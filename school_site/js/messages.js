import { supabase } from "./supabaseClient.js";

const convoListEl   = document.querySelector("#convo-list");
const threadEmptyEl = document.querySelector("#thread-empty");
const threadHeadEl  = document.querySelector("#thread-head");
const messagesEl    = document.querySelector("#msg-messages");
const msgStatusEl   = document.querySelector("#msg-status");
const msgComposeEl  = document.querySelector("#msg-compose");
const msgInputEl    = document.querySelector("#msg-input");
const msgSendBtn    = document.querySelector("#msg-send-btn");
const newConvoBtn   = document.querySelector("#new-convo-btn");

const state = {
  appUserId: null,
  convos: [],
  activeConvoId: null,
  messages: [],
  realtimeSub: null,
};

function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function setStatus(text, isError = false) {
  if (!msgStatusEl) return;
  msgStatusEl.textContent = text;
  msgStatusEl.style.color = isError ? "var(--danger)" : "var(--muted)";
}

// ── Conversation list ────────────────────────────────────────────

async function loadConversations() {
  if (!state.appUserId || !convoListEl) return;

  const { data: msgRows, error } = await supabase
    .from("message")
    .select("conversation_id, body, sent_at, sender_user_id")
    .or(`sender_user_id.eq.${state.appUserId}`)
    .order("sent_at", { ascending: false });

  if (error) {
    convoListEl.innerHTML = `<div class="msg-empty-list">Failed to load conversations.</div>`;
    return;
  }

  if (!msgRows?.length) {
    convoListEl.innerHTML = `<div class="msg-empty-list">No conversations yet.<br>Start one with the + New button.</div>`;
    return;
  }

  // Deduplicate by conversation_id, keep most recent message per convo
  const seen = new Map();
  for (const row of msgRows) {
    if (!seen.has(row.conversation_id)) seen.set(row.conversation_id, row);
  }

  state.convos = Array.from(seen.values());

  convoListEl.innerHTML = state.convos.map((c) => `
    <div class="msg-convo-item${c.conversation_id === state.activeConvoId ? " active" : ""}"
         data-convo-id="${escapeHtml(c.conversation_id)}">
      <span class="msg-convo-name">Conversation</span>
      <span class="msg-convo-preview">${escapeHtml(c.body?.slice(0, 60) || "(no messages)")}</span>
      <span class="msg-convo-time">${formatTime(c.sent_at)}</span>
    </div>
  `).join("");

  convoListEl.querySelectorAll(".msg-convo-item").forEach((item) => {
    item.addEventListener("click", () => openConversation(item.dataset.convoId));
  });
}

// ── Thread view ──────────────────────────────────────────────────

async function openConversation(convoId) {
  state.activeConvoId = convoId;

  // Mark active in list
  convoListEl?.querySelectorAll(".msg-convo-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.convoId === convoId);
  });

  if (threadEmptyEl) threadEmptyEl.hidden = true;
  if (threadHeadEl)  { threadHeadEl.hidden = false; threadHeadEl.textContent = "Conversation"; }
  if (messagesEl)    messagesEl.hidden = false;
  if (msgComposeEl)  msgComposeEl.hidden = false;

  setStatus("Loading messages…");
  await fetchMessages(convoId);
  subscribeToConvo(convoId);
  setStatus("");
}

async function fetchMessages(convoId) {
  const { data, error } = await supabase
    .from("message")
    .select("message_id, sender_user_id, body, sent_at")
    .eq("conversation_id", convoId)
    .order("sent_at", { ascending: true });

  if (error) { setStatus("Failed to load messages.", true); return; }
  state.messages = data || [];
  renderMessages();
}

function renderMessages() {
  if (!messagesEl) return;
  if (!state.messages.length) {
    messagesEl.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:.875rem;">No messages yet. Say hi!</div>`;
    return;
  }

  messagesEl.innerHTML = state.messages.map((msg) => {
    const mine = msg.sender_user_id === state.appUserId;
    return `
      <div class="msg-bubble-row${mine ? " mine" : ""}">
        <div class="msg-bubble">${escapeHtml(msg.body)}</div>
        <span class="msg-bubble-time">${formatTime(msg.sent_at)}</span>
      </div>
    `;
  }).join("");

  // Scroll to bottom
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function subscribeToConvo(convoId) {
  // Unsubscribe from previous
  if (state.realtimeSub) {
    supabase.removeChannel(state.realtimeSub);
    state.realtimeSub = null;
  }

  state.realtimeSub = supabase
    .channel(`messages:${convoId}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "message",
      filter: `conversation_id=eq.${convoId}`,
    }, (payload) => {
      state.messages.push(payload.new);
      renderMessages();
    })
    .subscribe();
}

// ── Send message ─────────────────────────────────────────────────

async function sendMessage() {
  const body = msgInputEl?.value?.trim();
  if (!body || !state.activeConvoId || !state.appUserId) return;

  msgSendBtn.disabled = true;
  setStatus("Sending…");

  const { error } = await supabase.from("message").insert({
    conversation_id: state.activeConvoId,
    sender_user_id: state.appUserId,
    body,
  });

  if (error) {
    setStatus("Failed to send.", true);
  } else {
    if (msgInputEl) msgInputEl.value = "";
    setStatus("");
    // Optimistically add to local state (realtime will also fire)
    state.messages.push({
      message_id: crypto.randomUUID(),
      sender_user_id: state.appUserId,
      body,
      sent_at: new Date().toISOString(),
    });
    renderMessages();
    loadConversations(); // refresh preview
  }

  msgSendBtn.disabled = false;
}

// ── New conversation ─────────────────────────────────────────────

async function startNewConversation() {
  const { data, error } = await supabase
    .from("conversation")
    .insert({})
    .select("conversation_id")
    .single();

  if (error || !data?.conversation_id) {
    setStatus("Could not create conversation.", true);
    return;
  }

  state.convos.unshift({ conversation_id: data.conversation_id, body: "", sent_at: new Date().toISOString() });
  await loadConversations();
  openConversation(data.conversation_id);
}

// ── Auto-grow textarea ───────────────────────────────────────────

msgInputEl?.addEventListener("input", () => {
  msgInputEl.style.height = "auto";
  msgInputEl.style.height = `${Math.min(msgInputEl.scrollHeight, 140)}px`;
});

msgInputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

msgSendBtn?.addEventListener("click", sendMessage);
newConvoBtn?.addEventListener("click", startNewConversation);

// ── Bootstrap ────────────────────────────────────────────────────

window.addEventListener("session-ready", async ({ detail }) => {
  const session = detail?.session;
  if (!session?.user?.id) return;

  // Get appUserId
  const { data: userRow } = await supabase
    .from("users")
    .select("user_id")
    .eq("auth_uid", session.user.id)
    .maybeSingle();

  state.appUserId = userRow?.user_id || null;
  if (!state.appUserId) {
    if (convoListEl) convoListEl.innerHTML = `<div class="msg-empty-list">Could not load your account.</div>`;
    return;
  }

  await loadConversations();

  // Auto-open conversation from URL param ?convo=<id>
  const params = new URLSearchParams(window.location.search);
  const convoParam = params.get("convo");
  if (convoParam) openConversation(convoParam);
});

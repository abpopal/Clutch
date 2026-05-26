import { supabase } from "./supabaseClient.js";

// ── DOM refs ─────────────────────────────────────────────────
const convoListEl   = document.querySelector("#convo-list");
const threadEmptyEl = document.querySelector("#thread-empty");
const threadHeadEl  = document.querySelector("#thread-head");
const messagesEl    = document.querySelector("#msg-messages");
const msgStatusEl   = document.querySelector("#msg-status");
const msgComposeEl  = document.querySelector("#msg-compose");
const msgInputEl    = document.querySelector("#msg-input");
const msgSendBtn    = document.querySelector("#msg-send-btn");
const newConvoBtn   = document.querySelector("#new-convo-btn");

// ── State ────────────────────────────────────────────────────
const state = {
  appUserId: null,
  appUserRole: null,
  convos: [],         // [{conversation_id, otherUserId, otherName, otherRole, lastMsg, lastTime}]
  activeConvoId: null,
  messages: [],
  realtimeSub: null,
  nameCache: new Map(),
};

// ── Helpers ──────────────────────────────────────────────────
function esc(v) {
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

function formatTimeFull(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function setStatus(text, isError = false) {
  if (!msgStatusEl) return;
  msgStatusEl.textContent = text;
  msgStatusEl.style.color = isError ? "var(--danger, #ef4444)" : "var(--muted)";
}

function roleBadge(role) {
  const r = (role || "").toLowerCase();
  if (r.includes("school") || r.includes("admin")) return "S";
  if (r.includes("coach")) return "C";
  if (r.includes("scout")) return "SC";
  if (r.includes("athlete")) return "A";
  return "U";
}

function roleLabel(role) {
  const r = (role || "").toLowerCase();
  if (r.includes("school") || r.includes("admin")) return "School";
  if (r.includes("coach")) return "Coach";
  if (r.includes("scout")) return "Scout";
  if (r.includes("athlete")) return "Athlete";
  return "User";
}

function initials(name) {
  return (name || "?").split(/\s+/).slice(0, 2).map((w) => (w[0] || "").toUpperCase()).join("") || "?";
}

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return uuid();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Resolve user names ───────────────────────────────────────
async function resolveNames(userIds) {
  const missing = userIds.filter((id) => !state.nameCache.has(id));
  if (!missing.length) return;

  // Try school_join_requests first (has display_name)
  try {
    const { data } = await supabase
      .from("school_join_requests")
      .select("user_id, display_name, role")
      .in("user_id", missing);
    for (const r of (data || [])) {
      if (r.user_id) state.nameCache.set(r.user_id, { name: r.display_name || "", role: r.role || "" });
    }
  } catch (_) {}

  // Fill gaps from user_directory
  const stillMissing = missing.filter((id) => !state.nameCache.has(id));
  if (stillMissing.length) {
    try {
      const { data } = await supabase
        .from("user_directory")
        .select("user_id, display_name, email")
        .in("user_id", stillMissing);
      for (const r of (data || [])) {
        if (r.user_id && !state.nameCache.has(r.user_id)) {
          state.nameCache.set(r.user_id, { name: r.display_name || r.email || "", role: "" });
        }
      }
    } catch (_) {}
  }

  // Get roles from users table for anyone still missing role
  const needRole = missing.filter((id) => {
    const c = state.nameCache.get(id);
    return c && !c.role;
  });
  if (needRole.length) {
    try {
      const { data } = await supabase
        .from("users")
        .select("user_id, role")
        .in("user_id", needRole);
      for (const r of (data || [])) {
        const c = state.nameCache.get(r.user_id);
        if (c) c.role = r.role || "";
      }
    } catch (_) {}
  }

  // Fallback for anyone completely missing
  for (const id of missing) {
    if (!state.nameCache.has(id)) {
      state.nameCache.set(id, { name: id.slice(0, 8), role: "" });
    }
  }
}

// ── Load conversations (via RPC) ─────────────────────────────
async function loadConversations() {
  if (!state.appUserId || !convoListEl) return;

  const { data, error } = await supabase.rpc("get_my_conversations");

  if (error) {
    console.error("loadConversations error:", error);
    convoListEl.innerHTML = `<div class="msg-empty-list">Failed to load conversations.<br><small style="color:var(--danger,#ef4444)">${esc(error.message)}</small></div>`;
    return;
  }

  if (!data?.length) {
    convoListEl.innerHTML = `<div class="msg-empty-list">No conversations yet.<br>Start one with the <strong>+ New</strong> button.</div>`;
    return;
  }

  state.convos = data.map((r) => ({
    conversation_id: r.conversation_id,
    otherUserId: r.other_user_id,
    otherName: r.other_name || "Unknown",
    otherRole: r.other_role || "",
    lastMsg: r.last_body || "",
    lastTime: r.last_sent_at || "",
    lastSenderId: r.last_sender_id || "",
  }));

  renderConvoList();
}

function renderConvoList() {
  if (!convoListEl) return;

  if (!state.convos.length) {
    convoListEl.innerHTML = `<div class="msg-empty-list">No conversations yet.<br>Start one with the <strong>+ New</strong> button.</div>`;
    return;
  }

  convoListEl.innerHTML = state.convos.map((c) => {
    const isActive = c.conversation_id === state.activeConvoId;
    const preview = c.lastMsg
      ? (c.lastSenderId === state.appUserId ? `You: ${c.lastMsg}` : c.lastMsg)
      : "(no messages yet)";
    const ini = initials(c.otherName);
    return `
      <div class="msg-convo-item${isActive ? " active" : ""}" data-convo-id="${esc(c.conversation_id)}">
        <div style="display:flex;gap:12px;align-items:center;">
          <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#245f73,#3a8f9f);display:grid;place-items:center;color:#fff;font-weight:700;font-size:.8rem;flex-shrink:0">${esc(ini)}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <span class="msg-convo-name">${esc(c.otherName)}</span>
              <span class="msg-convo-time">${formatTime(c.lastTime)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
              <span style="font-size:.7rem;background:var(--surface-2,#f0f0f0);padding:1px 6px;border-radius:4px;color:var(--muted);font-weight:600;">${esc(roleLabel(c.otherRole))}</span>
              <span class="msg-convo-preview">${esc(preview.slice(0, 50))}</span>
            </div>
          </div>
        </div>
      </div>`;
  }).join("");

  convoListEl.querySelectorAll(".msg-convo-item").forEach((item) => {
    item.addEventListener("click", () => openConversation(item.dataset.convoId));
  });
}

// ── Thread view ──────────────────────────────────────────────
async function openConversation(convoId) {
  state.activeConvoId = convoId;

  // Update active state in list
  convoListEl?.querySelectorAll(".msg-convo-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.convoId === convoId);
  });

  // Find the other user for the header
  const convo = state.convos.find((c) => c.conversation_id === convoId);
  const otherName = convo?.otherName || "Conversation";
  const otherRole = convo?.otherRole || "";

  if (threadEmptyEl) threadEmptyEl.hidden = true;
  if (threadHeadEl) {
    threadHeadEl.hidden = false;
    threadHeadEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span>${esc(otherName)}</span>
        <span style="font-size:.7rem;background:var(--surface-2,#f0f0f0);padding:2px 8px;border-radius:4px;color:var(--muted);font-weight:600;">${esc(roleLabel(otherRole))}</span>
      </div>`;
  }
  if (messagesEl) messagesEl.hidden = false;
  if (msgComposeEl) msgComposeEl.hidden = false;

  setStatus("Loading messages…");
  await fetchMessages(convoId);
  subscribeToConvo(convoId);
  setStatus("");

  // Focus input
  msgInputEl?.focus();

  // On mobile, hide sidebar and show thread
  const sidebar = document.querySelector(".msg-sidebar");
  if (sidebar && window.innerWidth <= 680) {
    sidebar.classList.remove("show");
  }
}

async function fetchMessages(convoId) {
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("message_id, sender_id, body, sent_at")
      .eq("conversation_id", convoId)
      .order("sent_at", { ascending: true });
    if (error) throw error;
    state.messages = data || [];
  } catch (err) {
    console.error("Fetch messages error:", err);
    setStatus(`Failed: ${err.message}`, true);
    return;
  }
  renderMessages();
}

function renderMessages() {
  if (!messagesEl) return;
  if (!state.messages.length) {
    messagesEl.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:.875rem;padding:2rem;">No messages yet. Say hi!</div>`;
    return;
  }

  messagesEl.innerHTML = state.messages.map((msg, i) => {
    const mine = msg.sender_id === state.appUserId;
    // Show time label if gap > 5 min from previous
    let timeLabel = "";
    if (i === 0 || (new Date(msg.sent_at) - new Date(state.messages[i - 1]?.sent_at)) > 300000) {
      timeLabel = `<div style="text-align:center;font-size:.7rem;color:var(--muted);padding:8px 0;">${formatTime(msg.sent_at)}</div>`;
    }
    return `
      ${timeLabel}
      <div class="msg-bubble-row${mine ? " mine" : ""}">
        <div class="msg-bubble">${esc(msg.body)}</div>
        <span class="msg-bubble-time">${formatTimeFull(msg.sent_at)}</span>
      </div>`;
  }).join("");

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function subscribeToConvo(convoId) {
  if (state.realtimeSub) {
    supabase.removeChannel(state.realtimeSub);
    state.realtimeSub = null;
  }

  state.realtimeSub = supabase
    .channel(`messages:${convoId}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `conversation_id=eq.${convoId}`,
    }, (payload) => {
      // Avoid duplicates (optimistic insert may already have it)
      if (!state.messages.some((m) => m.message_id === payload.new.message_id)) {
        state.messages.push(payload.new);
        renderMessages();
      }
    })
    .subscribe();
}

// ── Send message ─────────────────────────────────────────────
async function sendMessage() {
  const body = msgInputEl?.value?.trim();
  if (!body || !state.activeConvoId || !state.appUserId) return;

  msgSendBtn.disabled = true;
  setStatus("Sending…");

  const tempId = uuid();
  const now = new Date().toISOString();

  state.messages.push({
    message_id: tempId,
    sender_id: state.appUserId,
    body,
    sent_at: now,
  });
  renderMessages();
  if (msgInputEl) msgInputEl.value = "";

  try {
    const { error } = await supabase.from("messages").insert({
      conversation_id: state.activeConvoId,
      sender_id: state.appUserId,
      body,
    });

    if (error) {
      state.messages = state.messages.filter((m) => m.message_id !== tempId);
      renderMessages();
      setStatus(`Failed: ${error.message || error.code}`, true);
    } else {
      setStatus("");
      const convo = state.convos.find((c) => c.conversation_id === state.activeConvoId);
      if (convo) {
        convo.lastMsg = body;
        convo.lastTime = now;
        convo.lastSenderId = state.appUserId;
      }
      renderConvoList();
    }
  } catch (err) {
    state.messages = state.messages.filter((m) => m.message_id !== tempId);
    renderMessages();
    setStatus(`Error: ${err.message}`, true);
  }

  msgSendBtn.disabled = false;
}

// ── New conversation modal ───────────────────────────────────
let _newConvoOverlay = null;

function ensureNewConvoModal() {
  if (_newConvoOverlay) return _newConvoOverlay;

  _newConvoOverlay = document.createElement("div");
  Object.assign(_newConvoOverlay.style, {
    position: "fixed", inset: "0", zIndex: "9999",
    background: "rgba(0,0,0,.55)", backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    opacity: "0", pointerEvents: "none", transition: "opacity .25s ease",
  });

  _newConvoOverlay.innerHTML = `
    <div style="
      background:var(--surface); border-radius:16px; width:94%; max-width:460px;
      max-height:75vh; display:flex; flex-direction:column;
      box-shadow:0 24px 80px rgba(0,0,0,.5); transform:translateY(16px) scale(.97);
      transition:transform .25s ease; overflow:hidden; border:1px solid var(--line);
    " id="new-convo-modal">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line);flex-shrink:0;">
        <h3 style="margin:0;font-size:1.05rem;font-weight:700;color:var(--text);">New Message</h3>
        <button id="new-convo-close" style="width:32px;height:32px;border-radius:50%;border:none;background:var(--surface-2);color:var(--muted);font-size:1.2rem;cursor:pointer;display:grid;place-items:center;">&times;</button>
      </div>
      <div style="padding:12px 22px;flex-shrink:0;">
        <input id="new-convo-search" type="text" placeholder="Search by name..." style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:10px;font-size:.875rem;outline:none;box-sizing:border-box;background:var(--surface-2);color:var(--text);">
      </div>
      <div id="new-convo-results" style="padding:4px 10px;overflow-y:auto;flex:1;">
        <div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:.85rem;">Type a name to search for users to message.</div>
      </div>
    </div>`;

  document.body.appendChild(_newConvoOverlay);

  _newConvoOverlay.addEventListener("click", (e) => {
    if (e.target === _newConvoOverlay) closeNewConvoModal();
  });
  _newConvoOverlay.querySelector("#new-convo-close").addEventListener("click", closeNewConvoModal);

  // Search input with debounce
  let searchTimer = null;
  _newConvoOverlay.querySelector("#new-convo-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void searchUsers(e.target.value.trim()), 300);
  });

  return _newConvoOverlay;
}

function openNewConvoModal() {
  const overlay = ensureNewConvoModal();
  void overlay.offsetWidth;
  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  overlay.querySelector("#new-convo-modal").style.transform = "translateY(0) scale(1)";
  overlay.querySelector("#new-convo-search").value = "";
  overlay.querySelector("#new-convo-search").focus();
  overlay.querySelector("#new-convo-results").innerHTML = `<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:.85rem;">Type a name to search for users to message.</div>`;
}

function closeNewConvoModal() {
  if (!_newConvoOverlay) return;
  _newConvoOverlay.style.opacity = "0";
  _newConvoOverlay.style.pointerEvents = "none";
  _newConvoOverlay.querySelector("#new-convo-modal").style.transform = "translateY(16px) scale(.97)";
}

// Allowed messaging pairs
const ALLOWED_PAIRS = {
  athlete:      ["school_admin", "coach", "scout"],
  school_admin: ["athlete"],
  coach:        ["athlete"],
  scout:        ["athlete"],
};

function canMessage(myRole, theirRole) {
  const myNorm = (myRole || "").toLowerCase().replace(/\s+/g, "_");
  const theirNorm = (theirRole || "").toLowerCase().replace(/\s+/g, "_");
  const allowed = ALLOWED_PAIRS[myNorm] || ALLOWED_PAIRS.athlete || [];
  return allowed.some((r) => theirNorm.includes(r));
}

async function searchUsers(query) {
  const results = document.querySelector("#new-convo-results");
  if (!results) return;

  if (!query || query.length < 2) {
    results.innerHTML = `<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:.85rem;">Type at least 2 characters to search.</div>`;
    return;
  }

  results.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:.85rem;">Searching...</div>`;

  try {
    // Search school_join_requests for matching names
    const { data: sjrRows } = await supabase
      .from("school_join_requests")
      .select("user_id, display_name, role")
      .ilike("display_name", `%${query}%`)
      .neq("user_id", state.appUserId)
      .limit(20);

    const users = (sjrRows || []).filter((r) => r.user_id);

    // Also get roles from users table for role filtering
    const userIds = users.map((u) => u.user_id);
    let roleMap = new Map();
    if (userIds.length) {
      try {
        const { data: uRows } = await supabase
          .from("users")
          .select("user_id, role")
          .in("user_id", userIds);
        for (const r of (uRows || [])) roleMap.set(r.user_id, r.role);
      } catch (_) {}
    }

    // Filter to only allowed message pairs
    const filtered = users.filter((u) => {
      const theirRole = roleMap.get(u.user_id) || u.role || "";
      return canMessage(state.appUserRole, theirRole);
    });

    if (!filtered.length) {
      results.innerHTML = `<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:.85rem;">No messageable users found for "${esc(query)}".<br><span style="font-size:.75rem;">You can message: ${(ALLOWED_PAIRS[(state.appUserRole || "").toLowerCase().replace(/\s+/g, "_")] || []).map(roleLabel).join(", ") || "other roles"}.</span></div>`;
      return;
    }

    results.innerHTML = filtered.map((u) => {
      const role = roleMap.get(u.user_id) || u.role || "";
      const ini = initials(u.display_name);
      return `
        <div class="new-convo-user" data-user-id="${esc(u.user_id)}" style="
          display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:10px;
          cursor:pointer;transition:background .12s;
        " onmouseenter="this.style.background='var(--surface-2)'" onmouseleave="this.style.background='none'">
          <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#245f73,#3a8f9f);display:grid;place-items:center;color:#fff;font-weight:700;font-size:.8rem;flex-shrink:0">${esc(ini)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:.9rem;color:var(--text);">${esc(u.display_name)}</div>
            <div style="font-size:.75rem;color:var(--muted);margin-top:1px;">${roleBadge(role)} ${esc(roleLabel(role))}</div>
          </div>
        </div>`;
    }).join("");

    results.querySelectorAll(".new-convo-user").forEach((el) => {
      el.addEventListener("click", () => void startConversationWith(el.dataset.userId));
    });
  } catch (err) {
    console.error("Search failed:", err);
    results.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger);font-size:.85rem;">Search failed.</div>`;
  }
}

async function startConversationWith(otherUserId) {
  if (!otherUserId || !state.appUserId) return;

  closeNewConvoModal();
  setStatus("Opening conversation...");

  try {
    // RPC finds existing or creates new — all in one call, bypasses RLS
    const { data: convoId, error } = await supabase.rpc("find_or_create_conversation", {
      user_a: state.appUserId,
      user_b: otherUserId,
    });

    if (error || !convoId) {
      throw new Error(error?.message || "Could not create conversation.");
    }

    await loadConversations();
    await openConversation(convoId);
    setStatus("");
  } catch (err) {
    console.error("Start conversation failed:", err);
    setStatus(err.message || "Failed to start conversation.", true);
  }
}

// ── Auto-grow textarea ───────────────────────────────────────
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
newConvoBtn?.addEventListener("click", openNewConvoModal);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeNewConvoModal();
});

// ── Bootstrap ────────────────────────────────────────────────
let _initDone = false;
let _initRunning = false;

async function init() {
  if (_initDone || _initRunning) return;
  _initRunning = true;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) { _initRunning = false; return; }

    // Get appUserId and role
    const { data: userRow } = await supabase
      .from("users")
      .select("user_id, role")
      .eq("auth_uid", session.user.id)
      .maybeSingle();

    state.appUserId = userRow?.user_id || null;
    state.appUserRole = userRow?.role || "athlete";

    if (!state.appUserId) {
      if (convoListEl) convoListEl.innerHTML = `<div class="msg-empty-list">Could not load your account.</div>`;
      _initRunning = false;
      return;
    }

    _initDone = true;
    await loadConversations();

    // Mark all message notifications as read + clear sidebar badge
    supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", state.appUserId)
      .eq("type", "message")
      .is("read_at", null)
      .then(() => {
        const badge = document.querySelector(".nav-msg-badge");
        if (badge) badge.remove();
      })
      .catch(() => {});

    // Auto-open conversation from URL params
    const params = new URLSearchParams(window.location.search);
    const convoParam = params.get("convo");
    const userParam = params.get("user_id");

    if (convoParam) {
      await openConversation(convoParam);
    } else if (userParam && userParam !== state.appUserId) {
      // Start/open conversation with specific user (from profile "Message" button)
      await startConversationWith(userParam);
    }
  } catch (err) {
    console.error("Messages init failed:", err);
    if (convoListEl) convoListEl.innerHTML = `<div class="msg-empty-list">Failed to load messages: ${esc(err.message)}</div>`;
  } finally {
    _initRunning = false;
  }
}

window.addEventListener("session-ready", () => void init());
window.addEventListener("ua-app-state-change", () => void init());
void init();

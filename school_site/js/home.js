import { supabase } from "./supabaseClient.js";

// ── Seed data (shown when feed is empty / not following anyone) ──────────────
const fallbackFollowingSeed = [
  {
    authorName: "Coach Elena Mendez",
    authorRole: "coach",
    sport: "basketball",
    caption: "Film session is up. We cleaned up late-clock spacing and transition defense from the last two games.",
    created_at: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    source: "fallback",
  },
  {
    authorName: "Westview Athletics",
    authorRole: "school",
    sport: "basketball",
    caption: "Final from tonight: Westview 68, North Ridge 61. Full recap and photo set coming after recovery.",
    created_at: new Date(Date.now() - 1000 * 60 * 130).toISOString(),
    source: "fallback",
  },
  {
    authorName: "Ava Kim",
    authorRole: "athlete",
    sport: "soccer",
    caption: "Back on the field this week. Appreciate everyone who checked in during rehab.",
    created_at: new Date(Date.now() - 1000 * 60 * 300).toISOString(),
    source: "fallback",
  },
];

// ── DOM refs ─────────────────────────────────────────────────────────────────
const feedListEl        = document.querySelector("#home-feed");
const statusEl          = document.querySelector("#connection-status");
const metricFollowingEl = document.querySelector("#metric-following");
const metricPostsEl     = document.querySelector("#metric-posts");
const metricTrendingEl  = document.querySelector("#metric-trending");
const metricUnreadEl    = document.querySelector("#metric-unread");

const filterTabs        = Array.from(document.querySelectorAll("#feed-filters button"));
const postTypeTabs      = Array.from(document.querySelectorAll("#post-type-tabs button"));

const composerPanel     = document.querySelector("#composer-panel");
const composerForm      = document.querySelector("#composer-form");
const composerStatus    = document.querySelector("#composer-status");
const composerCaption   = document.querySelector("#composer-caption");
const composerVisibility= document.querySelector("#composer-visibility");
const composerAvatar    = document.querySelector("#composer-avatar");
const recapFields       = document.querySelector("#recap-fields");
const recapScore        = document.querySelector("#recap-score");
const recapStandout     = document.querySelector("#recap-standout");
const recapHighlights   = document.querySelector("#recap-highlights");

// ── State ────────────────────────────────────────────────────────────────────
let currentSession  = null;
let currentRole     = "general";
let currentPostType = "standard";
let activeFilter    = "all";
let appUserId       = null;
let followedIds     = [];
let followingRows   = [...fallbackFollowingSeed];
let myReactions     = new Set();   // post_ids the current user has liked
let uiBound         = false;

// ── Helpers ──────────────────────────────────────────────────────────────────
function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function setComposerStatus(text, type = "") {
  if (!composerStatus) return;
  composerStatus.textContent = text;
  composerStatus.className = "composer-status-msg" + (type ? ` ${type}` : "");
}

function setMetric(el, value) {
  if (el) el.textContent = String(value);
}

function normalizeSport(raw, fallbackCaption = "") {
  const value = (raw || "").toString().toLowerCase();
  if (value) return value;
  const caption = fallbackCaption.toLowerCase();
  if (caption.includes("basket")) return "basketball";
  if (caption.includes("soccer")) return "soccer";
  if (caption.includes("football")) return "football";
  if (caption.includes("track")) return "track";
  if (caption.includes("baseball")) return "baseball";
  if (caption.includes("volleyball")) return "volleyball";
  return "";
}

function formatTime(isoString) {
  if (!isoString) return "now";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins   = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60)            return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24)           return `${hours}h`;
  const days  = Math.round(hours / 24);
  if (days < 7)             return `${days}d`;
  return new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function roleLabel(role) {
  const map = { athlete: "Athlete", coach: "Coach", school: "School", school_admin: "School", scout: "Scout" };
  return map[role] || role || "Member";
}

function sportEmoji(sport) {
  const map = { basketball: "BB", soccer: "SC", football: "FB", track: "TK", baseball: "BA", volleyball: "VB", tennis: "TN" };
  return map[sport] || "";
}

function avatarUrl(seed) {
  return `https://i.pravatar.cc/80?u=${encodeURIComponent(seed || "ua")}`;
}

function renderMedia(mediaItems) {
  if (!mediaItems || !mediaItems.length) return "";
  return `<div class="tweet-media">` + mediaItems.map((m) => {
    if (m.media_type === "video") {
      return `<video class="tweet-media-item" src="${escHtml(m.media_url)}" controls playsinline></video>`;
    }
    return `<img class="tweet-media-item" src="${escHtml(m.media_url)}" alt="Post media" loading="lazy">`;
  }).join("") + `</div>`;
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderRows(rows) {
  if (!feedListEl) return;
  feedListEl.innerHTML = "";

  if (!rows.length) {
    feedListEl.innerHTML = `<div class="tweet-placeholder">No posts yet. Follow athletes and coaches to fill your feed.</div>`;
    return;
  }

  rows.forEach((row) => {
    const sport   = normalizeSport(row.sport, row.caption);
    const emoji   = sportEmoji(sport);
    const isSeed  = row.source === "fallback";
    const seed    = row.authorName || row.authorRole || "user";
    const liked   = row.post_id && myReactions.has(row.post_id);
    const likeCount = row.interactions_count || 0;

    const article = document.createElement("article");
    article.className = "tweet-card";
    const profileHref = row.authorUserId ? `user-profile.html?user_id=${encodeURIComponent(row.authorUserId)}` : "";
    article.innerHTML = `
      ${profileHref
        ? `<a href="${profileHref}" class="tw-avatar-link"><img class="tw-avatar" src="${avatarUrl(seed)}" alt="${escHtml(row.authorName || "User")}"></a>`
        : `<img class="tw-avatar" src="${avatarUrl(seed)}" alt="${escHtml(row.authorName || "User")}">`}
      <div class="tweet-body">
        <div class="tweet-head">
          ${profileHref
            ? `<a href="${profileHref}" class="tweet-name tweet-name-link">${escHtml(row.authorName || roleLabel(row.authorRole))}</a>`
            : `<span class="tweet-name">${escHtml(row.authorName || roleLabel(row.authorRole))}</span>`}
          <span class="tweet-meta">${roleLabel(row.authorRole)}${sport ? ` · ${emoji} ${sport}` : ""}</span>
          <span class="tweet-time">${formatTime(row.created_at)}</span>
        </div>
        <p class="tweet-text">${escHtml(row.caption || "")}</p>
        ${renderMedia(row.media || [])}
        ${isSeed ? `<div class="tweet-seed-badge">Sample post</div>` : ""}
        <div class="tweet-actions">
          <button class="tweet-action tweet-like-btn ${liked ? "is-liked" : ""}"
                  ${row.post_id ? `data-post-id="${escHtml(row.post_id)}"` : ""}
                  title="${liked ? "Unlike" : "Like"}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span class="like-count">${likeCount}</span>
          </button>
          <button class="tweet-action" title="Share">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            <span>Share</span>
          </button>
        </div>
      </div>
    `;
    feedListEl.appendChild(article);
  });
}

function getFilteredRows() {
  return followingRows.filter((row) => {
    if (activeFilter === "all") return true;
    const role  = (row.authorRole || "").toLowerCase();
    const sport = normalizeSport(row.sport, row.caption);
    if (["athlete", "coach", "school", "school_admin"].includes(activeFilter)) {
      return role === activeFilter || (activeFilter === "school" && role === "school_admin");
    }
    return sport === activeFilter;
  });
}

function refreshView() {
  const rows = getFilteredRows();
  renderRows(rows);
  setMetric(metricPostsEl,     rows.length);
  setMetric(metricFollowingEl, followedIds.length || 0);
  setMetric(metricUnreadEl,    currentSession?.user?.user_metadata?.unread_notifications ?? 0);
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function resolveAppUserId(authUserId) {
  const { data, error } = await supabase
    .from("users")
    .select("user_id")
    .eq("auth_uid", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data?.user_id || null;
}

async function loadFollowingFeed() {
  if (!currentSession?.user?.id) return;

  appUserId = await resolveAppUserId(currentSession.user.id);

  // Update composer avatar
  if (composerAvatar) {
    composerAvatar.src = avatarUrl(
      currentSession.user.user_metadata?.name || currentSession.user.id
    );
  }

  if (!appUserId) {
    followingRows = fallbackFollowingSeed;
    followedIds   = [];
    setStatus("No linked profile found. Showing sample posts.");
    refreshView();
    return;
  }

  // Fetch who we follow
  const { data: followData, error: followError } = await supabase
    .from("follow")
    .select("followed_user_id")
    .eq("follower_user_id", appUserId);

  if (followError) throw followError;

  followedIds = (followData || []).map((r) => r.followed_user_id).filter(Boolean);

  if (!followedIds.length) {
    followingRows = fallbackFollowingSeed;
    setStatus("Follow athletes and coaches to personalise your feed.");
    refreshView();
    return;
  }

  // Fetch posts + author names in parallel
  const [postsRes, directoryRes] = await Promise.all([
    supabase
      .from("post")
      .select("post_id,author_user_id,author_role,caption,post_type,created_at,visibility,interactions_count,post_media(media_id,media_url,media_type)")
      .in("author_user_id", followedIds)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("user_directory")
      .select("user_id,display_name")
      .in("user_id", followedIds),
  ]);

  if (postsRes.error)     throw postsRes.error;
  if (directoryRes.error) console.warn("Directory lookup skipped:", directoryRes.error.message);

  const nameMap = new Map(
    (directoryRes.data || []).map((r) => [r.user_id, r.display_name])
  );

  const posts = postsRes.data || [];

  // Load current user's reactions for these posts
  const postIds = posts.map((p) => p.post_id).filter(Boolean);
  if (appUserId && postIds.length) {
    const { data: reactionData } = await supabase
      .from("post_reactions")
      .select("post_id")
      .eq("user_id", appUserId)
      .in("post_id", postIds);
    myReactions = new Set((reactionData || []).map((r) => r.post_id));
  } else {
    myReactions = new Set();
  }

  followingRows = (posts.length ? posts : fallbackFollowingSeed).map((row) => ({
    post_id:           row.post_id || null,
    authorUserId:      row.author_user_id || null,
    authorName:        row.author_user_id ? (nameMap.get(row.author_user_id) || roleLabel(row.author_role)) : row.authorName,
    authorRole:        row.author_role || row.authorRole,
    caption:           row.caption,
    created_at:        row.created_at,
    sport:             normalizeSport("", row.caption),
    visibility:        row.visibility || "public",
    interactions_count:row.interactions_count || 0,
    media:             row.post_media || [],
    source:            posts.length ? "following" : "fallback",
  }));

  setStatus(posts.length ? "" : "No posts yet from people you follow.");
  refreshView();
}

// ── Media upload ──────────────────────────────────────────────────────────────
const composerMediaInput = document.querySelector("#composer-media");
const composerMediaPreview = document.querySelector("#composer-media-preview");

let pendingMediaFile = null;

composerMediaInput?.addEventListener("change", () => {
  const file = composerMediaInput.files?.[0];
  if (!file) { pendingMediaFile = null; return; }
  pendingMediaFile = file;

  // Show preview
  if (composerMediaPreview) {
    const url = URL.createObjectURL(file);
    composerMediaPreview.innerHTML = file.type.startsWith("video/")
      ? `<video src="${url}" controls class="tweet-media-item" style="max-height:160px;border-radius:8px;"></video>
         <button type="button" class="composer-clear-media" title="Remove">✕</button>`
      : `<img src="${url}" alt="Preview" class="tweet-media-item" style="max-height:160px;border-radius:8px;">
         <button type="button" class="composer-clear-media" title="Remove">✕</button>`;
    composerMediaPreview.hidden = false;
    composerMediaPreview.querySelector(".composer-clear-media")?.addEventListener("click", () => {
      pendingMediaFile = null;
      composerMediaInput.value = "";
      composerMediaPreview.innerHTML = "";
      composerMediaPreview.hidden = true;
    });
  }
});

async function uploadMediaToStorage(file, userId) {
  const ext = file.name.split(".").pop() || "bin";
  const path = `posts/${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("post-media").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  const { data: publicData } = supabase.storage.from("post-media").getPublicUrl(path);
  return { url: publicData.publicUrl, type: file.type.startsWith("video/") ? "video" : "image" };
}

// ── Post composer ─────────────────────────────────────────────────────────────
async function handleComposerSubmit(event) {
  event.preventDefault();
  setComposerStatus("");

  if (!currentSession?.user?.id) {
    setComposerStatus("Not signed in.", "error");
    return;
  }

  const caption = composerCaption?.value.trim() || "";
  if (!caption) {
    setComposerStatus("Write something first.", "error");
    composerCaption?.focus();
    return;
  }

  let finalCaption = caption;
  if (currentPostType === "recap") {
    const score     = recapScore?.value.trim();
    const standouts = recapStandout?.value.trim();
    const highlights= recapHighlights?.value.trim();
    if (score)      finalCaption += `\nScore: ${score}`;
    if (standouts)  finalCaption += `\nStandouts: ${standouts}`;
    if (highlights) finalCaption += `\n${highlights}`;
  }

  try {
    if (!appUserId) appUserId = await resolveAppUserId(currentSession.user.id);
    if (!appUserId) throw new Error("No linked profile found for your account.");

    // Upload media if attached
    let mediaUrl = null;
    let mediaType = null;
    if (pendingMediaFile) {
      setComposerStatus("Uploading media…");
      try {
        const uploaded = await uploadMediaToStorage(pendingMediaFile, appUserId);
        mediaUrl = uploaded.url;
        mediaType = uploaded.type;
      } catch (uploadErr) {
        console.warn("Media upload failed, posting without media:", uploadErr.message);
        setComposerStatus("Media upload failed — posting without it.");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const postType = mediaType === "video" ? "video"
                   : mediaType === "image" ? "image"
                   : currentPostType === "recap" ? "recap" : "text";

    const { data: postRow, error } = await supabase.from("post").insert({
      author_user_id: appUserId,
      author_role:    currentRole,
      caption:        finalCaption,
      visibility:     composerVisibility?.value || "public",
      post_type:      postType,
    }).select("post_id").single();

    if (error) throw error;

    // Attach media record if uploaded
    if (mediaUrl && postRow?.post_id) {
      await supabase.from("post_media").insert({
        post_id:    postRow.post_id,
        media_url:  mediaUrl,
        media_type: mediaType,
      }).then(({ error: me }) => {
        if (me) console.warn("post_media insert failed:", me.message);
      });
    }

    // Reset
    pendingMediaFile = null;
    if (composerMediaInput) composerMediaInput.value = "";
    if (composerMediaPreview) { composerMediaPreview.innerHTML = ""; composerMediaPreview.hidden = true; }
    composerForm.reset();
    if (recapFields) recapFields.hidden = true;
    setComposerStatus("Posted!", "success");
    setTimeout(() => setComposerStatus(""), 2500);
    await loadFollowingFeed();
  } catch (err) {
    console.error("Post failed:", err);
    setComposerStatus(err.message || "Failed to post.", "error");
  }
}

// ── UI binding ────────────────────────────────────────────────────────────────
function bindUI() {
  // Feed filters
  filterTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      filterTabs.forEach((t) => t.classList.toggle("active", t === btn));
      refreshView();
    });
  });

  // Post type tabs
  postTypeTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentPostType = btn.dataset.postType;
      postTypeTabs.forEach((t) => t.classList.toggle("active", t === btn));
      if (recapFields) recapFields.hidden = currentPostType !== "recap";
    });
  });

  // Auto-grow textarea
  composerCaption?.addEventListener("input", () => {
    composerCaption.style.height = "auto";
    composerCaption.style.height = composerCaption.scrollHeight + "px";
  });

  composerForm?.addEventListener("submit", handleComposerSubmit);

  // Like / reaction toggle (event delegation on feed)
  feedListEl?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".tweet-like-btn[data-post-id]");
    if (!btn || !appUserId) return;

    const postId = btn.dataset.postId;
    const isLiked = btn.classList.contains("is-liked");
    const countEl = btn.querySelector(".like-count");
    const svg = btn.querySelector("svg");
    let count = parseInt(countEl?.textContent || "0", 10);

    // Optimistic UI update
    if (isLiked) {
      btn.classList.remove("is-liked");
      if (svg) svg.setAttribute("fill", "none");
      count = Math.max(0, count - 1);
      myReactions.delete(postId);
    } else {
      btn.classList.add("is-liked");
      btn.classList.add("like-pop");
      if (svg) svg.setAttribute("fill", "currentColor");
      count += 1;
      myReactions.add(postId);
      setTimeout(() => btn.classList.remove("like-pop"), 400);
    }
    if (countEl) countEl.textContent = String(count);

    // Update the row data too
    const row = followingRows.find((r) => r.post_id === postId);
    if (row) row.interactions_count = count;

    // DB update
    try {
      if (isLiked) {
        await supabase.from("post_reactions")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", appUserId);
      } else {
        await supabase.from("post_reactions")
          .upsert({ post_id: postId, user_id: appUserId, reaction: "like" },
                   { onConflict: "post_id,user_id" });
      }
    } catch (err) {
      console.error("Reaction toggle failed:", err);
    }
  });
}

// ── Session entry point ───────────────────────────────────────────────────────
window.addEventListener("session-ready", ({ detail }) => {
  currentSession = detail?.session || null;
  currentRole    = detail?.role    || "general";

  const canPost  = ["athlete", "coach", "school_admin", "school"].includes(currentRole);
  if (composerPanel) composerPanel.hidden = !canPost;

  if (!uiBound) { bindUI(); uiBound = true; }

  loadFollowingFeed().catch((err) => {
    console.error("Feed load failed:", err);
    followingRows = fallbackFollowingSeed;
    setStatus(err.message || "Could not load feed.", true);
    refreshView();
  });
});

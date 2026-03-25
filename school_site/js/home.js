import { supabase } from "./supabaseClient.js";

const fallbackFollowingSeed = [
  {
    authorName: "Coach Elena Mendez",
    authorRole: "coach",
    sport: "basketball",
    caption: "Film session is up. We cleaned up late-clock spacing and transition defense from the last two games.",
    created_at: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
  },
  {
    authorName: "Westview Girls Basketball",
    authorRole: "school",
    sport: "basketball",
    caption: "Final from tonight: Westview 68, North Ridge 61. Full recap and photo set coming after recovery and media upload.",
    created_at: new Date(Date.now() - 1000 * 60 * 130).toISOString(),
  },
  {
    authorName: "Ava Kim",
    authorRole: "athlete",
    sport: "soccer",
    caption: "Back on the field this week. Appreciate everyone who checked in during rehab.",
    created_at: new Date(Date.now() - 1000 * 60 * 300).toISOString(),
  },
];

const fallbackPulseSeed = [
  { sport: "basketball" },
  { sport: "football" },
  { sport: "soccer" },
  { sport: "track" },
];

const statusEl = document.querySelector("#connection-status");
const feedListEl = document.querySelector("#home-feed");
const metricFollowingEl = document.querySelector("#metric-following");
const metricPostsEl = document.querySelector("#metric-posts");
const metricTrendingEl = document.querySelector("#metric-trending");
const metricUnreadEl = document.querySelector("#metric-unread");

const filterTabs = Array.from(document.querySelectorAll("#feed-filters button"));
const postTypeTabs = Array.from(document.querySelectorAll("#post-type-tabs button"));

const composerPanel = document.querySelector("#composer-panel");
const composerForm = document.querySelector("#composer-form");
const composerStatus = document.querySelector("#composer-status");
const composerCaption = document.querySelector("#composer-caption");
const composerVisibility = document.querySelector("#composer-visibility");
const composerSchedule = document.querySelector("#composer-schedule");
const composerTags = document.querySelector("#composer-tags");
const recapFields = document.querySelector("#recap-fields");
const recapScore = document.querySelector("#recap-score");
const recapStandout = document.querySelector("#recap-standout");
const recapHighlights = document.querySelector("#recap-highlights");

let currentSession = null;
let currentRole = "general";
let currentPostType = "standard";
let activeFilter = "all";
let appUserId = null;
let followedIds = [];
let followingRows = [...fallbackFollowingSeed];
let uiBound = false;

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#b42318" : "var(--muted)";
}

function setComposerStatus(text, type = "") {
  if (!composerStatus) return;
  composerStatus.textContent = text;
  composerStatus.classList.remove("error", "success");
  if (type) composerStatus.classList.add(type);
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
  return "general";
}

function formatTime(isoString) {
  if (!isoString) return "Just now";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function roleCanPost(role) {
  return ["athlete", "coach", "school"].includes(role);
}

function renderRows(rows) {
  if (!feedListEl) return;
  feedListEl.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "No posts found for current filters.";
    feedListEl.appendChild(empty);
    return;
  }

  rows.forEach((row) => {
    const item = document.createElement("article");
    item.className = "post-card";
    item.innerHTML = `
      <div class="post-card-head">
        <div>
          <strong>${row.authorName || row.authorRole || "Creator"}</strong>
          <div class="post-meta-line">${row.authorRole || "member"} • ${normalizeSport(row.sport, row.caption)}</div>
        </div>
        <span class="tag">${formatTime(row.created_at)}</span>
      </div>
      <p class="post-caption">${row.caption || "(No caption)"}</p>
      <div class="post-card-foot">
        <span class="pill">${row.source === "fallback" ? "Sample network post" : "Following"}</span>
        <span class="helper">${row.visibility === "followers" ? "Followers only" : "Public update"}</span>
      </div>
    `;
    feedListEl.appendChild(item);
  });
}

function getFilteredRows() {
  return followingRows.filter((row) => {
    const sport = normalizeSport(row.sport, row.caption);
    if (activeFilter === "all") return true;
    if (["athlete", "coach", "school"].includes(activeFilter)) {
      return (row.authorRole || "").toLowerCase() === activeFilter;
    }
    return sport === activeFilter;
  });
}

function refreshView() {
  const rows = getFilteredRows();
  renderRows(rows);
  setMetric(metricPostsEl, rows.length);
  setMetric(metricTrendingEl, fallbackPulseSeed.length);
  setMetric(metricFollowingEl, followedIds.length || fallbackFollowingSeed.length);
  setMetric(metricUnreadEl, currentSession?.user?.user_metadata?.unread_notifications ?? 4);
}

async function resolveAppUserId(authUserId) {
  const { data, error } = await supabase
    .from("users")
    .select("user_id")
    .eq("firebase_uid", authUserId)
    .maybeSingle();

  if (error) throw error;
  return data?.user_id || null;
}

async function loadFollowingFeed() {
  if (!currentSession?.user?.id) return;

  appUserId = await resolveAppUserId(currentSession.user.id);
  if (!appUserId) {
    followingRows = fallbackFollowingSeed.map((row) => ({ ...row, source: "fallback" }));
    followedIds = [];
    setStatus("No linked app profile found yet. Showing sample following posts.");
    refreshView();
    return;
  }

  const { data: followData, error: followError } = await supabase
    .from("follow")
    .select("followed_user_id")
    .eq("follower_user_id", appUserId);

  if (followError) throw followError;

  followedIds = (followData || []).map((row) => row.followed_user_id).filter(Boolean);
  if (!followedIds.length) {
    followingRows = fallbackFollowingSeed.map((row) => ({ ...row, source: "fallback" }));
    setStatus("Follow accounts to personalize this feed. Showing sample network posts for now.");
    refreshView();
    return;
  }

  const [{ data: postsData, error: postsError }, { data: directoryData, error: directoryError }] = await Promise.all([
    supabase
      .from("post")
      .select("author_user_id, author_role, caption, created_at, visibility")
      .in("author_user_id", followedIds)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("user_directory")
      .select("user_id,display_name,email")
      .in("user_id", followedIds),
  ]);

  if (postsError) throw postsError;
  if (directoryError) console.warn("user_directory lookup skipped", directoryError.message);

  const directoryByUserId = new Map((directoryData || []).map((row) => [row.user_id, row]));

  followingRows = ((postsData || []).length ? postsData : fallbackFollowingSeed).map((row) => ({
    authorName: row.author_user_id ? directoryByUserId.get(row.author_user_id)?.display_name || row.author_role : row.authorName,
    authorRole: row.author_role || row.authorRole,
    caption: row.caption,
    created_at: row.created_at,
    sport: normalizeSport("", row.caption),
    visibility: row.visibility || "public",
    source: (postsData || []).length ? "following" : "fallback",
  }));

  setStatus((postsData || []).length ? "Connected to your following feed." : "No live posts found yet. Showing sample feed content.");
  refreshView();
}

async function handleComposerSubmit(event) {
  event.preventDefault();
  setComposerStatus("");

  if (!currentSession?.user?.id) {
    setComposerStatus("No active session.", "error");
    return;
  }

  if (!roleCanPost(currentRole)) {
    setComposerStatus("Your role cannot publish feed posts.", "error");
    return;
  }

  const caption = composerCaption?.value.trim() || "";
  if (!caption) {
    setComposerStatus("Caption is required.", "error");
    return;
  }

  const scheduleValue = composerSchedule?.value;
  const isScheduled = Boolean(scheduleValue);

  let finalCaption = caption;
  if (currentPostType === "recap") {
    finalCaption = `${caption}\n[Game Recap] Score: ${recapScore?.value || "-"}; Standouts: ${recapStandout?.value || "-"}; Highlights: ${recapHighlights?.value || "-"}`;
  }

  try {
    if (!appUserId) {
      appUserId = await resolveAppUserId(currentSession.user.id);
    }

    if (!appUserId) {
      throw new Error("No linked app profile found for posting.");
    }

    if (isScheduled) {
      const scheduledDate = new Date(scheduleValue);
      if (scheduledDate.getTime() > Date.now()) {
        setComposerStatus("Scheduled post captured in UI. Backend scheduling is still pending.", "success");
        return;
      }
    }

    const { error } = await supabase.from("post").insert({
      author_user_id: appUserId,
      author_role: currentRole,
      caption: `${finalCaption}${composerTags?.value ? `\nTags: ${composerTags.value}` : ""}`,
      visibility: composerVisibility?.value || "public",
      post_type: currentPostType,
    });

    if (error) throw error;

    composerForm.reset();
    if (recapFields) recapFields.hidden = currentPostType !== "recap";
    setComposerStatus("Post published.", "success");
    await loadFollowingFeed();
  } catch (error) {
    console.error("Publish failed", error);
    setComposerStatus(error.message || "Failed to publish post.", "error");
  }
}

function bindUI() {
  filterTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      filterTabs.forEach((tab) => tab.classList.toggle("active", tab === btn));
      refreshView();
    });
  });

  postTypeTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentPostType = btn.dataset.postType;
      postTypeTabs.forEach((tab) => tab.classList.toggle("active", tab === btn));
      if (recapFields) recapFields.hidden = currentPostType !== "recap";
    });
  });

  composerForm?.addEventListener("submit", handleComposerSubmit);
}

window.addEventListener("session-ready", ({ detail }) => {
  currentSession = detail?.session || null;
  currentRole = detail?.role || "general";

  if (composerPanel) composerPanel.hidden = !roleCanPost(currentRole);

  if (!uiBound) {
    bindUI();
    uiBound = true;
  }
  loadFollowingFeed().catch((error) => {
    console.error("Feed load failed", error);
    followingRows = fallbackFollowingSeed.map((row) => ({ ...row, source: "fallback" }));
    setStatus(error.message || "Failed to load feed data. Showing sample content.", true);
    refreshView();
  });
});

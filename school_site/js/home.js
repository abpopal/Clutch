import { supabase } from "./supabaseClient.js";

const trendingSeed = [
  {
    author_role: "athlete",
    caption: "Triple-double tonight. Thanks for the support! #Basketball",
    sport: "basketball",
    created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    source: "trending",
  },
  {
    author_role: "school",
    caption: "Bracket released for regional playoffs.",
    sport: "soccer",
    created_at: new Date(Date.now() - 1000 * 60 * 300).toISOString(),
    source: "trending",
  },
  {
    author_role: "coach",
    caption: "Match recap posted with standout performances.",
    sport: "football",
    created_at: new Date(Date.now() - 1000 * 60 * 480).toISOString(),
    source: "trending",
  },
];

const statusEl = document.querySelector("#connection-status");
const feedListEl = document.querySelector("#feed-list");
const metricFollowingEl = document.querySelector("#metric-following");
const metricPostsEl = document.querySelector("#metric-posts");
const metricTrendingEl = document.querySelector("#metric-trending");
const metricUnreadEl = document.querySelector("#metric-unread");

const feedTabs = Array.from(document.querySelectorAll("#feed-tabs button"));
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
let activeFeedTab = "following";
let activeFilter = "all";
let appUserId = null;
let followedIds = [];
let followingRows = [];
let trendingRows = [...trendingSeed];
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
    const item = document.createElement("div");
    item.className = "row";

    const author = document.createElement("strong");
    author.textContent = row.author_role || "creator";

    const content = document.createElement("span");
    content.textContent = row.caption || "(No caption)";

    const sport = document.createElement("span");
    sport.textContent = normalizeSport(row.sport, row.caption);

    const date = document.createElement("span");
    date.textContent = row.created_at ? new Date(row.created_at).toLocaleDateString() : "-";

    item.append(author, content, sport, date);
    feedListEl.appendChild(item);
  });
}

function getFilteredRows() {
  const baseRows = activeFeedTab === "following" ? followingRows : trendingRows;
  return baseRows.filter((row) => {
    const sport = normalizeSport(row.sport, row.caption);
    if (activeFilter === "all") return true;
    if (["athlete", "coach", "school"].includes(activeFilter)) {
      return (row.author_role || "").toLowerCase() === activeFilter;
    }
    return sport === activeFilter;
  });
}

function refreshView() {
  const rows = getFilteredRows();
  renderRows(rows);
  setMetric(metricPostsEl, rows.length);
  setMetric(metricTrendingEl, trendingRows.length);
  setMetric(metricFollowingEl, followedIds.length);
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
    followingRows = [];
    followedIds = [];
    setStatus("No linked app profile found in users table.", true);
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
    followingRows = [];
    setStatus("Connected. Follow accounts to populate your personalized feed.");
    refreshView();
    return;
  }

  const { data: postsData, error: postsError } = await supabase
    .from("post")
    .select("author_user_id, author_role, caption, created_at")
    .in("author_user_id", followedIds)
    .order("created_at", { ascending: false })
    .limit(40);

  if (postsError) throw postsError;

  followingRows = (postsData || []).map((row) => ({
    ...row,
    sport: normalizeSport("", row.caption),
    source: "following",
  }));

  setStatus("Connected to Supabase feed.");
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
    finalCaption = `${caption}\n[Match Recap] Score: ${recapScore?.value || "-"}; Standouts: ${recapStandout?.value || "-"}; Highlights: ${recapHighlights?.value || "-"}`;
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
        setComposerStatus("Scheduled post saved in UI placeholder. Backend scheduler required to publish later.", "success");
        return;
      }
    }

    const { error } = await supabase.from("post").insert({
      author_user_id: appUserId,
      author_role: currentRole,
      caption: `${finalCaption}${composerTags?.value ? `\nTags: ${composerTags.value}` : ""}${composerVisibility?.value === "followers" ? "\nVisibility: followers" : ""}`,
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
  feedTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFeedTab = btn.dataset.feedTab;
      feedTabs.forEach((tab) => tab.classList.toggle("active", tab === btn));
      refreshView();
    });
  });

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
    setStatus(error.message || "Failed to load feed data.", true);
    refreshView();
  });
});

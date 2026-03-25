import { supabase } from "./supabaseClient.js";

const followingListEl = document.querySelector("#pulse-following-list");
const trendingListEl = document.querySelector("#pulse-trending-list");
const newsListEl = document.querySelector("#pulse-news-list");
const statusEl = document.querySelector("#pulse-status");

const followingCountEl = document.querySelector("#pulse-following-count");
const trendingCountEl = document.querySelector("#pulse-trending-count");
const newsCountEl = document.querySelector("#pulse-news-count");

const trendingSeed = [
  {
    authorName: "Jordan Williams",
    authorRole: "athlete",
    caption: "34 points in the region final. Full clip thread is up now.",
    sport: "basketball",
    created_at: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
  },
  {
    authorName: "North Valley Football",
    authorRole: "school",
    caption: "Spring install starts Monday. Captains report at 6:15 AM and film packets are live.",
    sport: "football",
    created_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
  {
    authorName: "Coach Priya Shah",
    authorRole: "coach",
    caption: "Recruiting period opens next week. Updated board and target clips have been sent to staff.",
    sport: "soccer",
    created_at: new Date(Date.now() - 1000 * 60 * 260).toISOString(),
  },
];

const followingSeed = [
  {
    authorName: "Westview Athletics",
    authorRole: "school",
    caption: "Travel list is final and the community sendoff starts at 4 PM in the main gym.",
    sport: "basketball",
    created_at: new Date(Date.now() - 1000 * 60 * 85).toISOString(),
  },
  {
    authorName: "Ava Kim",
    authorRole: "athlete",
    caption: "Back training at full pace. Appreciate the messages and the support.",
    sport: "soccer",
    created_at: new Date(Date.now() - 1000 * 60 * 210).toISOString(),
  },
];

const newsSeed = [
  {
    title: "Recruiting calendars tighten this week",
    summary: "Coaches are posting film requests and unofficial visit windows more aggressively as event season ramps up.",
    source: "Clutch Watch",
    time: "2h ago",
  },
  {
    title: "Regional playoff clips are driving the most saves",
    summary: "High-pressure late-game possessions and commitment announcements are outperforming standard updates today.",
    source: "Platform Signals",
    time: "5h ago",
  },
  {
    title: "Schools are posting more roster and travel updates",
    summary: "Program accounts are seeing strong reach when they publish clean recap graphics and schedule notes.",
    source: "Clutch Watch",
    time: "Today",
  },
];

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ff8f8f" : "var(--muted)";
}

function setMetric(el, value) {
  if (el) el.textContent = String(value);
}

function normalizeSport(raw, caption = "") {
  const value = (raw || "").toLowerCase();
  if (value) return value;

  const text = caption.toLowerCase();
  if (text.includes("basket")) return "basketball";
  if (text.includes("soccer")) return "soccer";
  if (text.includes("football")) return "football";
  if (text.includes("track")) return "track";
  return "general";
}

function formatTime(isoString) {
  if (!isoString) return "Now";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function renderPostCards(container, rows, emptyText, mode) {
  if (!container) return;
  container.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = emptyText;
    container.appendChild(empty);
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
        <span class="pill">${mode === "trending" ? "Trending" : "Following highlight"}</span>
        <span class="helper">${mode === "trending" ? "Visible beyond your network" : "From accounts you follow"}</span>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderNews(items) {
  if (!newsListEl) return;
  newsListEl.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "No watchlist notes available right now.";
    newsListEl.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <p class="card-tag">${item.source}</p>
      <h3>${item.title}</h3>
      <p>${item.summary}</p>
      <span class="helper">${item.time}</span>
    `;
    newsListEl.appendChild(card);
  });
}

async function fetchFollowingPosts(authUserId) {
  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("user_id")
    .eq("firebase_uid", authUserId)
    .maybeSingle();

  if (userError) throw userError;
  const appUserId = userData?.user_id;
  if (!appUserId) return followingSeed;

  const { data: followRows, error: followError } = await supabase
    .from("follow")
    .select("followed_user_id")
    .eq("follower_user_id", appUserId);

  if (followError) throw followError;

  const followedIds = (followRows || []).map((row) => row.followed_user_id).filter(Boolean);
  if (!followedIds.length) return followingSeed;

  const [{ data: postsData, error: postsError }, { data: directoryData, error: directoryError }] = await Promise.all([
    supabase
      .from("post")
      .select("author_user_id, author_role, caption, created_at")
      .in("author_user_id", followedIds)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("user_directory")
      .select("user_id,display_name")
      .in("user_id", followedIds),
  ]);

  if (postsError) throw postsError;
  if (directoryError) console.warn("user_directory lookup skipped", directoryError.message);
  if (!postsData?.length) return followingSeed;

  const directoryByUserId = new Map((directoryData || []).map((row) => [row.user_id, row.display_name]));
  return postsData.map((row) => ({
    authorName: directoryByUserId.get(row.author_user_id) || row.author_role,
    authorRole: row.author_role,
    caption: row.caption,
    created_at: row.created_at,
    sport: normalizeSport("", row.caption),
  }));
}

async function fetchTrendingPosts() {
  try {
    const { data, error } = await supabase
      .from("post")
      .select("author_role, caption, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error || !data?.length) return trendingSeed;

    return data.slice(0, 8).map((item) => ({
      authorName: item.author_role,
      authorRole: item.author_role,
      caption: item.caption,
      created_at: item.created_at,
      sport: normalizeSport("", item.caption),
    }));
  } catch (_error) {
    return trendingSeed;
  }
}

async function fetchNewsItems() {
  try {
    const { data, error } = await supabase
      .from("news")
      .select("title, summary, source, created_at")
      .order("created_at", { ascending: false })
      .limit(8);

    if (error || !data?.length) return newsSeed;

    return data.map((item) => ({
      title: item.title,
      summary: item.summary,
      source: item.source || "Clutch Watch",
      time: item.created_at ? new Date(item.created_at).toLocaleDateString() : "Today",
    }));
  } catch (_error) {
    return newsSeed;
  }
}

window.addEventListener("session-ready", async ({ detail }) => {
  const session = detail?.session;
  if (!session?.user?.id) return;

  setStatus("Loading pulse...");

  try {
    const [followingPosts, trendingPosts, newsItems] = await Promise.all([
      fetchFollowingPosts(session.user.id),
      fetchTrendingPosts(),
      fetchNewsItems(),
    ]);

    renderPostCards(followingListEl, followingPosts, "No following highlights yet.", "following");
    renderPostCards(trendingListEl, trendingPosts, "No trending posts yet.", "trending");
    renderNews(newsItems);

    setMetric(followingCountEl, followingPosts.length);
    setMetric(trendingCountEl, trendingPosts.length);
    setMetric(newsCountEl, newsItems.length);

    setStatus("Pulse is up to date.");
  } catch (error) {
    console.error("Pulse load failed", error);
    renderPostCards(followingListEl, followingSeed, "Showing sample following highlights.", "following");
    renderPostCards(trendingListEl, trendingSeed, "Showing sample trending posts.", "trending");
    renderNews(newsSeed);

    setMetric(followingCountEl, followingSeed.length);
    setMetric(trendingCountEl, trendingSeed.length);
    setMetric(newsCountEl, newsSeed.length);

    setStatus(error.message || "Failed to load pulse feed.", true);
  }
});

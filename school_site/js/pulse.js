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
    author_role: "athlete",
    caption: "Player of the week voting is now open.",
    sport: "basketball",
    created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    author_role: "school",
    caption: "Regional bracket announced for this weekend.",
    sport: "soccer",
    created_at: new Date(Date.now() - 1000 * 60 * 240).toISOString(),
  },
  {
    author_role: "coach",
    caption: "Practice attendance tracker published for all teams.",
    sport: "football",
    created_at: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
  },
];

const newsSeed = [
  {
    title: "NCAA recruiting calendar updates",
    summary: "Important dates for official visits and signing windows this month.",
    source: "College Sports Wire",
    time: "2h ago",
  },
  {
    title: "High school playoff seeding released",
    summary: "State associations posted final seeds across major winter sports.",
    source: "Prep Athletics",
    time: "5h ago",
  },
  {
    title: "Athlete eligibility reminders",
    summary: "Schools are asked to confirm academic eligibility before postseason play.",
    source: "Clutch Newsroom",
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

function renderPostRows(container, rows, emptyText) {
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
    container.appendChild(item);
  });
}

function renderNews(items) {
  if (!newsListEl) return;
  newsListEl.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "No news available right now.";
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
  if (!appUserId) return [];

  const { data: followRows, error: followError } = await supabase
    .from("follow")
    .select("followed_user_id")
    .eq("follower_user_id", appUserId);

  if (followError) throw followError;

  const followedIds = (followRows || []).map((row) => row.followed_user_id).filter(Boolean);
  if (!followedIds.length) return [];

  const { data: postsData, error: postsError } = await supabase
    .from("post")
    .select("author_role, caption, created_at")
    .in("author_user_id", followedIds)
    .order("created_at", { ascending: false })
    .limit(30);

  if (postsError) throw postsError;
  return postsData || [];
}

async function fetchTrendingPosts() {
  try {
    const { data, error } = await supabase
      .from("post")
      .select("author_role, caption, created_at")
      .order("created_at", { ascending: false })
      .limit(60);

    if (error || !data?.length) return trendingSeed;

    return data.slice(0, 8);
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
      source: item.source || "Clutch Newsroom",
      time: item.created_at ? new Date(item.created_at).toLocaleDateString() : "Today",
    }));
  } catch (_error) {
    return newsSeed;
  }
}

window.addEventListener("session-ready", async ({ detail }) => {
  const session = detail?.session;
  if (!session?.user?.id) return;

  setStatus("Loading your pulse...");

  try {
    const [followingPosts, trendingPosts, newsItems] = await Promise.all([
      fetchFollowingPosts(session.user.id),
      fetchTrendingPosts(),
      fetchNewsItems(),
    ]);

    renderPostRows(followingListEl, followingPosts, "No posts from followed accounts yet.");
    renderPostRows(trendingListEl, trendingPosts, "No trending posts yet.");
    renderNews(newsItems);

    setMetric(followingCountEl, followingPosts.length);
    setMetric(trendingCountEl, trendingPosts.length);
    setMetric(newsCountEl, newsItems.length);

    setStatus("Pulse is up to date.");
  } catch (error) {
    console.error("Pulse load failed", error);
    renderPostRows(followingListEl, [], "Unable to load following posts.");
    renderPostRows(trendingListEl, trendingSeed, "Showing fallback trending posts.");
    renderNews(newsSeed);

    setMetric(followingCountEl, 0);
    setMetric(trendingCountEl, trendingSeed.length);
    setMetric(newsCountEl, newsSeed.length);

    setStatus(error.message || "Failed to load pulse feed.", true);
  }
});

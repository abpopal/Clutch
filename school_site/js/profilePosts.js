import { supabase } from "./supabaseClient.js";
import { buildAthleteProfile, formatScoutSummary, getSportMeta, normalizeText } from "./athleteData.js";

const nameEl = document.querySelector("#posts-athlete-name");
const subtitleEl = document.querySelector("#posts-athlete-subtitle");
const metaEl = document.querySelector("#posts-athlete-meta");
const featuredEl = document.querySelector("#posts-featured-card");
const storyRowEl = document.querySelector("#profile-story-row");
const mediaGridEl = document.querySelector("#profile-media-grid");
const primaryBtn = document.querySelector("#posts-primary-action");
const backLinkEl = document.querySelector("#back-to-profile-link");
const filterRowEl = document.querySelector("#posts-filter-row");
const summaryMetricsEl = document.querySelector("#posts-summary-metrics");

const state = {
  viewerUserId: null,
  targetUserId: null,
  athlete: null,
  posts: [],
  isSelfProfile: false,
  isFollowing: false,
  activeFilter: "all",
};

let eventsBound = false;

function queryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return (params.get(name) || "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatRelative(isoString) {
  if (!isoString) return "Now";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function primaryMedia(post) {
  const mediaList = Array.isArray(post?.post_media) ? post.post_media : [];
  return mediaList.find((item) => item?.media_url) || null;
}

async function fetchAppUserId(authUserId) {
  const { data, error } = await supabase
    .from("users")
    .select("user_id")
    .eq("firebase_uid", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data?.user_id || null;
}

async function fetchIsFollowing() {
  if (!state.viewerUserId || !state.targetUserId || state.viewerUserId === state.targetUserId) return false;
  const { data, error } = await supabase
    .from("follow")
    .select("follower_user_id")
    .eq("follower_user_id", state.viewerUserId)
    .eq("followed_user_id", state.targetUserId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function toggleFollow() {
  if (!state.viewerUserId || !state.targetUserId || state.isSelfProfile) return;
  primaryBtn.disabled = true;
  try {
    if (state.isFollowing) {
      const { error } = await supabase
        .from("follow")
        .delete()
        .eq("follower_user_id", state.viewerUserId)
        .eq("followed_user_id", state.targetUserId);
      if (error) throw error;
      state.isFollowing = false;
    } else {
      const { error } = await supabase
        .from("follow")
        .insert({ follower_user_id: state.viewerUserId, followed_user_id: state.targetUserId });
      if (error) throw error;
      state.isFollowing = true;
    }
    renderActions();
  } catch (error) {
    console.error("Follow toggle failed", error);
  } finally {
    primaryBtn.disabled = false;
  }
}

async function fetchCounts() {
  const [postsRes, followersRes] = await Promise.all([
    supabase.from("post").select("*", { count: "exact", head: true }).eq("author_user_id", state.targetUserId),
    supabase.from("follow").select("*", { count: "exact", head: true }).eq("followed_user_id", state.targetUserId),
  ]);
  return { posts: postsRes.count || 0, followers: followersRes.count || 0 };
}

async function fetchPosts() {
  const filters = ["public"];
  if (state.isFollowing || state.isSelfProfile) filters.push("followers");
  if (state.isSelfProfile) filters.push("private");

  const { data, error } = await supabase
    .from("post")
    .select("post_id,author_role,caption,post_type,created_at,visibility,post_media(media_url,media_type)")
    .eq("author_user_id", state.targetUserId)
    .in("visibility", filters)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw error;
  return data || [];
}

async function fetchProfileBundle() {
  const [{ data: directory }, { data: userRow }, { data: athleteRow }] = await Promise.all([
    supabase.from("user_directory").select("user_id,display_name,email").eq("user_id", state.targetUserId).maybeSingle(),
    supabase.from("users").select("user_id,role").eq("user_id", state.targetUserId).maybeSingle(),
    supabase.from("athletes").select("athlete_id,user_id,school_id,position,graduation_year").eq("user_id", state.targetUserId).maybeSingle(),
  ]);

  const schoolName = athleteRow?.school_id
    ? (await supabase.from("schools").select("name").eq("school_id", athleteRow.school_id).maybeSingle()).data?.name || ""
    : "";
  const stats = athleteRow?.athlete_id
    ? (await supabase.from("athlete_stat").select("sport,stat_key,stat_value,source").eq("athlete_id", athleteRow.athlete_id)).data || []
    : [];
  const counts = await fetchCounts();
  const posts = await fetchPosts();
  return { directory, userRow, athleteRow, schoolName, stats, posts, counts };
}

function renderActions() {
  if (!primaryBtn) return;
  primaryBtn.textContent = state.isSelfProfile ? "Back to Profile" : (state.isFollowing ? "Watching" : "Follow");
  primaryBtn.classList.toggle("warn", state.isFollowing && !state.isSelfProfile);
}

function renderHero() {
  const athlete = state.athlete;
  const counts = athlete.liveCounts || { posts: state.posts.length, followers: 0 };
  if (nameEl) nameEl.textContent = athlete.name;
  if (subtitleEl) subtitleEl.textContent = formatScoutSummary(athlete);
  if (backLinkEl) backLinkEl.href = state.isSelfProfile ? "profile.html" : `profile.html?user_id=${encodeURIComponent(state.targetUserId)}`;

  metaEl.innerHTML = [
    athlete.athleteId,
    athlete.school,
    athlete.ranking,
    `${counts.posts} posts`,
    `${counts.followers} followers`,
  ].map((item) => `<span class="ua-chip">${escapeHtml(item)}</span>`).join("");

  const featuredPost = filteredPosts()[0];
  if (!featuredPost) {
    featuredEl.innerHTML = `<div class="ua-empty">No visible media posts yet.</div>`;
  } else {
    const mediaUrl = primaryMedia(featuredPost)?.media_url || "";
    featuredEl.innerHTML = `
      <div class="ua-posts-featured-visual ${mediaUrl ? "has-image" : ""}" style="${mediaUrl ? `background-image:linear-gradient(180deg, rgba(0,0,0,.12), rgba(0,0,0,.72)), url('${mediaUrl}')` : ""}">
        <span class="ua-chip is-info">Featured</span>
      </div>
      <div class="ua-posts-featured-copy">
        <strong>${escapeHtml(featuredPost.caption || `${athlete.name} post`)}</strong>
        <p>${escapeHtml(featuredPost.post_type || "image")} • ${escapeHtml(formatRelative(featuredPost.created_at))}</p>
        <small>${escapeHtml(primaryMedia(featuredPost)?.media_type || "media")} • ${escapeHtml(athlete.name)}</small>
      </div>
    `;
  }

  summaryMetricsEl.innerHTML = `
    <span class="ua-chip">${counts.posts} posts</span>
    <span class="ua-chip">${state.posts.filter((post) => primaryMedia(post)).length} media</span>
    <span class="ua-chip">${state.posts.filter((post) => (post.post_type || "").toLowerCase() === "video").length} videos</span>
  `;

  renderActions();
}

function renderFilters() {
  const filters = [
    { id: "all", label: "All Posts" },
    { id: "image", label: "Images" },
    { id: "video", label: "Videos" },
    { id: "followers", label: "Followers" },
  ];
  filterRowEl.innerHTML = filters.map((filter) => `
    <button type="button" class="ua-metric-pill ${state.activeFilter === filter.id ? "active" : ""}" data-post-filter="${filter.id}">
      ${escapeHtml(filter.label)}
    </button>
  `).join("");
}

function filteredPosts() {
  return state.posts.filter((post) => {
    if (state.activeFilter === "all") return true;
    if (state.activeFilter === "followers") return normalizeText(post.visibility) === "followers";
    return normalizeText(post.post_type) === state.activeFilter;
  }).filter((post) => primaryMedia(post)?.media_url);
}

function renderStories() {
  const posts = filteredPosts().slice(0, 6);
  if (!posts.length) {
    storyRowEl.innerHTML = `<div class="ua-empty">No featured story circles available.</div>`;
    return;
  }
  storyRowEl.innerHTML = posts.map((post, index) => {
    const media = primaryMedia(post);
    return `
      <article class="story-bubble">
        <div class="story-ring">
          <img src="${escapeHtml(media.media_url)}" alt="Story ${index + 1}">
        </div>
        <span>${escapeHtml(post.caption || `Story ${index + 1}`)}</span>
      </article>
    `;
  }).join("");
}

function renderMediaGrid() {
  const athlete = state.athlete;
  const posts = filteredPosts();
  if (!posts.length) {
    mediaGridEl.innerHTML = `
      <article class="ua-empty-card">
        <strong>${escapeHtml(athlete.name)}</strong>
        <p>No media posts match the current filter.</p>
      </article>
    `;
    return;
  }

  mediaGridEl.innerHTML = posts.map((post) => {
    const media = primaryMedia(post);
    const sport = athlete.sports?.[0]?.id || "basketball";
    return `
      <article class="ua-post-archive-card">
        <div class="ua-post-archive-visual" style="background-image:linear-gradient(180deg, rgba(0,0,0,.1), rgba(0,0,0,.75)), url('${escapeHtml(media.media_url)}')">
          <span class="ua-chip">${escapeHtml(getSportMeta(sport).icon)} ${escapeHtml(post.post_type || "post")}</span>
        </div>
        <div class="ua-post-archive-copy">
          <strong>${escapeHtml(post.caption || `${athlete.name} post`)}</strong>
          <p>${escapeHtml(formatRelative(post.created_at))} • ${escapeHtml(post.visibility || "public")}</p>
        </div>
      </article>
    `;
  }).join("");
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const filterId = target.closest("[data-post-filter]")?.dataset.postFilter;
    if (filterId) {
      state.activeFilter = filterId;
      renderFilters();
      renderHero();
      renderStories();
      renderMediaGrid();
      return;
    }
  });

  primaryBtn?.addEventListener("click", () => {
    if (state.isSelfProfile) {
      window.location.assign(backLinkEl?.href || "profile.html");
      return;
    }
    toggleFollow();
  });
}

window.addEventListener("session-ready", async ({ detail }) => {
  try {
    state.viewerUserId = await fetchAppUserId(detail.session.user.id);
    state.targetUserId = queryParam("user_id") || state.viewerUserId;
    state.isSelfProfile = state.viewerUserId === state.targetUserId;
    state.isFollowing = await fetchIsFollowing();

    const bundle = await fetchProfileBundle();
    state.posts = bundle.posts;
    state.athlete = buildAthleteProfile({
      userId: state.targetUserId,
      directory: bundle.directory,
      athleteRow: bundle.athleteRow,
      schoolName: bundle.schoolName,
      stats: bundle.stats,
      posts: bundle.posts,
      counts: bundle.counts,
      fallbackRole: bundle.userRow?.role || "athlete",
    });

    bindEvents();
    renderFilters();
    renderHero();
    renderStories();
    renderMediaGrid();
  } catch (error) {
    console.error("Profile posts load failed", error);
    if (nameEl) nameEl.textContent = "Profile unavailable";
    if (subtitleEl) subtitleEl.textContent = error.message || "Unable to load athlete posts.";
    if (mediaGridEl) mediaGridEl.innerHTML = `<div class="ua-empty">${escapeHtml(error.message || "Unable to load athlete posts.")}</div>`;
  }
});

import { supabase } from "./supabaseClient.js";

const avatarEl = document.querySelector("#profile-posts-avatar");
const initialsEl = document.querySelector("#profile-posts-initials");
const nameEl = document.querySelector("#profile-posts-name");
const subtitleEl = document.querySelector("#profile-posts-subtitle");
const metaEl = document.querySelector("#profile-posts-meta");
const noteEl = document.querySelector("#profile-posts-note");
const storyRowEl = document.querySelector("#profile-story-row");
const mediaGridEl = document.querySelector("#profile-media-grid");
const primaryBtn = document.querySelector("#profile-posts-primary");
const backLinkEl = document.querySelector("#back-to-profile-link");

let viewerUserId = null;
let targetUserId = null;
let isFollowing = false;
let isSelfProfile = false;
let targetDirectory = null;

function queryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return (params.get(name) || "").trim();
}

function initialsFor(name) {
  const parts = (name || "Untitle Atheletics").split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "UA";
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

async function fetchTargetDirectory() {
  const { data, error } = await supabase
    .from("user_directory")
    .select("user_id,display_name,email")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function fetchTargetRole() {
  const { data, error } = await supabase
    .from("users")
    .select("user_id,role")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (error) throw error;
  return data?.role || "viewer";
}

async function fetchIsFollowing() {
  if (!viewerUserId || !targetUserId || viewerUserId === targetUserId) return false;
  const { data, error } = await supabase
    .from("follow")
    .select("follower_user_id")
    .eq("follower_user_id", viewerUserId)
    .eq("followed_user_id", targetUserId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function toggleFollow() {
  if (!viewerUserId || !targetUserId || isSelfProfile || !primaryBtn) return;
  primaryBtn.disabled = true;
  try {
    if (isFollowing) {
      const { error } = await supabase
        .from("follow")
        .delete()
        .eq("follower_user_id", viewerUserId)
        .eq("followed_user_id", targetUserId);
      if (error) throw error;
      isFollowing = false;
    } else {
      const { error } = await supabase
        .from("follow")
        .insert({ follower_user_id: viewerUserId, followed_user_id: targetUserId });
      if (error) throw error;
      isFollowing = true;
    }
    primaryBtn.textContent = isFollowing ? "Following" : "Follow";
    primaryBtn.classList.toggle("warn", isFollowing);
  } catch (error) {
    console.error("Follow toggle failed", error);
  } finally {
    primaryBtn.disabled = false;
  }
}

async function fetchPosts() {
  const filters = ["public"];
  if (isFollowing || isSelfProfile) filters.push("followers");
  if (isSelfProfile) filters.push("private");

  const { data, error } = await supabase
    .from("post")
    .select("post_id,caption,post_type,created_at,visibility,post_media(media_url,media_type)")
    .eq("author_user_id", targetUserId)
    .in("visibility", filters)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) throw error;
  return data || [];
}

async function fetchCounts() {
  const [{ count: postsCount }, { count: followersCount }, { count: followingCount }] = await Promise.all([
    supabase.from("post").select("*", { count: "exact", head: true }).eq("author_user_id", targetUserId),
    supabase.from("follow").select("*", { count: "exact", head: true }).eq("followed_user_id", targetUserId),
    supabase.from("follow").select("*", { count: "exact", head: true }).eq("follower_user_id", targetUserId),
  ]);

  return {
    posts: postsCount || 0,
    followers: followersCount || 0,
    following: followingCount || 0,
  };
}

function primaryMedia(post) {
  const mediaList = Array.isArray(post?.post_media) ? post.post_media : [];
  return mediaList.find((item) => item?.media_url) || null;
}

function renderAvatar(displayName, posts) {
  if (!avatarEl || !initialsEl) return;
  const avatarUrl = posts.map(primaryMedia).find((media) => media?.media_url)?.media_url;
  if (avatarUrl) {
    avatarEl.innerHTML = `<img src="${avatarUrl}" alt="${displayName} avatar">`;
    return;
  }
  initialsEl.textContent = initialsFor(displayName);
}

function renderMeta(counts, role, email) {
  if (!metaEl) return;
  metaEl.innerHTML = `
    <span><strong>${counts.posts}</strong> posts</span>
    <span><strong>${counts.followers}</strong> followers</span>
    <span><strong>${counts.following}</strong> following</span>
    <span>${role}</span>
    <span>${email || "Email unavailable"}</span>
  `;
}

function renderStories(posts) {
  if (!storyRowEl) return;
  storyRowEl.innerHTML = "";
  const items = posts.filter((post) => primaryMedia(post)?.media_url).slice(0, 4);

  if (!items.length) {
    storyRowEl.innerHTML = `<div class="placeholder">No featured post highlights yet.</div>`;
    return;
  }

  items.forEach((post, index) => {
    const media = primaryMedia(post);
    const item = document.createElement("article");
    item.className = "story-bubble";
    item.innerHTML = `
      <div class="story-ring">
        <img src="${media.media_url}" alt="Highlight ${index + 1}">
      </div>
      <span>${post.caption || `Highlight ${index + 1}`}</span>
    `;
    storyRowEl.appendChild(item);
  });
}

function renderMediaGrid(posts, displayName) {
  if (!mediaGridEl) return;
  mediaGridEl.innerHTML = "";

  const items = posts.filter((post) => primaryMedia(post)?.media_url);
  if (!items.length) {
    mediaGridEl.innerHTML = `
      <article class="media-grid-card media-grid-empty">
        <div class="gallery-visual gallery-tone-1"></div>
        <div class="gallery-copy">
          <strong>${displayName}</strong>
          <span class="helper">No image posts available yet.</span>
        </div>
      </article>
    `;
    return;
  }

  items.forEach((post) => {
    const media = primaryMedia(post);
    const item = document.createElement("article");
    item.className = "media-grid-card";
    item.innerHTML = `
      <img src="${media.media_url}" alt="${displayName} post">
      <div class="media-grid-overlay">
        <strong>${displayName}</strong>
        <span>${post.caption || "Image post"}</span>
      </div>
    `;
    mediaGridEl.appendChild(item);
  });
}

window.addEventListener("session-ready", async ({ detail }) => {
  const session = detail?.session;
  if (!session?.user?.id) return;

  try {
    viewerUserId = await fetchAppUserId(session.user.id);
    targetUserId = queryParam("user_id") || viewerUserId;
    if (!targetUserId) throw new Error("No profile is linked to this account yet.");

    targetDirectory = await fetchTargetDirectory();
    const role = await fetchTargetRole();
    isSelfProfile = viewerUserId === targetUserId;
    isFollowing = await fetchIsFollowing();

    const displayName = targetDirectory?.display_name || `User ${String(targetUserId).slice(0, 8)}`;
    const email = targetDirectory?.email || "";
    const [posts, counts] = await Promise.all([fetchPosts(), fetchCounts()]);

    if (nameEl) nameEl.textContent = displayName;
    if (subtitleEl) subtitleEl.textContent = isSelfProfile ? "Your post archive" : `${displayName}'s post archive`;
    if (noteEl) noteEl.textContent = posts.length ? "Media-first archive of profile posts." : "No image posts published yet.";
    if (backLinkEl) backLinkEl.href = isSelfProfile ? "profile.html" : `profile.html?user_id=${encodeURIComponent(targetUserId)}`;

    renderAvatar(displayName, posts);
    renderMeta(counts, role, email);
    renderStories(posts);
    renderMediaGrid(posts, displayName);

    if (primaryBtn) {
      primaryBtn.textContent = isSelfProfile ? "Edit Profile" : (isFollowing ? "Following" : "Follow");
      primaryBtn.classList.toggle("warn", isFollowing && !isSelfProfile);
      primaryBtn.onclick = isSelfProfile
        ? () => window.location.assign(backLinkEl?.href || "profile.html")
        : toggleFollow;
    }
  } catch (error) {
    console.error("Profile posts load failed", error);
    if (nameEl) nameEl.textContent = "Profile unavailable";
    if (subtitleEl) subtitleEl.textContent = "Unable to load post archive.";
    if (noteEl) noteEl.textContent = error.message || "Failed to load posts.";
  }
});

import { supabase } from "./supabaseClient.js";

const nameEl = document.querySelector("#profile-name");
const subtitleEl = document.querySelector("#profile-subtitle");
const metaEl = document.querySelector("#profile-meta");
const statusEl = document.querySelector("#profile-status");
const factsEl = document.querySelector("#profile-facts");
const aboutTitleEl = document.querySelector("#profile-about-title");
const primaryActionBtn = document.querySelector("#profile-primary-action");
const secondaryActionBtn = document.querySelector("#profile-secondary-action");
const postsEl = document.querySelector("#profile-activity");
const statsTableEl = document.querySelector("#profile-stats-table");
const mediaEl = document.querySelector("#profile-media");
const recruitingEl = document.querySelector("#profile-recruiting");

let viewerUserId = null;
let targetUserId = null;
let isSelfProfile = false;
let isFollowing = false;
let targetDirectory = null;

function queryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return (params.get(name) || "").trim();
}

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? "var(--danger)" : "var(--muted)";
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

async function fetchTargetProfile() {
  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (userError) throw userError;
  if (!userRow && !targetDirectory) throw new Error("Profile not found.");

  const targetRole = userRow?.role || "viewer";

  let athleteRow = null;
  let coachRow = null;
  let schoolRow = null;
  let scoutRow = null;

  if (targetRole === "athlete") {
    const { data, error } = await supabase
      .from("athletes")
      .select("athlete_id,user_id,school_id,position,graduation_year")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (error) throw error;
    athleteRow = data;
  }

  if (targetRole === "coach") {
    const { data, error } = await supabase
      .from("coaches")
      .select("coach_id,user_id,bio,years_experience")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (error) throw error;
    coachRow = data;
  }

  if (targetRole === "school") {
    const { data, error } = await supabase
      .from("schools")
      .select("school_id,user_id,name,description,location")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (error) throw error;
    schoolRow = data;
  }

  if (targetRole === "scout") {
    const { data, error } = await supabase
      .from("scouts")
      .select("scout_id,user_id,organization,title")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (error) throw error;
    scoutRow = data;
  }

  return { userRow, athleteRow, coachRow, schoolRow, scoutRow, targetRole };
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
  if (!viewerUserId || !targetUserId || isSelfProfile || !primaryActionBtn) return;
  primaryActionBtn.disabled = true;

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

    primaryActionBtn.textContent = isFollowing ? "Following" : "Follow";
    primaryActionBtn.classList.toggle("warn", isFollowing);
    setStatus(isFollowing ? "You are now following this profile." : "You unfollowed this profile.");
  } catch (error) {
    console.error("Follow toggle failed", error);
    setStatus(error.message || "Unable to update follow state.", true);
  } finally {
    primaryActionBtn.disabled = false;
  }
}

async function fetchPosts() {
  const filters = ["public"];
  if (isFollowing || isSelfProfile) filters.push("followers");
  if (isSelfProfile) filters.push("private");

  const { data, error } = await supabase
    .from("post")
    .select("author_role,caption,post_type,created_at,visibility")
    .eq("author_user_id", targetUserId)
    .in("visibility", filters)
    .order("created_at", { ascending: false })
    .limit(24);

  if (error) throw error;
  return data || [];
}

async function fetchAthleteStats(athleteId) {
  if (!athleteId) return [];
  const { data, error } = await supabase
    .from("athlete_stat")
    .select("sport,stat_key,stat_value,source")
    .eq("athlete_id", athleteId)
    .limit(50);

  if (error) throw error;
  return data || [];
}

async function fetchSchoolName(schoolId) {
  if (!schoolId) return "Unassigned";
  const { data, error } = await supabase
    .from("schools")
    .select("name")
    .eq("school_id", schoolId)
    .maybeSingle();

  if (error) throw error;
  return data?.name || "Unassigned";
}

function bestDisplayName(profileData) {
  const user = profileData.userRow || {};
  const school = profileData.schoolRow || {};
  return (
    targetDirectory?.display_name ||
    school.name ||
    user.name ||
    user.full_name ||
    user.display_name ||
    `User ${String(targetUserId).slice(0, 8)}`
  );
}

function bestEmail(profileData) {
  const user = profileData.userRow || {};
  return targetDirectory?.email || user.email || user.contact_email || user.primary_email || "Email unavailable";
}

function renderMeta(profile, isSelf) {
  if (!metaEl) return;
  metaEl.innerHTML = "";
  const chips = [
    isSelf ? "Your profile" : "Public profile",
    `Role: ${profile.targetRole}`,
    `Email: ${bestEmail(profile)}`,
  ];
  chips.forEach((chip) => {
    const el = document.createElement("span");
    el.textContent = chip;
    metaEl.appendChild(el);
  });
}

function renderFacts(profile, schoolName) {
  if (!factsEl) return;
  const athlete = profile.athleteRow;
  const coach = profile.coachRow;
  const scout = profile.scoutRow;
  const roleLabel =
    athlete?.position ||
    scout?.title ||
    (coach?.years_experience ? `${coach.years_experience} years experience` : "") ||
    "Lead contributor";
  factsEl.innerHTML = `
    <div class="profile-fact">
      <span class="profile-fact-label">Name</span>
      <strong>${bestDisplayName(profile)}</strong>
    </div>
    <div class="profile-fact">
      <span class="profile-fact-label">Role</span>
      <strong>${profile.targetRole}</strong>
    </div>
    <div class="profile-fact">
      <span class="profile-fact-label">School</span>
      <strong>${schoolName || "Untitle Atheletics Academy"}</strong>
    </div>
    <div class="profile-fact">
      <span class="profile-fact-label">Position / Title</span>
      <strong>${roleLabel}</strong>
    </div>
  `;
}

function renderPosts(posts, displayName) {
  if (!postsEl) return;
  postsEl.innerHTML = "";

  if (!posts.length) {
    postsEl.innerHTML = `
      <article class="post-card">
        <div class="post-card-head">
          <div>
            <strong>${displayName}</strong>
            <div class="post-meta-line">No live posts yet</div>
          </div>
          <span class="tag">Today</span>
        </div>
        <p class="post-caption">This profile has no visible posts yet. Placeholder activity is shown until posts are published.</p>
      </article>
    `;
    return;
  }

  posts.forEach((post) => {
    const item = document.createElement("article");
    item.className = "post-card";
    item.innerHTML = `
      <div class="post-card-head">
        <div>
          <strong>${displayName}</strong>
          <div class="post-meta-line">${post.author_role || "member"} • ${post.post_type || "text"}</div>
        </div>
        <span class="tag">${formatTime(post.created_at)}</span>
      </div>
      <p class="post-caption">${post.caption || "(No caption)"}</p>
      <div class="post-card-foot">
        <span class="pill">${post.visibility || "public"}</span>
      </div>
    `;
    postsEl.appendChild(item);
  });
}

function renderStats(stats) {
  if (!statsTableEl) return;
  statsTableEl.innerHTML = "";

  const fallbackStats = [
    { sport: "Basketball", stat_key: "PPG", stat_value: "22.4", source: "Generic" },
    { sport: "Basketball", stat_key: "APG", stat_value: "7.1", source: "Generic" },
    { sport: "Basketball", stat_key: "FG%", stat_value: "48.2%", source: "Generic" },
  ];

  const rows = stats.length ? stats : fallbackStats;
  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "row";
    item.innerHTML = `
      <strong>${row.sport || "-"}</strong>
      <span>${row.stat_key || "-"}</span>
      <span>${row.stat_value || "-"}</span>
      <span>${row.source || "-"}</span>
    `;
    statsTableEl.appendChild(item);
  });
}

function renderMedia(displayName) {
  if (!mediaEl) return;
  mediaEl.innerHTML = `
    <article class="card">
      <p class="card-tag">Featured Clip</p>
      <h3>${displayName} Season Mix</h3>
      <p>Primary highlight reel placeholder with the live profile name applied.</p>
    </article>
    <article class="card">
      <p class="card-tag">Top Game</p>
      <h3>Region Final Breakdown</h3>
      <p>Deep-dive media slot for marquee performances, kept generic until clip storage is connected.</p>
    </article>
    <article class="card">
      <p class="card-tag">Training Reel</p>
      <h3>Workout and development package</h3>
      <p>Additional media space for drills, practice film, and offseason progress updates.</p>
    </article>
  `;
}

function renderRecruiting(profile, schoolName) {
  if (!recruitingEl) return;
  const athlete = profile.athleteRow;
  recruitingEl.innerHTML = `
    <article class="card">
      <p class="card-tag">Programs Watching</p>
      <h3>3 Active Programs</h3>
      <p>Recruiting summary remains generic for now, but stays visible on the profile.</p>
    </article>
    <article class="card">
      <p class="card-tag">Academic / School</p>
      <h3>${schoolName || "Untitle Atheletics Academy"}</h3>
      <p>${athlete?.graduation_year ? `Class of ${athlete.graduation_year}` : "Graduation timeline pending"}</p>
    </article>
  `;
}

window.addEventListener("session-ready", async ({ detail }) => {
  const session = detail?.session;
  if (!session?.user?.id) return;

  try {
    viewerUserId = await fetchAppUserId(session.user.id);
    targetUserId = queryParam("user_id") || viewerUserId;

    if (!targetUserId) {
      throw new Error("No profile is linked to this account yet.");
    }

    targetDirectory = await fetchTargetDirectory();
    const profile = await fetchTargetProfile();
    isSelfProfile = viewerUserId === targetUserId;
    isFollowing = await fetchIsFollowing();

    const displayName = bestDisplayName(profile);
    const schoolName = profile.athleteRow?.school_id ? await fetchSchoolName(profile.athleteRow.school_id) : (profile.schoolRow?.name || "");
    const posts = await fetchPosts();
    const stats = await fetchAthleteStats(profile.athleteRow?.athlete_id);

    if (nameEl) nameEl.textContent = displayName;
    if (subtitleEl) subtitleEl.textContent = isSelfProfile ? "Your Untitle Atheletics profile" : `${displayName}'s Untitle Atheletics profile`;
    if (aboutTitleEl) aboutTitleEl.textContent = displayName;

    renderMeta(profile, isSelfProfile);
    renderFacts(profile, schoolName);
    renderPosts(posts, displayName);
    renderStats(stats);
    renderMedia(displayName);
    renderRecruiting(profile, schoolName);

    if (primaryActionBtn) {
      primaryActionBtn.textContent = isSelfProfile ? "Edit Profile" : (isFollowing ? "Following" : "Follow");
      primaryActionBtn.classList.toggle("warn", isFollowing && !isSelfProfile);
      primaryActionBtn.onclick = isSelfProfile
        ? () => window.alert("Profile editing can be connected next.")
        : toggleFollow;
    }

    if (secondaryActionBtn) {
      secondaryActionBtn.textContent = isSelfProfile ? "Share Profile" : "Message";
      secondaryActionBtn.onclick = () => {
        window.alert(isSelfProfile ? "Share flow can be connected next." : "Messaging can be connected next.");
      };
    }

    setStatus("Profile loaded.");
  } catch (error) {
    console.error("Profile load failed", error);
    if (nameEl) nameEl.textContent = "Profile unavailable";
    if (subtitleEl) subtitleEl.textContent = "Unable to load this profile.";
    setStatus(error.message || "Failed to load profile.", true);
  }
});

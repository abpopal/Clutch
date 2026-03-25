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
const postGalleryEl = document.querySelector("#profile-post-gallery");
const statsTableEl = document.querySelector("#profile-stats-table");
const mediaEl = document.querySelector("#profile-media");
const recruitingEl = document.querySelector("#profile-recruiting");
const sportTabs = Array.from(document.querySelectorAll("#profile-sport-tabs button"));
const chartTitleEl = document.querySelector("#profile-chart-title");
const breakdownTitleEl = document.querySelector("#profile-breakdown-title");
const chartStackEl = document.querySelector("#profile-chart-stack");
const sportBreakdownEl = document.querySelector("#profile-sport-breakdown");
const postsLinkEl = document.querySelector("#profile-posts-link");

let viewerUserId = null;
let targetUserId = null;
let isSelfProfile = false;
let isFollowing = false;
let targetDirectory = null;
let activeSport = "basketball";
let currentDisplayName = "Profile";

const genericSportProfiles = {
  basketball: {
    title: "Basketball profile",
    metrics: [
      { label: "Scoring", value: 88, display: "22.4 PPG" },
      { label: "Playmaking", value: 76, display: "7.1 APG" },
      { label: "Shooting", value: 71, display: "48.2 FG%" },
      { label: "Defense", value: 69, display: "2.3 STL" },
    ],
    cards: [
      { tag: "Game Impact", title: "Primary initiator", text: "Controls pace, gets downhill, and creates good shots late in possessions." },
      { tag: "Shot Profile", title: "Three-level scoring", text: "Comfortable creating off the bounce, getting to the line, and finishing through contact." },
      { tag: "Projection", title: "Lead guard ceiling", text: "Generic projection card based on the old profile’s more editorial athlete presentation." },
    ],
  },
  track: {
    title: "Track profile",
    metrics: [
      { label: "Acceleration", value: 84, display: "Elite first 30m" },
      { label: "Top Speed", value: 79, display: "State-level range" },
      { label: "Endurance", value: 67, display: "Late-race hold" },
      { label: "Consistency", value: 81, display: "Meet-to-meet reliability" },
    ],
    cards: [
      { tag: "Explosiveness", title: "Fast out of the blocks", text: "Strong drive phase and rapid transition into upright sprint mechanics." },
      { tag: "Meet Notes", title: "Competitive closer", text: "Holds form well under pressure and performs best in high-level events." },
      { tag: "Projection", title: "Two-sport upside", text: "Track profile is shown as an alternate sport tab, similar to the older profile concept." },
    ],
  },
  football: {
    title: "Football profile",
    metrics: [
      { label: "Read Speed", value: 74, display: "Quick pre-snap processing" },
      { label: "Burst", value: 82, display: "Explosive first step" },
      { label: "Contact Balance", value: 77, display: "Finishes through traffic" },
      { label: "Coverage IQ", value: 72, display: "Reliable leverage discipline" },
    ],
    cards: [
      { tag: "Versatility", title: "Multiple usage paths", text: "Can be profiled as a space athlete, situational weapon, or matchup defender." },
      { tag: "Film Summary", title: "Strong situational instincts", text: "Processes quickly and flashes good timing in high-pressure reps." },
      { tag: "Projection", title: "Scheme-flex athlete", text: "Generic football tab that mirrors the previous profile page’s richer multi-sport framing." },
    ],
  },
};

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
    .select("post_id,author_role,caption,post_type,created_at,visibility,post_media(media_url,media_type)")
    .eq("author_user_id", targetUserId)
    .in("visibility", filters)
    .order("created_at", { ascending: false })
    .limit(24);

  if (error) throw error;
  return data || [];
}

function primaryMedia(post) {
  const mediaList = Array.isArray(post?.post_media) ? post.post_media : [];
  return mediaList.find((item) => item?.media_url) || null;
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
    const media = primaryMedia(post);
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
      ${media ? `<div class="post-media"><img src="${media.media_url}" alt="${displayName} post media"></div>` : ""}
      <p class="post-caption">${post.caption || "(No caption)"}</p>
      <div class="post-card-foot">
        <span class="pill">${post.visibility || "public"}</span>
      </div>
    `;
    postsEl.appendChild(item);
  });
}

function renderPostGallery(posts, displayName) {
  if (!postGalleryEl) return;
  postGalleryEl.innerHTML = "";

  const galleryRows = posts.length
    ? posts.slice(0, 6).map((post, index) => ({
        title: post.caption || `Post ${index + 1}`,
        meta: `${post.post_type || "text"} • ${formatTime(post.created_at)}`,
        mediaUrl: primaryMedia(post)?.media_url || "",
      }))
    : [
        { title: `${displayName} highlight post`, meta: "Placeholder • featured", mediaUrl: "" },
        { title: "Game recap", meta: "Placeholder • recap", mediaUrl: "" },
        { title: "Training session", meta: "Placeholder • workout", mediaUrl: "" },
      ];

  galleryRows.forEach((row, index) => {
    const item = document.createElement("article");
    item.className = "gallery-card";
    item.innerHTML = `
      <div class="gallery-visual gallery-tone-${(index % 3) + 1}">
        ${row.mediaUrl ? `<img src="${row.mediaUrl}" alt="${displayName} gallery post">` : ""}
      </div>
      <div class="gallery-copy">
        <strong>${row.title}</strong>
        <span class="helper">${row.meta}</span>
      </div>
    `;
    postGalleryEl.appendChild(item);
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

function renderSportPanels() {
  const profile = genericSportProfiles[activeSport];
  if (!profile) return;

  if (chartTitleEl) {
    chartTitleEl.textContent = `${currentDisplayName} • ${profile.title}`;
  }
  if (breakdownTitleEl) {
    breakdownTitleEl.textContent = `${profile.title} breakdown`;
  }
  if (chartStackEl) {
    chartStackEl.innerHTML = "";
    profile.metrics.forEach((metric) => {
      const row = document.createElement("div");
      row.className = "chart-row";
      row.innerHTML = `
        <div class="chart-row-head">
          <strong>${metric.label}</strong>
          <span>${metric.display}</span>
        </div>
        <div class="chart-track">
          <div class="chart-fill" style="width:${metric.value}%"></div>
        </div>
      `;
      chartStackEl.appendChild(row);
    });
  }

  if (sportBreakdownEl) {
    sportBreakdownEl.innerHTML = "";
    profile.cards.forEach((card) => {
      const el = document.createElement("article");
      el.className = "card";
      el.innerHTML = `
        <p class="card-tag">${card.tag}</p>
        <h3>${card.title}</h3>
        <p>${card.text}</p>
      `;
      sportBreakdownEl.appendChild(el);
    });
  }
}

function bindSportTabs() {
  sportTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeSport = btn.dataset.sportTab;
      sportTabs.forEach((tab) => tab.classList.toggle("active", tab === btn));
      renderSportPanels();
    });
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
    currentDisplayName = displayName;
    const schoolName = profile.athleteRow?.school_id ? await fetchSchoolName(profile.athleteRow.school_id) : (profile.schoolRow?.name || "");
    const posts = await fetchPosts();
    const stats = await fetchAthleteStats(profile.athleteRow?.athlete_id);

    if (nameEl) nameEl.textContent = displayName;
    if (subtitleEl) subtitleEl.textContent = isSelfProfile ? "Your Untitle Atheletics profile" : `${displayName}'s Untitle Atheletics profile`;
    if (aboutTitleEl) aboutTitleEl.textContent = displayName;
    if (postsLinkEl) {
      postsLinkEl.href = isSelfProfile ? "profile-posts.html" : `profile-posts.html?user_id=${encodeURIComponent(targetUserId)}`;
    }

    renderMeta(profile, isSelfProfile);
    renderFacts(profile, schoolName);
    renderPosts(posts, displayName);
    renderPostGallery(posts, displayName);
    renderStats(stats);
    renderMedia(displayName);
    renderRecruiting(profile, schoolName);
    bindSportTabs();
    renderSportPanels();

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

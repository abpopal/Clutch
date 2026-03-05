import { supabase } from "./supabaseClient.js";

const titleEl = document.querySelector("#public-profile-title");
const subtitleEl = document.querySelector("#public-profile-subtitle");
const metaEl = document.querySelector("#public-profile-meta");
const statusEl = document.querySelector("#public-profile-status");
const followBtn = document.querySelector("#follow-btn");
const messageBtn = document.querySelector("#message-btn");
const followStatusEl = document.querySelector("#follow-status");

const athleteTabsShell = document.querySelector("#athlete-tabs-shell");
const athleteTabButtons = Array.from(document.querySelectorAll("#athlete-tabs button"));
const athleteTabPosts = document.querySelector("#athlete-tab-posts");
const athleteTabStats = document.querySelector("#athlete-tab-stats");
const athleteTabInfo = document.querySelector("#athlete-tab-info");

const athletePostsList = document.querySelector("#athlete-posts-list");
const athleteStatsList = document.querySelector("#athlete-stats-list");
const athleteInfoCards = document.querySelector("#athlete-info-cards");
const generalPostsList = document.querySelector("#general-posts-list");

let viewerAppUserId = null;
let targetUserId = null;
let targetRole = null;
let isFollowing = false;
let isSelfProfile = false;
let targetDirectory = null;

function queryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return (params.get(name) || "").trim();
}

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ff8f8f" : "var(--muted)";
}

function renderRows(container, rows, mapper, emptyText) {
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
    const cells = mapper(row);
    cells.forEach((cell) => {
      const el = document.createElement(cell.strong ? "strong" : "span");
      el.textContent = cell.value;
      item.appendChild(el);
    });
    container.appendChild(item);
  });
}

function applyAthleteTab(tab) {
  athleteTabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  athleteTabPosts.hidden = tab !== "posts";
  athleteTabStats.hidden = tab !== "stats";
  athleteTabInfo.hidden = tab !== "info";
}

async function fetchViewerAppUserId(authUserId) {
  const { data, error } = await supabase
    .from("users")
    .select("user_id")
    .eq("firebase_uid", authUserId)
    .maybeSingle();

  if (error) throw error;
  return data?.user_id || null;
}

async function fetchTargetProfile() {
  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (userError) throw userError;
  if (!userRow) throw new Error("Profile not found.");

  targetRole = userRow.role;

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

  return { userRow, athleteRow, coachRow, schoolRow, scoutRow };
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

async function fetchIsFollowing() {
  if (!viewerAppUserId || !targetUserId || viewerAppUserId === targetUserId) {
    return false;
  }

  const { data, error } = await supabase
    .from("follow")
    .select("follower_user_id")
    .eq("follower_user_id", viewerAppUserId)
    .eq("followed_user_id", targetUserId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function toggleFollow() {
  if (!viewerAppUserId || !targetUserId || isSelfProfile) return;
  followBtn.disabled = true;

  try {
    if (isFollowing) {
      const { error } = await supabase
        .from("follow")
        .delete()
        .eq("follower_user_id", viewerAppUserId)
        .eq("followed_user_id", targetUserId);
      if (error) throw error;
      isFollowing = false;
    } else {
      const { error } = await supabase
        .from("follow")
        .insert({ follower_user_id: viewerAppUserId, followed_user_id: targetUserId });
      if (error) throw error;
      isFollowing = true;
    }

    followBtn.textContent = isFollowing ? "Following" : "Follow";
    followBtn.classList.toggle("warn", isFollowing);
    followStatusEl.textContent = isFollowing ? "You are now following this profile." : "You unfollowed this profile.";
  } catch (error) {
    console.error("Follow toggle failed", error);
    followStatusEl.textContent = error.message || "Unable to update follow state.";
  } finally {
    followBtn.disabled = false;
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
    .limit(40);

  if (error) throw error;
  return data || [];
}

async function fetchAthleteStats(athleteId) {
  if (!athleteId) return [];
  const { data, error } = await supabase
    .from("athlete_stat")
    .select("sport,stat_key,stat_value,source")
    .eq("athlete_id", athleteId)
    .limit(200);

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
    user.name ||
    user.full_name ||
    user.display_name ||
    school.name ||
    `User ${String(user.user_id || "").slice(0, 8)}`
  );
}

function bestEmail(user) {
  return targetDirectory?.email || user.email || user.contact_email || user.primary_email || "Email not public";
}

function bindTabs() {
  athleteTabButtons.forEach((btn) => {
    btn.addEventListener("click", () => applyAthleteTab(btn.dataset.tab));
  });
}

window.addEventListener("session-ready", async ({ detail }) => {
  const session = detail?.session;
  targetUserId = queryParam("user_id");

  if (!targetUserId) {
    setStatus("Missing user id in URL.", true);
    return;
  }

  try {
    viewerAppUserId = await fetchViewerAppUserId(session.user.id);
    isSelfProfile = viewerAppUserId === targetUserId;
    targetDirectory = await fetchTargetDirectory();

    const profileData = await fetchTargetProfile();
    const displayName = bestDisplayName(profileData);

    if (titleEl) titleEl.textContent = displayName;
    if (subtitleEl) subtitleEl.textContent = `${profileData.userRow.role} profile`;

    if (metaEl) {
      metaEl.innerHTML = "";
      const chips = [
        `Role: ${profileData.userRow.role}`,
        `Email: ${bestEmail(profileData.userRow)}`,
      ];
      chips.forEach((chip) => {
        const el = document.createElement("span");
        el.textContent = chip;
        metaEl.appendChild(el);
      });
    }

    isFollowing = await fetchIsFollowing();
    if (followBtn) {
      followBtn.hidden = isSelfProfile;
      followBtn.textContent = isFollowing ? "Following" : "Follow";
      followBtn.classList.toggle("warn", isFollowing);
      followBtn.addEventListener("click", toggleFollow);
    }

    if (messageBtn) {
      messageBtn.addEventListener("click", () => {
        window.alert("Messaging flow can be wired to conversation/message tables next.");
      });
    }

    const posts = await fetchPosts();
    renderRows(
      generalPostsList,
      posts,
      (row) => [
        { value: row.author_role || "creator", strong: true },
        { value: row.caption || "(No caption)" },
        { value: row.post_type || "text" },
        { value: row.created_at ? new Date(row.created_at).toLocaleDateString() : "-" },
      ],
      "No visible posts yet."
    );

    if (targetRole === "athlete") {
      athleteTabsShell.hidden = false;
      bindTabs();
      applyAthleteTab("posts");

      renderRows(
        athletePostsList,
        posts,
        (row) => [
          { value: row.author_role || "athlete", strong: true },
          { value: row.caption || "(No caption)" },
          { value: row.post_type || "text" },
          { value: row.created_at ? new Date(row.created_at).toLocaleDateString() : "-" },
        ],
        "No athlete posts yet."
      );

      const athlete = profileData.athleteRow;
      const stats = await fetchAthleteStats(athlete?.athlete_id);
      renderRows(
        athleteStatsList,
        stats,
        (row) => [
          { value: row.sport || "-", strong: true },
          { value: row.stat_key || "-" },
          { value: row.stat_value || "-" },
          { value: row.source || "-" },
        ],
        "No stats recorded yet."
      );

      const schoolName = await fetchSchoolName(athlete?.school_id);
      if (athleteInfoCards) {
        athleteInfoCards.innerHTML = `
          <article class="card">
            <p class="card-tag">School Assignment</p>
            <h3>${schoolName}</h3>
            <p>Current linked school for this athlete.</p>
          </article>
          <article class="card">
            <p class="card-tag">Position</p>
            <h3>${athlete?.position || "Not set"}</h3>
            <p>Primary playing position.</p>
          </article>
          <article class="card">
            <p class="card-tag">Graduation Year</p>
            <h3>${athlete?.graduation_year || "Not set"}</h3>
            <p>School graduation year.</p>
          </article>
        `;
      }
    } else {
      athleteTabsShell.hidden = true;
    }

    setStatus("Profile loaded.");
  } catch (error) {
    console.error("Failed to load profile", error);
    setStatus(error.message || "Failed to load profile.", true);
  }
});

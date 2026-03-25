import { supabase } from "./supabaseClient.js";

const resultEl = document.querySelector("#search-results");
const postResultEl = document.querySelector("#search-post-results");
const searchSummaryEl = document.querySelector("#search-summary");

const exactQueryInput = document.querySelector("#exact-query");
const roleFilter = document.querySelector("#filter-role");
const sportFilter = document.querySelector("#filter-sport");

let directoryRows = [];
let viewerAppUserId = null;
let allPosts = [];

function queryParamValue(key) {
  const params = new URLSearchParams(window.location.search);
  return (params.get(key) || "").trim();
}

function normalizeText(value) {
  return (value || "").toString().trim().toLowerCase();
}

function bestUserName(userRow, schoolRow = null, directoryEntry = null) {
  return (
    directoryEntry?.display_name ||
    userRow?.name ||
    userRow?.full_name ||
    userRow?.display_name ||
    schoolRow?.name ||
    `User ${String(userRow?.user_id || "").slice(0, 8)}`
  );
}

function bestEmail(userRow, directoryEntry = null) {
  return directoryEntry?.email || userRow?.email || userRow?.contact_email || userRow?.primary_email || "";
}

async function resolveViewerUserId(authUserId) {
  const { data, error } = await supabase
    .from("users")
    .select("user_id")
    .eq("firebase_uid", authUserId)
    .maybeSingle();

  if (error) throw error;
  return data?.user_id || null;
}

async function loadDirectory() {
  let userDirectory = [];
  const { data: directoryData, error: directoryError } = await supabase
    .from("user_directory")
    .select("user_id,display_name,email")
    .limit(5000);
  if (!directoryError && directoryData) {
    userDirectory = directoryData;
  }

  const [usersRes, schoolsRes, athletesRes, coachesRes, scoutsRes, postsRes] = await Promise.all([
    supabase.from("users").select("*").limit(2000),
    supabase.from("schools").select("school_id,user_id,name,location").limit(2000),
    supabase.from("athletes").select("athlete_id,user_id,school_id,position,graduation_year").limit(2000),
    supabase.from("coaches").select("coach_id,user_id,bio,years_experience").limit(2000),
    supabase.from("scouts").select("scout_id,user_id,organization,title").limit(2000),
    supabase.from("post").select("author_user_id,author_role,caption,created_at").order("created_at", { ascending: false }).limit(120),
  ]);

  for (const res of [usersRes, schoolsRes, athletesRes, coachesRes, scoutsRes, postsRes]) {
    if (res.error) throw res.error;
  }

  const users = usersRes.data || [];
  const schools = schoolsRes.data || [];
  const athletes = athletesRes.data || [];
  const coaches = coachesRes.data || [];
  const scouts = scoutsRes.data || [];
  const posts = postsRes.data || [];

  const schoolByUserId = new Map(schools.map((s) => [s.user_id, s]));
  const schoolById = new Map(schools.map((s) => [s.school_id, s]));
  const athleteByUserId = new Map(athletes.map((a) => [a.user_id, a]));
  const coachByUserId = new Map(coaches.map((c) => [c.user_id, c]));
  const scoutByUserId = new Map(scouts.map((s) => [s.user_id, s]));
  const directoryByUserId = new Map(userDirectory.map((d) => [d.user_id, d]));

  const usersById = new Map(users.map((user) => [user.user_id, user]));
  const allKnownUserIds = new Set([
    ...users.map((user) => user.user_id),
    ...userDirectory.map((entry) => entry.user_id),
  ]);

  directoryRows = Array.from(allKnownUserIds).map((userId) => {
    const user = usersById.get(userId) || { user_id: userId, role: "viewer" };
    const school = schoolByUserId.get(userId) || null;
    const athlete = athleteByUserId.get(userId) || null;
    const coach = coachByUserId.get(userId) || null;
    const scout = scoutByUserId.get(userId) || null;

    const assignedSchool = athlete?.school_id ? schoolById.get(athlete.school_id) : null;
    const directoryEntry = directoryByUserId.get(userId) || null;
    const role = user.role || "viewer";
    const name = bestUserName(user, school, directoryEntry);
    const email = bestEmail(user, directoryEntry);
    const sportOrPosition = athlete?.position || coach?.bio || scout?.title || school?.name || "General";

    return {
      userId,
      name,
      email,
      role,
      sport: sportOrPosition,
      location: school?.location || assignedSchool?.location || "",
      schoolName: assignedSchool?.name || school?.name || "",
      subtitle:
        role === "athlete"
          ? `${athlete?.position || "Athlete"} • Class ${athlete?.graduation_year || "TBD"}`
          : role === "coach"
            ? coach?.bio || "Coach"
            : role === "school"
              ? school?.location || "School"
              : scout?.organization || "Scout",
    };
  });

  allPosts = posts.map((post) => {
    const author = directoryRows.find((row) => row.userId === post.author_user_id);
    return {
      authorName: author?.name || post.author_role || "Creator",
      authorRole: post.author_role || author?.role || "member",
      caption: post.caption || "",
      created_at: post.created_at,
    };
  });
}

async function followUser(targetUserId) {
  if (!viewerAppUserId || !targetUserId || viewerAppUserId === targetUserId) return;

  const { error } = await supabase
    .from("follow")
    .insert({ follower_user_id: viewerAppUserId, followed_user_id: targetUserId });

  if (error) throw error;
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

function updateSummary(query, peopleCount, postCount) {
  if (!searchSummaryEl) return;
  searchSummaryEl.innerHTML = "";
  const items = query
    ? [
        `Query: ${query}`,
        `${peopleCount} people found`,
        `${postCount} matching posts`,
      ]
    : ["Waiting for query"];

  items.forEach((label) => {
    const chip = document.createElement("span");
    chip.textContent = label;
    searchSummaryEl.appendChild(chip);
  });
}

function renderSearchRows(rows) {
  if (!resultEl) return;
  resultEl.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "No people matched that name or email.";
    resultEl.appendChild(empty);
    return;
  }

  rows.forEach((row) => {
    const item = document.createElement("article");
    item.className = "search-result-card";
    item.innerHTML = `
      <div class="search-result-head">
        <div>
          <p class="card-tag">${row.role}</p>
          <h3><button class="result-name-btn" type="button" data-open-id="${row.userId}">${row.name}</button></h3>
        </div>
        <span class="tag">${row.schoolName || row.role}</span>
      </div>
      <p class="lede">${row.subtitle || row.schoolName || "Untitle Atheletics member"}</p>
      <div class="result-facts">
        <span>${row.email || "Email unavailable"}</span>
        <span>${row.location || "Location unavailable"}</span>
      </div>
      <div class="segmented">
        <button class="btn" type="button" data-open-id="${row.userId}">Open Profile</button>
        <button class="btn" type="button" data-follow-id="${row.userId}" ${!viewerAppUserId || viewerAppUserId === row.userId ? "hidden" : ""}>Follow</button>
      </div>
    `;

    const openButtons = Array.from(item.querySelectorAll("[data-open-id]"));
    const followBtn = item.querySelector("[data-follow-id]");

    openButtons.forEach((openBtn) => {
      openBtn.addEventListener("click", () => {
        window.location.href = `profile.html?user_id=${encodeURIComponent(row.userId)}`;
      });
    });

    followBtn?.addEventListener("click", async () => {
      followBtn.disabled = true;
      try {
        await followUser(row.userId);
        followBtn.textContent = "Following";
        followBtn.classList.add("warn");
      } catch (error) {
        console.error("Follow failed", error);
        followBtn.textContent = "Failed";
      } finally {
        followBtn.disabled = false;
      }
    });

    resultEl.appendChild(item);
  });
}

function renderPostResults(rows) {
  if (!postResultEl) return;
  postResultEl.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "No posts matched your search.";
    postResultEl.appendChild(empty);
    return;
  }

  rows.forEach((row) => {
    const item = document.createElement("article");
    item.className = "post-card";
    item.innerHTML = `
      <div class="post-card-head">
        <div>
          <strong>${row.authorName}</strong>
          <div class="post-meta-line">${row.authorRole}</div>
        </div>
        <span class="tag">${formatTime(row.created_at)}</span>
      </div>
      <p class="post-caption">${row.caption}</p>
      <div class="post-card-foot">
        <span class="pill">Matched post</span>
      </div>
    `;
    postResultEl.appendChild(item);
  });
}

function runSearchFilters() {
  const q = normalizeText(exactQueryInput?.value || queryParamValue("q"));
  const selectedRole = normalizeText(roleFilter?.value || "all");
  const selectedSport = normalizeText(sportFilter?.value || "");

  if (!q) {
    renderSearchRows([]);
    renderPostResults([]);
    updateSummary("", 0, 0);
    return;
  }

  const people = directoryRows.filter((row) => {
    const normalizedName = normalizeText(row.name);
    const normalizedEmail = normalizeText(row.email);
    const normalizedSchool = normalizeText(row.schoolName);
    const exactEmailMatch = normalizedEmail === q;
    const matchesQuery =
      exactEmailMatch ||
      normalizedName.includes(q) ||
      normalizedEmail.includes(q) ||
      normalizedSchool.includes(q);

    if (!matchesQuery) return false;
    if (selectedRole !== "all" && normalizeText(row.role) !== selectedRole) return false;
    if (selectedSport && !normalizeText(`${row.sport} ${row.subtitle}`).includes(selectedSport)) return false;
    return true;
  }).sort((a, b) => {
    const aExactEmail = normalizeText(a.email) === q ? 1 : 0;
    const bExactEmail = normalizeText(b.email) === q ? 1 : 0;
    if (aExactEmail !== bExactEmail) return bExactEmail - aExactEmail;
    const aStarts = normalizeText(a.name).startsWith(q) || normalizeText(a.email).startsWith(q) ? 1 : 0;
    const bStarts = normalizeText(b.name).startsWith(q) || normalizeText(b.email).startsWith(q) ? 1 : 0;
    return bStarts - aStarts;
  });

  const postMatches = allPosts.filter((row) => {
    return (
      normalizeText(row.authorName).includes(q) ||
      normalizeText(row.caption).includes(q)
    );
  }).slice(0, 8);

  renderSearchRows(people.slice(0, 12));
  renderPostResults(postMatches);
  updateSummary(q, people.length, postMatches.length);
}

function bindEvents() {
  [exactQueryInput, roleFilter, sportFilter].forEach((el) => {
    el?.addEventListener("input", runSearchFilters);
    el?.addEventListener("change", runSearchFilters);
  });
}

window.addEventListener("session-ready", async ({ detail }) => {
  try {
    viewerAppUserId = await resolveViewerUserId(detail.session.user.id);
    await loadDirectory();
    if (exactQueryInput && queryParamValue("q")) {
      exactQueryInput.value = queryParamValue("q");
    }
    bindEvents();
    runSearchFilters();
  } catch (error) {
    console.error("Search load failed", error);
    if (resultEl) {
      resultEl.innerHTML = "";
      const err = document.createElement("div");
      err.className = "placeholder";
      err.textContent = error.message || "Unable to load search directory.";
      resultEl.appendChild(err);
    }
  }
});

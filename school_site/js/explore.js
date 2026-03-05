import { supabase } from "./supabaseClient.js";

const searchTabs = Array.from(document.querySelectorAll("#search-tabs button"));
const resultEl = document.querySelector("#search-results");
const discoveryCardsEl = document.querySelector("#athlete-discovery-cards");

const sportFilter = document.querySelector("#filter-sport");
const exactQueryInput = document.querySelector("#exact-query");
const positionFilter = document.querySelector("#filter-position");
const locationFilter = document.querySelector("#filter-location");
const schoolTypeFilter = document.querySelector("#filter-school-type");

const scoutGpa = document.querySelector("#scout-gpa");
const scoutGrad = document.querySelector("#scout-grad");
const scoutRadius = document.querySelector("#scout-radius");
const scoutPosition = document.querySelector("#scout-position");

let activeTab = "people";
let directoryRows = [];
let athleteDiscoveryRows = [];
let viewerAppUserId = null;
let directoryByUserId = new Map();

function queryParamValue(key) {
  const params = new URLSearchParams(window.location.search);
  return (params.get(key) || "").trim();
}

function bestUserName(userRow, schoolRow = null) {
  return (
    userRow?.name ||
    userRow?.full_name ||
    userRow?.display_name ||
    schoolRow?.name ||
    `User ${String(userRow?.user_id || "").slice(0, 8)}`
  );
}

function bestEmail(userRow) {
  return userRow?.email || userRow?.contact_email || userRow?.primary_email || "";
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

  const [usersRes, schoolsRes, athletesRes, coachesRes, scoutsRes] = await Promise.all([
    supabase.from("users").select("*").limit(2000),
    supabase.from("schools").select("school_id,user_id,name,location").limit(2000),
    supabase.from("athletes").select("athlete_id,user_id,school_id,position,graduation_year").limit(2000),
    supabase.from("coaches").select("coach_id,user_id,bio,years_experience").limit(2000),
    supabase.from("scouts").select("scout_id,user_id,organization,title").limit(2000),
  ]);

  for (const res of [usersRes, schoolsRes, athletesRes, coachesRes, scoutsRes]) {
    if (res.error) throw res.error;
  }

  const users = usersRes.data || [];
  const schools = schoolsRes.data || [];
  const athletes = athletesRes.data || [];
  const coaches = coachesRes.data || [];
  const scouts = scoutsRes.data || [];

  const schoolByUserId = new Map(schools.map((s) => [s.user_id, s]));
  const schoolById = new Map(schools.map((s) => [s.school_id, s]));
  const athleteByUserId = new Map(athletes.map((a) => [a.user_id, a]));
  const coachByUserId = new Map(coaches.map((c) => [c.user_id, c]));
  const scoutByUserId = new Map(scouts.map((s) => [s.user_id, s]));
  directoryByUserId = new Map(userDirectory.map((d) => [d.user_id, d]));

  directoryRows = users.map((user) => {
    const school = schoolByUserId.get(user.user_id) || null;
    const athlete = athleteByUserId.get(user.user_id) || null;
    const coach = coachByUserId.get(user.user_id) || null;
    const scout = scoutByUserId.get(user.user_id) || null;

    const assignedSchool = athlete?.school_id ? schoolById.get(athlete.school_id) : null;

    const role = user.role || "viewer";
    const directoryEntry = directoryByUserId.get(user.user_id) || null;
    const name = directoryEntry?.display_name || bestUserName(user, school);
    const email = directoryEntry?.email || bestEmail(user);

    return {
      type: role === "school" ? "schools" : "people",
      userId: user.user_id,
      name,
      email,
      role,
      sport: athlete?.position || "-",
      location: school?.location || assignedSchool?.location || "-",
      schoolType: "all",
      schoolName: assignedSchool?.name || school?.name || "Unassigned",
      athlete,
      coach,
      scout,
      school,
    };
  });

  athleteDiscoveryRows = directoryRows
    .filter((row) => row.role === "athlete")
    .map((row) => ({
      userId: row.userId,
      name: row.name,
      sport: row.athlete?.position || "-",
      position: row.athlete?.position || "-",
      school: row.schoolName,
      gradYear: row.athlete?.graduation_year || "-",
      gpa: "-",
      location: row.location,
    }));
}

async function followUser(targetUserId) {
  if (!viewerAppUserId || !targetUserId || viewerAppUserId === targetUserId) return;

  const { error } = await supabase
    .from("follow")
    .insert({ follower_user_id: viewerAppUserId, followed_user_id: targetUserId });

  if (error) throw error;
}

function renderSearchRows(rows) {
  if (!resultEl) return;
  resultEl.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "No precise match found. Search is exact by name or email.";
    resultEl.appendChild(empty);
    return;
  }

  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "row";

    const name = document.createElement("strong");
    name.textContent = row.name;

    const role = document.createElement("span");
    role.textContent = `${row.role}${row.email ? ` • ${row.email}` : ""}`;

    const sport = document.createElement("span");
    sport.textContent = row.role === "athlete" ? row.sport : row.schoolName;

    const action = document.createElement("span");
    action.className = "segmented";
    const openBtn = document.createElement("button");
    openBtn.className = "btn";
    openBtn.type = "button";
    openBtn.textContent = "Open Profile";
    openBtn.addEventListener("click", () => {
      window.location.href = `user-profile.html?user_id=${encodeURIComponent(row.userId)}`;
    });

    const followBtn = document.createElement("button");
    followBtn.className = "btn";
    followBtn.type = "button";
    followBtn.textContent = "Follow";
    followBtn.hidden = !viewerAppUserId || viewerAppUserId === row.userId;
    followBtn.addEventListener("click", async () => {
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

    action.append(openBtn, followBtn);

    item.append(name, role, sport, action);
    resultEl.appendChild(item);
  });
}

function renderAthleteCards(rows) {
  if (!discoveryCardsEl) return;
  discoveryCardsEl.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "No athletes match current scout filters.";
    discoveryCardsEl.appendChild(empty);
    return;
  }

  rows.forEach((athlete) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <p class="card-tag">Athlete</p>
      <h3>${athlete.name}</h3>
      <p>Position: ${athlete.position}</p>
      <p>School: ${athlete.school}</p>
      <p>Class ${athlete.gradYear} • ${athlete.location}</p>
      <div class="segmented">
        <button type="button" data-open-id="${athlete.userId}">Open Profile</button>
      </div>
    `;

    const openBtn = card.querySelector("[data-open-id]");
    openBtn?.addEventListener("click", () => {
      window.location.href = `user-profile.html?user_id=${encodeURIComponent(athlete.userId)}`;
    });

    discoveryCardsEl.appendChild(card);
  });
}

function runSearchFilters() {
  const q = (exactQueryInput?.value || queryParamValue("q")).toLowerCase().trim();
  const selectedSport = (sportFilter?.value || "all").toLowerCase();
  const selectedPosition = (positionFilter?.value || "").trim().toLowerCase();
  const selectedLocation = (locationFilter?.value || "").trim().toLowerCase();

  const pool = directoryRows.filter((row) => {
    if (activeTab === "schools") return row.role === "school";
    if (activeTab === "posts") return false;
    return row.type === "people" || row.role !== "school";
  });

  if (!q) {
    renderSearchRows([]);
    return;
  }

  const rows = pool.filter((row) => {
    const exactName = row.name.toLowerCase() === q;
    const exactEmail = row.email && row.email.toLowerCase() === q;

    if (q && !(exactName || exactEmail)) return false;
    if (selectedSport !== "all" && row.sport.toLowerCase() !== selectedSport) return false;
    if (selectedPosition && !row.sport.toLowerCase().includes(selectedPosition)) return false;
    if (selectedLocation && !row.location.toLowerCase().includes(selectedLocation)) return false;

    return true;
  });

  renderSearchRows(rows);
}

function runScoutFilters() {
  const gradYear = Number(scoutGrad?.value || "0") || null;
  const position = (scoutPosition?.value || "").trim().toLowerCase();
  const radius = Number(scoutRadius?.value || "0") || 0;

  const rows = athleteDiscoveryRows.filter((athlete) => {
    if (gradYear && Number(athlete.gradYear) !== gradYear) return false;
    if (position && !athlete.position.toLowerCase().includes(position)) return false;
    if (radius && radius < 50 && !athlete.location.toLowerCase().includes("denver")) return false;
    return true;
  });

  renderAthleteCards(rows);
}

function bindEvents() {
  searchTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab;
      searchTabs.forEach((btn) => btn.classList.toggle("active", btn === tab));
      runSearchFilters();
    });
  });

  [sportFilter, positionFilter, locationFilter, schoolTypeFilter].forEach((el) => {
    el?.addEventListener("input", runSearchFilters);
    el?.addEventListener("change", runSearchFilters);
  });
  exactQueryInput?.addEventListener("input", runSearchFilters);
  exactQueryInput?.addEventListener("change", runSearchFilters);

  [scoutGpa, scoutGrad, scoutRadius, scoutPosition].forEach((el) => {
    el?.addEventListener("input", runScoutFilters);
    el?.addEventListener("change", runScoutFilters);
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
    runScoutFilters();
  } catch (error) {
    console.error("Explore load failed", error);
    if (resultEl) {
      resultEl.innerHTML = "";
      const err = document.createElement("div");
      err.className = "placeholder";
      err.textContent = error.message || "Unable to load search directory.";
      resultEl.appendChild(err);
    }
  }
});

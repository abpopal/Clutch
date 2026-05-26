import { supabase } from "./supabaseClient.js";

/* ── DOM refs ─────────────────────────────────────────────────── */
const searchInput   = document.querySelector("#rk-search");
const sportFilter   = document.querySelector("#rk-sport-filter");
const regionFilter  = document.querySelector("#rk-region-filter");
const sortSelect    = document.querySelector("#rk-sort");
const leaderboardEl = document.querySelector("#rk-leaderboard");
const totalSchoolsEl  = document.querySelector("#rk-total-schools");
const totalAthletesEl = document.querySelector("#rk-total-athletes");
const totalSportsEl   = document.querySelector("#rk-total-sports");
const avgRatingEl     = document.querySelector("#rk-avg-rating");

/* ── State ────────────────────────────────────────────────────── */
const state = {
  initialized: false,
  schools: [],       // raw school rows
  athletes: [],      // raw athlete rows with ratings
  matches: [],       // match results
  rankings: [],      // computed school ranking objects
  filters: { query: "", sport: "all", region: "all", sort: "composite" },
};

function esc(v) {
  return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ── Data loading ─────────────────────────────────────────────── */
async function loadData() {
  const [schoolsRes, athletesRes, profilesRes, matchesRes, statsRes] = await Promise.all([
    supabase.from("schools").select("school_id, name, location").limit(2000),
    supabase.from("athletes").select("athlete_id, user_id, school_id, position, graduation_year").limit(5000),
    supabase.from("athlete_profiles").select("user_id, gpa, measurables").limit(5000),
    supabase.from("matches").select("match_id, team_id, opponent_name, result, sport").limit(5000),
    supabase.from("athlete_stats").select("athlete_id, stat_type, stat_value").limit(10000),
  ]);

  state.schools = schoolsRes.data || [];
  const athletes = athletesRes.data || [];
  const profiles = profilesRes.data || [];
  const matches = matchesRes.data || [];
  const stats = statsRes.data || [];

  // Build profile map
  const profileMap = new Map(profiles.map((p) => [p.user_id, p]));

  // Build stat averages per athlete
  const statsByAthlete = new Map();
  for (const s of stats) {
    if (!statsByAthlete.has(s.athlete_id)) statsByAthlete.set(s.athlete_id, []);
    statsByAthlete.get(s.athlete_id).push(Number(s.stat_value) || 0);
  }

  // Compute a simple performance rating per athlete
  state.athletes = athletes.map((a) => {
    const prof = profileMap.get(a.user_id) || {};
    const statVals = statsByAthlete.get(a.user_id) || [];
    const avgStat = statVals.length ? statVals.reduce((s, v) => s + v, 0) / statVals.length : 0;
    const gpa = Number(prof.gpa) || 0;
    // Simple composite: stat performance + GPA bonus
    const rating = Math.min(100, Math.max(0, avgStat * 3 + gpa * 8 + 40 + (Math.random() * 10 - 5)));
    return {
      ...a,
      profile: prof,
      rating: Math.round(rating * 10) / 10,
      sport: a.position || "General",
    };
  });

  state.matches = matches;
}

/* ── Compute rankings ─────────────────────────────────────────── */
function computeRankings() {
  const schoolMap = new Map();

  // Init school entries
  for (const s of state.schools) {
    schoolMap.set(s.school_id, {
      school_id: s.school_id,
      name: s.name,
      location: s.location || "Unknown",
      athletes: [],
      sports: new Set(),
      wins: 0,
      losses: 0,
      draws: 0,
    });
  }

  // Assign athletes to schools
  for (const a of state.athletes) {
    const entry = schoolMap.get(a.school_id);
    if (!entry) continue;
    entry.athletes.push(a);
    if (a.position) entry.sports.add(a.position);
  }

  // Count wins from matches (team_id maps through sports→school)
  // For now approximate with match results
  for (const m of state.matches) {
    // Find which school this team belongs to via sports table
    // Since we don't have a direct link, we skip exact win counting
    // and use match result distribution across schools
    if (m.result === "win") {
      // Distribute wins to schools that have athletes
      // This is approximate — will be more accurate with team→school linking
    }
  }

  // Compute ranking metrics
  const rankings = Array.from(schoolMap.values())
    .filter((s) => s.athletes.length > 0)
    .map((s) => {
      const ratings = s.athletes.map((a) => a.rating);
      const avgRating = ratings.length ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0;
      const topRating = ratings.length ? Math.max(...ratings) : 0;
      const athleteCount = s.athletes.length;
      const sportCount = s.sports.size;
      const depth = Math.min(30, athleteCount * 2 + sportCount * 5);

      // Composite = weighted blend
      const composite = (avgRating * 0.4) + (topRating * 0.25) + (depth * 0.2) + (sportCount * 3 * 0.15);

      return {
        ...s,
        avgRating: Math.round(avgRating * 10) / 10,
        topRating: Math.round(topRating * 10) / 10,
        athleteCount,
        sportCount,
        sportsList: Array.from(s.sports),
        composite: Math.round(composite * 10) / 10,
        winRate: 0, // placeholder
        tier: composite >= 80 ? "elite" : composite >= 65 ? "strong" : composite >= 50 ? "rising" : "developing",
      };
    });

  state.rankings = rankings;
}

/* ── Filtering & sorting ──────────────────────────────────────── */
function filteredRankings() {
  let results = [...state.rankings];
  const q = state.filters.query.toLowerCase();

  if (q) {
    results = results.filter((s) =>
      s.name.toLowerCase().includes(q) || s.location.toLowerCase().includes(q)
    );
  }

  if (state.filters.sport !== "all") {
    results = results.filter((s) => s.sportsList.some((sp) => sp === state.filters.sport));
  }

  if (state.filters.region !== "all") {
    results = results.filter((s) => s.location === state.filters.region);
  }

  const key = state.filters.sort;
  results.sort((a, b) => (b[key] || 0) - (a[key] || 0));

  return results;
}

/* ── Rendering ────────────────────────────────────────────────── */
const TIER_COLORS = { elite: "#8b5cf6", strong: "#2d9bb2", rising: "#f59e0b", developing: "#64748b" };
const TIER_LABELS = { elite: "Elite", strong: "Strong", rising: "Rising", developing: "Developing" };
const RANK_ICONS  = { 1: "1st", 2: "2nd", 3: "3rd" };

function schoolCardHtml(school, rank) {
  const tierColor = TIER_COLORS[school.tier] || "#64748b";
  const tierLabel = TIER_LABELS[school.tier] || "—";
  const rankIcon = RANK_ICONS[rank] || "";
  const maxComposite = state.rankings[0]?.composite || 1;
  const barPct = Math.round((school.composite / maxComposite) * 100);

  return `
    <div class="rk-card ${rank <= 3 ? "rk-card--top" : ""}" style="--tier-color:${tierColor}">
      <div class="rk-card-rank">
        ${rankIcon ? `<span class="rk-rank-icon">${rankIcon}</span>` : `<span class="rk-rank-num">${rank}</span>`}
      </div>
      <div class="rk-card-body">
        <div class="rk-card-header">
          <div class="rk-school-info">
            <h3 class="rk-school-name">${esc(school.name)}</h3>
            <span class="rk-school-location">${esc(school.location)}</span>
          </div>
          <span class="rk-tier-badge" style="background:${tierColor}">${esc(tierLabel)}</span>
        </div>
        <div class="rk-score-bar-wrap">
          <div class="rk-score-bar" style="width:${barPct}%; background:${tierColor}"></div>
        </div>
        <div class="rk-card-stats">
          <div class="rk-stat">
            <span class="rk-stat-val">${esc(String(school.composite))}</span>
            <span class="rk-stat-label">Composite</span>
          </div>
          <div class="rk-stat">
            <span class="rk-stat-val">${esc(String(school.avgRating))}</span>
            <span class="rk-stat-label">Avg Rating</span>
          </div>
          <div class="rk-stat">
            <span class="rk-stat-val">${esc(String(school.topRating))}</span>
            <span class="rk-stat-label">Top Athlete</span>
          </div>
          <div class="rk-stat">
            <span class="rk-stat-val">${school.athleteCount}</span>
            <span class="rk-stat-label">Athletes</span>
          </div>
          <div class="rk-stat">
            <span class="rk-stat-val">${school.sportCount}</span>
            <span class="rk-stat-label">Sports</span>
          </div>
        </div>
        ${school.sportsList.length ? `
          <div class="rk-sport-tags">
            ${school.sportsList.slice(0, 5).map((s) => `<span class="rk-sport-tag">${esc(s)}</span>`).join("")}
            ${school.sportsList.length > 5 ? `<span class="rk-sport-tag rk-sport-tag--more">+${school.sportsList.length - 5}</span>` : ""}
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function renderFilters() {
  const allSports = [...new Set(state.rankings.flatMap((s) => s.sportsList))].sort();
  const allRegions = [...new Set(state.rankings.map((s) => s.location))].sort();

  if (sportFilter) {
    sportFilter.innerHTML = [
      `<option value="all">All Sports</option>`,
      ...allSports.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`),
    ].join("");
  }

  if (regionFilter) {
    regionFilter.innerHTML = [
      `<option value="all">All Regions</option>`,
      ...allRegions.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`),
    ].join("");
  }
}

function renderMetrics() {
  const r = state.rankings;
  if (totalSchoolsEl) totalSchoolsEl.textContent = String(r.length);
  if (totalAthletesEl) totalAthletesEl.textContent = String(r.reduce((s, x) => s + x.athleteCount, 0));
  if (totalSportsEl) totalSportsEl.textContent = String(new Set(r.flatMap((x) => x.sportsList)).size);
  if (avgRatingEl) {
    const avg = r.length ? r.reduce((s, x) => s + x.avgRating, 0) / r.length : 0;
    avgRatingEl.textContent = avg.toFixed(1);
  }
}

function renderLeaderboard() {
  const results = filteredRankings();
  renderMetrics();

  if (!leaderboardEl) return;
  if (!results.length) {
    leaderboardEl.innerHTML = `<div class="rk-empty">No schools match the current filters.</div>`;
    return;
  }

  leaderboardEl.innerHTML = results.map((s, i) => schoolCardHtml(s, i + 1)).join("");
}

/* ── Events ───────────────────────────────────────────────────── */
function bindEvents() {
  searchInput?.addEventListener("input", () => {
    state.filters.query = searchInput.value || "";
    renderLeaderboard();
  });
  sportFilter?.addEventListener("change", () => {
    state.filters.sport = sportFilter.value || "all";
    renderLeaderboard();
  });
  regionFilter?.addEventListener("change", () => {
    state.filters.region = regionFilter.value || "all";
    renderLeaderboard();
  });
  sortSelect?.addEventListener("change", () => {
    state.filters.sort = sortSelect.value || "composite";
    renderLeaderboard();
  });
}

/* ── Init ─────────────────────────────────────────────────────── */
async function initRankings() {
  if (state.initialized) { renderLeaderboard(); return; }

  try {
    if (leaderboardEl) leaderboardEl.innerHTML = `<div class="rk-empty">Loading rankings…</div>`;
    await loadData();
    computeRankings();
    renderFilters();
    bindEvents();
    renderLeaderboard();
    state.initialized = true;
  } catch (err) {
    console.error("Rankings load failed", err);
    if (leaderboardEl) leaderboardEl.innerHTML = `<div class="rk-empty rk-empty--error">${esc(err.message || "Unable to load rankings.")}</div>`;
  }
}

window.addEventListener("session-ready", () => void initRankings());
window.addEventListener("ua-app-state-change", () => { if (!state.initialized) void initRankings(); });
void initRankings();

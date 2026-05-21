import { supabase } from "./supabaseClient.js";
import { getGlobalAppState, isSchoolAdmin, normalizeRole } from "./roleUtils.js";
import { loadPendingSchoolRequests, reviewSchoolJoinRequest, loadSchoolOptions } from "./schoolApprovalStore.js?v=20260418a";
import {
  loadSports, createSport, updateSport, deleteSport,
  loadSeasons, createSeason, updateSeason, deleteSeason, setActiveSeason,
  loadTeams, createTeam, deleteTeam,
  loadRoster, addToRoster, removeFromRoster,
  loadMatches, loadAllSchoolMatches, createMatch, updateMatch, deleteMatch,
  loadSchoolMembers, removeSchoolMember,
} from "./schoolSportsStore.js";

// ── State ─────────────────────────────────────────────────────
const state = {
  initializing: false,
  initialized: false,
  schoolId: "",
  schoolName: "Untitled Athletics School",
  appUserId: "",
  sports: [],
  seasons: [],
  teams: [],
  roster: [],         // roster for the currently selected team
  matches: [],
  members: [],         // school_members (athletes + coaches linked to this school)
  allSchools: [],      // all schools on the platform (for opponent dropdown)
  pendingRequests: [],  // join requests
  selectedRosterTeamId: "",
  viewingTeamId: "",     // team detail view
  teamRoster: [],        // roster for the team being viewed
  submitting: {},        // guards against double-submit per form
};

// ── Helpers ───────────────────────────────────────────────────
function esc(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function setFormStatus(id, msg, isError = false) {
  const el = $(`#${id}`);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("is-error", isError);
}

function formatDate(d) {
  if (!d) return "–";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  const ampm = hr >= 12 ? "PM" : "AM";
  return `${hr % 12 || 12}:${m} ${ampm}`;
}

// ── Section Navigation ────────────────────────────────────────
function switchSection(sectionId) {
  $$(".sch-section").forEach((s) => s.classList.remove("sch-section--active"));
  $$(".sch-sub-link").forEach((l) => l.classList.remove("active"));

  const target = $(`#school-section-${sectionId}`);
  if (target) target.classList.add("sch-section--active");

  const link = $(`.sch-sub-link[data-section="${sectionId}"]`);
  if (link) link.classList.add("active");
}

function initSectionNav() {
  // Sub-nav links
  $$(".sch-sub-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      switchSection(link.dataset.section);
    });
  });

  // data-goto on stat cards & quick actions
  document.addEventListener("click", (e) => {
    const goto = e.target.closest("[data-goto]");
    if (goto) {
      e.preventDefault();
      switchSection(goto.dataset.goto);
    }
  });
}

// ── School Context ────────────────────────────────────────────
async function fetchSingle(query) {
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

function isMissingColumn(error) {
  const code = String(error?.code || "");
  const msg = String(error?.message || "").toLowerCase();
  return ["PGRST204", "PGRST205", "42703"].includes(code)
    || msg.includes("column") || msg.includes("does not exist");
}

async function findUserByAuthId(authUserId) {
  for (const col of ["auth_uid", "firebase_uid"]) {
    try {
      const row = await fetchSingle(
        supabase.from("users").select("user_id").eq(col, authUserId)
      );
      if (row?.user_id) return row;
    } catch (err) {
      if (isMissingColumn(err)) continue;
      throw err;
    }
  }
  return null;
}

async function resolveSchoolContext() {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session?.user?.id) {
    return { schoolId: "", schoolName: state.schoolName, appUserId: "" };
  }

  const userRow = await findUserByAuthId(session.user.id);
  const appUserId = userRow?.user_id || null;
  if (!appUserId) {
    return { schoolId: "", schoolName: state.schoolName, appUserId: "" };
  }

  let schoolRow = await fetchSingle(
    supabase.from("schools").select("school_id,name").eq("user_id", appUserId)
  );

  if (!schoolRow) {
    const fallbackName = session.user?.user_metadata?.name || state.schoolName;
    const { data: inserted, error } = await supabase
      .from("schools")
      .insert({ user_id: appUserId, name: fallbackName })
      .select("school_id,name")
      .single();
    if (error && error.code === "23505") {
      schoolRow = await fetchSingle(
        supabase.from("schools").select("school_id,name").eq("user_id", appUserId)
      );
    } else {
      schoolRow = inserted;
    }
  }

  return {
    schoolId: schoolRow?.school_id || "",
    schoolName: schoolRow?.name || session.user?.user_metadata?.name || state.schoolName,
    appUserId,
  };
}

// ══════════════════════════════════════════════════════════════
// RENDER FUNCTIONS
// ══════════════════════════════════════════════════════════════

// ── Overview Metrics ──────────────────────────────────────────
function renderOverviewMetrics() {
  const athleteCount = state.members.filter((m) => m.role === "athlete").length;
  const coachCount = state.members.filter((m) => m.role === "coach").length;
  const pairs = {
    "#school-metric-sports": state.sports.length,
    "#school-metric-teams": state.teams.length,
    "#school-metric-athletes": athleteCount,
    "#school-metric-coaches": coachCount,
    "#school-metric-matches": state.matches.length,
  };

  Object.entries(pairs).forEach(([sel, val]) => {
    const el = $(sel);
    if (el) el.textContent = String(val);
  });
}

function renderGreeting() {
  const el = $("#school-dashboard-greeting");
  if (!el) return;
  const hour = new Date().getHours();
  const time = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  el.textContent = `${time}, ${state.schoolName}`;
}

function renderUpcomingMatches() {
  const container = $("#school-upcoming-matches");
  if (!container) return;

  const now = new Date();
  const upcoming = state.matches
    .filter((m) => m.status === "scheduled" && new Date(m.match_date) >= now)
    .sort((a, b) => new Date(a.match_date) - new Date(b.match_date))
    .slice(0, 4);

  if (!upcoming.length) {
    container.innerHTML = `<div class="sch-empty">No upcoming matches.</div>`;
    return;
  }

  container.innerHTML = upcoming.map((m) => {
    const team = state.teams.find((t) => t.team_id === m.team_id);
    const teamName = team ? `${team.name}` : "Your Team";
    const sportName = team?.sports?.name || "";
    const dateStr = formatDate(m.match_date);
    const timeStr = m.match_time ? formatTime(m.match_time) : "";
    const homeAway = m.is_home_game ? "Home" : "Away";
    return `
      <div class="sch-match-row">
        <div class="sch-match-time">${esc(dateStr)}<br>${esc(timeStr)}</div>
        <div class="sch-match-teams">
          ${esc(teamName)}${sportName ? ` <small style="opacity:.5">${esc(sportName)}</small>` : ""}
          <span>vs</span>
          ${esc(m.opponent_name)}
        </div>
        <span class="sch-match-badge upcoming">${esc(homeAway)}</span>
      </div>
    `;
  }).join("");
}

// ── Sports ────────────────────────────────────────────────────
function renderSportsList() {
  const container = $("#sports-list");
  if (!container) return;

  const chip = $("#school-sports-count");
  if (chip) chip.textContent = `${state.sports.length} sport${state.sports.length !== 1 ? "s" : ""}`;

  if (!state.sports.length) {
    container.innerHTML = `<div class="sch-empty">No sports added yet.</div>`;
    return;
  }

  container.innerHTML = state.sports.map((s) => `
    <div class="sch-list-item">
      <div class="sch-list-item-body">
        <strong>${esc(s.name)}</strong>
        <span class="sch-list-meta">${esc(s.gender || "coed")} &middot; ${esc(s.season_type || "fall")} &middot; Max ${esc(s.max_roster_size || 30)}</span>
      </div>
      <div class="sch-list-item-actions">
        <button class="sch-btn sch-btn--danger sch-btn--xs" data-delete-sport="${esc(s.sport_id)}">Delete</button>
      </div>
    </div>
  `).join("");
}

function populateSportDropdowns() {
  const selects = [$("#team-sport")];
  selects.forEach((sel) => {
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="" disabled selected>Select sport</option>`
      + state.sports.map((s) => `<option value="${esc(s.sport_id)}">${esc(s.name)} (${esc(s.gender)})</option>`).join("");
    if (current) sel.value = current;
  });
}

// ── Seasons ───────────────────────────────────────────────────
function renderSeasonsList() {
  const container = $("#seasons-list");
  if (!container) return;

  const chip = $("#school-seasons-count");
  if (chip) chip.textContent = `${state.seasons.length} season${state.seasons.length !== 1 ? "s" : ""}`;

  if (!state.seasons.length) {
    container.innerHTML = `<div class="sch-empty">No seasons created yet.</div>`;
    return;
  }

  container.innerHTML = state.seasons.map((s) => {
    const active = s.is_active;
    return `
      <div class="sch-list-item${active ? " sch-list-item--active" : ""}">
        <div class="sch-list-item-body">
          <strong>${esc(s.name)}${active ? ' <span class="sch-badge-active">Active</span>' : ""}</strong>
          <span class="sch-list-meta">${formatDate(s.start_date)} – ${formatDate(s.end_date)}</span>
        </div>
        <div class="sch-list-item-actions">
          ${!active ? `<button class="sch-btn sch-btn--sm" data-activate-season="${esc(s.season_id)}">Set Active</button>` : ""}
          <button class="sch-btn sch-btn--danger sch-btn--xs" data-delete-season="${esc(s.season_id)}">Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

function populateCoachDropdown() {
  const sel = $("#team-coach");
  if (!sel) return;
  const coaches = state.members.filter((m) => m.role === "coach");
  const current = sel.value;
  sel.innerHTML = `<option value="">No coach</option>`
    + coaches.map((c) => {
      const name = c.users?.display_name || c.users?.email || "Coach";
      return `<option value="${esc(c.user_id)}">${esc(name)}</option>`;
    }).join("");
  if (current) sel.value = current;
}

function populateAthleteMultiSelect() {
  const sel = $("#team-athletes");
  if (!sel) return;
  const athletes = state.members.filter((m) => m.role === "athlete");
  sel.innerHTML = athletes.map((a) => {
    const name = a.users?.display_name || a.users?.email || "Athlete";
    return `<option value="${esc(a.user_id)}">${esc(name)}</option>`;
  }).join("");
}

// ── Teams ─────────────────────────────────────────────────────
function renderTeamsList() {
  const container = $("#teams-list");
  if (!container) return;

  const chip = $("#school-teams-count");
  if (chip) chip.textContent = `${state.teams.length} team${state.teams.length !== 1 ? "s" : ""}`;

  if (!state.teams.length) {
    container.innerHTML = `<div class="sch-empty">No teams yet. Add a sport first.</div>`;
    return;
  }

  container.innerHTML = state.teams.map((t) => {
    const sportName = t.sports?.name || "–";
    const sportGender = t.sports?.gender || "";
    const seasonName = t.seasons?.name || "No season";
    const coach = t.head_coach_id
      ? state.members.find((m) => m.user_id === t.head_coach_id)
      : null;
    const coachName = coach ? (coach.users?.display_name || coach.users?.email || "Coach") : "No coach";
    return `
      <div class="sch-list-item sch-list-item--clickable" data-view-team="${esc(t.team_id)}">
        <div class="sch-list-item-body">
          <strong>${esc(t.name)}</strong>
          <span class="sch-list-meta">
            ${esc(sportName)}${sportGender ? ` (${esc(sportGender)})` : ""}
            &middot; ${esc(t.level)}
            &middot; ${esc(seasonName)}
            &middot; ${esc(coachName)}
          </span>
        </div>
        <div class="sch-list-item-actions">
          <button class="sch-btn sch-btn--sm sch-btn--ghost" data-view-team="${esc(t.team_id)}">View</button>
          <button class="sch-btn sch-btn--danger sch-btn--xs" data-delete-team="${esc(t.team_id)}">Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

function populateOpponentDropdown() {
  const sel = $("#match-opponent");
  if (!sel) return;
  const others = state.allSchools.filter((s) => s.school_id !== state.schoolId);
  const current = sel.value;
  sel.innerHTML = `<option value="" disabled selected>Select opponent</option>`
    + others.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}${s.location ? ` — ${esc(s.location)}` : ""}</option>`).join("");
  if (current) sel.value = current;
}

function teamOptionHtml(t) {
  const sportName = t.sports?.name || "";
  return `<option value="${esc(t.team_id)}">${esc(t.name)}${sportName ? ` – ${esc(sportName)}` : ""}</option>`;
}

function populateTeamDropdowns() {
  const selects = [$("#match-team"), $("#match-opponent-team"), $("#roster-team-filter")];
  selects.forEach((sel) => {
    if (!sel) return;
    const current = sel.value;
    const placeholder = sel.id === "roster-team-filter" ? "Choose a team" : "Select team";
    sel.innerHTML = `<option value="" disabled selected>${placeholder}</option>`
      + state.teams.map(teamOptionHtml).join("");
    if (current) sel.value = current;
  });
}

// ── Roster ────────────────────────────────────────────────────
function renderRosterList() {
  const container = $("#roster-list");
  if (!container) return;

  if (!state.selectedRosterTeamId) {
    container.innerHTML = `<div class="sch-empty">Select a team to view its roster.</div>`;
    return;
  }

  // Build "Add Athlete" dropdown — only show athletes not already on this team
  const rosterAthleteIds = new Set(state.roster.map((r) => r.athlete_id));
  const availableAthletes = state.members
    .filter((m) => m.role === "athlete" && !rosterAthleteIds.has(m.user_id));

  const addForm = `
    <div class="sch-roster-add">
      <select id="roster-add-athlete" class="sch-select" style="flex:1">
        <option value="" disabled selected>Select athlete to add</option>
        ${availableAthletes.map((m) => {
          const name = m.users?.display_name || m.users?.email || "Athlete";
          return `<option value="${esc(m.user_id)}">${esc(name)}</option>`;
        }).join("")}
      </select>
      <input id="roster-add-jersey" type="text" class="sch-input" placeholder="Jersey #" style="width:80px">
      <input id="roster-add-position" type="text" class="sch-input" placeholder="Position" style="width:110px">
      <button class="sch-btn sch-btn--primary sch-btn--xs" id="roster-add-btn" type="button">Add</button>
    </div>
    <div id="roster-form-status" class="sch-form-status"></div>
  `;

  if (!state.roster.length && !availableAthletes.length) {
    container.innerHTML = addForm + `<div class="sch-empty">No athletes on this team's roster. Approve join requests first to get athletes in your school.</div>`;
    return;
  }

  if (!state.roster.length) {
    container.innerHTML = addForm + `<div class="sch-empty">No athletes on this team yet. Use the dropdown above to add athletes.</div>`;
    return;
  }

  container.innerHTML = addForm + state.roster.map((r) => {
    const name = r.user_directory?.display_name || r.user_directory?.email || "Athlete";
    const email = r.user_directory?.email || "";
    return `
      <div class="sch-list-item">
        <div class="sch-list-item-body">
          <strong>${esc(name)}</strong>
          <span class="sch-list-meta">
            ${r.jersey_number ? `#${esc(r.jersey_number)}` : ""}
            ${r.position ? ` &middot; ${esc(r.position)}` : ""}
            ${r.status ? ` &middot; ${esc(r.status)}` : ""}
            ${email ? ` &middot; ${esc(email)}` : ""}
          </span>
        </div>
        <div class="sch-list-item-actions">
          <button class="sch-btn sch-btn--danger sch-btn--xs" data-remove-roster="${esc(r.roster_id)}">Remove</button>
        </div>
      </div>
    `;
  }).join("");
}

// ── Schedule (Matches) ────────────────────────────────────────
function renderMatchesList() {
  const container = $("#matches-list");
  if (!container) return;

  const chip = $("#school-matches-count");
  if (chip) chip.textContent = `${state.matches.length} match${state.matches.length !== 1 ? "es" : ""}`;

  if (!state.matches.length) {
    container.innerHTML = `<div class="sch-empty">No matches scheduled.</div>`;
    return;
  }

  container.innerHTML = state.matches.map((m) => {
    const team = state.teams.find((t) => t.team_id === m.team_id);
    const teamName = team?.name || "Team";
    const sportName = team?.sports?.name || "";
    const isInternal = m.match_type === "internal";

    // For internal matches, show opponent team name
    let opponentLabel = m.opponent_name;
    if (isInternal && m.opponent_team_id) {
      const oppTeam = state.teams.find((t) => t.team_id === m.opponent_team_id);
      if (oppTeam) opponentLabel = oppTeam.name;
    }

    const scoreText = (m.home_score != null && m.away_score != null)
      ? `${m.home_score} – ${m.away_score}`
      : "";
    const statusBadge = m.status === "completed"
      ? `<span class="sch-badge-completed">${esc(m.result || "completed")}</span>`
      : m.status === "cancelled"
        ? `<span class="sch-badge-cancelled">Cancelled</span>`
        : `<span class="sch-badge-scheduled">${esc(m.status)}</span>`;

    const typeBadge = isInternal
      ? `<span class="sch-badge-internal">Internal</span>`
      : `<span class="sch-badge-external">External</span>`;

    return `
      <div class="sch-list-item">
        <div class="sch-list-item-body">
          <strong>${esc(teamName)} vs ${esc(opponentLabel)}</strong>
          <span class="sch-list-meta">
            ${formatDate(m.match_date)}${m.match_time ? ` at ${formatTime(m.match_time)}` : ""}
            ${!isInternal ? ` &middot; ${m.is_home_game ? "Home" : "Away"}` : ""}
            ${m.location ? ` &middot; ${esc(m.location)}` : ""}
            ${sportName ? ` &middot; ${esc(sportName)}` : ""}
            ${scoreText ? ` &middot; ${esc(scoreText)}` : ""}
          </span>
        </div>
        <div class="sch-list-item-actions">
          ${typeBadge}
          ${statusBadge}
          <button class="sch-btn sch-btn--danger sch-btn--xs" data-delete-match="${esc(m.match_id)}">Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

// ── Coaches ───────────────────────────────────────────────────
function renderCoachesList() {
  const container = $("#coaches-list");
  if (!container) return;

  const coaches = state.members.filter((m) => m.role === "coach");

  if (!coaches.length) {
    container.innerHTML = `<div class="sch-empty">No coaches yet. Coaches appear here after their join request is approved.</div>`;
    return;
  }

  container.innerHTML = coaches.map((c) => {
    const name = c.users?.display_name || c.users?.email || "Coach";
    const email = c.users?.email || "";
    return `
      <div class="sch-list-item">
        <div class="sch-list-item-body">
          <strong>${esc(name)}</strong>
          <span class="sch-list-meta">${esc(c.role)} &middot; ${esc(c.status)}${email ? ` &middot; ${esc(email)}` : ""} &middot; Joined ${formatDate(c.joined_at)}</span>
        </div>
      </div>
    `;
  }).join("");
}

// ── Requests ──────────────────────────────────────────────────
function renderRequestsList() {
  const container = $("#requests-list");
  if (!container) return;

  const chip = $("#school-requests-count");
  if (chip) chip.textContent = state.pendingRequests.length
    ? `${state.pendingRequests.length} pending`
    : "";

  if (!state.pendingRequests.length) {
    container.innerHTML = `<div class="sch-empty">No pending requests.</div>`;
    return;
  }

  container.innerHTML = state.pendingRequests.map((r) => `
    <div class="sch-list-item">
      <div class="sch-list-item-body">
        <strong>${esc(r.display_name || "Pending member")}</strong>
        <span class="sch-list-meta">${esc(r.email || "")} &middot; ${esc(r.requester_role || "athlete")} &middot; ${formatDate(r.requested_at)}</span>
      </div>
      <div class="sch-list-item-actions">
        <button class="sch-btn sch-btn--primary sch-btn--xs" data-approve-request="${esc(r.request_id)}">Approve</button>
        <button class="sch-btn sch-btn--danger sch-btn--xs" data-reject-request="${esc(r.request_id)}">Reject</button>
      </div>
    </div>
  `).join("");
}

// ── Team Detail View ──────────────────────────────────────────
async function openTeamDetail(teamId) {
  state.viewingTeamId = teamId;
  state.teamRoster = [];

  // Load roster for this team
  try {
    state.teamRoster = await loadRoster(teamId);
  } catch { /* empty */ }

  renderTeamDetail();
  switchSection("team-detail");
}

function renderTeamDetail() {
  const team = state.teams.find((t) => t.team_id === state.viewingTeamId);
  if (!team) return;

  const sportName = team.sports?.name || "–";
  const sportGender = team.sports?.gender || "";
  const seasonName = team.seasons?.name || "–";

  // Header
  const nameEl = $("#team-detail-name");
  if (nameEl) nameEl.textContent = team.name;
  const metaEl = $("#team-detail-meta");
  if (metaEl) metaEl.textContent = `${sportName}${sportGender ? ` (${sportGender})` : ""} · ${team.level} · ${seasonName}`;

  // Performance — compute from matches
  const teamMatches = state.matches.filter(
    (m) => m.team_id === team.team_id || m.opponent_team_id === team.team_id
  );
  const completed = teamMatches.filter((m) => m.status === "completed");
  let wins = 0, losses = 0, ties = 0;
  for (const m of completed) {
    if (m.result === "win" && m.team_id === team.team_id) wins++;
    else if (m.result === "loss" && m.team_id === team.team_id) losses++;
    else if (m.result === "tie") ties++;
    else if (m.result === "win" && m.opponent_team_id === team.team_id) losses++;
    else if (m.result === "loss" && m.opponent_team_id === team.team_id) wins++;
  }
  // Also use stored wins/losses/ties from the team record
  wins = wins || team.wins || 0;
  losses = losses || team.losses || 0;
  ties = ties || team.ties || 0;

  const wEl = $("#td-wins"); if (wEl) wEl.textContent = wins;
  const lEl = $("#td-losses"); if (lEl) lEl.textContent = losses;
  const tEl = $("#td-ties"); if (tEl) tEl.textContent = ties;
  const totEl = $("#td-total"); if (totEl) totEl.textContent = wins + losses + ties;

  // Coach info
  const coachContainer = $("#td-coach-info");
  if (coachContainer) {
    const coach = team.head_coach_id
      ? state.members.find((m) => m.user_id === team.head_coach_id)
      : null;
    if (coach) {
      const cName = coach.users?.display_name || coach.users?.email || "Coach";
      const cEmail = coach.users?.email || "";
      coachContainer.innerHTML = `
        <div class="sch-modal-member">
          <div class="sch-modal-member-avatar">&#129333;</div>
          <div class="sch-modal-member-info">
            <div class="sch-modal-member-name">${esc(cName)}</div>
            <div class="sch-modal-member-meta">Head Coach${cEmail ? ` · ${esc(cEmail)}` : ""}</div>
          </div>
        </div>
      `;
    } else {
      coachContainer.innerHTML = `<div class="sch-empty">No coach assigned.</div>`;
    }
  }

  // Roster
  renderTeamDetailRoster();

  // Upcoming matches
  const now = new Date();
  const upcoming = teamMatches
    .filter((m) => m.status === "scheduled" && new Date(m.match_date) >= now)
    .sort((a, b) => new Date(a.match_date) - new Date(b.match_date));
  const past = teamMatches
    .filter((m) => m.status === "completed" || new Date(m.match_date) < now)
    .sort((a, b) => new Date(b.match_date) - new Date(a.match_date));

  const upChip = $("#td-upcoming-count");
  if (upChip) upChip.textContent = upcoming.length ? `${upcoming.length}` : "";
  const pastChip = $("#td-past-count");
  if (pastChip) pastChip.textContent = past.length ? `${past.length}` : "";

  const upList = $("#td-upcoming-list");
  if (upList) {
    upList.innerHTML = upcoming.length
      ? upcoming.map((m) => matchRowHtml(m, team)).join("")
      : `<div class="sch-empty">No upcoming matches.</div>`;
  }

  const pastList = $("#td-past-list");
  if (pastList) {
    pastList.innerHTML = past.length
      ? past.map((m) => matchRowHtml(m, team)).join("")
      : `<div class="sch-empty">No past matches yet.</div>`;
  }
}

function matchRowHtml(m, team) {
  const isInternal = m.match_type === "internal";
  let opponentLabel = m.opponent_name;
  if (isInternal && m.opponent_team_id) {
    const opp = state.teams.find((t) => t.team_id === m.opponent_team_id);
    if (opp) opponentLabel = opp.name;
  }
  const scoreText = (m.home_score != null && m.away_score != null)
    ? `${m.home_score} – ${m.away_score}` : "";
  const resultBadge = m.result
    ? `<span class="sch-badge-${m.result === "win" ? "completed" : m.result === "loss" ? "cancelled" : "scheduled"}">${esc(m.result)}</span>`
    : "";
  return `
    <div class="sch-match-row">
      <div class="sch-match-time">${formatDate(m.match_date)}<br>${m.match_time ? formatTime(m.match_time) : ""}</div>
      <div class="sch-match-teams">
        vs ${esc(opponentLabel)}
        ${m.location ? `<span style="margin-left:8px">${esc(m.location)}</span>` : ""}
      </div>
      ${scoreText ? `<span class="sch-count-chip">${esc(scoreText)}</span>` : ""}
      ${resultBadge}
    </div>
  `;
}

function renderTeamDetailRoster() {
  const addContainer = $("#td-roster-add");
  const listContainer = $("#td-roster-list");
  const countChip = $("#td-roster-count");
  if (!addContainer || !listContainer) return;

  if (countChip) countChip.textContent = state.teamRoster.length
    ? `${state.teamRoster.length}` : "0";

  // Add athlete dropdown — athletes in the school but not already on this team
  const rosterIds = new Set(state.teamRoster.map((r) => r.athlete_id));
  const available = state.members.filter((m) => m.role === "athlete" && !rosterIds.has(m.user_id));

  addContainer.innerHTML = `
    <select id="td-roster-athlete" class="sch-select" style="flex:1">
      <option value="" disabled selected>Add athlete</option>
      ${available.map((a) => {
        const n = a.users?.display_name || a.users?.email || "Athlete";
        return `<option value="${esc(a.user_id)}">${esc(n)}</option>`;
      }).join("")}
    </select>
    <input id="td-roster-jersey" type="text" class="sch-input" placeholder="#" style="width:60px">
    <input id="td-roster-position" type="text" class="sch-input" placeholder="Position" style="width:100px">
    <button class="sch-btn sch-btn--primary sch-btn--xs" id="td-roster-add-btn" type="button">Add</button>
  `;

  if (!state.teamRoster.length) {
    listContainer.innerHTML = `<div class="sch-empty">No athletes on this team yet.</div>`;
    return;
  }

  listContainer.innerHTML = state.teamRoster.map((r) => {
    const name = r.user_directory?.display_name || r.user_directory?.email || "Athlete";
    const email = r.user_directory?.email || "";
    return `
      <div class="sch-list-item" style="margin-top:6px">
        <div class="sch-list-item-body">
          <strong>${esc(name)}</strong>
          <span class="sch-list-meta">
            ${r.jersey_number ? `#${esc(r.jersey_number)}` : ""}
            ${r.position ? ` · ${esc(r.position)}` : ""}
            ${r.status ? ` · ${esc(r.status)}` : ""}
            ${email ? ` · ${esc(email)}` : ""}
          </span>
        </div>
        <div class="sch-list-item-actions">
          <button class="sch-btn sch-btn--danger sch-btn--xs" data-td-remove-roster="${esc(r.roster_id)}">Remove</button>
        </div>
      </div>
    `;
  }).join("");
}

// ── Modals ────────────────────────────────────────────────────
function openModal(id) {
  const modal = $(`#${id}`);
  if (modal) modal.classList.add("is-open");
}

function closeModal(id) {
  const modal = $(`#${id}`);
  if (modal) modal.classList.remove("is-open");
}

function renderAthletesModal() {
  const body = $("#athletes-modal-body");
  if (!body) return;

  const athletes = state.members.filter((m) => m.role === "athlete");
  if (!athletes.length) {
    body.innerHTML = `<div class="sch-empty">No athletes yet. Athletes appear here after their join request is approved.</div>`;
    return;
  }

  body.innerHTML = athletes.map((m) => {
    const name = m.users?.display_name || m.users?.email || "Athlete";
    const email = m.users?.email || "";
    return `
      <div class="sch-modal-member">
        <div class="sch-modal-member-avatar">&#9917;</div>
        <div class="sch-modal-member-info">
          <div class="sch-modal-member-name">${esc(name)}</div>
          <div class="sch-modal-member-meta">${esc(email)}${m.joined_at ? ` &middot; Joined ${formatDate(m.joined_at)}` : ""}</div>
        </div>
        <div class="sch-modal-member-status">
          <span class="sch-badge-active">${esc(m.status)}</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderCoachesModal() {
  const body = $("#coaches-modal-body");
  if (!body) return;

  const coaches = state.members.filter((m) => m.role === "coach");
  if (!coaches.length) {
    body.innerHTML = `<div class="sch-empty">No coaches yet. Coaches appear here after their join request is approved.</div>`;
    return;
  }

  body.innerHTML = coaches.map((m) => {
    const name = m.users?.display_name || m.users?.email || "Coach";
    const email = m.users?.email || "";
    return `
      <div class="sch-modal-member">
        <div class="sch-modal-member-avatar">&#129333;</div>
        <div class="sch-modal-member-info">
          <div class="sch-modal-member-name">${esc(name)}</div>
          <div class="sch-modal-member-meta">${esc(email)}${m.joined_at ? ` &middot; Joined ${formatDate(m.joined_at)}` : ""}</div>
        </div>
        <div class="sch-modal-member-status">
          <span class="sch-badge-active">${esc(m.status)}</span>
        </div>
      </div>
    `;
  }).join("");
}

function bindModals() {
  // Open athletes modal from stat card
  const athleteCard = $("#stat-card-athletes");
  if (athleteCard) {
    athleteCard.addEventListener("click", () => {
      renderAthletesModal();
      openModal("athletes-modal");
    });
  }

  // Open coaches modal from stat card
  const coachCard = $("#stat-card-coaches");
  if (coachCard) {
    coachCard.addEventListener("click", () => {
      renderCoachesModal();
      openModal("coaches-modal");
    });
  }

  // Close buttons
  document.addEventListener("click", (e) => {
    const closeBtn = e.target.closest("[data-close-modal]");
    if (closeBtn) {
      closeModal(closeBtn.dataset.closeModal);
      return;
    }
    // Click overlay to close
    const overlay = e.target.closest(".sch-modal-overlay");
    if (overlay && e.target === overlay) {
      overlay.classList.remove("is-open");
    }
  });

  // Escape key closes any open modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $$(".sch-modal-overlay.is-open").forEach((m) => m.classList.remove("is-open"));
    }
  });
}

// ══════════════════════════════════════════════════════════════
// MASTER RENDER
// ══════════════════════════════════════════════════════════════
function renderAll() {
  renderGreeting();
  renderOverviewMetrics();
  renderUpcomingMatches();
  renderSportsList();
  renderSeasonsList();
  renderTeamsList();
  renderMatchesList();
  renderCoachesList();
  renderRequestsList();
  renderRosterList();

  // Populate dropdowns
  populateSportDropdowns();
  populateCoachDropdown();
  populateAthleteMultiSelect();
  populateTeamDropdowns();
  populateOpponentDropdown();
}

// ══════════════════════════════════════════════════════════════
// DATA LOADING
// ══════════════════════════════════════════════════════════════
async function loadAllData() {
  if (!state.schoolId) return;

  const [sports, seasons, teams, matches, members, requests, allSchools] = await Promise.all([
    loadSports(state.schoolId),
    loadSeasons(state.schoolId),
    loadTeams(state.schoolId),
    loadAllSchoolMatches(state.schoolId),
    loadSchoolMembers(state.schoolId).catch(() => []),
    loadPendingSchoolRequests({ schoolId: state.schoolId }).catch(() => []),
    loadSchoolOptions().catch(() => []),
  ]);

  state.sports = sports;
  state.seasons = seasons;
  state.teams = teams;
  state.matches = matches;
  state.members = members;
  state.pendingRequests = requests;
  state.allSchools = allSchools;
}

async function refreshRoster(teamId) {
  if (!teamId) {
    state.roster = [];
    return;
  }
  try {
    state.roster = await loadRoster(teamId);
  } catch {
    state.roster = [];
  }
}

// ══════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ══════════════════════════════════════════════════════════════

function guardedSubmit(formId, statusId, handler) {
  return async (e) => {
    e.preventDefault();
    if (state.submitting[formId]) return;  // block double-submit
    state.submitting[formId] = true;
    try {
      await handler();
    } finally {
      state.submitting[formId] = false;
    }
  };
}

function bindForms() {
  // ── Sport form ──
  const sportForm = $("#sport-form");
  if (sportForm) {
    sportForm.addEventListener("submit", guardedSubmit("sport", "sport-form-status", async () => {
      const name = $("#sport-name")?.value?.trim();
      const seasonType = $("#sport-season-type")?.value;
      const gender = $("#sport-gender")?.value;
      const maxRoster = parseInt($("#sport-max-roster")?.value, 10) || 30;

      if (!name) {
        setFormStatus("sport-form-status", "Sport name is required.", true);
        return;
      }

      try {
        setFormStatus("sport-form-status", "Adding sport...");
        await createSport({ schoolId: state.schoolId, name, seasonType, gender, maxRosterSize: maxRoster });
        state.sports = await loadSports(state.schoolId);
        renderAll();
        sportForm.reset();
        setFormStatus("sport-form-status", `Added ${name}.`);
      } catch (err) {
        console.error("Create sport failed", err);
        setFormStatus("sport-form-status", err.message || "Failed to add sport.", true);
      }
    }));
  }

  // ── Season form ──
  const seasonForm = $("#season-form");
  if (seasonForm) {
    seasonForm.addEventListener("submit", guardedSubmit("season", "season-form-status", async () => {
      const name = $("#season-name")?.value?.trim();
      const startDate = $("#season-start")?.value || null;
      const endDate = $("#season-end")?.value || null;

      if (!name) {
        setFormStatus("season-form-status", "Season name is required.", true);
        return;
      }

      try {
        setFormStatus("season-form-status", "Creating season...");
        await createSeason({ schoolId: state.schoolId, name, startDate, endDate });
        state.seasons = await loadSeasons(state.schoolId);
        renderAll();
        seasonForm.reset();
        setFormStatus("season-form-status", `Created ${name}.`);
      } catch (err) {
        console.error("Create season failed", err);
        setFormStatus("season-form-status", err.message || "Failed to create season.", true);
      }
    }));
  }

  // ── Team form ──
  const teamForm = $("#team-form");
  if (teamForm) {
    teamForm.addEventListener("submit", guardedSubmit("team", "team-form-status", async () => {
      const name = $("#team-name")?.value?.trim();
      const sportId = $("#team-sport")?.value;
      const seasonText = $("#team-season")?.value?.trim() || null;
      const level = $("#team-level")?.value || "varsity";
      const headCoachId = $("#team-coach")?.value || null;

      // Gather selected athletes from multi-select
      const athleteSelect = $("#team-athletes");
      const selectedAthleteIds = athleteSelect
        ? Array.from(athleteSelect.selectedOptions).map((o) => o.value)
        : [];

      if (!name || !sportId) {
        setFormStatus("team-form-status", "Team name and sport are required.", true);
        return;
      }

      try {
        setFormStatus("team-form-status", "Creating team...");

        // If user typed a season name, find or create that season
        let seasonId = null;
        if (seasonText) {
          const existing = state.seasons.find(
            (s) => s.name.toLowerCase() === seasonText.toLowerCase()
          );
          if (existing) {
            seasonId = existing.season_id;
          } else {
            const newSeason = await createSeason({ schoolId: state.schoolId, name: seasonText });
            state.seasons = await loadSeasons(state.schoolId);
            seasonId = newSeason.season_id;
          }
        }

        const team = await createTeam({
          schoolId: state.schoolId, sportId, seasonId, name, level, headCoachId,
        });

        // Add selected athletes to roster
        if (selectedAthleteIds.length && team?.team_id) {
          await Promise.all(
            selectedAthleteIds.map((athleteId) =>
              addToRoster({ teamId: team.team_id, athleteId }).catch((err) => {
                console.warn("Roster add skipped:", err.message);
              })
            )
          );
        }

        state.teams = await loadTeams(state.schoolId);
        renderAll();
        teamForm.reset();
        const extras = [];
        if (headCoachId) extras.push("coach assigned");
        if (selectedAthleteIds.length) extras.push(`${selectedAthleteIds.length} athlete(s) added`);
        setFormStatus("team-form-status", `Created ${name}${extras.length ? ` — ${extras.join(", ")}` : ""}.`);
      } catch (err) {
        console.error("Create team failed", err);
        setFormStatus("team-form-status", err.message || "Failed to create team.", true);
      }
    }));
  }

  // ── Match type toggle ──
  $$(".sch-toggle-btn[data-match-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.matchType;
      const hidden = $("#match-type");
      if (hidden) hidden.value = type;

      $$(".sch-toggle-btn[data-match-type]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const isInternal = type === "internal";
      // Show/hide fields based on type
      const opponentTeamField = $("#match-opponent-team-field");
      const opponentSchoolField = $("#match-opponent-school-field");
      const opponentCustomField = $("#match-opponent-custom-field");
      const homeField = $("#match-home-field");

      if (opponentTeamField) opponentTeamField.style.display = isInternal ? "" : "none";
      if (opponentSchoolField) opponentSchoolField.style.display = isInternal ? "none" : "";
      if (opponentCustomField) opponentCustomField.style.display = isInternal ? "none" : "";
      if (homeField) homeField.style.display = isInternal ? "none" : "";
    });
  });

  // ── Match form ──
  const matchForm = $("#match-form");
  if (matchForm) {
    matchForm.addEventListener("submit", guardedSubmit("match", "match-form-status", async () => {
      const matchType = $("#match-type")?.value || "internal";
      const teamId = $("#match-team")?.value;
      const matchDate = $("#match-date")?.value;
      const matchTime = $("#match-time")?.value || null;
      const location = $("#match-location")?.value?.trim() || null;

      if (!teamId || !matchDate) {
        setFormStatus("match-form-status", "Team and date are required.", true);
        return;
      }

      let opponentName = "";
      let opponentTeamId = null;
      let opponentSchoolId = null;
      let isHome = true;

      if (matchType === "internal") {
        // Internal match — pick second team from your school
        opponentTeamId = $("#match-opponent-team")?.value || null;
        if (!opponentTeamId) {
          setFormStatus("match-form-status", "Select the opponent team.", true);
          return;
        }
        if (opponentTeamId === teamId) {
          setFormStatus("match-form-status", "Pick two different teams.", true);
          return;
        }
        // Build opponent name from team
        const oppTeam = state.teams.find((t) => t.team_id === opponentTeamId);
        opponentName = oppTeam?.name || "School Team";
      } else {
        // External match — pick school or type name
        const opponentDropdown = $("#match-opponent")?.value?.trim() || "";
        const opponentCustom = $("#match-opponent-custom")?.value?.trim() || "";
        opponentName = opponentCustom || opponentDropdown;
        if (!opponentName) {
          setFormStatus("match-form-status", "Select or type the opponent school.", true);
          return;
        }
        // Find opponent_school_id if they picked from dropdown
        if (opponentDropdown && !opponentCustom) {
          const school = state.allSchools.find((s) => s.name === opponentDropdown);
          opponentSchoolId = school?.school_id || null;
        }
        isHome = $("#match-home")?.value !== "false";
      }

      try {
        setFormStatus("match-form-status", "Scheduling match...");
        await createMatch({
          teamId,
          opponentName,
          matchDate,
          matchTime,
          location,
          isHomeGame: isHome,
          matchType,
          opponentTeamId,
          opponentSchoolId,
        });
        state.matches = await loadAllSchoolMatches(state.schoolId);
        renderAll();
        matchForm.reset();
        // Reset toggle to internal
        $$(".sch-toggle-btn[data-match-type]").forEach((b) => b.classList.toggle("active", b.dataset.matchType === "internal"));
        if ($("#match-type")) $("#match-type").value = "internal";
        $("#match-opponent-team-field") && ($("#match-opponent-team-field").style.display = "");
        $("#match-opponent-school-field") && ($("#match-opponent-school-field").style.display = "none");
        $("#match-opponent-custom-field") && ($("#match-opponent-custom-field").style.display = "none");
        $("#match-home-field") && ($("#match-home-field").style.display = "none");
        setFormStatus("match-form-status", `Scheduled: ${matchType === "internal" ? "internal" : "vs " + opponentName}.`);
      } catch (err) {
        console.error("Create match failed", err);
        setFormStatus("match-form-status", err.message || "Failed to schedule match.", true);
      }
    }));
  }
}

function bindDelegatedClicks() {
  // ── Add to Roster button ──
  document.addEventListener("click", async (e) => {
    if (e.target.id !== "roster-add-btn") return;
    if (state.submitting.rosterAdd) return;
    state.submitting.rosterAdd = true;

    const athleteId = $("#roster-add-athlete")?.value;
    const jersey = $("#roster-add-jersey")?.value?.trim() || null;
    const position = $("#roster-add-position")?.value?.trim() || null;

    if (!athleteId || !state.selectedRosterTeamId) {
      setFormStatus("roster-form-status", "Select an athlete first.", true);
      state.submitting.rosterAdd = false;
      return;
    }

    try {
      setFormStatus("roster-form-status", "Adding to roster...");
      await addToRoster({ teamId: state.selectedRosterTeamId, athleteId, jerseyNumber: jersey, position });
      await refreshRoster(state.selectedRosterTeamId);
      renderRosterList();
      setFormStatus("roster-form-status", "Athlete added to roster.");
    } catch (err) {
      console.error("Add to roster failed", err);
      setFormStatus("roster-form-status", err.message || "Failed to add athlete.", true);
    } finally {
      state.submitting.rosterAdd = false;
    }
  });

  // ── View team detail ──
  document.addEventListener("click", async (e) => {
    // Don't open team detail if clicking a delete button
    if (e.target.closest("button[data-delete-team]")) return;

    const viewTeam = e.target.closest("[data-view-team]");
    if (viewTeam) {
      e.preventDefault();
      await openTeamDetail(viewTeam.dataset.viewTeam);
    }
  });

  // ── Back to teams ──
  const backBtn = $("#team-detail-back");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      state.viewingTeamId = "";
      state.teamRoster = [];
      switchSection("teams");
    });
  }

  // ── Team detail: Add to roster ──
  document.addEventListener("click", async (e) => {
    if (e.target.id !== "td-roster-add-btn") return;
    if (state.submitting.tdRosterAdd) return;
    state.submitting.tdRosterAdd = true;

    const athleteId = $("#td-roster-athlete")?.value;
    const jersey = $("#td-roster-jersey")?.value?.trim() || null;
    const position = $("#td-roster-position")?.value?.trim() || null;

    if (!athleteId || !state.viewingTeamId) {
      setFormStatus("td-roster-status", "Select an athlete first.", true);
      state.submitting.tdRosterAdd = false;
      return;
    }

    try {
      setFormStatus("td-roster-status", "Adding...");
      await addToRoster({ teamId: state.viewingTeamId, athleteId, jerseyNumber: jersey, position });
      state.teamRoster = await loadRoster(state.viewingTeamId);
      renderTeamDetailRoster();
      setFormStatus("td-roster-status", "Added.");
    } catch (err) {
      console.error("TD add roster failed", err);
      setFormStatus("td-roster-status", err.message || "Failed.", true);
    } finally {
      state.submitting.tdRosterAdd = false;
    }
  });

  // ── Team detail: Remove from roster ──
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-td-remove-roster]");
    if (!btn) return;
    btn.disabled = true;
    try {
      await removeFromRoster(btn.dataset.tdRemoveRoster);
      state.teamRoster = await loadRoster(state.viewingTeamId);
      renderTeamDetailRoster();
    } catch (err) {
      console.error("TD remove roster failed", err);
    } finally {
      btn.disabled = false;
    }
  });

  document.addEventListener("click", async (e) => {
    const target = e.target.closest("button[data-delete-sport], button[data-delete-season], button[data-activate-season], button[data-delete-team], button[data-delete-match], button[data-remove-roster], button[data-approve-request], button[data-reject-request]");
    if (!target) return;

    target.disabled = true;

    try {
      // Delete sport
      if (target.dataset.deleteSport) {
        await deleteSport(target.dataset.deleteSport);
        state.sports = await loadSports(state.schoolId);
        renderAll();
        return;
      }

      // Delete season
      if (target.dataset.deleteSeason) {
        await deleteSeason(target.dataset.deleteSeason);
        state.seasons = await loadSeasons(state.schoolId);
        renderAll();
        return;
      }

      // Activate season
      if (target.dataset.activateSeason) {
        await setActiveSeason(state.schoolId, target.dataset.activateSeason);
        state.seasons = await loadSeasons(state.schoolId);
        renderAll();
        return;
      }

      // Delete team
      if (target.dataset.deleteTeam) {
        await deleteTeam(target.dataset.deleteTeam);
        state.teams = await loadTeams(state.schoolId);
        renderAll();
        return;
      }

      // Delete match
      if (target.dataset.deleteMatch) {
        await deleteMatch(target.dataset.deleteMatch);
        state.matches = await loadAllSchoolMatches(state.schoolId);
        renderAll();
        return;
      }

      // Remove from roster
      if (target.dataset.removeRoster) {
        await removeFromRoster(target.dataset.removeRoster);
        await refreshRoster(state.selectedRosterTeamId);
        renderRosterList();
        return;
      }

      // Approve request
      if (target.dataset.approveRequest) {
        await reviewSchoolJoinRequest({
          requestId: target.dataset.approveRequest,
          decision: "approve",
          reviewedByUserId: state.appUserId,
        });
        state.pendingRequests = await loadPendingSchoolRequests({ schoolId: state.schoolId }).catch(() => []);
        renderRequestsList();
        return;
      }

      // Reject request
      if (target.dataset.rejectRequest) {
        await reviewSchoolJoinRequest({
          requestId: target.dataset.rejectRequest,
          decision: "reject",
          reviewedByUserId: state.appUserId,
        });
        state.pendingRequests = await loadPendingSchoolRequests({ schoolId: state.schoolId }).catch(() => []);
        renderRequestsList();
        return;
      }
    } catch (err) {
      console.error("Action failed", err);
      alert(err.message || "Action failed. Please try again.");
    } finally {
      target.disabled = false;
    }
  });
}

function bindRosterFilter() {
  const select = $("#roster-team-filter");
  if (!select) return;
  select.addEventListener("change", async () => {
    state.selectedRosterTeamId = select.value;
    await refreshRoster(state.selectedRosterTeamId);
    renderRosterList();
  });
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════

async function initSchoolDashboard() {
  const auth = getGlobalAppState().auth;
  if (!auth?.session && !auth?.authUser) return;
  if (!isSchoolAdmin(auth)) {
    window.location.replace("index.html");
    return;
  }
  if (state.initialized || state.initializing) return;  // prevent concurrent inits
  state.initializing = true;

  try {
    const statusEl = $("#school-dashboard-status");
    if (statusEl) statusEl.textContent = "Loading school dashboard...";

    const context = await resolveSchoolContext();
    state.schoolId = context.schoolId;
    state.schoolName = context.schoolName;
    state.appUserId = context.appUserId;

    const subtitleEl = $("#school-dashboard-subtitle");
    if (subtitleEl) {
      subtitleEl.textContent = `Manage athletes, staff, teams, and schedule for ${state.schoolName}.`;
    }

    await loadAllData();
    renderAll();

    initSectionNav();
    bindForms();
    bindDelegatedClicks();
    bindRosterFilter();
    bindModals();

    state.initialized = true;
    if (statusEl) statusEl.textContent = "";
  } catch (err) {
    console.error("School dashboard init failed", err);
    state.initializing = false;  // allow retry on failure
    const statusEl = $("#school-dashboard-status");
    if (statusEl) {
      statusEl.textContent = err.message || "Unable to load the school dashboard.";
      statusEl.classList.add("is-error");
    }
  }
}

// ── Bootstrap ─────────────────────────────────────────────────
window.addEventListener("session-ready", () => {
  void initSchoolDashboard();
});

window.addEventListener("ua-app-state-change", () => {
  const role = normalizeRole(getGlobalAppState().auth?.role);
  if (role === "school_admin" && !state.initialized) {
    void initSchoolDashboard();
  }
});

// Immediate try in case state is already set
void initSchoolDashboard();

import { supabase } from "./supabaseClient.js";
import { getGlobalAppState, normalizeRole } from "./roleUtils.js";
import {
  loadCoachTeams, loadCoachSchoolId,
  loadRoster, addToRoster, removeFromRoster, updateRosterEntry,
  loadMatches,
  loadSchoolMembers,
  loadTrainings, loadTrainingsByTeams, createTraining, deleteTraining,
  loadAttendance, bulkUpsertAttendance, loadAttendanceSummary,
  loadPlayerNotes, createPlayerNote, updatePlayerNote, deletePlayerNote,
  loadFormations, createFormation, updateFormation, deleteFormation,
} from "./schoolSportsStore.js";

// ── State ─────────────────────────────────────────────────────
const state = {
  initializing: false,
  initialized: false,
  appUserId: "",
  schoolId: "",
  teams: [],
  allMatches: [],
  allTrainings: [],
  members: [],
  viewingTeamId: "",
  teamRoster: [],
  teamMatches: [],
  teamTrainings: [],
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  submitting: {},
};

// ── Helpers ───────────────────────────────────────────────────
function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function setStatus(id, msg, isErr = false) {
  const el = $(`#${id}`);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("is-error", isErr);
}

function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function formatDateShort(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function formatTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

function guardedSubmit(formId, statusId, handler) {
  const form = $(`#${formId}`);
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.submitting[formId]) return;
    state.submitting[formId] = true;
    setStatus(statusId, "Saving...");
    try {
      await handler(form);
      form.reset();
      setStatus(statusId, "");
    } catch (err) {
      setStatus(statusId, err.message || "Something went wrong.", true);
    } finally {
      state.submitting[formId] = false;
    }
  });
}

// ── Section Navigation (tab bar) ──────────────────────────────
function switchSection(sectionId) {
  $$(".sch-section").forEach((s) => s.classList.remove("sch-section--active"));
  const target = $(`#coach-section-${sectionId}`);
  if (target) target.classList.add("sch-section--active");

  // Update tab bar
  $$(".coach-tab").forEach((t) => t.classList.remove("active"));
  const tab = $(`.coach-tab[data-section="${sectionId}"]`);
  if (tab) tab.classList.add("active");
}

function initSectionNav() {
  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".coach-tab[data-section]");
    if (tab) { switchSection(tab.dataset.section); return; }

    const goto = e.target.closest("[data-goto]");
    if (goto) { switchSection(goto.dataset.goto); return; }
  });
}

// ── Find user ─────────────────────────────────────────────────
async function fetchFirst(query) {
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

async function findAppUser(authUserId) {
  // Try auth_uid first (standard column)
  let row = await fetchFirst(
    supabase.from("users").select("user_id").eq("auth_uid", authUserId)
  );
  if (row?.user_id) return row;

  // Try firebase_uid (legacy column, may not exist)
  try {
    row = await fetchFirst(
      supabase.from("users").select("user_id").eq("firebase_uid", authUserId)
    );
    if (row?.user_id) return row;
  } catch (_) { /* column may not exist — ignore */ }

  // Auto-create stub row so the coach can proceed
  try {
    const { data: inserted } = await supabase
      .from("users")
      .insert({ auth_uid: authUserId, role: "coach" })
      .select("user_id")
      .single();
    if (inserted?.user_id) return inserted;
  } catch (_) {
    // duplicate — retry fetch
    const retry = await fetchFirst(
      supabase.from("users").select("user_id").eq("auth_uid", authUserId)
    );
    if (retry?.user_id) return retry;
  }

  return null;
}

// ── Resolve coach context ─────────────────────────────────────
let _coachDisplayName = "Coach";

async function resolveCoachContext() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) throw new Error("Not signed in.");

  const userRow = await findAppUser(session.user.id);
  if (!userRow?.user_id) throw new Error("User record not found.");

  state.appUserId = userRow.user_id;
  _coachDisplayName = session.user?.user_metadata?.name || "Coach";
  state.schoolId = await loadCoachSchoolId(userRow.user_id);

  // Try to get display name from join request
  try {
    const nameRow = await fetchFirst(
      supabase.from("school_join_requests").select("display_name").eq("user_id", userRow.user_id)
    );
    if (nameRow?.display_name) _coachDisplayName = nameRow.display_name;
  } catch (_) { /* ignore */ }
}

// ── Load all data ─────────────────────────────────────────────
async function loadAllData() {
  state.teams = await loadCoachTeams(state.appUserId);
  const teamIds = state.teams.map((t) => t.team_id);

  const [matchArrays, trainings, members] = await Promise.all([
    Promise.all(teamIds.map((id) => loadMatches(id))),
    loadTrainingsByTeams(teamIds),
    state.schoolId ? loadSchoolMembers(state.schoolId, "athlete") : Promise.resolve([]),
  ]);

  state.allMatches = matchArrays.flat().sort((a, b) => (a.match_date || "").localeCompare(b.match_date || ""));
  state.allTrainings = trainings;
  state.members = members;
}

// ── Sport icon helper ─────────────────────────────────────────
function sportIcon(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("basketball")) return "BB";
  if (n.includes("football")) return "FB";
  if (n.includes("soccer")) return "SC";
  if (n.includes("baseball")) return "BA";
  if (n.includes("track")) return "TK";
  if (n.includes("tennis")) return "TN";
  if (n.includes("swim")) return "SW";
  if (n.includes("volleyball")) return "VB";
  return "SP";
}

// ── Render: Overview ──────────────────────────────────────────
function renderOverview() {
  const el = (id, val) => { const e = $(`#${id}`); if (e) e.textContent = val; };
  const now = todayStr();

  // Greeting
  el("coach-greeting", `Welcome back, ${esc(_coachDisplayName)}`);
  el("coach-subtitle", `You have ${state.teams.length} team${state.teams.length !== 1 ? "s" : ""} this season.`);

  // Stats
  el("coach-metric-teams", state.teams.length);
  el("coach-metric-athletes", state.members.length);
  const upcomingMatches = state.allMatches.filter((m) => m.match_date >= now);
  el("coach-metric-matches", upcomingMatches.length);
  const upcomingTrainings = state.allTrainings.filter((t) => t.training_date >= now);
  el("coach-metric-trainings", upcomingTrainings.length);

  // Week summary
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekStr = weekEnd.toISOString().slice(0, 10);
  const weekMatches = upcomingMatches.filter((m) => m.match_date <= weekStr).length;
  const weekTrainings = upcomingTrainings.filter((t) => t.training_date <= weekStr).length;
  const weekSummary = $("#coach-week-summary");
  if (weekSummary) weekSummary.textContent = `${weekMatches} match${weekMatches !== 1 ? "es" : ""}, ${weekTrainings} training${weekTrainings !== 1 ? "s" : ""}`;

  // Calendar
  renderCalendar();

  // Upcoming feed (combined matches + trainings, next 10)
  renderUpcomingFeed();

  // Performance
  renderPerformance();
}

// ── Render: Mini Calendar ─────────────────────────────────────
function renderCalendar() {
  const container = $("#coach-calendar");
  const monthLabel = $("#coach-cal-month");
  if (!container) return;

  const month = state.calMonth;
  if (monthLabel) monthLabel.textContent = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstCell = new Date(monthStart);
  firstCell.setDate(firstCell.getDate() - firstCell.getDay());

  // Build event map
  const eventMap = {};
  for (const m of state.allMatches) {
    const key = m.match_date;
    if (!eventMap[key]) eventMap[key] = [];
    eventMap[key].push({ type: "match", color: "var(--amber)" });
  }
  for (const t of state.allTrainings) {
    const key = t.training_date;
    if (!eventMap[key]) eventMap[key] = [];
    eventMap[key].push({ type: "training", color: "var(--purple)" });
  }

  const todayKey = todayStr();
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(firstCell);
    d.setDate(firstCell.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    return {
      date: d,
      key,
      inMonth: d.getMonth() === monthStart.getMonth(),
      isToday: key === todayKey,
      events: eventMap[key] || [],
    };
  });

  container.innerHTML = `
    ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<span class="coach-cal-weekday">${d}</span>`).join("")}
    ${days.map((d) => `
      <div class="coach-cal-day ${d.inMonth ? "" : "is-muted"} ${d.isToday ? "is-today" : ""} ${d.events.length ? "has-event" : ""}">
        <span>${d.date.getDate()}</span>
        ${d.events.length ? `<div class="coach-cal-dots">${d.events.slice(0, 3).map((ev) => `<i style="background:${ev.color}"></i>`).join("")}</div>` : ""}
      </div>
    `).join("")}
  `;
}

// ── Render: Upcoming Feed ─────────────────────────────────────
function renderUpcomingFeed() {
  const container = $("#coach-upcoming-feed");
  if (!container) return;

  const now = todayStr();
  const items = [];

  for (const m of state.allMatches) {
    if (m.match_date < now) continue;
    const team = state.teams.find((t) => t.team_id === m.team_id);
    items.push({
      date: m.match_date,
      time: m.match_time,
      type: "match",
      title: `${team?.name || "Team"} vs ${m.opponent_name || "TBD"}`,
      detail: `${m.location || ""}${m.is_home_game ? " (Home)" : " (Away)"}`.trim(),
    });
  }
  for (const t of state.allTrainings) {
    if (t.training_date < now) continue;
    const teamName = t.teams?.name || "Team";
    items.push({
      date: t.training_date,
      time: t.start_time,
      type: "training",
      title: `${t.title || "Practice"} — ${teamName}`,
      detail: `${t.location || ""}${t.start_time ? ` ${formatTime(t.start_time)}` : ""}`.trim(),
    });
  }

  items.sort((a, b) => `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`));
  const next = items.slice(0, 10);

  if (!next.length) {
    container.innerHTML = `<div class="sch-empty">No upcoming events.</div>`;
    return;
  }

  container.innerHTML = next.map((item) => {
    const d = new Date(item.date + "T00:00:00");
    const dayNum = d.getDate();
    const monthAbbr = d.toLocaleDateString("en-US", { month: "short" });
    return `
      <div class="coach-event-row">
        <div class="coach-event-dot ${item.type}"></div>
        <div class="coach-event-info">
          <div class="coach-event-title">${esc(item.title)}</div>
          <div class="coach-event-detail">${esc(item.detail)}${item.time ? ` - ${esc(formatTime(item.time))}` : ""}</div>
        </div>
        <div class="coach-event-date">
          <div class="coach-event-date-day">${dayNum}</div>
          <div class="coach-event-date-month">${monthAbbr}</div>
        </div>
      </div>`;
  }).join("");
}

// ── Render: Performance ───────────────────────────────────────
function renderPerformance() {
  const container = $("#coach-performance-overview");
  if (!container) return;

  if (!state.teams.length) {
    container.innerHTML = `<div class="sch-empty">No teams assigned yet.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="coach-perf-grid">
      ${state.teams.map((t) => {
        const total = t.wins + t.losses + t.ties;
        const winRate = total > 0 ? Math.round((t.wins / total) * 100) : 0;
        const barClass = winRate >= 60 ? "high" : winRate >= 40 ? "mid" : "low";
        const sportName = t.sports?.name || "Sport";
        return `
          <div class="coach-perf-card" data-open-team="${t.team_id}">
            <div style="font-size:1.6rem;flex-shrink:0">${sportIcon(sportName)}</div>
            <div class="coach-perf-info">
              <div class="coach-perf-name">${esc(t.name)}</div>
              <div class="coach-perf-meta">${esc(sportName)} - ${esc(t.level)}</div>
              <div class="coach-perf-bar-wrap">
                <div class="coach-perf-bar ${barClass}" style="width:${Math.max(winRate, 4)}%"></div>
              </div>
            </div>
            <div class="coach-perf-record">
              <div class="coach-perf-record-val">${t.wins}-${t.losses}-${t.ties}</div>
              <div class="coach-perf-record-label">${winRate}% Win</div>
            </div>
          </div>`;
      }).join("")}
    </div>`;
}

// ── Render: My Teams ──────────────────────────────────────────
function renderTeamsList() {
  const container = $("#coach-teams-list");
  const countChip = $("#coach-teams-count");
  if (countChip) countChip.textContent = state.teams.length ? `${state.teams.length} team${state.teams.length > 1 ? "s" : ""}` : "";

  if (!container) return;
  if (!state.teams.length) {
    container.innerHTML = `<div class="sch-empty">You have not been assigned to any teams yet. Ask your school admin to assign you as head coach.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="coach-teams-grid">
      ${state.teams.map((t) => {
        const sportName = t.sports?.name || "Sport";
        const seasonName = t.seasons?.name || "";
        const total = t.wins + t.losses + t.ties;
        const winRate = total > 0 ? Math.round((t.wins / total) * 100) : 0;
        // Count upcoming matches for this team
        const now = todayStr();
        const teamMatches = state.allMatches.filter((m) => m.team_id === t.team_id && m.match_date >= now).length;
        const teamTrainings = state.allTrainings.filter((tr) => tr.team_id === t.team_id && tr.training_date >= now).length;

        return `
          <div class="coach-team-card" data-open-team="${t.team_id}">
            <div class="coach-team-card-header">
              <div class="coach-team-card-icon">${sportIcon(sportName)}</div>
              <div class="coach-team-card-info">
                <h3 class="coach-team-card-name">${esc(t.name)}</h3>
                <div class="coach-team-card-meta">
                  ${esc(sportName)} - ${esc(t.level)}${seasonName ? ` - ${esc(seasonName)}` : ""}
                  ${teamMatches ? ` &middot; ${teamMatches} upcoming` : ""}
                  ${teamTrainings ? ` &middot; ${teamTrainings} training${teamTrainings > 1 ? "s" : ""}` : ""}
                </div>
              </div>
            </div>
            <div class="coach-team-card-stats">
              <div class="coach-team-card-stat">
                <div class="coach-team-card-stat-val win">${t.wins}</div>
                <div class="coach-team-card-stat-label">Wins</div>
              </div>
              <div class="coach-team-card-stat">
                <div class="coach-team-card-stat-val loss">${t.losses}</div>
                <div class="coach-team-card-stat-label">Losses</div>
              </div>
              <div class="coach-team-card-stat">
                <div class="coach-team-card-stat-val tie">${t.ties}</div>
                <div class="coach-team-card-stat-label">Ties</div>
              </div>
              <div class="coach-team-card-stat">
                <div class="coach-team-card-stat-val">${winRate}%</div>
                <div class="coach-team-card-stat-label">Win Rate</div>
              </div>
            </div>
          </div>`;
      }).join("")}
    </div>`;
}

// ── Render: Team Detail ───────────────────────────────────────
async function openTeamDetail(teamId) {
  state.viewingTeamId = teamId;
  const team = state.teams.find((t) => t.team_id === teamId);
  if (!team) return;

  switchSection("team-detail");

  const nameEl = $("#coach-td-name");
  const metaEl = $("#coach-td-meta");
  if (nameEl) nameEl.textContent = team.name;
  if (metaEl) metaEl.textContent = `${team.sports?.name || "Sport"} - ${team.level}${team.seasons?.name ? ` - ${team.seasons.name}` : ""}`;

  const [roster, matches, trainings] = await Promise.all([
    loadRoster(teamId),
    loadMatches(teamId),
    loadTrainings(teamId),
  ]);
  state.teamRoster = roster;
  state.teamMatches = matches;
  state.teamTrainings = trainings;

  renderTeamDetail(team);
}

function renderTeamDetail(team) {
  const el = (id, v) => { const e = $(`#${id}`); if (e) e.textContent = v; };
  el("coach-td-wins", team.wins);
  el("coach-td-losses", team.losses);
  el("coach-td-ties", team.ties);
  el("coach-td-total", team.wins + team.losses + team.ties);

  renderTeamDetailRosterEnhanced();

  const now = todayStr();
  const upcoming = state.teamMatches.filter((m) => m.match_date >= now);
  const past = state.teamMatches.filter((m) => m.match_date < now);

  renderMatchList("#coach-td-upcoming-list", "#coach-td-upcoming-count", upcoming, team);
  renderMatchList("#coach-td-past-list", "#coach-td-past-count", past, team);
  renderTeamDetailTrainings();
}

function renderTeamDetailRoster() {
  const addContainer = $("#coach-td-roster-add");
  const listContainer = $("#coach-td-roster-list");
  const countChip = $("#coach-td-roster-count");
  if (countChip) countChip.textContent = state.teamRoster.length ? `${state.teamRoster.length} athletes` : "";

  const rosterAthleteIds = new Set(state.teamRoster.map((r) => r.athlete_id));
  const available = state.members.filter((m) => !rosterAthleteIds.has(m.user_id));

  if (addContainer) {
    addContainer.innerHTML = `
      <select id="coach-td-add-athlete" class="sch-select" style="flex:1">
        <option value="" disabled selected>Add athlete to roster...</option>
        ${available.map((m) => `<option value="${m.user_id}">${esc(m.users?.display_name || m.users?.email || m.user_id)}</option>`).join("")}
      </select>
      <input id="coach-td-add-jersey" type="text" class="sch-input" placeholder="Jersey #" style="width:70px">
      <input id="coach-td-add-position" type="text" class="sch-input" placeholder="Position" style="width:100px">
      <button class="sch-btn sch-btn--primary sch-btn--xs" id="coach-td-add-btn" type="button">Add</button>`;
  }

  if (listContainer) {
    listContainer.innerHTML = state.teamRoster.length
      ? state.teamRoster.map((r) => `
          <div class="sch-list-item">
            <div class="sch-list-item-main">
              <strong>${esc(r.user_directory?.display_name || "Athlete")}</strong>
              <span style="color:var(--muted);font-size:.8125rem">
                ${r.jersey_number ? `#${esc(r.jersey_number)}` : ""}${r.position ? ` ${esc(r.position)}` : ""}
              </span>
            </div>
            <button class="sch-btn sch-btn--danger sch-btn--xs" data-remove-roster="${r.roster_id}">Remove</button>
          </div>`).join("")
      : `<div class="sch-empty">No athletes on roster yet. Add athletes from the dropdown above.</div>`;
  }
}

function renderTeamDetailTrainings() {
  const container = $("#coach-td-training-list");
  const countChip = $("#coach-td-training-count");
  if (countChip) countChip.textContent = state.teamTrainings.length ? `${state.teamTrainings.length}` : "";

  if (!container) return;
  container.innerHTML = state.teamTrainings.length
    ? state.teamTrainings.map((t) => trainingRowHtml(t, true)).join("")
    : `<div class="sch-empty">No trainings scheduled.</div>`;
}

// ── Render: Training (all) ────────────────────────────────────
function renderAllTrainings() {
  const container = $("#coach-all-trainings-list");
  const countChip = $("#coach-training-count");
  if (countChip) countChip.textContent = state.allTrainings.length ? `${state.allTrainings.length} sessions` : "";

  // Populate team dropdown
  const teamSelect = $("#training-team");
  if (teamSelect && teamSelect.options.length <= 1) {
    state.teams.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.team_id;
      opt.textContent = `${t.name} (${t.sports?.name || "Sport"})`;
      teamSelect.appendChild(opt);
    });
  }

  if (!container) return;
  if (!state.allTrainings.length) {
    container.innerHTML = `<div class="sch-empty">No trainings scheduled yet. Use the form above to schedule your first session.</div>`;
    return;
  }

  container.innerHTML = state.allTrainings.map((t) => trainingRowHtml(t, true)).join("");
}

// ── Render: Schedule (all matches) ────────────────────────────
function renderAllMatches() {
  const container = $("#coach-all-matches-list");
  const countChip = $("#coach-schedule-count");
  if (countChip) countChip.textContent = state.allMatches.length ? `${state.allMatches.length} matches` : "";

  if (!container) return;
  if (!state.allMatches.length) {
    container.innerHTML = `<div class="sch-empty">No matches scheduled. Matches are added by your school admin.</div>`;
    return;
  }

  container.innerHTML = state.allMatches.map((m) => {
    const team = state.teams.find((t) => t.team_id === m.team_id);
    return matchRowHtml(m, team);
  }).join("");
}

// ── Shared row helpers ────────────────────────────────────────
function matchRowHtml(m, team) {
  const teamName = team?.name || "Team";
  const now = todayStr();
  const isPast = m.match_date < now;
  const isInternal = m.match_type === "internal";

  return `
    <div class="sch-list-item">
      <div style="font-size:1.2rem;flex-shrink:0">${sportIcon(team?.sports?.name)}</div>
      <div class="sch-list-item-main">
        <strong>${esc(teamName)} vs ${esc(m.opponent_name || "TBD")}</strong>
        <span style="color:var(--muted);font-size:.8125rem">
          ${esc(formatDate(m.match_date))}${m.match_time ? ` at ${esc(formatTime(m.match_time))}` : ""}
          ${m.location ? ` &middot; ${esc(m.location)}` : ""}
          ${m.is_home_game ? " &middot; Home" : " &middot; Away"}
        </span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        ${isPast && (m.home_score != null || m.away_score != null) ? `<span style="font-weight:700;font-size:.875rem">${m.home_score ?? "-"} - ${m.away_score ?? "-"}</span>` : ""}
        <span class="sch-badge-${isPast ? "completed" : "scheduled"}">${isPast ? "Completed" : "Upcoming"}</span>
        ${isInternal ? `<span class="sch-badge-internal">Internal</span>` : ""}
      </div>
    </div>`;
}

function renderMatchList(containerSel, countSel, matches, team) {
  const container = $(containerSel);
  const count = $(countSel);
  if (count) count.textContent = matches.length || "";
  if (!container) return;
  container.innerHTML = matches.length
    ? matches.map((m) => matchRowHtml(m, team)).join("")
    : `<div class="sch-empty">No matches.</div>`;
}

function trainingRowHtml(t, showDelete = false) {
  const teamName = t.teams?.name || "Team";
  const sportName = t.teams?.sports?.name || "";
  return `
    <div class="sch-list-item">
      <div style="font-size:1.1rem;flex-shrink:0;font-weight:600;color:var(--accent)">TR</div>
      <div class="sch-list-item-main">
        <strong>${esc(t.title || "Practice")}</strong>
        <span style="color:var(--muted);font-size:.8125rem">
          ${esc(teamName)}${sportName ? ` (${esc(sportName)})` : ""} &middot;
          ${esc(formatDate(t.training_date))}${t.start_time ? ` at ${esc(formatTime(t.start_time))}` : ""}${t.end_time ? ` - ${esc(formatTime(t.end_time))}` : ""}
          ${t.location ? ` &middot; ${esc(t.location)}` : ""}
        </span>
        ${t.description ? `<span style="color:var(--muted);font-size:.7rem;display:block;margin-top:2px">${esc(t.description)}</span>` : ""}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
        <span class="sch-badge-scheduled">${esc(t.type || "practice")}</span>
        ${showDelete ? `<button class="sch-btn sch-btn--danger sch-btn--xs" data-delete-training="${t.training_id}">Delete</button>` : ""}
      </div>
    </div>`;
}

// ── Render all ────────────────────────────────────────────────
// ── Render: Stats Tab ─────────────────────────────────────────
let _statDefs = [];    // cached sport_stat_definitions
let _statsRoster = []; // current team roster for stats entry

async function loadStatDefinitions(sportName) {
  if (!sportName) return [];
  const key = sportName.toLowerCase();
  const { data, error } = await supabase
    .from("sport_stat_definitions")
    .select("*")
    .eq("sport_name", key)
    .order("sort_order", { ascending: true });
  if (error) { console.warn("Could not load stat defs:", error); return []; }
  return data || [];
}

function renderStatsTeamDropdown() {
  const sel = $("#stats-team");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Select a team —</option>`
    + state.teams.map((t) => {
      const sportName = t.sports?.name || "Sport";
      return `<option value="${t.team_id}" data-sport="${esc(sportName.toLowerCase())}">${esc(t.name)} — ${esc(sportName)}</option>`;
    }).join("");
}

async function onStatsTeamChange() {
  const teamId = $("#stats-team")?.value;
  const matchSel = $("#stats-match");
  const entryCard = $("#stats-entry-card");
  const summaryCard = $("#stats-summary-card");
  if (matchSel) matchSel.innerHTML = `<option value="">— Select a match —</option>`;
  if (entryCard) entryCard.style.display = "none";
  if (summaryCard) summaryCard.style.display = "none";
  if (!teamId) return;

  // Load matches for this team
  const matches = await loadMatches(teamId);
  const completedFirst = [...matches].sort((a, b) => {
    // completed matches first, then by date desc
    if (a.status === "completed" && b.status !== "completed") return -1;
    if (b.status === "completed" && a.status !== "completed") return 1;
    return (b.match_date || "").localeCompare(a.match_date || "");
  });

  if (matchSel) {
    matchSel.innerHTML = `<option value="">— Select a match —</option>`
      + completedFirst.map((m) => {
        const label = `${formatDateShort(m.match_date)} — vs ${esc(m.opponent_name)} (${m.status || "scheduled"})`;
        return `<option value="${m.match_id}">${label}</option>`;
      }).join("");
  }

  // Also show season averages for this team
  await renderSeasonAverages(teamId);
}

async function onStatsMatchChange() {
  const teamId = $("#stats-team")?.value;
  const matchId = $("#stats-match")?.value;
  const entryCard = $("#stats-entry-card");
  if (!teamId || !matchId) { if (entryCard) entryCard.style.display = "none"; return; }

  // Get sport name from team
  const team = state.teams.find((t) => t.team_id === teamId);
  const sportName = (team?.sports?.name || "").toLowerCase();

  // Load stat definitions, roster, and existing stats in parallel
  const [defs, roster, existingStats] = await Promise.all([
    loadStatDefinitions(sportName),
    loadRoster(teamId),
    supabase.from("athlete_stats")
      .select("*")
      .eq("match_id", matchId)
      .then(({ data }) => data || []),
  ]);

  _statDefs = defs;
  _statsRoster = roster;

  if (!defs.length) {
    if (entryCard) {
      entryCard.style.display = "block";
      $("#stats-entry-grid").innerHTML = `<div class="sch-empty">No stat definitions found for "${esc(sportName)}". Run the SQL migration (step8) to add them.</div>`;
    }
    return;
  }
  if (!roster.length) {
    if (entryCard) {
      entryCard.style.display = "block";
      $("#stats-entry-grid").innerHTML = `<div class="sch-empty">No athletes on this team's roster.</div>`;
    }
    return;
  }

  // Build a lookup: athlete_id -> stat_type -> value
  const existingMap = new Map();
  for (const s of existingStats) {
    const key = `${s.athlete_id}__${s.stat_type}`;
    existingMap.set(key, { value: s.stat_value, statId: s.stat_id });
  }

  // Build the stat entry table
  const grid = $("#stats-entry-grid");
  if (!grid) return;

  // Enrich roster with names
  const rosterIds = roster.map((r) => r.athlete_id);
  let nameMap = new Map();
  try {
    const { data: sjrRows } = await supabase
      .from("school_join_requests")
      .select("user_id, display_name")
      .in("user_id", rosterIds);
    for (const r of (sjrRows || [])) {
      if (r.user_id) nameMap.set(r.user_id, r.display_name);
    }
  } catch (_) {}

  const headerCells = defs.map((d) => `<th style="padding:8px 6px; font-size:.7rem; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); white-space:nowrap; min-width:70px">${esc(d.stat_label)}${d.unit ? ` (${esc(d.unit)})` : ""}</th>`).join("");

  const rows = roster.map((r) => {
    const name = nameMap.get(r.athlete_id) || r.athlete_id.slice(0, 8);
    const cells = defs.map((d) => {
      const key = `${r.athlete_id}__${d.stat_key}`;
      const existing = existingMap.get(key);
      const val = existing ? existing.value : "";
      const inputType = d.stat_type === "text" ? "text" : "number";
      const step = d.stat_type === "decimal" ? "0.01" : "1";
      return `<td style="padding:4px 3px">
        <input type="${inputType}" step="${step}" value="${esc(val)}"
               data-athlete="${r.athlete_id}" data-stat="${d.stat_key}"
               style="width:100%; padding:6px 8px; border:1px solid var(--line,#e0e0e0); border-radius:6px; font-size:.8rem; background:var(--surface,#fff); color:var(--text,#222);"
               placeholder="—">
      </td>`;
    }).join("");
    return `<tr>
      <td style="padding:8px 10px; font-weight:600; font-size:.8rem; white-space:nowrap; position:sticky; left:0; background:var(--surface,#fff); z-index:1;">${esc(name)}</td>
      ${cells}
    </tr>`;
  }).join("");

  grid.innerHTML = `
    <table style="width:100%; border-collapse:collapse; font-size:.8rem">
      <thead>
        <tr style="border-bottom:2px solid var(--line,#e0e0e0)">
          <th style="padding:8px 10px; text-align:left; font-size:.75rem; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); position:sticky; left:0; background:var(--surface,#fff); z-index:2; min-width:120px">Athlete</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  const title = $("#stats-entry-title");
  const matchInfo = state.allMatches.find((m) => m.match_id === matchId);
  if (title && matchInfo) {
    title.textContent = `Stats: vs ${matchInfo.opponent_name} (${formatDateShort(matchInfo.match_date)})`;
  }

  if (entryCard) entryCard.style.display = "block";
}

async function saveAllStats() {
  const matchId = $("#stats-match")?.value;
  if (!matchId) return;

  setStatus("stats-save-status", "Saving...");

  const inputs = document.querySelectorAll("#stats-entry-grid input[data-athlete]");
  const upserts = [];

  for (const inp of inputs) {
    const athleteId = inp.dataset.athlete;
    const statType = inp.dataset.stat;
    const val = inp.value.trim();
    if (!val) continue;

    upserts.push({
      match_id: matchId,
      athlete_id: athleteId,
      stat_type: statType,
      stat_value: parseFloat(val) || 0,
      notes: val, // Keep original for text stats
    });
  }

  if (!upserts.length) {
    setStatus("stats-save-status", "No stats to save.", true);
    return;
  }

  try {
    // Delete old stats for this match, then insert new
    await supabase.from("athlete_stats").delete().eq("match_id", matchId);
    const { error } = await supabase.from("athlete_stats").insert(upserts);
    if (error) throw error;
    setStatus("stats-save-status", `Saved ${upserts.length} stat entries.`);

    // Refresh season averages
    const teamId = $("#stats-team")?.value;
    if (teamId) await renderSeasonAverages(teamId);
  } catch (err) {
    setStatus("stats-save-status", err.message || "Failed to save.", true);
  }
}

async function renderSeasonAverages(teamId) {
  const summaryCard = $("#stats-summary-card");
  const summaryBody = $("#stats-summary-body");
  const summaryTitle = $("#stats-summary-title");
  if (!summaryCard || !summaryBody) return;

  const team = state.teams.find((t) => t.team_id === teamId);
  const sportName = (team?.sports?.name || "").toLowerCase();
  if (summaryTitle) summaryTitle.textContent = `${team?.name || "Team"} — Season Averages`;

  const roster = await loadRoster(teamId);
  if (!roster.length) {
    summaryCard.style.display = "none";
    return;
  }

  const defs = await loadStatDefinitions(sportName);
  if (!defs.length) { summaryCard.style.display = "none"; return; }

  // Load all matches for this team
  const matches = await loadMatches(teamId);
  const matchIds = matches.map((m) => m.match_id);
  if (!matchIds.length) {
    summaryCard.style.display = "block";
    summaryBody.innerHTML = `<div class="sch-empty">No matches played yet — averages will appear after you enter stats.</div>`;
    return;
  }

  // Load all stats for these matches
  const { data: allStats } = await supabase
    .from("athlete_stats")
    .select("*")
    .in("match_id", matchIds);

  if (!allStats?.length) {
    summaryCard.style.display = "block";
    summaryBody.innerHTML = `<div class="sch-empty">No stats entered yet for this team's matches.</div>`;
    return;
  }

  // Get names
  const rosterIds = roster.map((r) => r.athlete_id);
  let nameMap = new Map();
  try {
    const { data: sjrRows } = await supabase
      .from("school_join_requests")
      .select("user_id, display_name")
      .in("user_id", rosterIds);
    for (const r of (sjrRows || [])) nameMap.set(r.user_id, r.display_name);
  } catch (_) {}

  // Calculate averages per athlete per stat
  const numericDefs = defs.filter((d) => d.stat_type !== "text");
  const avgMap = new Map(); // athlete_id -> { stat_key -> { total, count } }

  for (const s of allStats) {
    if (!rosterIds.includes(s.athlete_id)) continue;
    if (!avgMap.has(s.athlete_id)) avgMap.set(s.athlete_id, new Map());
    const statMap = avgMap.get(s.athlete_id);
    if (!statMap.has(s.stat_type)) statMap.set(s.stat_type, { total: 0, count: 0 });
    const entry = statMap.get(s.stat_type);
    entry.total += parseFloat(s.stat_value) || 0;
    entry.count += 1;
  }

  // Build summary table
  const headerCells = numericDefs.map((d) =>
    `<th style="padding:8px 6px; font-size:.7rem; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); text-align:center; white-space:nowrap">${esc(d.stat_label)}</th>`
  ).join("");

  const rows = roster.filter((r) => avgMap.has(r.athlete_id)).map((r) => {
    const name = nameMap.get(r.athlete_id) || r.athlete_id.slice(0, 8);
    const statMap = avgMap.get(r.athlete_id) || new Map();
    const cells = numericDefs.map((d) => {
      const entry = statMap.get(d.stat_key);
      if (!entry) return `<td style="padding:6px; text-align:center; color:var(--muted)">—</td>`;
      const avg = entry.total / entry.count;
      const display = d.stat_type === "decimal" ? avg.toFixed(1) : avg.toFixed(1);
      return `<td style="padding:6px; text-align:center; font-weight:600; font-size:.85rem">${display}</td>`;
    }).join("");
    const gamesPlayed = new Set(allStats.filter((s) => s.athlete_id === r.athlete_id).map((s) => s.match_id)).size;
    return `<tr style="border-bottom:1px solid var(--line,#eee)">
      <td style="padding:8px 10px; font-weight:600; font-size:.8rem; white-space:nowrap">${esc(name)}</td>
      <td style="padding:6px; text-align:center; font-size:.8rem">${gamesPlayed}</td>
      ${cells}
    </tr>`;
  }).join("");

  if (!rows) {
    summaryCard.style.display = "block";
    summaryBody.innerHTML = `<div class="sch-empty">No stats entered yet.</div>`;
    return;
  }

  summaryBody.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%; border-collapse:collapse; font-size:.8rem">
        <thead>
          <tr style="border-bottom:2px solid var(--line,#e0e0e0)">
            <th style="padding:8px 10px; text-align:left; font-size:.75rem; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); min-width:120px">Athlete</th>
            <th style="padding:8px 6px; font-size:.7rem; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); text-align:center">GP</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  summaryCard.style.display = "block";
}

// ══════════════════════════════════════════════════════════════
// ── ATTENDANCE TAB ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

let _attRoster = [];
let _attRecords = {}; // athleteId -> status

function renderAttTeamDropdown() {
  const sel = $("#att-team");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Select a team —</option>`
    + state.teams.map((t) => `<option value="${t.team_id}">${esc(t.name)} — ${esc(t.sports?.name || "Sport")}</option>`).join("");
}

async function onAttTeamChange() {
  const teamId = $("#att-team")?.value;
  const eventSel = $("#att-event");
  const gridCard = $("#att-grid-card");
  const summaryCard = $("#att-summary-card");
  if (eventSel) eventSel.innerHTML = `<option value="">— Select an event —</option>`;
  if (gridCard) gridCard.style.display = "none";
  if (summaryCard) summaryCard.style.display = "none";
  if (!teamId) return;

  await refreshAttEventList(teamId);
  await renderAttSummary(teamId);
}

async function refreshAttEventList(teamId) {
  const eventType = $("#att-event-type")?.value || "training";
  const eventSel = $("#att-event");
  if (!eventSel) return;

  if (eventType === "training") {
    const trainings = await loadTrainings(teamId);
    eventSel.innerHTML = `<option value="">— Select a training —</option>`
      + trainings.map((t) => `<option value="${t.training_id}">${esc(formatDate(t.training_date))} — ${esc(t.title || "Practice")}</option>`).join("");
  } else {
    const matches = await loadMatches(teamId);
    eventSel.innerHTML = `<option value="">— Select a match —</option>`
      + matches.map((m) => `<option value="${m.match_id}">${esc(formatDate(m.match_date))} — vs ${esc(m.opponent_name || "TBD")}</option>`).join("");
  }
}

async function onAttEventChange() {
  const teamId = $("#att-team")?.value;
  const eventType = $("#att-event-type")?.value || "training";
  const eventId = $("#att-event")?.value;
  const gridCard = $("#att-grid-card");
  if (!teamId || !eventId) { if (gridCard) gridCard.style.display = "none"; return; }

  // Load roster + existing attendance
  const [roster, existing] = await Promise.all([
    loadRoster(teamId),
    loadAttendance(teamId, eventType, eventId),
  ]);
  _attRoster = roster;
  _attRecords = {};
  for (const r of existing) {
    _attRecords[r.athlete_id] = r.status;
  }
  // Default everyone not yet recorded to "present"
  for (const r of roster) {
    if (!_attRecords[r.athlete_id]) _attRecords[r.athlete_id] = "present";
  }

  renderAttGrid();
  if (gridCard) gridCard.style.display = "block";

  const title = $("#att-grid-title");
  if (title) title.textContent = `Mark Attendance — ${eventType === "training" ? "Training" : "Match"}`;
}

function renderAttGrid() {
  const container = $("#att-grid");
  if (!container) return;
  if (!_attRoster.length) {
    container.innerHTML = `<div class="sch-empty">No athletes on roster.</div>`;
    return;
  }

  container.innerHTML = _attRoster.map((r) => {
    const name = r.user_directory?.display_name || "Athlete";
    const current = _attRecords[r.athlete_id] || "present";
    const statuses = ["present", "absent", "late", "excused"];
    return `
      <div class="att-row">
        <div class="att-name">${esc(name)}${r.jersey_number ? ` <span style="color:var(--muted)">#${esc(r.jersey_number)}</span>` : ""}</div>
        <div class="att-status-group">
          ${statuses.map((s) => `<button type="button" class="att-status-btn ${current === s ? `is-${s}` : ""}" data-att-athlete="${r.athlete_id}" data-att-status="${s}">${s}</button>`).join("")}
        </div>
      </div>`;
  }).join("");
}

async function saveAttendance() {
  const teamId = $("#att-team")?.value;
  const eventType = $("#att-event-type")?.value || "training";
  const eventId = $("#att-event")?.value;
  if (!teamId || !eventId) return;

  setStatus("att-save-status", "Saving...");
  const records = _attRoster.map((r) => ({
    team_id: teamId,
    athlete_id: r.athlete_id,
    event_type: eventType,
    event_id: eventId,
    status: _attRecords[r.athlete_id] || "present",
    recorded_by: state.appUserId,
  }));

  try {
    await bulkUpsertAttendance(records);
    setStatus("att-save-status", `Saved attendance for ${records.length} athletes.`);
    await renderAttSummary(teamId);
  } catch (err) {
    setStatus("att-save-status", err.message || "Failed to save.", true);
  }
}

async function renderAttSummary(teamId) {
  const card = $("#att-summary-card");
  const body = $("#att-summary-body");
  if (!card || !body) return;

  const allAtt = await loadAttendanceSummary(teamId);
  if (!allAtt.length) { card.style.display = "none"; return; }

  // Load roster for names
  const roster = await loadRoster(teamId);
  const nameMap = new Map();
  for (const r of roster) nameMap.set(r.athlete_id, r.user_directory?.display_name || "Athlete");

  // Build per-athlete summary
  const summary = new Map();
  for (const a of allAtt) {
    if (!summary.has(a.athlete_id)) summary.set(a.athlete_id, { present: 0, absent: 0, late: 0, excused: 0, total: 0 });
    const s = summary.get(a.athlete_id);
    s[a.status] = (s[a.status] || 0) + 1;
    s.total++;
  }

  body.innerHTML = [...summary.entries()].map(([aid, s]) => {
    const name = nameMap.get(aid) || aid.slice(0, 8);
    const rate = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0;
    return `
      <div class="att-summary-row">
        <div class="att-summary-name">${esc(name)}</div>
        <div class="att-summary-stat present">${s.present}</div>
        <div class="att-summary-stat absent">${s.absent}</div>
        <div class="att-summary-stat late">${s.late}</div>
        <div class="att-summary-stat rate">${rate}%</div>
      </div>`;
  }).join("");

  card.style.display = "block";
}

// ══════════════════════════════════════════════════════════════
// ── PLAYER NOTES ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

async function openPlayerNotesModal(athleteId, athleteName, teamId) {
  // Remove existing modal
  document.querySelector(".pn-modal-overlay")?.remove();

  const notes = await loadPlayerNotes(state.appUserId, athleteId, null);
  const categories = ["general", "performance", "behavior", "injury", "development"];

  const overlay = document.createElement("div");
  overlay.className = "pn-modal-overlay";
  overlay.innerHTML = `
    <div class="pn-modal">
      <div class="pn-modal-head">
        <div class="pn-modal-title">Notes — ${esc(athleteName)}</div>
        <button class="pn-modal-close" id="pn-close">&times;</button>
      </div>
      <div class="pn-modal-body">
        <div id="pn-notes-list">
          ${notes.length ? notes.map((n) => playerNoteHtml(n)).join("") : `<div class="sch-empty" style="padding:20px 0">No notes yet.</div>`}
        </div>
        <div class="pn-add-form">
          <select id="pn-cat" class="sch-select" style="font-size:.8rem">
            ${categories.map((c) => `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join("")}
          </select>
          <textarea id="pn-content" class="sch-input" rows="2" placeholder="Add a note..." style="font-size:.8125rem;resize:vertical"></textarea>
          <button class="sch-btn sch-btn--primary sch-btn--sm" id="pn-add-btn" data-athlete="${athleteId}" data-team="${teamId || ""}">Add Note</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Close
  overlay.querySelector("#pn-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  // Add note
  overlay.querySelector("#pn-add-btn").addEventListener("click", async () => {
    const content = overlay.querySelector("#pn-content")?.value?.trim();
    if (!content) return;
    const cat = overlay.querySelector("#pn-cat")?.value || "general";
    try {
      await createPlayerNote({ coachId: state.appUserId, athleteId, teamId: teamId || null, content, category: cat });
      overlay.querySelector("#pn-content").value = "";
      // Refresh list
      const refreshed = await loadPlayerNotes(state.appUserId, athleteId, null);
      overlay.querySelector("#pn-notes-list").innerHTML = refreshed.length
        ? refreshed.map((n) => playerNoteHtml(n)).join("")
        : `<div class="sch-empty" style="padding:20px 0">No notes yet.</div>`;
    } catch (err) {
      console.error("Failed to add note:", err);
    }
  });

  // Delete / pin handlers (delegated)
  overlay.querySelector("#pn-notes-list").addEventListener("click", async (e) => {
    const delBtn = e.target.closest("[data-pn-delete]");
    if (delBtn) {
      await deletePlayerNote(delBtn.dataset.pnDelete);
      const refreshed = await loadPlayerNotes(state.appUserId, athleteId, null);
      overlay.querySelector("#pn-notes-list").innerHTML = refreshed.length
        ? refreshed.map((n) => playerNoteHtml(n)).join("")
        : `<div class="sch-empty" style="padding:20px 0">No notes yet.</div>`;
      return;
    }
    const pinBtn = e.target.closest("[data-pn-pin]");
    if (pinBtn) {
      const isPinned = pinBtn.dataset.pnPinned === "true";
      await updatePlayerNote(pinBtn.dataset.pnPin, { is_pinned: !isPinned });
      const refreshed = await loadPlayerNotes(state.appUserId, athleteId, null);
      overlay.querySelector("#pn-notes-list").innerHTML = refreshed.map((n) => playerNoteHtml(n)).join("");
    }
  });
}

function playerNoteHtml(n) {
  const date = new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `
    <div class="pn-note-item ${n.is_pinned ? "is-pinned" : ""}">
      <div class="pn-note-cat">${esc(n.category)}${n.is_pinned ? " · Pinned" : ""}</div>
      <div class="pn-note-text">${esc(n.content)}</div>
      <div class="pn-note-foot">
        <span class="pn-note-date">${date}</span>
        <button class="pn-note-action" data-pn-pin="${n.note_id}" data-pn-pinned="${n.is_pinned}">${n.is_pinned ? "Unpin" : "Pin"}</button>
        <button class="pn-note-action" data-pn-delete="${n.note_id}" style="color:var(--danger,#ef4444)">Delete</button>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
// ── ROSTER ROLE TAGS (in team detail) ────────────────────────
// ══════════════════════════════════════════════════════════════

function renderTeamDetailRosterEnhanced() {
  const addContainer = $("#coach-td-roster-add");
  const listContainer = $("#coach-td-roster-list");
  const countChip = $("#coach-td-roster-count");
  if (countChip) countChip.textContent = state.teamRoster.length ? `${state.teamRoster.length} athletes` : "";

  const rosterAthleteIds = new Set(state.teamRoster.map((r) => r.athlete_id));
  const available = state.members.filter((m) => !rosterAthleteIds.has(m.user_id));

  if (addContainer) {
    addContainer.innerHTML = `
      <select id="coach-td-add-athlete" class="sch-select" style="flex:1">
        <option value="" disabled selected>Add athlete to roster...</option>
        ${available.map((m) => `<option value="${m.user_id}">${esc(m.users?.display_name || m.users?.email || m.user_id)}</option>`).join("")}
      </select>
      <input id="coach-td-add-jersey" type="text" class="sch-input" placeholder="Jersey #" style="width:70px">
      <input id="coach-td-add-position" type="text" class="sch-input" placeholder="Position" style="width:100px">
      <button class="sch-btn sch-btn--primary sch-btn--xs" id="coach-td-add-btn" type="button">Add</button>`;
  }

  if (listContainer) {
    listContainer.innerHTML = state.teamRoster.length
      ? state.teamRoster.map((r) => {
          const name = r.user_directory?.display_name || "Athlete";
          const tags = [];
          if (r.is_captain) tags.push(`<span class="roster-tag captain">Captain</span>`);
          if (r.is_starter) tags.push(`<span class="roster-tag starter">Starter</span>`);
          if (r.role_tag) tags.push(`<span class="roster-tag">${esc(r.role_tag)}</span>`);

          return `
            <div class="sch-list-item" style="flex-wrap:wrap;gap:8px">
              <div class="sch-list-item-main" style="flex:1;min-width:180px">
                <strong>${esc(name)}</strong>
                <span style="color:var(--muted);font-size:.8125rem">
                  ${r.jersey_number ? `#${esc(r.jersey_number)}` : ""}${r.position ? ` ${esc(r.position)}` : ""}
                  ${tags.join("")}
                </span>
              </div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
                <button class="sch-btn sch-btn--ghost sch-btn--xs" data-toggle-captain="${r.roster_id}" data-current="${r.is_captain}">${r.is_captain ? "★ Captain" : "☆ Captain"}</button>
                <button class="sch-btn sch-btn--ghost sch-btn--xs" data-toggle-starter="${r.roster_id}" data-current="${r.is_starter}">${r.is_starter ? "✓ Starter" : "Starter"}</button>
                <button class="sch-btn sch-btn--ghost sch-btn--xs" data-open-notes="${r.athlete_id}" data-athlete-name="${esc(name)}">Notes</button>
                <button class="sch-btn sch-btn--danger sch-btn--xs" data-remove-roster="${r.roster_id}">Remove</button>
              </div>
            </div>`;
        }).join("")
      : `<div class="sch-empty">No athletes on roster yet. Add athletes from the dropdown above.</div>`;
  }
}

// ══════════════════════════════════════════════════════════════
// ── TACTICAL BOARD ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

let _tacFormations = [];
let _tacCurrentId = null;
let _tacPlayers = [];  // [{id, x, y, label, role}]
let _tacDragging = null;
let _tacRoster = [];   // roster entries for selected team
let _tacSport = "";    // current team sport name (lowercase)

function renderTacTeamDropdown() {
  const sel = $("#tac-team");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Select a team —</option>`
    + state.teams.map((t) => `<option value="${t.team_id}">${esc(t.name)} — ${esc(t.sports?.name || "Sport")}</option>`).join("");
}

async function onTacTeamChange() {
  const teamId = $("#tac-team")?.value;
  const formSel = $("#tac-formation-select");
  const boardCard = $("#tac-board-card");
  if (boardCard) boardCard.style.display = "none";
  _tacCurrentId = null;
  _tacPlayers = [];
  _tacRoster = [];
  _tacSport = "";

  if (!teamId) return;

  const team = state.teams.find((t) => t.team_id === teamId);
  _tacSport = (team?.sports?.name || "").toLowerCase();

  const [formations, roster] = await Promise.all([
    loadFormations(teamId),
    loadRoster(teamId),
  ]);

  _tacFormations = formations;
  _tacRoster = roster;

  if (formSel) {
    formSel.innerHTML = `<option value="">— New formation —</option>`
      + _tacFormations.map((f) => `<option value="${f.formation_id}">${esc(f.name)}</option>`).join("");
  }

  // Update the add-player button to a roster dropdown
  renderTacAddPlayerControl();

  if (boardCard) boardCard.style.display = "block";
  applyFieldSport();
  renderTacBoard();
}

function onTacFormationSelect() {
  const formId = $("#tac-formation-select")?.value;
  const delBtn = $("#tac-delete-btn");

  if (!formId) {
    _tacCurrentId = null;
    _tacPlayers = [];
    const nameInput = $("#tac-name");
    if (nameInput) nameInput.value = "Untitled Formation";
    const notesInput = $("#tac-notes");
    if (notesInput) notesInput.value = "";
    if (delBtn) delBtn.style.display = "none";
    renderTacBoard();
    return;
  }

  const f = _tacFormations.find((x) => x.formation_id === formId);
  if (!f) return;

  _tacCurrentId = formId;
  _tacPlayers = Array.isArray(f.layout_json) ? [...f.layout_json] : [];
  const nameInput = $("#tac-name");
  if (nameInput) nameInput.value = f.name;
  const notesInput = $("#tac-notes");
  if (notesInput) notesInput.value = f.notes || "";
  if (delBtn) delBtn.style.display = "inline-flex";
  renderTacBoard();
}

function applyFieldSport() {
  const field = $("#tac-field");
  if (!field) return;
  // Remove all sport classes
  field.classList.remove("tac-field--soccer", "tac-field--basketball", "tac-field--football", "tac-field--baseball", "tac-field--volleyball", "tac-field--tennis");
  if (_tacSport.includes("soccer")) field.classList.add("tac-field--soccer");
  else if (_tacSport.includes("basketball")) field.classList.add("tac-field--basketball");
  else if (_tacSport.includes("football")) field.classList.add("tac-field--football");
  else if (_tacSport.includes("baseball")) field.classList.add("tac-field--baseball");
  else if (_tacSport.includes("volleyball")) field.classList.add("tac-field--volleyball");
  else if (_tacSport.includes("tennis")) field.classList.add("tac-field--tennis");
  else field.classList.add("tac-field--soccer"); // default
}

function renderTacAddPlayerControl() {
  const addBtn = $("#tac-add-player");
  if (!addBtn) return;

  // Replace the add button with a dropdown if we have roster players
  const container = addBtn.parentElement;
  const existing = container.querySelector("#tac-add-roster-select");
  if (existing) existing.remove();

  if (_tacRoster.length) {
    addBtn.style.display = "none";
    const sel = document.createElement("select");
    sel.id = "tac-add-roster-select";
    sel.className = "sch-select";
    sel.style.cssText = "font-size:.75rem;padding:4px 10px;min-width:160px;";
    sel.innerHTML = `<option value="">+ Add player to board</option>`
      + _tacRoster.map((r) => {
        const name = r.user_directory?.display_name || `Player`;
        const jersey = r.jersey_number ? `#${r.jersey_number}` : "";
        const pos = r.position || "";
        return `<option value="${r.roster_id}">${esc(name)}${jersey ? ` ${jersey}` : ""}${pos ? ` — ${pos}` : ""}</option>`;
      }).join("");
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      const entry = _tacRoster.find((r) => r.roster_id === sel.value);
      if (entry) {
        tacAddRosterPlayer(entry);
        sel.value = "";
      }
    });
    container.insertBefore(sel, addBtn);
  } else {
    addBtn.style.display = "";
  }
}

function tacAddRosterPlayer(rosterEntry) {
  const name = rosterEntry.user_directory?.display_name || "Player";
  const jersey = rosterEntry.jersey_number || "";
  const pos = rosterEntry.position || "";
  // Check if already on board
  if (_tacPlayers.some((p) => p.rosterId === rosterEntry.roster_id)) return;
  const id = `p${Date.now()}`;
  _tacPlayers.push({
    id,
    rosterId: rosterEntry.roster_id,
    x: 30 + Math.random() * 40,
    y: 30 + Math.random() * 40,
    label: jersey || name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
    role: name,
  });
  renderTacBoard();
}

function renderFootballMarkings(field) {
  // Remove old markings
  field.querySelectorAll(".tac-fb-yard-line, .tac-fb-yard-num, .tac-fb-hash").forEach((el) => el.remove());

  // Field runs from 8.33% (left goal line) to 91.67% (right goal line)
  // That's 83.34% of width for 100 yards → each yard = 0.8334%
  const goalL = 8.33;
  const yardW = 83.34 / 100;

  // Yard lines every 5 yards, numbers every 10
  const yardLabels = [10, 20, 30, 40, 50, 40, 30, 20, 10];
  for (let y = 5; y <= 95; y += 5) {
    const pct = goalL + y * yardW;

    // Yard line
    const line = document.createElement("div");
    line.className = "tac-fb-yard-line" + (y === 50 ? " is-fifty" : "");
    line.style.left = `${pct}%`;
    field.appendChild(line);

    // Yard number every 10 yards (skip goal lines)
    if (y % 10 === 0 && y >= 10 && y <= 90) {
      const num = yardLabels[Math.round(y / 10) - 1];
      // Top number
      const top = document.createElement("span");
      top.className = "tac-fb-yard-num is-top";
      top.style.left = `${pct}%`;
      top.style.transform = "translateX(-50%)";
      top.textContent = num;
      field.appendChild(top);
      // Bottom number (upside-down on a real field, but we keep it readable)
      const bot = document.createElement("span");
      bot.className = "tac-fb-yard-num is-bot";
      bot.style.left = `${pct}%`;
      bot.style.transform = "translateX(-50%)";
      bot.textContent = num;
      field.appendChild(bot);
    }

    // Hash marks between each 5-yard line at ~33% and ~67% from top
    if (y % 5 === 0) {
      for (const topPct of [30, 70]) {
        const hash = document.createElement("div");
        hash.className = "tac-fb-hash";
        hash.style.left = `${pct - 0.3}%`;
        hash.style.top = `${topPct}%`;
        field.appendChild(hash);
      }
    }
  }
}

function renderTacBoard() {
  const field = $("#tac-field");
  if (!field) return;

  // Clear existing players
  field.querySelectorAll(".tac-player").forEach((el) => el.remove());

  // Render sport-specific markings
  if (_tacSport.includes("football")) {
    renderFootballMarkings(field);
  } else {
    // Clean up football markings if switching sport
    field.querySelectorAll(".tac-fb-yard-line, .tac-fb-yard-num, .tac-fb-hash").forEach((el) => el.remove());
  }

  for (const p of _tacPlayers) {
    const el = document.createElement("div");
    el.className = "tac-player";
    el.dataset.playerId = p.id;
    el.style.left = `${p.x}%`;
    el.style.top = `${p.y}%`;
    el.innerHTML = `
      ${esc(p.label || "?")}
      <span class="tac-player-label">${esc(p.role || "")}</span>
      <button class="tac-player-remove" data-tac-remove="${p.id}">&times;</button>`;
    field.appendChild(el);
  }

  // Setup drag (only once)
  if (!field._tacDragBound) {
    setupTacDrag(field);
    field._tacDragBound = true;
  }
}

function setupTacDrag(field) {
  // Pointer events for drag
  field.addEventListener("pointerdown", (e) => {
    const player = e.target.closest(".tac-player");
    if (e.target.closest(".tac-player-remove")) return; // Don't drag on remove button
    if (!player) return;

    e.preventDefault();
    player.setPointerCapture(e.pointerId);
    player.classList.add("is-dragging");
    _tacDragging = player.dataset.playerId;
  });

  field.addEventListener("pointermove", (e) => {
    if (!_tacDragging) return;
    const rect = field.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    const player = _tacPlayers.find((p) => p.id === _tacDragging);
    if (player) {
      player.x = Math.round(x * 10) / 10;
      player.y = Math.round(y * 10) / 10;
    }

    const el = field.querySelector(`[data-player-id="${_tacDragging}"]`);
    if (el) {
      el.style.left = `${x}%`;
      el.style.top = `${y}%`;
    }
  });

  field.addEventListener("pointerup", () => {
    if (_tacDragging) {
      const el = field.querySelector(`[data-player-id="${_tacDragging}"]`);
      if (el) el.classList.remove("is-dragging");
      _tacDragging = null;
    }
  });
}

function tacAddPlayer() {
  const id = `p${Date.now()}`;
  const num = _tacPlayers.length + 1;
  _tacPlayers.push({ id, rosterId: null, x: 50, y: 50, label: String(num), role: `Player ${num}` });
  renderTacBoard();
}

function tacRemovePlayer(playerId) {
  _tacPlayers = _tacPlayers.filter((p) => p.id !== playerId);
  renderTacBoard();
}

function tacClearBoard() {
  _tacPlayers = [];
  renderTacBoard();
}

async function tacSave() {
  const teamId = $("#tac-team")?.value;
  if (!teamId) return;

  const name = $("#tac-name")?.value || "Untitled Formation";
  const notes = $("#tac-notes")?.value || "";
  const team = state.teams.find((t) => t.team_id === teamId);
  const sport = team?.sports?.name?.toLowerCase() || null;

  setStatus("tac-save-status", "Saving...");

  try {
    if (_tacCurrentId) {
      await updateFormation(_tacCurrentId, { name, layout_json: _tacPlayers, notes, sport });
    } else {
      const created = await createFormation({ teamId, coachId: state.appUserId, name, sport, layoutJson: _tacPlayers, notes });
      _tacCurrentId = created.formation_id;
    }

    // Refresh list
    _tacFormations = await loadFormations(teamId);
    const formSel = $("#tac-formation-select");
    if (formSel) {
      formSel.innerHTML = `<option value="">— New formation —</option>`
        + _tacFormations.map((f) => `<option value="${f.formation_id}"${f.formation_id === _tacCurrentId ? " selected" : ""}>${esc(f.name)}</option>`).join("");
    }
    const delBtn = $("#tac-delete-btn");
    if (delBtn) delBtn.style.display = _tacCurrentId ? "inline-flex" : "none";

    setStatus("tac-save-status", "Saved!");
  } catch (err) {
    setStatus("tac-save-status", err.message || "Failed to save.", true);
  }
}

async function tacDelete() {
  if (!_tacCurrentId) return;
  const teamId = $("#tac-team")?.value;
  try {
    await deleteFormation(_tacCurrentId);
    _tacCurrentId = null;
    _tacPlayers = [];
    const nameInput = $("#tac-name");
    if (nameInput) nameInput.value = "Untitled Formation";
    const notesInput = $("#tac-notes");
    if (notesInput) notesInput.value = "";
    if (teamId) {
      _tacFormations = await loadFormations(teamId);
      const formSel = $("#tac-formation-select");
      if (formSel) {
        formSel.innerHTML = `<option value="">— New formation —</option>`
          + _tacFormations.map((f) => `<option value="${f.formation_id}">${esc(f.name)}</option>`).join("");
      }
    }
    const delBtn = $("#tac-delete-btn");
    if (delBtn) delBtn.style.display = "none";
    renderTacBoard();
  } catch (err) {
    console.error("Failed to delete formation:", err);
  }
}

function renderAll() {
  renderOverview();
  renderTeamsList();
  renderAllTrainings();
  renderAllMatches();
  renderStatsTeamDropdown();
  renderAttTeamDropdown();
  renderTacTeamDropdown();
}

// ── Bind forms + events ───────────────────────────────────────
function bindForms() {
  // Training form (main page)
  guardedSubmit("coach-training-form", "coach-training-form-status", async () => {
    const teamId = $("#training-team")?.value;
    if (!teamId) throw new Error("Please select a team.");
    await createTraining({
      teamId,
      title: $("#training-title")?.value || "Practice",
      description: $("#training-desc")?.value || "",
      trainingDate: $("#training-date")?.value,
      startTime: $("#training-start")?.value || null,
      endTime: $("#training-end")?.value || null,
      location: $("#training-location")?.value || null,
      type: $("#training-type")?.value || "practice",
      createdBy: state.appUserId,
    });
    await reloadTrainings();
    renderAllTrainings();
    renderOverview();
  });

  // Team detail training form
  guardedSubmit("coach-td-training-form", "coach-td-training-status", async () => {
    if (!state.viewingTeamId) throw new Error("No team selected.");
    await createTraining({
      teamId: state.viewingTeamId,
      title: $("#coach-td-train-title")?.value || "Practice",
      trainingDate: $("#coach-td-train-date")?.value,
      startTime: $("#coach-td-train-start")?.value || null,
      endTime: $("#coach-td-train-end")?.value || null,
      location: $("#coach-td-train-location")?.value || null,
      type: $("#coach-td-train-type")?.value || "practice",
      createdBy: state.appUserId,
    });
    state.teamTrainings = await loadTrainings(state.viewingTeamId);
    renderTeamDetailTrainings();
    await reloadTrainings();
    renderOverview();
  });

  // Click handlers
  document.addEventListener("click", async (e) => {
    const target = e.target;

    // Open team detail
    const openTeam = target.closest("[data-open-team]");
    if (openTeam) {
      await openTeamDetail(openTeam.dataset.openTeam);
      return;
    }

    // Back to teams
    if (target.closest("#coach-team-detail-back")) {
      state.viewingTeamId = "";
      switchSection("my-teams");
      return;
    }

    // Calendar nav
    const calStep = target.closest("[data-cal-step]");
    if (calStep) {
      const step = Number(calStep.dataset.calStep);
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + step, 1);
      renderCalendar();
      return;
    }

    // Add athlete to roster
    if (target.closest("#coach-td-add-btn")) {
      const select = $("#coach-td-add-athlete");
      const athleteId = select?.value;
      const jerseyNumber = $("#coach-td-add-jersey")?.value?.trim() || null;
      const position = $("#coach-td-add-position")?.value?.trim() || null;
      if (!athleteId || !state.viewingTeamId) return;
      try {
        await addToRoster({ teamId: state.viewingTeamId, athleteId, jerseyNumber, position });
        state.teamRoster = await loadRoster(state.viewingTeamId);
        renderTeamDetailRoster();
        setStatus("coach-td-roster-status", "");
      } catch (err) {
        setStatus("coach-td-roster-status", err.message || "Failed to add athlete.", true);
      }
      return;
    }

    // Remove from roster
    const removeRoster = target.closest("[data-remove-roster]");
    if (removeRoster) {
      try {
        await removeFromRoster(removeRoster.dataset.removeRoster);
        state.teamRoster = await loadRoster(state.viewingTeamId);
        renderTeamDetailRoster();
      } catch (err) {
        console.error("Remove roster failed:", err);
      }
      return;
    }

    // Delete training
    const deleteTrain = target.closest("[data-delete-training]");
    if (deleteTrain) {
      try {
        await deleteTraining(deleteTrain.dataset.deleteTraining);
        if (state.viewingTeamId) {
          state.teamTrainings = await loadTrainings(state.viewingTeamId);
          renderTeamDetailTrainings();
        }
        await reloadTrainings();
        renderAllTrainings();
        renderOverview();
      } catch (err) {
        console.error("Delete training failed:", err);
      }
      return;
    }

    // Save stats button
    if (target.closest("#stats-save-btn")) {
      void saveAllStats();
      return;
    }
  });

  // Stats tab dropdowns
  const statsTeam = $("#stats-team");
  if (statsTeam) statsTeam.addEventListener("change", () => void onStatsTeamChange());
  const statsMatch = $("#stats-match");
  if (statsMatch) statsMatch.addEventListener("change", () => void onStatsMatchChange());

  // ── Attendance bindings ───────────────────────────────────
  const attTeam = $("#att-team");
  if (attTeam) attTeam.addEventListener("change", () => void onAttTeamChange());
  const attEventType = $("#att-event-type");
  if (attEventType) attEventType.addEventListener("change", () => {
    const teamId = $("#att-team")?.value;
    if (teamId) void refreshAttEventList(teamId);
  });
  const attEvent = $("#att-event");
  if (attEvent) attEvent.addEventListener("change", () => void onAttEventChange());

  // Attendance status buttons + save
  document.addEventListener("click", (e) => {
    const attBtn = e.target.closest("[data-att-status]");
    if (attBtn) {
      const athleteId = attBtn.dataset.attAthlete;
      const status = attBtn.dataset.attStatus;
      _attRecords[athleteId] = status;
      // Update UI
      const row = attBtn.closest(".att-row");
      if (row) {
        row.querySelectorAll(".att-status-btn").forEach((b) => {
          b.className = "att-status-btn" + (b.dataset.attStatus === status ? ` is-${status}` : "");
        });
      }
      return;
    }
    if (e.target.closest("#att-save-btn")) {
      void saveAttendance();
      return;
    }
  });

  // ── Roster role tag bindings ──────────────────────────────
  document.addEventListener("click", async (e) => {
    const capBtn = e.target.closest("[data-toggle-captain]");
    if (capBtn) {
      const rosterId = capBtn.dataset.toggleCaptain;
      const current = capBtn.dataset.current === "true";
      try {
        await updateRosterEntry(rosterId, { is_captain: !current });
        state.teamRoster = await loadRoster(state.viewingTeamId);
        renderTeamDetailRosterEnhanced();
      } catch (err) { console.error(err); }
      return;
    }
    const startBtn = e.target.closest("[data-toggle-starter]");
    if (startBtn) {
      const rosterId = startBtn.dataset.toggleStarter;
      const current = startBtn.dataset.current === "true";
      try {
        await updateRosterEntry(rosterId, { is_starter: !current });
        state.teamRoster = await loadRoster(state.viewingTeamId);
        renderTeamDetailRosterEnhanced();
      } catch (err) { console.error(err); }
      return;
    }
    const notesBtn = e.target.closest("[data-open-notes]");
    if (notesBtn) {
      const athleteId = notesBtn.dataset.openNotes;
      const athleteName = notesBtn.dataset.athleteName;
      void openPlayerNotesModal(athleteId, athleteName, state.viewingTeamId);
      return;
    }
  });

  // ── Tactical board bindings ───────────────────────────────
  const tacTeam = $("#tac-team");
  if (tacTeam) tacTeam.addEventListener("change", () => void onTacTeamChange());
  const tacFormSel = $("#tac-formation-select");
  if (tacFormSel) tacFormSel.addEventListener("change", () => onTacFormationSelect());

  document.addEventListener("click", (e) => {
    if (e.target.closest("#tac-add-player")) { tacAddPlayer(); return; }
    if (e.target.closest("#tac-clear-board")) { tacClearBoard(); return; }
    if (e.target.closest("#tac-save-btn")) { void tacSave(); return; }
    if (e.target.closest("#tac-delete-btn")) { void tacDelete(); return; }
    if (e.target.closest("#tac-new-btn")) {
      _tacCurrentId = null;
      _tacPlayers = [];
      const nameInput = $("#tac-name");
      if (nameInput) nameInput.value = "Untitled Formation";
      const notesInput = $("#tac-notes");
      if (notesInput) notesInput.value = "";
      const formSel = $("#tac-formation-select");
      if (formSel) formSel.value = "";
      const delBtn = $("#tac-delete-btn");
      if (delBtn) delBtn.style.display = "none";
      renderTacBoard();
      return;
    }
    const tacRemove = e.target.closest("[data-tac-remove]");
    if (tacRemove) { tacRemovePlayer(tacRemove.dataset.tacRemove); return; }
  });
}

async function reloadTrainings() {
  const teamIds = state.teams.map((t) => t.team_id);
  state.allTrainings = await loadTrainingsByTeams(teamIds);
}

// ── Init ──────────────────────────────────────────────────────
async function initCoachDashboard() {
  if (state.initializing || state.initialized) return;
  state.initializing = true;

  try {
    await resolveCoachContext();
    await loadAllData();
    renderAll();
    initSectionNav();
    bindForms();
    state.initialized = true;
  } catch (err) {
    console.error("Coach dashboard init failed:", err);
    const status = $("#coach-status");
    if (status) {
      status.textContent = err.message || "Failed to load coach dashboard.";
      status.classList.add("is-error");
    }
  } finally {
    state.initializing = false;
  }
}

// ── Bootstrap ─────────────────────────────────────────────────
function shouldInit() {
  return document.body?.dataset.page === "coach-dashboard";
}

if (shouldInit()) {
  window.addEventListener("session-ready", () => void initCoachDashboard());
  window.addEventListener("ua-app-state-change", () => void initCoachDashboard());
  void initCoachDashboard();
}

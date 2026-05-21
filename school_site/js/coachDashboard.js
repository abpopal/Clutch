import { supabase } from "./supabaseClient.js";
import { getGlobalAppState, normalizeRole } from "./roleUtils.js";
import {
  loadCoachTeams, loadCoachSchoolId,
  loadRoster, addToRoster, removeFromRoster,
  loadMatches,
  loadSchoolMembers,
  loadTrainings, loadTrainingsByTeams, createTraining, deleteTraining,
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
  if (n.includes("basketball")) return "🏀";
  if (n.includes("football")) return "🏈";
  if (n.includes("soccer")) return "⚽";
  if (n.includes("baseball")) return "⚾";
  if (n.includes("track")) return "🏃";
  if (n.includes("tennis")) return "🎾";
  if (n.includes("swim")) return "🏊";
  if (n.includes("volleyball")) return "🏐";
  return "🏅";
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

  renderTeamDetailRoster();

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
      <div style="font-size:1.1rem;flex-shrink:0">📋</div>
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
function renderAll() {
  renderOverview();
  renderTeamsList();
  renderAllTrainings();
  renderAllMatches();
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
      if (!athleteId || !state.viewingTeamId) return;
      try {
        await addToRoster({ teamId: state.viewingTeamId, athleteId });
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

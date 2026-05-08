import { supabase } from "./supabaseClient.js";
import { getGlobalAppState, isSchoolAdmin, normalizeRole } from "./roleUtils.js";
import { loadPendingSchoolRequests, reviewSchoolJoinRequest } from "./schoolApprovalStore.js?v=20260418a";
import { assignSchoolTeamMember, createSchoolTeam, loadSchoolTeamWorkspace } from "./schoolTeamStore.js?v=20260418a";
import { createSchoolMatch, loadMatchNotificationCount, loadSchoolMatches, saveSchoolMatchResult } from "./schoolMatchStore.js?v=20260418b";
import { assignTeamToLeague, buildLeagueStandings, createSchoolLeague, loadSchoolLeagueWorkspace } from "./schoolLeagueStore.js?v=20260418b";
import { createSchoolPost, loadSchoolPosts } from "./schoolPostStore.js?v=20260418a";

const NAV_ITEMS = [
  { id: "overview", title: "Overview", target: "#school-section-overview" },
  { id: "athletes", title: "Athletes", target: "#school-section-athletes" },
  { id: "coaches", title: "Coaches", target: "#school-section-coaches" },
  { id: "teams", title: "Teams", target: "#school-section-teams" },
  { id: "matches", title: "Matches", target: "#school-section-matches" },
  { id: "leagues", title: "Leagues", target: "#school-section-leagues" },
  { id: "media", title: "Media", target: "#school-section-media" },
];

const state = {
  initialized: false,
  schoolId: "",
  schoolName: "Untitled Athletics School",
  pendingAthletes: [],
  pendingCoaches: [],
  teams: [],
  athletePool: [],
  coachPool: [],
  matches: [],
  leagues: [],
  schoolPosts: [],
  schoolUserId: "",
};

const statusEl = document.querySelector("#school-dashboard-status");
const subtitleEl = document.querySelector("#school-dashboard-subtitle");
const teamStatusEl = document.querySelector("#school-team-status");
const matchStatusEl = document.querySelector("#school-match-status");
const leagueStatusEl = document.querySelector("#school-league-status");
const postStatusEl = document.querySelector("#school-post-status");

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function setTeamStatus(message, isError = false) {
  if (!teamStatusEl) return;
  teamStatusEl.textContent = message;
  teamStatusEl.classList.toggle("is-error", isError);
}

function setMatchStatus(message, isError = false) {
  if (!matchStatusEl) return;
  matchStatusEl.textContent = message;
  matchStatusEl.classList.toggle("is-error", isError);
}

function setLeagueStatus(message, isError = false) {
  if (!leagueStatusEl) return;
  leagueStatusEl.textContent = message;
  leagueStatusEl.classList.toggle("is-error", isError);
}

function setPostStatus(message, isError = false) {
  if (!postStatusEl) return;
  postStatusEl.textContent = message;
  postStatusEl.classList.toggle("is-error", isError);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderList(targetId, rows, emptyLabel) {
  const container = document.querySelector(targetId);
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div class="pp-empty">${escapeHtml(emptyLabel)}</div>`;
    return;
  }
  container.innerHTML = rows.map((row) => `
    <div class="pp-list-row">
      <strong>${escapeHtml(row.title)}</strong>
      ${row.meta ? `<span>${escapeHtml(row.meta)}</span>` : ""}
      ${row.detail ? `<small>${escapeHtml(row.detail)}</small>` : ""}
    </div>
  `).join("");
}

function renderRequestList(targetId, requests, emptyLabel) {
  const container = document.querySelector(targetId);
  if (!container) return;
  if (!requests.length) {
    container.innerHTML = `<div class="pp-empty">${escapeHtml(emptyLabel)}</div>`;
    return;
  }
  container.innerHTML = requests.map((request) => `
    <div class="pp-list-row school-request-row">
      <strong>${escapeHtml(request.display_name || "Pending member")}</strong>
      <span>${escapeHtml(request.email || "Email unavailable")}</span>
      <small>${escapeHtml(`Requested ${new Date(request.requested_at || Date.now()).toLocaleString()}`)}</small>
      <div class="school-request-actions">
        <button type="button" class="pp-btn pp-btn--primary" data-school-request-action="approve" data-school-request-id="${escapeHtml(request.request_id || "")}">Approve</button>
        <button type="button" class="pp-link-btn" data-school-request-action="reject" data-school-request-id="${escapeHtml(request.request_id || "")}">Reject</button>
      </div>
    </div>
  `).join("");
}

function memberOptions(pool, selectedIds) {
  return pool
    .filter((item) => !selectedIds.has(item.userId))
    .map((item) => `<option value="${escapeHtml(item.userId)}">${escapeHtml(`${item.name}${item.meta ? ` • ${item.meta}` : ""}`)}</option>`)
    .join("");
}

function memberMarkup(member, fallback = "") {
  return `
    <div class="school-team-member">
      <strong>${escapeHtml(member?.name || fallback || "Team member")}</strong>
      ${member?.meta ? `<span>${escapeHtml(member.meta)}</span>` : ""}
      ${member?.email ? `<small>${escapeHtml(member.email)}</small>` : ""}
    </div>
  `;
}

function renderTeams() {
  const container = document.querySelector("#school-teams-list");
  if (!container) return;
  if (!state.teams.length) {
    container.innerHTML = `<div class="pp-empty">No teams have been created yet.</div>`;
    return;
  }

  container.innerHTML = state.teams.map((team) => {
    const selectedAthleteIds = new Set((team.athletes || []).map((member) => member.userId));
    const selectedCoachIds = new Set((team.coaches || []).map((member) => member.userId));
    return `
      <div class="pp-list-row school-team-card">
        <div>
          <strong>${escapeHtml(team.name)}</strong>
          <span>${escapeHtml(`${team.sport}${team.season ? ` • ${team.season}` : ""}`)}</span>
          <small>${escapeHtml(`${team.athletes?.length || 0} athletes • ${team.coaches?.length || 0} coaches`)}</small>
        </div>

        <div class="school-team-assignments">
          <div class="school-team-assignment">
            <div class="school-team-assignment-head">
              <strong>Athletes</strong>
              <span class="pp-chip">${escapeHtml(String(team.athletes?.length || 0))}</span>
            </div>
            <div class="school-team-assignment-controls">
              <select data-school-team-select="${escapeHtml(team.team_id)}" data-member-role="athlete">
                <option value="">Assign athlete</option>
                ${memberOptions(state.athletePool, selectedAthleteIds)}
              </select>
              <button type="button" class="pp-btn pp-btn--primary" data-school-team-assign="${escapeHtml(team.team_id)}" data-member-role="athlete">Assign</button>
            </div>
            <div class="school-team-member-list">
              ${(team.athletes || []).length
                ? team.athletes.map((member) => memberMarkup(member, "Assigned athlete")).join("")
                : `<div class="pp-empty">No athletes assigned yet.</div>`}
            </div>
          </div>

          <div class="school-team-assignment">
            <div class="school-team-assignment-head">
              <strong>Coaches</strong>
              <span class="pp-chip">${escapeHtml(String(team.coaches?.length || 0))}</span>
            </div>
            <div class="school-team-assignment-controls">
              <select data-school-team-select="${escapeHtml(team.team_id)}" data-member-role="coach">
                <option value="">Assign coach</option>
                ${memberOptions(state.coachPool, selectedCoachIds)}
              </select>
              <button type="button" class="pp-btn pp-btn--primary" data-school-team-assign="${escapeHtml(team.team_id)}" data-member-role="coach">Assign</button>
            </div>
            <div class="school-team-member-list">
              ${(team.coaches || []).length
                ? team.coaches.map((member) => memberMarkup(member, "Assigned coach")).join("")
                : `<div class="pp-empty">No coaches assigned yet.</div>`}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderMatchFormOptions() {
  const leagueSelect = document.querySelector("#school-match-league");
  const homeSelect = document.querySelector("#school-match-home-team");
  const awaySelect = document.querySelector("#school-match-away-team");
  if (
    !(leagueSelect instanceof HTMLSelectElement)
    || !(homeSelect instanceof HTMLSelectElement)
    || !(awaySelect instanceof HTMLSelectElement)
  ) return;
  leagueSelect.innerHTML = [
    `<option value="">Independent match</option>`,
    ...state.leagues.map((league) => `<option value="${escapeHtml(league.league_id)}">${escapeHtml(`${league.name} • ${league.sport}${league.season ? ` • ${league.season}` : ""}`)}</option>`),
  ].join("");
  const options = [
    `<option value="">Select team</option>`,
    ...state.teams.map((team) => `<option value="${escapeHtml(team.team_id)}">${escapeHtml(`${team.name} • ${team.sport}`)}</option>`),
  ].join("");
  homeSelect.innerHTML = options;
  awaySelect.innerHTML = options;
}

function teamLabel(teamId) {
  const team = state.teams.find((item) => item.team_id === teamId);
  if (!team) return "Unknown Team";
  return `${team.name}${team.sport ? ` • ${team.sport}` : ""}`;
}

function renderLeagues() {
  const container = document.querySelector("#school-leagues-list");
  if (!container) return;
  if (!state.leagues.length) {
    container.innerHTML = `<div class="pp-empty">No leagues have been created yet.</div>`;
    return;
  }

  const standingsByLeagueId = new Map(
    buildLeagueStandings({
      leagues: state.leagues,
      teams: state.teams,
      matches: state.matches,
    }).map((league) => [league.leagueId, league.standings])
  );

  container.innerHTML = state.leagues.map((league) => {
    const selectedTeamIds = new Set(league.team_ids || []);
    const assignableTeams = state.teams.filter((team) => (
      team.sport === league.sport && !selectedTeamIds.has(team.team_id)
    ));
    const standings = standingsByLeagueId.get(league.league_id) || [];
    const assignedTeams = (league.team_ids || []).map((teamId) => state.teams.find((team) => team.team_id === teamId)).filter(Boolean);

    return `
      <div class="pp-list-row school-league-card">
        <div>
          <strong>${escapeHtml(league.name)}</strong>
          <span>${escapeHtml(`${league.sport}${league.season ? ` • ${league.season}` : ""}`)}</span>
          <small>${escapeHtml(`${assignedTeams.length} teams • ${standings.filter((row) => row.played > 0).length} active in standings`)}</small>
        </div>

        <div class="school-league-panel">
          <div class="school-team-assignment">
            <div class="school-team-assignment-head">
              <strong>Teams</strong>
              <span class="pp-chip">${escapeHtml(String(assignedTeams.length))}</span>
            </div>
            <div class="school-team-assignment-controls">
              <select data-school-league-select="${escapeHtml(league.league_id)}">
                <option value="">Assign team</option>
                ${assignableTeams.map((team) => `<option value="${escapeHtml(team.team_id)}">${escapeHtml(`${team.name}${team.season ? ` • ${team.season}` : ""}`)}</option>`).join("")}
              </select>
              <button type="button" class="pp-btn pp-btn--primary" data-school-league-assign="${escapeHtml(league.league_id)}">Assign</button>
            </div>
            <div class="school-team-member-list">
              ${assignedTeams.length
                ? assignedTeams.map((team) => memberMarkup({ name: team.name, meta: `${team.sport}${team.season ? ` • ${team.season}` : ""}` }, "Assigned team")).join("")
                : `<div class="pp-empty">No teams assigned yet.</div>`}
            </div>
          </div>

          <div class="school-league-standings">
            <div class="school-team-assignment-head">
              <strong>Standings</strong>
              <span class="pp-chip">${escapeHtml(String(standings.length))}</span>
            </div>
            ${standings.length ? `
              <div class="school-league-table-wrap">
                <table class="school-league-table">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>P</th>
                      <th>W</th>
                      <th>D</th>
                      <th>L</th>
                      <th>Pts</th>
                      <th>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${standings.map((row) => `
                      <tr>
                        <td>${escapeHtml(row.teamName)}</td>
                        <td>${escapeHtml(String(row.played))}</td>
                        <td>${escapeHtml(String(row.wins))}</td>
                        <td>${escapeHtml(String(row.draws))}</td>
                        <td>${escapeHtml(String(row.losses))}</td>
                        <td>${escapeHtml(String(row.points))}</td>
                        <td>${escapeHtml(String(row.scoreDiff))}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : `<div class="pp-empty">Standings will populate when league matches are completed.</div>`}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderSchoolPosts() {
  const container = document.querySelector("#school-media-list");
  if (!container) return;
  if (!state.schoolPosts.length) {
    container.innerHTML = `<div class="pp-empty">No school posts have been published yet.</div>`;
    return;
  }

  container.innerHTML = state.schoolPosts.map((post) => {
    const media = Array.isArray(post.post_media) ? post.post_media[0] : null;
    const mediaMarkup = !media ? "" : media.media_type === "video"
      ? `
        <div class="school-post-preview">
          <video controls preload="metadata" src="${escapeHtml(media.media_url)}"></video>
        </div>
      `
      : `
        <div class="school-post-preview">
          <img src="${escapeHtml(media.media_url)}" alt="${escapeHtml(post.caption || "School post")}">
        </div>
      `;

    return `
      <div class="pp-list-row school-post-card">
        <div>
          <strong>${escapeHtml(post.caption || "Untitled school post")}</strong>
          <span>${escapeHtml(`${post.post_type || "media"} • ${post.visibility || "public"} • ${new Date(post.created_at || Date.now()).toLocaleString()}`)}</span>
        </div>
        ${mediaMarkup}
      </div>
    `;
  }).join("");
}

async function renderMatches() {
  const container = document.querySelector("#school-matches-list");
  if (!container) return;
  if (!state.matches.length) {
    container.innerHTML = `<div class="pp-empty">No matches are scheduled yet.</div>`;
    return;
  }

  const notificationCounts = await Promise.all(
    state.matches.map((match) => loadMatchNotificationCount({ matchId: match.match_id }))
  );

  container.innerHTML = state.matches.map((match, index) => {
    const scheduledAt = match.scheduled_at ? new Date(match.scheduled_at) : null;
    const resultSaved = Number.isFinite(Number(match.home_score)) && Number.isFinite(Number(match.away_score));
    const league = state.leagues.find((item) => item.league_id === match.league_id);
    return `
      <div class="pp-list-row school-match-card">
        <div>
          <strong>${escapeHtml(`${teamLabel(match.home_team_id)} vs ${teamLabel(match.away_team_id)}`)}</strong>
          <div class="school-match-meta">
            <span>${escapeHtml(scheduledAt ? scheduledAt.toLocaleString() : "Date pending")}</span>
            <span>${escapeHtml(match.status || "scheduled")}</span>
            <span>${escapeHtml(league ? `${league.name} league` : "Independent")}</span>
            <span>${escapeHtml(`${notificationCounts[index] || 0} notifications`)}</span>
          </div>
          ${resultSaved ? `<small class="school-match-notes">Result saved: ${escapeHtml(String(match.home_score))} - ${escapeHtml(String(match.away_score))}</small>` : `<small class="school-match-notes">No result saved yet.</small>`}
        </div>
        <div class="school-match-result">
          <input type="number" min="0" placeholder="Home" data-school-match-score-home="${escapeHtml(match.match_id)}" value="${resultSaved ? escapeHtml(String(match.home_score)) : ""}">
          <input type="number" min="0" placeholder="Away" data-school-match-score-away="${escapeHtml(match.match_id)}" value="${resultSaved ? escapeHtml(String(match.away_score)) : ""}">
          <button type="button" class="pp-btn pp-btn--primary" data-school-match-save="${escapeHtml(match.match_id)}">Save Result</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderMetrics(metrics) {
  const pairs = [
    ["#school-metric-athletes", metrics.athletes],
    ["#school-metric-coaches", metrics.coaches],
    ["#school-metric-teams", metrics.teams],
    ["#school-metric-matches", metrics.matches],
    ["#school-metric-leagues", metrics.leagues],
    ["#school-metric-media", metrics.media],
  ];

  pairs.forEach(([selector, value]) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = String(value);
  });

  const sectionCountEl = document.querySelector("#school-dashboard-section-count");
  if (sectionCountEl) sectionCountEl.textContent = String(NAV_ITEMS.length);

  const athletesChip = document.querySelector("#school-athletes-count-chip");
  if (athletesChip) athletesChip.textContent = `${metrics.athletes} pending`;

  const coachesChip = document.querySelector("#school-coaches-count-chip");
  if (coachesChip) coachesChip.textContent = `${metrics.coaches} pending`;

  const teamsChip = document.querySelector("#school-teams-count-chip");
  if (teamsChip) teamsChip.textContent = `${metrics.teams} teams`;

  const matchesChip = document.querySelector("#school-matches-count-chip");
  if (matchesChip) matchesChip.textContent = `${metrics.matches} matches`;

  const leaguesChip = document.querySelector("#school-leagues-count-chip");
  if (leaguesChip) leaguesChip.textContent = `${metrics.leagues} leagues`;

  const mediaChip = document.querySelector("#school-media-count-chip");
  if (mediaChip) mediaChip.textContent = `${metrics.media} posts`;
}

async function fetchSingle(query) {
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

function isMissingAuthColumn(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return ["PGRST204", "PGRST205", "42703"].includes(code)
    || message.includes("column")
    || message.includes("does not exist");
}

async function findUserByAuthId(authUserId) {
  for (const column of ["auth_uid", "firebase_uid"]) {
    try {
      const row = await fetchSingle(
        supabase.from("users").select("user_id").eq(column, authUserId)
      );
      if (row?.user_id) return row;
    } catch (error) {
      if (isMissingAuthColumn(error)) continue;
      throw error;
    }
  }
  return null;
}

async function ensureUserByAuthId(authUserId, role) {
  const existing = await findUserByAuthId(authUserId);
  if (existing?.user_id) return existing;

  for (const column of ["auth_uid", "firebase_uid"]) {
    try {
      const { data, error } = await supabase
        .from("users")
        .insert({ [column]: authUserId, role })
        .select("user_id")
        .single();
      if (!error && data?.user_id) return data;
      if (error?.code === "23505") {
        const retry = await findUserByAuthId(authUserId);
        if (retry?.user_id) return retry;
      }
      if (error) throw error;
    } catch (error) {
      if (isMissingAuthColumn(error)) continue;
      throw error;
    }
  }

  return null;
}

async function resolveSchoolContext() {
  // Get session directly from Supabase — don't depend on global app state
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session?.user?.id) {
    return { schoolId: "", schoolName: state.schoolName, appUserId: "" };
  }

  // Only look up the user — app.js handles user creation
  let userRow = await findUserByAuthId(session.user.id);

  const appUserId = userRow?.user_id || null;
  if (!appUserId) {
    return { schoolId: "", schoolName: state.schoolName, appUserId: "" };
  }

  // Find school for this user
  let schoolRow = await fetchSingle(
    supabase.from("schools").select("school_id,name").eq("user_id", appUserId)
  );

  // Auto-create school row if missing
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

function bindSectionNav() {
  const links = Array.from(document.querySelectorAll("[data-school-section-link]"));
  if (!links.length) return;

  function activate(id) {
    links.forEach((link) => {
      link.classList.toggle("is-active", link.dataset.schoolSectionLink === id);
    });
  }

  links.forEach((link) => {
    link.addEventListener("click", () => activate(link.dataset.schoolSectionLink || ""));
  });

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
    if (!visible?.target?.id) return;
    activate(visible.target.id.replace("school-section-", ""));
  }, {
    rootMargin: "-20% 0px -60% 0px",
    threshold: [0.2, 0.4, 0.6],
  });

  NAV_ITEMS.forEach((item) => {
    const section = document.querySelector(item.target);
    if (section) observer.observe(section);
  });
}

function buildStaticRows(schoolName) {
  return {
    media: [
      { title: "Spring Media Queue", meta: "12 pending assets", detail: "Highlight edits and team-day coverage" },
      { title: "Recruiting Spotlights", meta: "8 published this month", detail: "Athlete profile packages" },
      { title: "Game-Day Archive", meta: "46 clips indexed", detail: "Recent uploads and publishing requests" },
    ],
  };
}

async function loadPendingRequests() {
  if (!state.schoolId) {
    state.pendingAthletes = [];
    state.pendingCoaches = [];
    return;
  }
  const [athletes, coaches] = await Promise.all([
    loadPendingSchoolRequests({ schoolId: state.schoolId, requesterRole: "athlete" }),
    loadPendingSchoolRequests({ schoolId: state.schoolId, requesterRole: "coach" }),
  ]);
  state.pendingAthletes = athletes;
  state.pendingCoaches = coaches;
}

async function loadTeamWorkspace() {
  if (!state.schoolId) {
    state.teams = [];
    state.athletePool = [];
    state.coachPool = [];
    return;
  }
  const workspace = await loadSchoolTeamWorkspace({ schoolId: state.schoolId });
  state.teams = workspace.teams;
  state.athletePool = workspace.athletes;
  state.coachPool = workspace.coaches;
}

async function loadMatchWorkspace() {
  if (!state.schoolId) {
    state.matches = [];
    return;
  }
  state.matches = await loadSchoolMatches({ schoolId: state.schoolId });
}

async function loadLeagueWorkspace() {
  if (!state.schoolId) {
    state.leagues = [];
    return;
  }
  state.leagues = await loadSchoolLeagueWorkspace({ schoolId: state.schoolId });
}

async function loadSchoolPostWorkspace() {
  if (!state.schoolUserId) {
    state.schoolPosts = [];
    return;
  }
  state.schoolPosts = await loadSchoolPosts({ authorUserId: state.schoolUserId });
}

function renderGreeting() {
  const greetingEl = document.querySelector("#school-dashboard-greeting");
  if (!greetingEl) return;
  const hour = new Date().getHours();
  const timeLabel = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  greetingEl.textContent = `${timeLabel}, ${state.schoolName}`;
}

function renderActionChips() {
  const bar = document.querySelector("#school-action-bar");
  if (!bar) return;
  const chips = [];

  const pendingTotal = state.pendingAthletes.length + state.pendingCoaches.length;
  if (pendingTotal > 0) {
    chips.push(`
      <a class="sch-action-chip" href="#school-section-athletes">
        <span class="sch-action-dot red"></span>
        ${escapeHtml(pendingTotal)} pending request${pendingTotal > 1 ? "s" : ""}
      </a>
    `);
  }

  const scheduledMatches = state.matches.filter((m) => m.status === "scheduled");
  if (scheduledMatches.length > 0) {
    chips.push(`
      <a class="sch-action-chip" href="#school-section-matches">
        <span class="sch-action-dot amber"></span>
        ${escapeHtml(String(scheduledMatches.length))} upcoming match${scheduledMatches.length > 1 ? "es" : ""}
      </a>
    `);
  }

  if (state.teams.length > 0) {
    chips.push(`
      <a class="sch-action-chip" href="#school-section-teams">
        <span class="sch-action-dot green"></span>
        ${escapeHtml(String(state.teams.length))} active team${state.teams.length > 1 ? "s" : ""}
      </a>
    `);
  }

  bar.innerHTML = chips.length ? chips.join("") : "";
}

function renderUpcomingMatches() {
  const container = document.querySelector("#school-upcoming-matches");
  if (!container) return;

  const now = Date.now();
  const upcoming = state.matches
    .filter((m) => m.status === "scheduled" || m.status === "live")
    .sort((a, b) => new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0))
    .slice(0, 4);

  if (!upcoming.length) {
    container.innerHTML = `<div class="sch-empty">No upcoming matches.</div>`;
    return;
  }

  container.innerHTML = upcoming.map((match) => {
    const scheduledAt = match.scheduled_at ? new Date(match.scheduled_at) : null;
    const dateStr = scheduledAt
      ? scheduledAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      : "TBD";
    const timeStr = scheduledAt
      ? scheduledAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "";
    const badge = match.status === "live"
      ? `<span class="sch-match-badge live">LIVE</span>`
      : `<span class="sch-match-badge upcoming">Upcoming</span>`;
    return `
      <div class="sch-match-row">
        <div class="sch-match-time">${escapeHtml(dateStr)}<br>${escapeHtml(timeStr)}</div>
        <div class="sch-match-teams">
          ${escapeHtml(teamLabel(match.home_team_id))}
          <span>vs</span>
          ${escapeHtml(teamLabel(match.away_team_id))}
        </div>
        ${badge}
      </div>
    `;
  }).join("");
}

function renderRosterPreview() {
  const table = document.querySelector("#school-roster-preview");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  // Gather athletes from all teams (deduplicated)
  const seen = new Set();
  const athletes = [];
  for (const team of state.teams) {
    for (const member of (team.athletes || [])) {
      if (seen.has(member.userId)) continue;
      seen.add(member.userId);
      athletes.push({ ...member, sport: team.sport, teamName: team.name });
    }
  }

  if (!athletes.length) {
    // Also show pending athletes as a fallback
    if (state.pendingAthletes.length) {
      tbody.innerHTML = state.pendingAthletes.slice(0, 5).map((req) => `
        <tr>
          <td>
            <div class="sch-avatar-name">
              <div class="sch-avatar-sm" style="background:var(--surface-3,#212b42);display:grid;place-items:center;font-size:.75rem">👤</div>
              <div>
                <strong>${escapeHtml(req.display_name || "Pending")}</strong>
                <small>${escapeHtml(req.email || "")}</small>
              </div>
            </div>
          </td>
          <td><span class="sch-sport-pill">Pending</span></td>
          <td>–</td>
          <td>–</td>
        </tr>
      `).join("");
    } else {
      tbody.innerHTML = `<tr><td colspan="4" class="sch-empty">No athletes on roster yet.</td></tr>`;
    }
    return;
  }

  tbody.innerHTML = athletes.slice(0, 5).map((a) => `
    <tr>
      <td>
        <div class="sch-avatar-name">
          <div class="sch-avatar-sm" style="background:var(--surface-3,#212b42);display:grid;place-items:center;font-size:.75rem">👤</div>
          <div>
            <strong>${escapeHtml(a.name || "Athlete")}</strong>
            <small>${escapeHtml(a.email || a.teamName || "")}</small>
          </div>
        </div>
      </td>
      <td><span class="sch-sport-pill">${escapeHtml(a.sport || "–")}</span></td>
      <td>${escapeHtml(a.meta || "–")}</td>
      <td>–</td>
    </tr>
  `).join("");
}

function renderActivityFeed() {
  const feed = document.querySelector("#school-activity-feed");
  if (!feed) return;
  const items = [];

  // Recent join requests
  for (const req of state.pendingAthletes.slice(0, 2)) {
    items.push({
      icon: "fi-join",
      emoji: "👤",
      text: `<strong>${escapeHtml(req.display_name || "Someone")}</strong> requested to join as an athlete`,
      time: req.requested_at,
    });
  }
  for (const req of state.pendingCoaches.slice(0, 1)) {
    items.push({
      icon: "fi-join",
      emoji: "🧑‍🏫",
      text: `<strong>${escapeHtml(req.display_name || "Someone")}</strong> requested to join as a coach`,
      time: req.requested_at,
    });
  }

  // Recent matches
  for (const match of state.matches.slice(0, 2)) {
    const resultSaved = Number.isFinite(Number(match.home_score)) && Number.isFinite(Number(match.away_score));
    if (resultSaved) {
      items.push({
        icon: "fi-match",
        emoji: "📅",
        text: `Match completed: <strong>${escapeHtml(teamLabel(match.home_team_id))}</strong> ${escapeHtml(String(match.home_score))} – ${escapeHtml(String(match.away_score))} <strong>${escapeHtml(teamLabel(match.away_team_id))}</strong>`,
        time: match.completed_at || match.scheduled_at,
      });
    } else {
      items.push({
        icon: "fi-match",
        emoji: "📅",
        text: `Match scheduled: <strong>${escapeHtml(teamLabel(match.home_team_id))}</strong> vs <strong>${escapeHtml(teamLabel(match.away_team_id))}</strong>`,
        time: match.scheduled_at || match.created_at,
      });
    }
  }

  // Recent posts
  for (const post of state.schoolPosts.slice(0, 2)) {
    items.push({
      icon: "fi-post",
      emoji: "📣",
      text: `New post: <strong>${escapeHtml(post.caption || "Untitled")}</strong>`,
      time: post.created_at,
    });
  }

  // Sort by most recent
  items.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

  if (!items.length) {
    feed.innerHTML = `<div class="sch-empty">No recent activity.</div>`;
    return;
  }

  feed.innerHTML = items.slice(0, 6).map((item) => {
    const timeAgo = item.time ? formatTimeAgo(new Date(item.time)) : "";
    return `
      <div class="sch-feed-item">
        <div class="sch-feed-icon ${escapeHtml(item.icon)}">${item.emoji}</div>
        <div>
          <div class="sch-feed-text">${item.text}</div>
          <div class="sch-feed-time">${escapeHtml(timeAgo)}</div>
        </div>
      </div>
    `;
  }).join("");
}

function formatTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function renderDashboard() {
  const staticRows = buildStaticRows(state.schoolName);
  renderGreeting();
  renderActionChips();
  renderMetrics({
    athletes: state.pendingAthletes.length,
    coaches: state.pendingCoaches.length,
    teams: state.teams.length,
    matches: state.matches.length,
    leagues: state.leagues.length,
    media: state.schoolPosts.length,
  });
  renderRequestList("#school-athletes-list", state.pendingAthletes, "No pending athlete requests.");
  renderRequestList("#school-coaches-list", state.pendingCoaches, "No pending coach requests.");
  renderTeams();
  renderMatchFormOptions();
  await renderMatches();
  renderLeagues();
  renderSchoolPosts();
  renderUpcomingMatches();
  renderRosterPreview();
  renderActivityFeed();
}

async function refreshSchoolData() {
  await Promise.all([
    loadPendingRequests(),
    loadTeamWorkspace(),
    loadMatchWorkspace(),
    loadLeagueWorkspace(),
    loadSchoolPostWorkspace(),
  ]);
  await renderDashboard();
}

function bindRequestEvents(auth) {
  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const requestButton = target.closest("[data-school-request-action]");
    if (requestButton) {
      const requestId = requestButton.getAttribute("data-school-request-id") || "";
      const action = requestButton.getAttribute("data-school-request-action") || "";
      if (!requestId || !["approve", "reject"].includes(action)) return;

      requestButton.setAttribute("disabled", "true");
      try {
        await reviewSchoolJoinRequest({
          requestId,
          decision: action,
          reviewedByUserId: auth?.appUserId || "",
        });
        await refreshSchoolData();
        setStatus(`${action === "approve" ? "Approved" : "Rejected"} request successfully.`);
      } catch (error) {
        console.error("School request review failed", error);
        setStatus(error.message || "Unable to review request.", true);
      } finally {
        requestButton.removeAttribute("disabled");
      }
      return;
    }

    const assignButton = target.closest("[data-school-team-assign]");
    if (assignButton) {
      const teamId = assignButton.getAttribute("data-school-team-assign") || "";
      const memberRole = assignButton.getAttribute("data-member-role") || "";
      const select = document.querySelector(`[data-school-team-select="${CSS.escape(teamId)}"][data-member-role="${CSS.escape(memberRole)}"]`);
      const userId = select instanceof HTMLSelectElement ? select.value : "";
      if (!teamId || !memberRole || !userId) {
        setTeamStatus("Choose a member before assigning.", true);
        return;
      }

      assignButton.setAttribute("disabled", "true");
      try {
        await assignSchoolTeamMember({ teamId, userId, memberRole });
        await loadTeamWorkspace();
        await renderDashboard();
        setTeamStatus(`${memberRole === "athlete" ? "Athlete" : "Coach"} assigned successfully.`);
      } catch (error) {
        console.error("Team assignment failed", error);
        setTeamStatus(error.message || "Unable to assign team member.", true);
      } finally {
        assignButton.removeAttribute("disabled");
      }
      return;
    }

    const assignLeagueButton = target.closest("[data-school-league-assign]");
    if (assignLeagueButton) {
      const leagueId = assignLeagueButton.getAttribute("data-school-league-assign") || "";
      const select = document.querySelector(`[data-school-league-select="${CSS.escape(leagueId)}"]`);
      const teamId = select instanceof HTMLSelectElement ? select.value : "";
      if (!leagueId || !teamId) {
        setLeagueStatus("Choose a team before assigning it to a league.", true);
        return;
      }

      assignLeagueButton.setAttribute("disabled", "true");
      try {
        await assignTeamToLeague({ leagueId, teamId });
        await loadLeagueWorkspace();
        await renderDashboard();
        setLeagueStatus("Team assigned to league.");
      } catch (error) {
        console.error("League assignment failed", error);
        setLeagueStatus(error.message || "Unable to assign team to league.", true);
      } finally {
        assignLeagueButton.removeAttribute("disabled");
      }
      return;
    }

    const saveMatchButton = target.closest("[data-school-match-save]");
    if (!saveMatchButton) return;

    const matchId = saveMatchButton.getAttribute("data-school-match-save") || "";
    const homeInput = document.querySelector(`[data-school-match-score-home="${CSS.escape(matchId)}"]`);
    const awayInput = document.querySelector(`[data-school-match-score-away="${CSS.escape(matchId)}"]`);
    const homeScore = homeInput instanceof HTMLInputElement ? homeInput.value : "";
    const awayScore = awayInput instanceof HTMLInputElement ? awayInput.value : "";
    if (!matchId || homeScore === "" || awayScore === "") {
      setMatchStatus("Enter both scores before saving a result.", true);
      return;
    }

    saveMatchButton.setAttribute("disabled", "true");
    try {
      await saveSchoolMatchResult({ matchId, homeScore, awayScore });
      await loadMatchWorkspace();
      await renderDashboard();
      setMatchStatus("Match result saved.");
    } catch (error) {
      console.error("Match result save failed", error);
      setMatchStatus(error.message || "Unable to save match result.", true);
    } finally {
      saveMatchButton.removeAttribute("disabled");
    }
  });
}

function bindTeamForm() {
  const form = document.querySelector("#school-team-form");
  if (!(form instanceof HTMLFormElement)) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nameInput = document.querySelector("#school-team-name");
    const sportInput = document.querySelector("#school-team-sport");
    const seasonInput = document.querySelector("#school-team-season");
    const name = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : "";
    const sport = (sportInput instanceof HTMLInputElement || sportInput instanceof HTMLSelectElement) ? sportInput.value.trim() : "";
    const season = seasonInput instanceof HTMLInputElement ? seasonInput.value.trim() : "";

    if (!state.schoolId) {
      setTeamStatus("No school is linked to this dashboard.", true);
      return;
    }
    if (!name || !sport) {
      setTeamStatus("Team name and sport are required.", true);
      return;
    }

    try {
      setTeamStatus("Creating team…");
      await createSchoolTeam({
        schoolId: state.schoolId,
        name,
        sport,
        season,
      });
      await loadTeamWorkspace();
      await renderDashboard();
      form.reset();
      setTeamStatus(`Created ${name}.`);
    } catch (error) {
      console.error("Team creation failed", error);
      setTeamStatus(error.message || "Unable to create team.", true);
    }
  });
}

function bindMatchForm() {
  const form = document.querySelector("#school-match-form");
  if (!(form instanceof HTMLFormElement)) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const leagueSelect = document.querySelector("#school-match-league");
    const homeSelect = document.querySelector("#school-match-home-team");
    const awaySelect = document.querySelector("#school-match-away-team");
    const dateInput = document.querySelector("#school-match-datetime");
    const leagueId = leagueSelect instanceof HTMLSelectElement ? leagueSelect.value.trim() : "";
    const homeTeamId = homeSelect instanceof HTMLSelectElement ? homeSelect.value.trim() : "";
    const awayTeamId = awaySelect instanceof HTMLSelectElement ? awaySelect.value.trim() : "";
    const scheduledAt = dateInput instanceof HTMLInputElement ? dateInput.value.trim() : "";

    if (!state.schoolId) {
      setMatchStatus("No school is linked to this dashboard.", true);
      return;
    }
    if (!homeTeamId || !awayTeamId || !scheduledAt) {
      setMatchStatus("Two teams and a date/time are required.", true);
      return;
    }
    if (homeTeamId === awayTeamId) {
      setMatchStatus("Choose two different teams for the match.", true);
      return;
    }
    if (leagueId) {
      const league = state.leagues.find((item) => item.league_id === leagueId);
      const allowedTeams = new Set(league?.team_ids || []);
      if (!league) {
        setMatchStatus("Selected league could not be found.", true);
        return;
      }
      if (!allowedTeams.has(homeTeamId) || !allowedTeams.has(awayTeamId)) {
        setMatchStatus("League matches must use teams already assigned to that league.", true);
        return;
      }
    }

    try {
      setMatchStatus("Creating match…");
      const { notificationCount } = await createSchoolMatch({
        schoolId: state.schoolId,
        homeTeamId,
        awayTeamId,
        leagueId,
        scheduledAt: new Date(scheduledAt).toISOString(),
      });
      await loadMatchWorkspace();
      await renderDashboard();
      form.reset();
      setMatchStatus(`Match created and ${notificationCount} notifications queued.`);
    } catch (error) {
      console.error("Match creation failed", error);
      setMatchStatus(error.message || "Unable to create match.", true);
    }
  });
}

function bindLeagueForm() {
  const form = document.querySelector("#school-league-form");
  if (!(form instanceof HTMLFormElement)) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nameInput = document.querySelector("#school-league-name");
    const sportInput = document.querySelector("#school-league-sport");
    const seasonInput = document.querySelector("#school-league-season");
    const name = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : "";
    const sport = (sportInput instanceof HTMLInputElement || sportInput instanceof HTMLSelectElement) ? sportInput.value.trim() : "";
    const season = seasonInput instanceof HTMLInputElement ? seasonInput.value.trim() : "";

    if (!state.schoolId) {
      setLeagueStatus("No school is linked to this dashboard.", true);
      return;
    }
    if (!name || !sport) {
      setLeagueStatus("League name and sport are required.", true);
      return;
    }

    try {
      setLeagueStatus("Creating league…");
      await createSchoolLeague({
        schoolId: state.schoolId,
        name,
        sport,
        season,
      });
      await loadLeagueWorkspace();
      await renderDashboard();
      form.reset();
      setLeagueStatus(`Created ${name}.`);
    } catch (error) {
      console.error("League creation failed", error);
      setLeagueStatus(error.message || "Unable to create league.", true);
    }
  });
}

function bindPostForm() {
  const form = document.querySelector("#school-post-form");
  if (!(form instanceof HTMLFormElement)) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const captionInput = document.querySelector("#school-post-caption");
    const mediaTypeInput = document.querySelector("#school-post-media-type");
    const mediaUrlInput = document.querySelector("#school-post-media-url");
    const visibilityInput = document.querySelector("#school-post-visibility");
    const caption = captionInput instanceof HTMLTextAreaElement ? captionInput.value.trim() : "";
    const mediaType = mediaTypeInput instanceof HTMLSelectElement ? mediaTypeInput.value.trim() : "";
    const mediaUrl = mediaUrlInput instanceof HTMLInputElement ? mediaUrlInput.value.trim() : "";
    const visibility = visibilityInput instanceof HTMLSelectElement ? visibilityInput.value.trim() : "public";

    if (!state.schoolUserId) {
      setPostStatus("No school user is linked to this dashboard.", true);
      return;
    }
    if (!caption || !mediaType || !mediaUrl) {
      setPostStatus("Caption, media type, and media URL are required.", true);
      return;
    }

    try {
      setPostStatus("Publishing school post…");
      await createSchoolPost({
        authorUserId: state.schoolUserId,
        caption,
        mediaType,
        mediaUrl,
        visibility,
      });
      await loadSchoolPostWorkspace();
      await renderDashboard();
      form.reset();
      setPostStatus("School post published.");
    } catch (error) {
      console.error("School post publish failed", error);
      setPostStatus(error.message || "Unable to publish school post.", true);
    }
  });
}

/* ── Teams Modal ───────────────────────────────────────────────── */
function openTeamsModal() {
  const modal = document.querySelector("#school-teams-modal");
  const body = document.querySelector("#school-teams-modal-body");
  if (!modal || !body) return;

  if (!state.teams.length) {
    body.innerHTML = `<div class="sch-empty">No teams have been created yet.<br><a class="sch-btn sch-btn--primary sch-btn--sm" href="#school-section-teams" style="margin-top:12px;display:inline-flex" onclick="document.querySelector('#school-teams-modal').classList.remove('is-open')">Create a Team</a></div>`;
  } else {
    body.innerHTML = state.teams.map((team) => {
      const athleteCount = team.athletes?.length || 0;
      const coachCount = team.coaches?.length || 0;
      return `
        <div class="sch-modal-team">
          <div class="sch-modal-team-icon">🏆</div>
          <div class="sch-modal-team-info">
            <div class="sch-modal-team-name">${escapeHtml(team.name)}</div>
            <div class="sch-modal-team-meta">${escapeHtml(team.sport)}${team.season ? ` · ${escapeHtml(team.season)}` : ""}</div>
          </div>
          <div class="sch-modal-team-stats">
            <div class="sch-modal-team-stat">
              <div class="sch-modal-team-stat-val">${escapeHtml(String(athleteCount))}</div>
              <div class="sch-modal-team-stat-label">Athletes</div>
            </div>
            <div class="sch-modal-team-stat">
              <div class="sch-modal-team-stat-val">${escapeHtml(String(coachCount))}</div>
              <div class="sch-modal-team-stat-label">Coaches</div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  modal.classList.add("is-open");
}

function closeTeamsModal() {
  const modal = document.querySelector("#school-teams-modal");
  if (modal) modal.classList.remove("is-open");
}

function bindTeamsModal() {
  // Close button
  const closeBtn = document.querySelector("#school-teams-modal-close");
  if (closeBtn) closeBtn.addEventListener("click", closeTeamsModal);

  // Click overlay to close
  const overlay = document.querySelector("#school-teams-modal");
  if (overlay) overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeTeamsModal();
  });

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTeamsModal();
  });

  // Open from stat card
  const statCard = document.querySelector("#school-stat-teams-card");
  if (statCard) statCard.addEventListener("click", openTeamsModal);

  // Open from "View All" button
  const viewAllBtn = document.querySelector("#school-view-all-teams-btn");
  if (viewAllBtn) viewAllBtn.addEventListener("click", openTeamsModal);
}

async function initSchoolDashboard() {
  const auth = getGlobalAppState().auth;
  if (!auth?.session && !auth?.authUser) return;

  if (!isSchoolAdmin(auth)) {
    window.location.replace("index.html");
    return;
  }

  if (state.initialized) return;

  try {
    setStatus("Loading school dashboard…");
    const context = await resolveSchoolContext();
    state.schoolId = context.schoolId;
    state.schoolName = context.schoolName;
    state.schoolUserId = context.appUserId;

    if (subtitleEl) {
      subtitleEl.textContent = `Manage athletes, staff, teams, and schedule for ${state.schoolName}.`;
    }

    await refreshSchoolData();
    bindSectionNav();
    bindRequestEvents({ ...auth, appUserId: context.appUserId });
    bindTeamForm();
    bindMatchForm();
    bindLeagueForm();
    bindPostForm();
    bindTeamsModal();
    state.initialized = true;
    setStatus(`School dashboard ready for ${state.schoolName}.`);
  } catch (error) {
    console.error("School dashboard load failed", error);
    setStatus(error.message || "Unable to load the school dashboard.", true);
  }
}

window.addEventListener("session-ready", () => {
  void initSchoolDashboard();
});

window.addEventListener("ua-app-state-change", () => {
  const role = normalizeRole(getGlobalAppState().auth?.role);
  if (role === "school_admin" && !state.initialized) {
    void initSchoolDashboard();
  }
});

void initSchoolDashboard();

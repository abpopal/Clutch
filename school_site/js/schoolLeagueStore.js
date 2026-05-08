import { supabase } from "./supabaseClient.js";

const LEAGUE_TABLE = "school_leagues";
const LEAGUE_TEAM_TABLE = "school_league_teams";
const LOCAL_LEAGUES_KEY = "ua-school-leagues";
const LOCAL_LEAGUE_TEAMS_KEY = "ua-school-league-teams";
const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 };

function isSchemaMissing(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return ["PGRST204", "PGRST205", "42P01", "42703"].includes(code)
    || message.includes("could not find the table")
    || message.includes("relation")
    || message.includes("does not exist")
    || message.includes("column");
}

async function tryTableQuery(run, fallback) {
  try {
    return await run();
  } catch (error) {
    if (isSchemaMissing(error)) return fallback();
    throw error;
  }
}

function readLocal(key) {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

function writeLocal(key, rows) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(rows));
}

function localId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function fetchFirst(query) {
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

async function loadLeagues(schoolId) {
  return tryTableQuery(async () => {
    const { data, error } = await supabase
      .from(LEAGUE_TABLE)
      .select("*")
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }, () => {
    return readLocal(LOCAL_LEAGUES_KEY)
      .filter((league) => league.school_id === schoolId)
      .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
  });
}

async function loadLeagueTeams(leagueIds) {
  if (!leagueIds.length) return [];
  return tryTableQuery(async () => {
    const { data, error } = await supabase
      .from(LEAGUE_TEAM_TABLE)
      .select("*")
      .in("league_id", leagueIds);
    if (error) throw error;
    return data || [];
  }, () => readLocal(LOCAL_LEAGUE_TEAMS_KEY).filter((item) => leagueIds.includes(item.league_id)));
}

export async function loadSchoolLeagueWorkspace({ schoolId }) {
  const leagues = await loadLeagues(schoolId);
  const leagueTeams = await loadLeagueTeams(leagues.map((league) => league.league_id));
  const teamIdsByLeague = new Map();
  leagueTeams.forEach((row) => {
    if (!teamIdsByLeague.has(row.league_id)) teamIdsByLeague.set(row.league_id, []);
    teamIdsByLeague.get(row.league_id).push(row.team_id);
  });

  return leagues.map((league) => ({
    ...league,
    team_ids: teamIdsByLeague.get(league.league_id) || [],
  }));
}

export async function createSchoolLeague({
  schoolId,
  name,
  sport,
  season = "",
}) {
  const payload = {
    school_id: schoolId,
    name: String(name || "").trim(),
    sport: String(sport || "").trim(),
    season: String(season || "").trim() || null,
    created_at: new Date().toISOString(),
  };

  return tryTableQuery(async () => {
    const { data, error } = await supabase
      .from(LEAGUE_TABLE)
      .insert(payload)
      .select("*")
      .single();
    if (error?.code === "23505") {
      let query = supabase
        .from(LEAGUE_TABLE)
        .select("*")
        .eq("school_id", payload.school_id)
        .eq("name", payload.name)
        .eq("sport", payload.sport);
      query = payload.season ? query.eq("season", payload.season) : query.is("season", null);
      return fetchFirst(query);
    }
    if (error) throw error;
    return data;
  }, () => {
    const leagues = readLocal(LOCAL_LEAGUES_KEY);
    const duplicate = leagues.find((league) => (
      league.school_id === payload.school_id
      && String(league.name || "").trim().toLowerCase() === payload.name.toLowerCase()
      && String(league.sport || "").trim().toLowerCase() === payload.sport.toLowerCase()
      && String(league.season || "").trim().toLowerCase() === String(payload.season || "").toLowerCase()
    ));
    if (duplicate) return duplicate;
    const record = { league_id: localId("league"), ...payload };
    leagues.push(record);
    writeLocal(LOCAL_LEAGUES_KEY, leagues);
    return record;
  });
}

export async function assignTeamToLeague({
  leagueId,
  teamId,
}) {
  const payload = {
    league_id: leagueId,
    team_id: teamId,
    created_at: new Date().toISOString(),
  };

  return tryTableQuery(async () => {
    const { data, error } = await supabase
      .from(LEAGUE_TEAM_TABLE)
      .insert(payload)
      .select("*")
      .single();
    if (error?.code === "23505") {
      return fetchFirst(
        supabase
          .from(LEAGUE_TEAM_TABLE)
          .select("*")
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
      );
    }
    if (error) throw error;
    return data;
  }, () => {
    const records = readLocal(LOCAL_LEAGUE_TEAMS_KEY);
    const existing = records.find((item) => item.league_id === leagueId && item.team_id === teamId);
    if (existing) return existing;
    const record = { league_team_id: localId("league-team"), ...payload };
    records.push(record);
    writeLocal(LOCAL_LEAGUE_TEAMS_KEY, records);
    return record;
  });
}

export function buildLeagueStandings({
  leagues,
  teams,
  matches,
  pointsConfig = DEFAULT_POINTS,
}) {
  const teamMap = new Map((teams || []).map((team) => [team.team_id, team]));

  return (leagues || []).map((league) => {
    const standingsMap = new Map();
    const leagueTeamIds = new Set(league.team_ids || []);

    leagueTeamIds.forEach((teamId) => {
      const team = teamMap.get(teamId);
      standingsMap.set(teamId, {
        teamId,
        teamName: team?.name || "Unknown Team",
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        scoreFor: 0,
        scoreAgainst: 0,
      });
    });

    (matches || []).forEach((match) => {
      if (match.league_id !== league.league_id) return;
      if (match.status !== "completed") return;
      const homeScore = Number(match.home_score);
      const awayScore = Number(match.away_score);
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return;
      if (!leagueTeamIds.has(match.home_team_id) || !leagueTeamIds.has(match.away_team_id)) return;

      const home = standingsMap.get(match.home_team_id);
      const away = standingsMap.get(match.away_team_id);
      if (!home || !away) return;

      home.played += 1;
      away.played += 1;
      home.scoreFor += homeScore;
      home.scoreAgainst += awayScore;
      away.scoreFor += awayScore;
      away.scoreAgainst += homeScore;

      if (homeScore > awayScore) {
        home.wins += 1;
        away.losses += 1;
        home.points += pointsConfig.win;
        away.points += pointsConfig.loss;
      } else if (homeScore < awayScore) {
        away.wins += 1;
        home.losses += 1;
        away.points += pointsConfig.win;
        home.points += pointsConfig.loss;
      } else {
        home.draws += 1;
        away.draws += 1;
        home.points += pointsConfig.draw;
        away.points += pointsConfig.draw;
      }
    });

    const standings = Array.from(standingsMap.values())
      .map((row) => ({ ...row, scoreDiff: row.scoreFor - row.scoreAgainst }))
      .sort((left, right) => (
        right.points - left.points
        || right.scoreDiff - left.scoreDiff
        || right.scoreFor - left.scoreFor
        || left.teamName.localeCompare(right.teamName)
      ));

    return {
      leagueId: league.league_id,
      standings,
    };
  });
}

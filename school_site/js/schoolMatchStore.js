import { supabase } from "./supabaseClient.js";

const MATCH_TABLE = "school_matches";
const NOTIFICATION_TABLE = "school_match_notifications";
const MEMBER_TABLE = "school_team_members";
const TEAM_TABLE = "school_teams";
const LOCAL_MATCHES_KEY = "ua-school-matches";
const LOCAL_NOTIFICATIONS_KEY = "ua-school-match-notifications";
const LOCAL_MEMBERS_KEY = "ua-school-team-members";

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

async function loadTeamMembers(teamIds) {
  if (!teamIds.length) return [];
  return tryTableQuery(async () => {
    const { data, error } = await supabase
      .from(MEMBER_TABLE)
      .select("*")
      .in("team_id", teamIds);
    if (error) throw error;
    return data || [];
  }, () => readLocal(LOCAL_MEMBERS_KEY).filter((row) => teamIds.includes(row.team_id)));
}

async function createMatchNotifications({ matchId, homeTeamId, awayTeamId }) {
  const teamIds = [homeTeamId, awayTeamId].filter(Boolean);
  const members = await loadTeamMembers(teamIds);
  const payload = members.map((member) => ({
    match_id: matchId,
    user_id: member.user_id,
    team_id: member.team_id,
    member_role: member.member_role,
    created_at: new Date().toISOString(),
    read_at: null,
  }));

  if (!payload.length) return 0;

  return tryTableQuery(async () => {
    const { error } = await supabase
      .from(NOTIFICATION_TABLE)
      .insert(payload);
    if (error?.code !== "23505" && error) throw error;
    return payload.length;
  }, () => {
    const notifications = readLocal(LOCAL_NOTIFICATIONS_KEY);
    payload.forEach((item) => {
      const exists = notifications.some((notification) => (
        notification.match_id === item.match_id
        && notification.user_id === item.user_id
        && notification.team_id === item.team_id
        && notification.member_role === item.member_role
      ));
      if (!exists) {
        notifications.push({ notification_id: localId("match-notification"), ...item });
      }
    });
    writeLocal(LOCAL_NOTIFICATIONS_KEY, notifications);
    return payload.length;
  });
}

export async function loadSchoolMatches({ schoolId }) {
  return tryTableQuery(async () => {
    const { data, error } = await supabase
      .from(MATCH_TABLE)
      .select("*")
      .eq("school_id", schoolId)
      .order("scheduled_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }, () => {
    return readLocal(LOCAL_MATCHES_KEY)
      .filter((match) => match.school_id === schoolId)
      .sort((left, right) => new Date(right.scheduled_at || 0).getTime() - new Date(left.scheduled_at || 0).getTime());
  });
}

export async function createSchoolMatch({
  schoolId,
  homeTeamId,
  awayTeamId,
  leagueId = "",
  scheduledAt,
}) {
  const payload = {
    school_id: schoolId,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    league_id: String(leagueId || "").trim() || null,
    scheduled_at: scheduledAt,
    status: "scheduled",
    created_at: new Date().toISOString(),
    home_score: null,
    away_score: null,
    completed_at: null,
  };

  const match = await tryTableQuery(async () => {
    const { data, error } = await supabase
      .from(MATCH_TABLE)
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }, () => {
    const matches = readLocal(LOCAL_MATCHES_KEY);
    const record = { match_id: localId("match"), ...payload };
    matches.push(record);
    writeLocal(LOCAL_MATCHES_KEY, matches);
    return record;
  });

  const notificationCount = await createMatchNotifications({
    matchId: match.match_id,
    homeTeamId,
    awayTeamId,
  });

  return { match, notificationCount };
}

export async function saveSchoolMatchResult({
  matchId,
  homeScore,
  awayScore,
}) {
  const payload = {
    home_score: Number(homeScore),
    away_score: Number(awayScore),
    status: "completed",
    completed_at: new Date().toISOString(),
  };

  return tryTableQuery(async () => {
    const { data, error } = await supabase
      .from(MATCH_TABLE)
      .update(payload)
      .eq("match_id", matchId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }, () => {
    const matches = readLocal(LOCAL_MATCHES_KEY);
    const index = matches.findIndex((match) => match.match_id === matchId);
    if (index < 0) return null;
    matches[index] = { ...matches[index], ...payload };
    writeLocal(LOCAL_MATCHES_KEY, matches);
    return matches[index];
  });
}

export async function loadMatchNotificationCount({ matchId }) {
  return tryTableQuery(async () => {
    const { count, error } = await supabase
      .from(NOTIFICATION_TABLE)
      .select("*", { count: "exact", head: true })
      .eq("match_id", matchId);
    if (error) throw error;
    return count || 0;
  }, () => {
    return readLocal(LOCAL_NOTIFICATIONS_KEY).filter((item) => item.match_id === matchId).length;
  });
}

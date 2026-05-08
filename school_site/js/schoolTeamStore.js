import { supabase } from "./supabaseClient.js";

const TEAM_TABLE = "school_teams";
const MEMBER_TABLE = "school_team_members";
const REQUEST_TABLE = "school_join_requests";
const LOCAL_TEAMS_KEY = "ua-school-teams";
const LOCAL_MEMBERS_KEY = "ua-school-team-members";
const LOCAL_REQUESTS_KEY = "ua-school-join-requests";

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

function safeName(row, directory) {
  return directory?.display_name || row?.name || row?.email || `User ${String(row?.user_id || "").slice(0, 8)}`;
}

async function loadDirectoryMap() {
  const { data, error } = await supabase
    .from("user_directory")
    .select("user_id,display_name,email")
    .limit(5000);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.user_id, row]));
}

async function fetchFirst(query) {
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

async function loadAthletePool(schoolId) {
  const [directoryMap, athletesRes] = await Promise.all([
    loadDirectoryMap(),
    supabase
      .from("athletes")
      .select("user_id,position,graduation_year")
      .eq("school_id", schoolId)
      .limit(1000),
  ]);
  if (athletesRes.error) throw athletesRes.error;
  return (athletesRes.data || []).map((row) => {
    const directory = directoryMap.get(row.user_id);
    return {
      userId: row.user_id,
      role: "athlete",
      name: safeName(row, directory),
      email: directory?.email || "",
      meta: [row.position, row.graduation_year ? `Class ${row.graduation_year}` : ""].filter(Boolean).join(" • "),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

async function loadCoachPool(schoolId) {
  const [directoryMap, coachesRes, requests] = await Promise.all([
    loadDirectoryMap(),
    supabase
      .from("coaches")
      .select("user_id,bio,years_experience")
      .limit(2000),
    tryTableQuery(async () => {
      const { data, error } = await supabase
        .from(REQUEST_TABLE)
        .select("user_id,display_name,email")
        .eq("school_id", schoolId)
        .eq("requester_role", "coach")
        .eq("status", "approved")
        .limit(1000);
      if (error) throw error;
      return data || [];
    }, () => readLocal(LOCAL_REQUESTS_KEY).filter((item) => (
      item.school_id === schoolId
      && item.requester_role === "coach"
      && item.status === "approved"
    ))),
  ]);
  if (coachesRes.error) throw coachesRes.error;

  const coachByUserId = new Map((coachesRes.data || []).map((row) => [row.user_id, row]));
  return (requests || []).map((request) => {
    const directory = directoryMap.get(request.user_id);
    const coach = coachByUserId.get(request.user_id);
    return {
      userId: request.user_id,
      role: "coach",
      name: request.display_name || safeName({ user_id: request.user_id }, directory),
      email: request.email || directory?.email || "",
      meta: coach?.bio || (coach?.years_experience ? `${coach.years_experience} years experience` : "Approved coach"),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

async function loadTeams(schoolId) {
  return tryTableQuery(async () => {
    const { data, error } = await supabase
      .from(TEAM_TABLE)
      .select("*")
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }, () => {
    return readLocal(LOCAL_TEAMS_KEY)
      .filter((team) => team.school_id === schoolId)
      .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
  });
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
  }, () => {
    return readLocal(LOCAL_MEMBERS_KEY).filter((member) => teamIds.includes(member.team_id));
  });
}

export async function loadSchoolTeamWorkspace({ schoolId }) {
  const [athletes, coaches, teams] = await Promise.all([
    loadAthletePool(schoolId),
    loadCoachPool(schoolId),
    loadTeams(schoolId),
  ]);
  const members = await loadTeamMembers(teams.map((team) => team.team_id));

  const athleteMap = new Map(athletes.map((item) => [item.userId, item]));
  const coachMap = new Map(coaches.map((item) => [item.userId, item]));
  const membersByTeamId = new Map();
  members.forEach((member) => {
    if (!membersByTeamId.has(member.team_id)) membersByTeamId.set(member.team_id, []);
    membersByTeamId.get(member.team_id).push(member);
  });

  return {
    athletes,
    coaches,
    teams: teams.map((team) => {
      const rawMembers = membersByTeamId.get(team.team_id) || [];
      const athleteMembers = rawMembers
        .filter((member) => member.member_role === "athlete")
        .map((member) => athleteMap.get(member.user_id))
        .filter(Boolean);
      const coachMembers = rawMembers
        .filter((member) => member.member_role === "coach")
        .map((member) => coachMap.get(member.user_id))
        .filter(Boolean);
      return {
        ...team,
        athletes: athleteMembers,
        coaches: coachMembers,
      };
    }),
  };
}

export async function createSchoolTeam({
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
      .from(TEAM_TABLE)
      .insert(payload)
      .select("*")
      .single();
    if (error?.code === "23505") {
      let query = supabase
        .from(TEAM_TABLE)
        .select("*")
        .eq("school_id", payload.school_id)
        .eq("name", payload.name)
        .eq("sport", payload.sport);
      query = payload.season ? query.eq("season", payload.season) : query.is("season", null);
      const existing = await fetchFirst(
        query
      );
      return existing;
    }
    if (error) throw error;
    return data;
  }, () => {
    const teams = readLocal(LOCAL_TEAMS_KEY);
    const duplicate = teams.find((team) => (
      team.school_id === payload.school_id
      && String(team.name || "").trim().toLowerCase() === payload.name.toLowerCase()
      && String(team.sport || "").trim().toLowerCase() === payload.sport.toLowerCase()
      && String(team.season || "").trim().toLowerCase() === String(payload.season || "").toLowerCase()
    ));
    if (duplicate) return duplicate;
    const record = { team_id: localId("team"), ...payload };
    teams.push(record);
    writeLocal(LOCAL_TEAMS_KEY, teams);
    return record;
  });
}

export async function assignSchoolTeamMember({
  teamId,
  userId,
  memberRole,
}) {
  const payload = {
    team_id: teamId,
    user_id: userId,
    member_role: memberRole,
    created_at: new Date().toISOString(),
  };

  return tryTableQuery(async () => {
    const { data, error } = await supabase
      .from(MEMBER_TABLE)
      .insert(payload)
      .select("*")
      .single();
    if (error?.code === "23505") {
      const existing = await fetchFirst(
        supabase
          .from(MEMBER_TABLE)
          .select("*")
          .eq("team_id", payload.team_id)
          .eq("user_id", payload.user_id)
          .eq("member_role", payload.member_role)
      );
      return existing;
    }
    if (error) throw error;
    return data;
  }, () => {
    const members = readLocal(LOCAL_MEMBERS_KEY);
    const existing = members.find((member) => (
      member.team_id === payload.team_id
      && member.user_id === payload.user_id
      && member.member_role === payload.member_role
    ));
    if (existing) return existing;
    const record = { team_member_id: localId("team-member"), ...payload };
    members.push(record);
    writeLocal(LOCAL_MEMBERS_KEY, members);
    return record;
  });
}

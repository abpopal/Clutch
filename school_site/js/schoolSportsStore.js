import { supabase } from "./supabaseClient.js";

// ── Sports CRUD ──────────────────────────────────────────────

export async function loadSports(schoolId) {
  const { data, error } = await supabase
    .from("sports")
    .select("*")
    .eq("school_id", schoolId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createSport({ schoolId, name, seasonType, gender, maxRosterSize }) {
  const { data, error } = await supabase
    .from("sports")
    .insert({
      school_id: schoolId,
      name: name.trim(),
      season_type: seasonType || "fall",
      gender: gender || "coed",
      max_roster_size: maxRosterSize || 30,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateSport(sportId, updates) {
  const { data, error } = await supabase
    .from("sports")
    .update(updates)
    .eq("sport_id", sportId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSport(sportId) {
  const { error } = await supabase
    .from("sports")
    .delete()
    .eq("sport_id", sportId);
  if (error) throw error;
}

// ── Seasons CRUD ─────────────────────────────────────────────

export async function loadSeasons(schoolId) {
  const { data, error } = await supabase
    .from("seasons")
    .select("*")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createSeason({ schoolId, name, startDate, endDate, isActive }) {
  const { data, error } = await supabase
    .from("seasons")
    .insert({
      school_id: schoolId,
      name: name.trim(),
      start_date: startDate || null,
      end_date: endDate || null,
      is_active: isActive || false,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateSeason(seasonId, updates) {
  const { data, error } = await supabase
    .from("seasons")
    .update(updates)
    .eq("season_id", seasonId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSeason(seasonId) {
  const { error } = await supabase
    .from("seasons")
    .delete()
    .eq("season_id", seasonId);
  if (error) throw error;
}

export async function setActiveSeason(schoolId, seasonId) {
  // Deactivate all seasons for this school
  await supabase
    .from("seasons")
    .update({ is_active: false })
    .eq("school_id", schoolId);
  // Activate the chosen one
  if (seasonId) {
    await supabase
      .from("seasons")
      .update({ is_active: true })
      .eq("season_id", seasonId);
  }
}

// ── Teams CRUD (new tables) ──────────────────────────────────

export async function loadTeams(schoolId) {
  const { data, error } = await supabase
    .from("teams")
    .select("*, sports(name, gender), seasons(name)")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createTeam({ schoolId, sportId, seasonId, name, level, headCoachId }) {
  const { data, error } = await supabase
    .from("teams")
    .insert({
      school_id: schoolId,
      sport_id: sportId,
      season_id: seasonId || null,
      name: name.trim(),
      level: level || "varsity",
      head_coach_id: headCoachId || null,
    })
    .select("*, sports(name, gender), seasons(name)")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTeam(teamId) {
  const { error } = await supabase
    .from("teams")
    .delete()
    .eq("team_id", teamId);
  if (error) throw error;
}

// ── Roster CRUD ──────────────────────────────────────────────

export async function loadRoster(teamId) {
  const { data, error } = await supabase
    .from("roster_entries")
    .select("*")
    .eq("team_id", teamId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  const entries = data || [];
  if (!entries.length) return entries;

  // Enrich with name/email from school_join_requests
  const athleteIds = entries.map((r) => r.athlete_id);
  const { data: requests } = await supabase
    .from("school_join_requests")
    .select("user_id, display_name, email")
    .in("user_id", athleteIds);

  const infoMap = new Map();
  for (const r of (requests || [])) {
    if (r.user_id) infoMap.set(r.user_id, { display_name: r.display_name, email: r.email });
  }

  return entries.map((e) => ({
    ...e,
    user_directory: infoMap.get(e.athlete_id) || { display_name: null, email: null },
  }));
}

export async function addToRoster({ teamId, athleteId, jerseyNumber, position }) {
  const { data, error } = await supabase
    .from("roster_entries")
    .insert({
      team_id: teamId,
      athlete_id: athleteId,
      jersey_number: jerseyNumber || null,
      position: position || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function removeFromRoster(rosterId) {
  const { error } = await supabase
    .from("roster_entries")
    .delete()
    .eq("roster_id", rosterId);
  if (error) throw error;
}

// ── Matches CRUD (new tables) ────────────────────────────────

export async function loadMatches(teamId) {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("team_id", teamId)
    .order("match_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function loadAllSchoolMatches(schoolId) {
  // Use explicit FK constraint name since matches has two FKs to teams
  const { data, error } = await supabase
    .from("matches")
    .select("*, team:teams!matches_team_id_fkey(school_id, name, sports(name))")
    .eq("team.school_id", schoolId)
    .order("match_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createMatch({
  teamId, opponentName, matchDate, matchTime, location, isHomeGame,
  matchType, opponentTeamId, opponentSchoolId,
}) {
  const row = {
    team_id: teamId,
    opponent_name: opponentName.trim(),
    match_date: matchDate,
    match_time: matchTime || null,
    location: location || null,
    is_home_game: isHomeGame !== false,
  };
  // Only include new columns if they have values (avoids error if migration not run yet)
  if (matchType) row.match_type = matchType;
  if (opponentTeamId) row.opponent_team_id = opponentTeamId;
  if (opponentSchoolId) row.opponent_school_id = opponentSchoolId;

  const { data, error } = await supabase
    .from("matches")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateMatch(matchId, updates) {
  const { data, error } = await supabase
    .from("matches")
    .update(updates)
    .eq("match_id", matchId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMatch(matchId) {
  const { error } = await supabase
    .from("matches")
    .delete()
    .eq("match_id", matchId);
  if (error) throw error;
}

// ── School Members ──────────────────────────────────────────

export async function loadSchoolMembers(schoolId, role = "") {
  // First load the raw members
  let query = supabase
    .from("school_members")
    .select("*")
    .eq("school_id", schoolId)
    .is("removed_at", null)
    .order("joined_at", { ascending: true });
  if (role) query = query.eq("role", role);
  const { data, error } = await query;
  if (error) throw error;
  const members = data || [];
  if (!members.length) return [];

  // Enrich with display_name + email from school_join_requests
  // (users table may not have these columns, but join requests do)
  const userIds = members.map((m) => m.user_id);
  const { data: requests } = await supabase
    .from("school_join_requests")
    .select("user_id, display_name, email")
    .eq("school_id", schoolId)
    .in("user_id", userIds);

  const infoMap = new Map();
  for (const r of (requests || [])) {
    if (r.user_id) infoMap.set(r.user_id, { display_name: r.display_name, email: r.email });
  }

  return members.map((m) => ({
    ...m,
    users: infoMap.get(m.user_id) || { display_name: null, email: null },
  }));
}

export async function removeSchoolMember(memberId) {
  const { error } = await supabase
    .from("school_members")
    .update({ status: "inactive", removed_at: new Date().toISOString() })
    .eq("member_id", memberId);
  if (error) throw error;
}

// ── Trainings CRUD ──────────────────────────────────────────

export async function loadTrainings(teamId) {
  const { data, error } = await supabase
    .from("trainings")
    .select("*")
    .eq("team_id", teamId)
    .order("training_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function loadTrainingsByTeams(teamIds) {
  if (!teamIds?.length) return [];
  const { data, error } = await supabase
    .from("trainings")
    .select("*, teams(name, sports(name))")
    .in("team_id", teamIds)
    .order("training_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createTraining({ teamId, title, description, trainingDate, startTime, endTime, location, type, createdBy }) {
  const { data, error } = await supabase
    .from("trainings")
    .insert({
      team_id: teamId,
      title: (title || "Practice").trim(),
      description: description || null,
      training_date: trainingDate,
      start_time: startTime || null,
      end_time: endTime || null,
      location: location || null,
      type: type || "practice",
      created_by: createdBy || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTraining(trainingId) {
  const { error } = await supabase
    .from("trainings")
    .delete()
    .eq("training_id", trainingId);
  if (error) throw error;
}

// ── Coach-specific loaders ──────────────────────────────────

export async function loadCoachTeams(coachUserId) {
  // Find teams where this user is head_coach OR has a coach_assignment
  const [{ data: headCoachTeams }, { data: assignments }] = await Promise.all([
    supabase
      .from("teams")
      .select("*, sports(name, gender), seasons(name)")
      .eq("head_coach_id", coachUserId)
      .order("created_at", { ascending: false }),
    supabase
      .from("coach_assignments")
      .select("team_id")
      .eq("coach_id", coachUserId)
      .is("removed_at", null),
  ]);

  const teamMap = new Map();
  for (const t of (headCoachTeams || [])) teamMap.set(t.team_id, t);

  if (assignments?.length) {
    const extraIds = assignments.map((a) => a.team_id).filter((id) => !teamMap.has(id));
    if (extraIds.length) {
      const { data: extraTeams } = await supabase
        .from("teams")
        .select("*, sports(name, gender), seasons(name)")
        .in("team_id", extraIds);
      for (const t of (extraTeams || [])) teamMap.set(t.team_id, t);
    }
  }

  return [...teamMap.values()];
}

export async function loadCoachSchoolId(coachUserId) {
  // Find the school this coach belongs to via school_members
  const { data } = await supabase
    .from("school_members")
    .select("school_id")
    .eq("user_id", coachUserId)
    .eq("role", "coach")
    .is("removed_at", null)
    .limit(1)
    .single();
  return data?.school_id || null;
}

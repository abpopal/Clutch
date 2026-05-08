import { supabase } from "./supabaseClient.js";
import { buildAthleteProfile, normalizeText } from "./athleteData.js?v=20260418b";
import { normalizeRole } from "./roleUtils.js";

function uniqueList(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function athleteRowScore(row) {
  if (!row) return -1;
  return [
    row.school_id ? 1 : 0,
    row.position ? 1 : 0,
    row.graduation_year ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
}

function rowName(user, school, directoryEntry) {
  return directoryEntry?.display_name || school?.name || user?.display_name || user?.name || `User ${String(user?.user_id || "").slice(0, 8)}`;
}

const GENERIC_SCHOOL_COORDS = {
  "westlake high school": { lat: 33.6627, lng: -84.5319 },
  "northside prep": { lat: 33.7925, lng: -84.3238 },
  "untitled athletic academy": { lat: 33.749, lng: -84.388 },
};

const GENERIC_LOCATION_COORDS = {
  "atlanta ga": { lat: 33.749, lng: -84.388 },
  "atlanta, ga": { lat: 33.749, lng: -84.388 },
  "decatur ga": { lat: 33.7748, lng: -84.2963 },
  "decatur, ga": { lat: 33.7748, lng: -84.2963 },
  "georgia": { lat: 32.1656, lng: -82.9001 },
};

const GENERIC_SCHOOL_REGIONS = {
  "westlake high school": { key: "west-metro", district: "West Metro District", area: "Westlake Area" },
  "northside prep": { key: "north-atlanta", district: "North Atlanta District", area: "Northside Area" },
  "untitled athletic academy": { key: "ua-central", district: "UA Central District", area: "Atlanta Core" },
};

const GENERIC_LOCATION_REGIONS = {
  "atlanta ga": { key: "atlanta-core", district: "Atlanta Core District", area: "Atlanta Metro" },
  "atlanta, ga": { key: "atlanta-core", district: "Atlanta Core District", area: "Atlanta Metro" },
  "decatur ga": { key: "east-atlanta", district: "East Atlanta District", area: "Decatur" },
  "decatur, ga": { key: "east-atlanta", district: "East Atlanta District", area: "Decatur" },
  "georgia": { key: "georgia-statewide", district: "Georgia District", area: "Statewide" },
};

function seededCoordinate(seed = "") {
  const normalized = normalizeText(seed || "untitled athletics");
  const hash = normalized.split("").reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const lat = 25 + ((hash % 1900) / 100);
  const lng = -124 + (((hash >> 4) % 5700) / 100);
  return {
    lat: Number(Math.min(48.75, Math.max(25.0, lat)).toFixed(4)),
    lng: Number(Math.min(-66.9, Math.max(-124.0, lng)).toFixed(4)),
  };
}

function coordinatesForSchool({ schoolName, location, userId }) {
  const normalizedSchool = normalizeText(schoolName);
  const normalizedLocation = normalizeText(location);
  return GENERIC_SCHOOL_COORDS[normalizedSchool]
    || GENERIC_LOCATION_COORDS[normalizedLocation]
    || seededCoordinate(`${schoolName}|${location}|${userId}`);
}

function regionFromCoordinates({ lat, lng }) {
  const northSouth = lat >= 39 ? "North" : lat >= 34 ? "Central" : "South";
  const eastWest = lng <= -105 ? "West" : lng <= -92 ? "Plains" : lng <= -82 ? "Central" : "East";
  const label = `${northSouth} ${eastWest}`;
  return {
    key: normalizeText(label).replace(/\s+/g, "-"),
    district: `${label} District`,
    area: label,
  };
}

function regionForSchool({ schoolName, location, coordinates }) {
  const normalizedSchool = normalizeText(schoolName);
  const normalizedLocation = normalizeText(location);
  return GENERIC_SCHOOL_REGIONS[normalizedSchool]
    || GENERIC_LOCATION_REGIONS[normalizedLocation]
    || regionFromCoordinates(coordinates);
}

export async function loadAthleteDirectory() {
  const [directoryRes, usersRes, schoolsRes, athletesRes, statsRes] = await Promise.all([
    supabase.from("user_directory").select("user_id,display_name,email").limit(5000),
    supabase.from("users").select("user_id,role").limit(2000),
    supabase.from("schools").select("school_id,user_id,name,location").limit(2000),
    supabase.from("athletes").select("athlete_id,user_id,school_id,position,graduation_year").limit(2000),
    supabase.from("athlete_stat").select("athlete_id,sport,stat_key,stat_value,source").limit(5000),
  ]);

  for (const response of [directoryRes, usersRes, schoolsRes, athletesRes, statsRes]) {
    if (response.error) throw response.error;
  }

  const directories = directoryRes.data || [];
  const users = usersRes.data || [];
  const schools = schoolsRes.data || [];
  const athletes = athletesRes.data || [];
  const statRows = statsRes.data || [];

  const userById = new Map(users.map((row) => [row.user_id, row]));
  const directoryByUserId = new Map(directories.map((row) => [row.user_id, row]));
  const schoolById = new Map(schools.map((row) => [row.school_id, row]));
  const statsByAthleteId = new Map();
  const athleteRowsByUserId = new Map();

  statRows.forEach((row) => {
    if (!statsByAthleteId.has(row.athlete_id)) statsByAthleteId.set(row.athlete_id, []);
    statsByAthleteId.get(row.athlete_id).push(row);
  });

  athletes.forEach((athleteRow) => {
    if (!athleteRowsByUserId.has(athleteRow.user_id)) athleteRowsByUserId.set(athleteRow.user_id, []);
    athleteRowsByUserId.get(athleteRow.user_id).push(athleteRow);
  });

  return Array.from(athleteRowsByUserId.entries()).map(([userId, athleteRows]) => {
    const primaryAthleteRow = [...athleteRows].sort((left, right) => athleteRowScore(right) - athleteRowScore(left))[0] || athleteRows[0];
    const user = userById.get(userId) || { user_id: userId, role: "athlete" };
    const role = normalizeRole(user.role || "athlete");
    const school = schoolById.get(primaryAthleteRow?.school_id) || null;
    const directory = directoryByUserId.get(userId) || {
      user_id: userId,
      display_name: rowName(user, school, null),
      email: "",
    };
    const combinedStats = athleteRows.flatMap((row) => statsByAthleteId.get(row.athlete_id) || []);

    const profile = buildAthleteProfile({
      userId,
      directory,
      athleteRow: primaryAthleteRow,
      schoolName: school?.name || "",
      stats: combinedStats,
      posts: [],
      counts: { posts: 0, followers: 0, following: 0 },
      fallbackRole: role,
    });

    const sportLabels = uniqueList((profile.sports || []).map((sport) => sport.label));
    const sportIds = uniqueList((profile.sports || []).map((sport) => sport.id));
    const positions = uniqueList([...athleteRows.map((row) => row.position), profile.position]);
    const location = school?.location || profile.hometown || "";
    const schoolName = school?.name || profile.school || "";
    const primarySport = profile.sports?.[0] || null;
    const coordinates = coordinatesForSchool({ schoolName, location, userId });
    const region = regionForSchool({ schoolName, location, coordinates });

    return {
      userId,
      athleteId: profile.athleteId || "",
      athleteRow: primaryAthleteRow,
      athleteRows,
      profile,
      name: profile.name,
      email: directory?.email || profile.email || "",
      schoolName,
      location,
      position: primaryAthleteRow?.position || profile.position || "Athlete",
      positions,
      sportLabels,
      sportIds,
      primarySportId: primarySport?.id || "",
      primarySportLabel: primarySport?.label || "",
      readiness: Number(profile.readiness?.score || 0),
      performanceRating: Number(profile.performanceRating || primarySport?.performanceRating || 0),
      gradYear: profile.gradYear,
      coordinates,
      region,
      searchText: normalizeText([
        profile.name,
        directory?.email,
        profile.athleteId,
        schoolName,
        location,
        positions.join(" "),
        profile.position,
        sportLabels.join(" "),
      ].filter(Boolean).join(" ")),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

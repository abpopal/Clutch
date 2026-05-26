import { supabase } from "./supabaseClient.js";
import { badgeMeta, buildAthleteProfile, formatScoutSummary, getSportMeta } from "./athleteData.js?v=20260430";
import { getGlobalAppState, normalizeRole } from "./roleUtils.js";
import { loadCoachTeams } from "./schoolSportsStore.js";
import {
  destroyProfileStatsCharts,
  mountProfileStatsCharts,
  progressionLeadMetric,
  sportChartConfig,
} from "./profileStatsCharts.js";
import {
  canUseScoutWorkspace,
  getScoutWorkspaceState,
  saveScoutNotes,
  toggleSavedAthlete,
  toggleShortlistedAthlete,
} from "./scoutWorkspace.js";

const HERO_IMAGES = {
  soccer: "https://images.unsplash.com/photo-1517466787929-bc90951d0974?auto=format&fit=crop&w=1600&q=80",
  basketball: "https://images.unsplash.com/photo-1546519638-68e109498ffc?auto=format&fit=crop&w=1600&q=80",
  football: "https://images.unsplash.com/photo-1508098682722-e99c643e7485?auto=format&fit=crop&w=1600&q=80",
  baseball: "https://images.unsplash.com/photo-1471295253337-3ceaaedca402?auto=format&fit=crop&w=1600&q=80",
  track: "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=1600&q=80",
  default: "https://images.unsplash.com/photo-1511886929837-354d827aae26?auto=format&fit=crop&w=1600&q=80",
};

const TAB_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "stats", label: "Stats" },
  { id: "posts", label: "Posts" },
  { id: "achievements", label: "Achievements" },
  { id: "media", label: "Media" },
  { id: "academics", label: "Academics" },
];

const SCHEDULE_TAB = { id: "schedule", label: "Schedule" };

const SCHEDULE_CATEGORY_META = {
  school: { label: "School", color: "#60a5fa" },
  "rec-league": { label: "Rec League", color: "#34d399" },
  "ua-event": { label: "UA Events", color: "#f59e0b" },
};

const state = {
  mounted: false,
  mode: "self",
  viewerUserId: "",
  viewerRole: "user",
  targetUserId: "",
  isSelf: false,
  isFollowing: false,
  role: "athlete",
  scoutWorkspace: null,
  profile: null,
  coachRow: null,
  schoolRow: null,
  scoutRow: null,
  coachTeams: [],
  posts: [],
  counts: { posts: 0, followers: 0, following: 0 },
  activeTab: "overview",
  activeSportId: "",
  scheduleMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  bootKey: "",
  bootPromise: null,
};

function queryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return (params.get(name) || "").trim();
}

function publicProfileUrl(userId) {
  return `user-profile.html?user_id=${encodeURIComponent(userId)}`;
}

function privateProfileUrl() {
  return "profile.html";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hashString(value) {
  return String(value || "profile").split("").reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 7);
}

function seededValue(seed, min, max) {
  const hash = hashString(seed);
  const ratio = (hash % 1000) / 1000;
  return Math.round(min + ((max - min) * ratio));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function initials(name) {
  return String(name || "Athlete")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "AT";
}

function formatShortDate(value) {
  if (!value) return "TBD";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatLongDate(value) {
  if (!value) return "Date TBD";
  return new Date(value).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatTime(value) {
  if (!value) return "TBD";
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatRelativeTime(value) {
  if (!value) return "Now";
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatShortDate(value);
}

function mediaSource(post) {
  const items = Array.isArray(post?.post_media) ? post.post_media : [];
  return items.find((item) => item?.media_url) || null;
}

function mediaVisualMarkup(media, className, altText) {
  if (!media?.media_url) return "";
  if (media.media_type === "video") {
    return `<video class="${escapeHtml(className)}" controls preload="metadata" src="${escapeHtml(media.media_url)}"></video>`;
  }
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(media.media_url)}" alt="${escapeHtml(altText || "Profile media")}">`;
}

function postMediaMarkup(post, profile, className) {
  const media = mediaSource(post);
  if (media?.media_url) {
    return mediaVisualMarkup(media, className, post.caption || `${profile?.name || "Profile"} media`);
  }
  // No real media — don't show the hero photo as a fake background
  return "";
}

function currentSport() {
  if (!state.profile?.sports?.length) return null;
  return state.profile.sports.find((sport) => sport.id === state.activeSportId) || state.profile.sports[0];
}

function heroImageFor(profile) {
  if (profile?.coverUrl) return profile.coverUrl;
  const sportId = profile?.sports?.[0]?.id || "default";
  return HERO_IMAGES[sportId] || HERO_IMAGES.default;
}

function availableTabs() {
  return state.isSelf ? [...TAB_ITEMS, SCHEDULE_TAB] : TAB_ITEMS;
}

function scheduleCategoryMeta(category) {
  return SCHEDULE_CATEGORY_META[category] || { label: "Event", color: "#94a3b8" };
}

function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function scheduleItems(profile) {
  return (profile?.schedule || [])
    .map((item) => ({
      ...item,
      startDate: new Date(item.date),
      dateKey: new Date(item.date).toISOString().slice(0, 10),
      category: item.category || "school",
      venueName: item.venueName || item.location || "Venue TBD",
    }))
    .sort((a, b) => a.startDate - b.startDate);
}

function avatarImageFor(profile) {
  if (profile?.avatarUrl) return profile.avatarUrl;
  const seed = profile?.userId || profile?.athleteId || profile?.name || "athlete";
  return `https://i.pravatar.cc/320?u=${encodeURIComponent(seed)}`;
}

function renderSkeleton() {
  const root = document.querySelector("#profile-experience");
  if (!root) return;
  root.innerHTML = `
    <section class="pp-profile pp-profile--skeleton">
      <div class="pp-hero pp-hero--skeleton">
        <div class="pp-hero-main">
          <div class="pp-identity">
            <div class="pp-avatar-wrap">
              <div class="pp-skeleton pp-skeleton--avatar"></div>
            </div>
            <div class="pp-headline">
              <div class="pp-skeleton pp-skeleton--name"></div>
              <div class="pp-skeleton pp-skeleton--line"></div>
              <div class="pp-skeleton pp-skeleton--line pp-skeleton--short"></div>
              <div class="pp-action-row">
                <div class="pp-skeleton pp-skeleton--btn"></div>
                <div class="pp-skeleton pp-skeleton--btn"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="pp-metrics-bar">
          ${Array.from({ length: 6 }, () => `<div class="pp-metric-tile"><div class="pp-skeleton pp-skeleton--metric"></div></div>`).join("")}
        </div>
      </div>
      <div class="pp-tab-bar">
        <div class="pp-tabs">
          ${Array.from({ length: 6 }, () => `<div class="pp-skeleton pp-skeleton--tab"></div>`).join("")}
        </div>
      </div>
      <div class="pp-stage">
        <div class="pp-grid pp-grid--overview">
          ${Array.from({ length: 4 }, () => `
            <article class="pp-card">
              <div class="pp-skeleton pp-skeleton--card-title"></div>
              <div class="pp-skeleton pp-skeleton--block"></div>
              <div class="pp-skeleton pp-skeleton--block pp-skeleton--short"></div>
            </article>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function setStatus(message, isError = false) {
  const el = document.querySelector("#profile-page-status");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("is-error", isError);
}

function showToast(message) {
  const toast = document.querySelector("#profile-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.classList.remove("is-visible");
    toast.hidden = true;
  }, 2200);
}

async function fetchFirst(query) {
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

async function fetchViewerAppUserId(authUserId) {
  const data = await fetchFirst(
    supabase
      .from("users")
      .select("user_id")
      .eq("auth_uid", authUserId)
  );
  if (data?.user_id) return data.user_id;

  // User exists in auth but not in app users table — auto-create a stub row
  try {
    const { data: inserted, error } = await supabase
      .from("users")
      .insert({ auth_uid: authUserId, role: "user" })
      .select("user_id")
      .single();
    if (!error && inserted?.user_id) return inserted.user_id;
  } catch (_) {
    // ignore — row may have been created by another concurrent request
    const retry = await fetchFirst(
      supabase.from("users").select("user_id").eq("auth_uid", authUserId)
    );
    if (retry?.user_id) return retry.user_id;
  }

  return null;
}

async function fetchViewerRole(appUserId) {
  if (!appUserId) return "user";
  const data = await fetchFirst(
    supabase
      .from("users")
      .select("role")
      .eq("user_id", appUserId)
  );
  return normalizeRole(data?.role);
}

async function fetchCounts(userId) {
  const [postsRes, followersRes, followingRes] = await Promise.all([
    supabase.from("post").select("*", { count: "exact", head: true }).eq("author_user_id", userId),
    supabase.from("follow").select("*", { count: "exact", head: true }).eq("followed_user_id", userId),
    supabase.from("follow").select("*", { count: "exact", head: true }).eq("follower_user_id", userId),
  ]);

  return {
    posts: postsRes.count || 0,
    followers: followersRes.count || 0,
    following: followingRes.count || 0,
  };
}

async function fetchVisiblePosts(userId, isSelf, isFollowing) {
  const filters = ["public"];
  if (isFollowing || isSelf) filters.push("followers");
  if (isSelf) filters.push("private");

  const { data, error } = await supabase
    .from("post")
    .select("post_id,author_role,caption,post_type,created_at,visibility,post_media(media_url,media_type)")
    .eq("author_user_id", userId)
    .in("visibility", filters)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) throw error;
  return data || [];
}

async function fetchTargetDirectory(userId) {
  try {
    return await fetchFirst(
      supabase
        .from("user_directory")
        .select("user_id,display_name,email")
        .eq("user_id", userId)
    );
  } catch (_error) {
    return null;
  }
}

async function fetchUserRecord(userId) {
  const [userRow, athleteRow, coachRow, schoolRow, scoutRow] = await Promise.all([
    fetchFirst(supabase.from("users").select("*").eq("user_id", userId)),
    fetchFirst(supabase.from("athletes").select("athlete_id,user_id,school_id,position,graduation_year,sport,bio").eq("user_id", userId)),
    fetchFirst(supabase.from("coaches").select("coach_id,user_id,bio,years_experience").eq("user_id", userId)),
    fetchFirst(supabase.from("schools").select("school_id,user_id,name,description,location").eq("user_id", userId)),
    fetchFirst(supabase.from("scouts").select("scout_id,user_id,organization,title").eq("user_id", userId)),
  ]);

  return {
    userRow: userRow || null,
    athleteRow: athleteRow || null,
    coachRow: coachRow || null,
    schoolRow: schoolRow || null,
    scoutRow: scoutRow || null,
  };
}

async function fetchSchoolName(schoolId) {
  if (!schoolId) return "";
  const data = await fetchFirst(
    supabase
      .from("schools")
      .select("name")
      .eq("school_id", schoolId)
  );
  return data?.name || "";
}

async function fetchAthleteStats(athleteId) {
  if (!athleteId) return [];
  const { data, error } = await supabase
    .from("athlete_stat")
    .select("sport,stat_key,stat_value,source")
    .eq("athlete_id", athleteId)
    .limit(200);

  if (error) throw error;
  return data || [];
}

async function fetchAthleteProfile(userId) {
  if (!userId) return null;
  try {
    const { data } = await supabase
      .from("athlete_profiles")
      .select("*")
      .eq("user_id", userId)
      .limit(1);
    return data?.[0] || null;
  } catch (_) { return null; }
}

async function fetchSeasonAverages(userId) {
  if (!userId) return null;
  try {
    // Find all matches for teams this athlete is on
    const { data: rosterRows } = await supabase
      .from("roster_entries")
      .select("team_id")
      .eq("athlete_id", userId);
    if (!rosterRows?.length) return null;

    const teamIds = [...new Set(rosterRows.map((r) => r.team_id))];
    const { data: matches } = await supabase
      .from("matches")
      .select("match_id")
      .in("team_id", teamIds);
    if (!matches?.length) return null;

    const matchIds = matches.map((m) => m.match_id);
    const { data: allStats } = await supabase
      .from("athlete_stats")
      .select("stat_type, stat_value")
      .eq("athlete_id", userId)
      .in("match_id", matchIds);
    if (!allStats?.length) return null;

    // Calculate averages per stat_type
    const totals = {};
    const counts = {};
    const gamesPlayed = new Set();

    for (const s of allStats) {
      if (!totals[s.stat_type]) { totals[s.stat_type] = 0; counts[s.stat_type] = 0; }
      totals[s.stat_type] += parseFloat(s.stat_value) || 0;
      counts[s.stat_type] += 1;
    }

    const averages = {};
    for (const key of Object.keys(totals)) {
      averages[key] = {
        total: totals[key],
        count: counts[key],
        avg: totals[key] / counts[key],
      };
    }
    averages._gamesPlayed = allStats.length > 0 ? Math.max(...Object.values(counts)) : 0;
    return averages;
  } catch (err) {
    console.warn("Could not load season averages:", err);
    return null;
  }
}

async function fetchIsFollowing() {
  if (!state.viewerUserId || !state.targetUserId || state.viewerUserId === state.targetUserId) return false;
  const data = await fetchFirst(
    supabase
      .from("follow")
      .select("follower_user_id")
      .eq("follower_user_id", state.viewerUserId)
      .eq("followed_user_id", state.targetUserId)
  );
  return Boolean(data);
}

// ── Fetch real matches + trainings for an athlete from database ──
async function fetchAthleteMatchSchedule(userId) {
  if (!userId) return [];
  try {
    // 1) Find all teams this athlete is on via roster_entries
    const { data: rosterRows, error: rosterErr } = await supabase
      .from("roster_entries")
      .select("team_id")
      .eq("athlete_id", userId);
    if (rosterErr || !rosterRows?.length) return [];

    const teamIds = [...new Set(rosterRows.map((r) => r.team_id))];

    // 2) Load matches AND trainings for those teams in parallel
    const [matchResult, trainingResult] = await Promise.all([
      supabase
        .from("matches")
        .select("*, team:teams!matches_team_id_fkey(name, sports(name, gender))")
        .in("team_id", teamIds)
        .order("match_date", { ascending: true }),
      supabase
        .from("trainings")
        .select("*, teams(name, sports(name))")
        .in("team_id", teamIds)
        .order("training_date", { ascending: true }),
    ]);

    const matches = matchResult.data || [];
    const trainings = trainingResult.error ? [] : (trainingResult.data || []);

    // 3) Transform DB matches → calendar schedule item format
    const matchItems = matches.map((m) => {
      const sportName = m.team?.sports?.name || "Sport";
      const teamName = m.team?.name || "Team";
      const matchDate = m.match_date || "";
      const matchTime = m.match_time || "00:00:00";
      const dateStr = matchTime
        ? `${matchDate}T${matchTime}`
        : `${matchDate}T00:00:00`;
      const isInternal = m.match_type === "internal";

      return {
        id: m.match_id,
        date: dateStr,
        sport: sportName.toLowerCase(),
        opponent: m.opponent_name || "TBD",
        location: m.location || "Location TBD",
        venueName: m.location || "Venue TBD",
        venueAddress: "",
        type: isInternal ? "scrimmage" : "game",
        category: isInternal ? "rec-league" : "school",
        notes: `${teamName} ${m.is_home_game ? "(Home)" : "(Away)"} — ${m.status || "scheduled"}`,
        durationMinutes: 90,
        arrivalOffsetMinutes: 60,
        warmupOffsetMinutes: 30,
        result: m.status === "completed"
          ? `${m.home_score ?? ""}-${m.away_score ?? ""}`.replace(/^-$/, "")
          : "",
      };
    });

    // 4) Transform trainings → calendar schedule item format
    const trainingItems = trainings.map((t) => {
      const teamName = t.teams?.name || "Team";
      const sportName = t.teams?.sports?.name || "sport";
      const dateStr = t.start_time
        ? `${t.training_date}T${t.start_time}`
        : `${t.training_date}T00:00:00`;

      return {
        id: t.training_id,
        date: dateStr,
        sport: sportName.toLowerCase(),
        opponent: t.title || "Practice",
        location: t.location || "Location TBD",
        venueName: t.location || "Venue TBD",
        venueAddress: "",
        type: t.type || "practice",
        category: "rec-league",
        notes: `${teamName} — ${t.description || t.type || "practice"}`,
        durationMinutes: 90,
        arrivalOffsetMinutes: 30,
        warmupOffsetMinutes: 15,
        result: "",
      };
    });

    return [...matchItems, ...trainingItems];
  } catch (err) {
    console.warn("Could not load athlete match schedule:", err);
    return [];
  }
}

async function loadProfileBundle(userId) {
  // Run directory + all role records in parallel
  const [directory, records] = await Promise.all([
    fetchTargetDirectory(userId),
    fetchUserRecord(userId),
  ]);

  const normalizedUserRole = normalizeRole(records.userRow?.role);

  const inferredRole = (records.athleteRow ? "athlete" : "")
    || (records.coachRow ? "coach" : "")
    || (records.schoolRow ? "school" : "")
    || (records.scoutRow ? "scout" : "")
    || (normalizedUserRole !== "user" ? normalizedUserRole : "")
    || (directory ? "user" : "");

  if (!records.userRow && !records.athleteRow && !records.coachRow && !records.schoolRow && !records.scoutRow && !directory) {
    throw new Error("Profile not found.");
  }

  // Run school name, counts, posts, stats, match schedule, and profile edits all in parallel
  const [schoolName, counts, posts, stats, realSchedule, athleteProfileRow, seasonStats] = await Promise.all([
    records.athleteRow?.school_id
      ? fetchSchoolName(records.athleteRow.school_id)
      : Promise.resolve(records.schoolRow?.name || ""),
    fetchCounts(userId),
    fetchVisiblePosts(userId, state.isSelf, state.isFollowing),
    fetchAthleteStats(records.athleteRow?.athlete_id),
    fetchAthleteMatchSchedule(userId),
    fetchAthleteProfile(userId),
    fetchSeasonAverages(userId),
  ]);

  const resolvedRole = inferredRole || normalizedUserRole || "user";
  const userRow = records.userRow || { user_id: userId, role: resolvedRole };

  const preferredDisplayName = records.schoolRow?.name || directory?.display_name || userRow.display_name || "";
  const profile = buildAthleteProfile({
    userId,
    directory: {
      user_id: userId,
      display_name: preferredDisplayName,
      email: directory?.email || userRow.email || "",
    },
    athleteRow: records.athleteRow,
    schoolName,
    stats,
    posts,
    counts,
    fallbackRole: resolvedRole || "athlete",
  });

  // Inject avatar/cover URLs from users table
  if (userRow.avatar_url) profile.avatarUrl = userRow.avatar_url;
  if (userRow.cover_url) profile.coverUrl = userRow.cover_url;

  // Override schedule with real match data if the athlete has any
  if (realSchedule.length) {
    profile.schedule = realSchedule;
  }

  // Override with athlete_profiles data (athlete-editable fields)
  if (athleteProfileRow) {
    if (athleteProfileRow.bio) profile.bio = athleteProfileRow.bio;
    if (athleteProfileRow.position) profile.position = athleteProfileRow.position;
    if (athleteProfileRow.hometown) profile.hometown = athleteProfileRow.hometown;
    if (athleteProfileRow.goals) profile.goals = athleteProfileRow.goals;
    if (athleteProfileRow.gpa) profile.gpa = String(athleteProfileRow.gpa);
    if (athleteProfileRow.height_inches || athleteProfileRow.weight_lbs) {
      const h = athleteProfileRow.height_inches;
      const w = athleteProfileRow.weight_lbs;
      profile.measurables = {
        ...profile.measurables,
        ...(h ? { Height: `${Math.floor(h / 12)}'${h % 12}"` } : {}),
        ...(w ? { Weight: `${w} lbs` } : {}),
      };
      if (athleteProfileRow.measurables) {
        const m = athleteProfileRow.measurables;
        if (m.wingspan) profile.measurables.Wingspan = m.wingspan;
        if (m.vertical) profile.measurables.Vertical = m.vertical;
        if (m.speed) profile.measurables.Speed = m.speed;
        if (m.reach) profile.measurables.Reach = m.reach;
      }
    }
    if (athleteProfileRow.highlights?.length) {
      profile.editableHighlights = athleteProfileRow.highlights;
    }
  }

  // Override with real season averages from athlete_stats
  if (seasonStats && Object.keys(seasonStats).length) {
    profile.realSeasonStats = seasonStats;
  }

  return {
    directory,
    userRow,
    athleteRow: records.athleteRow,
    coachRow: records.coachRow,
    schoolRow: records.schoolRow,
    scoutRow: records.scoutRow,
    schoolName,
    counts,
    posts,
    stats,
    profile,
    role: resolvedRole,
    athleteProfileRow,
  };
}

function heroMetricItems(profile, sport) {
  const m = profile?.measurables || {};
  const metrics = [
    { label: "Height", value: m.Height || "" },
    { label: "Weight", value: m.Weight || "" },
    { label: "Speed", value: m.Speed || "" },
    { label: "GPA", value: profile?.gpa || "" },
  ].filter((item) => item.value);

  // Add real season avg stats if available
  const realStats = profile?.realSeasonStats;
  if (realStats) {
    const topStatKeys = ["points", "goals", "pass_yards", "kills", "wins", "hits"];
    for (const key of topStatKeys) {
      if (realStats[key]) {
        const avg = realStats[key].avg;
        const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        metrics.push({ label: `Avg ${label}`, value: avg.toFixed(1) });
        break;
      }
    }
    const secondaryKeys = ["assists", "rebounds", "tackles", "digs", "rbi"];
    for (const key of secondaryKeys) {
      if (realStats[key]) {
        const avg = realStats[key].avg;
        const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        metrics.push({ label: `Avg ${label}`, value: avg.toFixed(1) });
        break;
      }
    }
  }

  // Fall back to sport stats from athleteData preset
  if (metrics.length < 4) {
    (sport?.stats || []).slice(0, 4 - metrics.length).forEach((stat) => {
      metrics.push({ label: stat.label, value: stat.value });
    });
  }

  return metrics.slice(0, 6);
}

function ratingFor(profile) {
  const activeSport = currentSport();
  const score = activeSport?.performanceRating || profile?.performanceRating || profile?.readiness?.score || 82;
  return (Number(score) / 10).toFixed(1);
}

function profileViewsFor(profile) {
  return seededValue(profile?.athleteId || profile?.userId || "views", 900, 5400).toLocaleString();
}

function recentPosts() {
  return state.posts.slice(0, 6);
}

function achievementItems(profile) {
  const sport = currentSport();
  const awards = (sport?.awards || []).map((award, index) => ({
    title: award,
    year: 2024 - index,
    detail: sport?.team || profile.school,
  }));
  const offers = (profile?.offers || []).map((offer) => ({
    title: `${offer.school} Offer`,
    year: new Date(offer.date || Date.now()).getFullYear(),
    detail: offer.official ? "Official offer" : `${offer.sport} interest`,
  }));
  const events = (profile?.events || []).map((event) => ({
    title: event.name,
    year: new Date(event.date || Date.now()).getFullYear(),
    detail: event.result || "Verified event",
  }));
  return [...awards, ...offers, ...events].slice(0, 6);
}

function genericAchievementItems(profile, sport) {
  const baseItems = achievementItems(profile);
  const templatesBySport = {
    basketball: [
      { year: 2026, title: "District Offensive MVP", detail: `${profile.school} Varsity Basketball` },
      { year: 2025, title: "First Team All-Region", detail: "Coaches Association Selection" },
      { year: 2025, title: "District Champions", detail: profile.school },
      { year: 2024, title: "Academic All-State", detail: "State Student Athlete Program" },
    ],
    soccer: [
      { year: 2026, title: "All-District Midfielder", detail: `${profile.school} Varsity Soccer` },
      { year: 2025, title: "First Team All-Region", detail: "Regional Coaches Poll" },
      { year: 2025, title: "Playmaker of the Year", detail: `${sport?.team || profile.school}` },
      { year: 2024, title: "Academic Honor Roll", detail: "Student Athlete Recognition" },
    ],
    track: [
      { year: 2026, title: "State Qualifier", detail: `${profile.school} Track & Field` },
      { year: 2025, title: "Regional Finals Podium", detail: "Verified Meet Result" },
      { year: 2025, title: "Top Performance Award", detail: `${sport?.team || profile.school}` },
      { year: 2024, title: "Academic Honor Roll", detail: "Student Athlete Recognition" },
    ],
    default: [
      { year: 2026, title: "Top Prospect Watchlist", detail: profile.school },
      { year: 2025, title: "All-Region Selection", detail: `${sport?.label || "Athlete"} Program` },
      { year: 2025, title: "Team Leadership Award", detail: `${sport?.team || profile.school}` },
      { year: 2024, title: "Academic Distinction", detail: "Student Athlete Recognition" },
    ],
  };

  const templates = templatesBySport[sport?.id] || templatesBySport.default;
  const merged = [];
  const seen = new Set();

  [...baseItems, ...templates].forEach((item) => {
    const key = normalizeText(item.title);
    if (!key || seen.has(key) || merged.length >= 6) return;
    seen.add(key);
    merged.push(item);
  });

  return merged;
}

function findSportStatValue(sport, keywords) {
  const match = (sport?.stats || []).find((stat) => {
    const label = normalizeText(stat.label);
    return keywords.some((keyword) => label.includes(keyword));
  });
  return match?.value || null;
}

function genericSeasonStats(profile, sport) {
  const seasonYear = new Date().getFullYear();

  // If we have real season stats from athlete_stats, use those
  const realStats = profile?.realSeasonStats;
  if (realStats && Object.keys(realStats).filter((k) => !k.startsWith("_")).length > 0) {
    const gp = realStats._gamesPlayed || 0;
    const items = [{ label: "Games", value: String(gp) }];
    for (const [key, val] of Object.entries(realStats)) {
      if (key.startsWith("_")) continue;
      const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const display = val.avg % 1 === 0 ? String(Math.round(val.avg)) : val.avg.toFixed(1);
      items.push({ label, value: display });
    }
    return { year: seasonYear, items: items.slice(0, 6) };
  }

  const defaultsBySport = {
    basketball: [
      { label: "Games", value: String(seededValue(`${profile.userId}:games`, 20, 30)) },
      { label: "Points", value: findSportStatValue(sport, ["points", "pts", "ppg"]) || String(seededValue(`${profile.userId}:points`, 14, 28)) },
      { label: "Assists", value: findSportStatValue(sport, ["assists", "ast"]) || String(seededValue(`${profile.userId}:assists`, 4, 11)) },
      { label: "Rebounds", value: findSportStatValue(sport, ["rebounds", "reb"]) || String(seededValue(`${profile.userId}:rebounds`, 5, 13)) },
      { label: "FG%", value: findSportStatValue(sport, ["fg", "field goal"]) || `${seededValue(`${profile.userId}:fg`, 43, 61)}%` },
      { label: "Steals", value: findSportStatValue(sport, ["steals", "stl"]) || String(seededValue(`${profile.userId}:steals`, 2, 5)) },
    ],
    soccer: [
      { label: "Games", value: String(seededValue(`${profile.userId}:games`, 18, 26)) },
      { label: "Goals", value: findSportStatValue(sport, ["goals", "goal"]) || String(seededValue(`${profile.userId}:goals`, 8, 22)) },
      { label: "Assists", value: findSportStatValue(sport, ["assists", "assist"]) || String(seededValue(`${profile.userId}:assists`, 6, 18)) },
      { label: "Pass Acc.", value: findSportStatValue(sport, ["pass accuracy", "accuracy"]) || `${seededValue(`${profile.userId}:pass`, 76, 92)}%` },
      { label: "Chances", value: findSportStatValue(sport, ["chances", "created"]) || String(seededValue(`${profile.userId}:chances`, 24, 51)) },
      { label: "MOTM", value: String(seededValue(`${profile.userId}:motm`, 3, 9)) },
    ],
    track: [
      { label: "Meets", value: String(seededValue(`${profile.userId}:meets`, 7, 15)) },
      { label: "Finals", value: String(seededValue(`${profile.userId}:finals`, 4, 10)) },
      { label: "Podiums", value: String(seededValue(`${profile.userId}:podiums`, 2, 7)) },
      { label: "PR Events", value: String(seededValue(`${profile.userId}:prs`, 2, 5)) },
      { label: "Points", value: String(seededValue(`${profile.userId}:points`, 18, 44)) },
      { label: "Top 3", value: String(seededValue(`${profile.userId}:top3`, 3, 8)) },
    ],
    default: [
      { label: "Games", value: String(seededValue(`${profile.userId}:games`, 16, 24)) },
      { label: "Impact", value: findSportStatValue(sport, ["impact"]) || String(seededValue(`${profile.userId}:impact`, 12, 30)) },
      { label: "Assists", value: findSportStatValue(sport, ["assists", "assist"]) || String(seededValue(`${profile.userId}:assists`, 3, 10)) },
      { label: "Readiness", value: findSportStatValue(sport, ["readiness"]) || `${seededValue(`${profile.userId}:readiness`, 72, 91)}%` },
      { label: "Efficiency", value: `${seededValue(`${profile.userId}:efficiency`, 74, 90)}%` },
      { label: "Honors", value: String(seededValue(`${profile.userId}:honors`, 2, 6)) },
    ],
  };

  return {
    year: seasonYear,
    items: defaultsBySport[sport?.id] || defaultsBySport.default,
  };
}

function highlightVideoConfig(profile, sport) {
  const sharedVideo = {
    embedUrl: "https://www.youtube-nocookie.com/embed/N4alsmZR08M?rel=0",
    watchUrl: "https://youtube.com/shorts/N4alsmZR08M?si=xNgPXhWV4LcO82vR",
  };

  const videosBySport = {
    basketball: {
      title: `${profile.name} Highlight Mix`,
      subtitle: `${sport?.season || "Current Season"} • Featured tape`,
      ...sharedVideo,
    },
    soccer: {
      title: `${profile.name} Midfield Highlights`,
      subtitle: `${sport?.season || "Current Season"} • Featured tape`,
      ...sharedVideo,
    },
    track: {
      title: `${profile.name} Event Highlights`,
      subtitle: `${sport?.season || "Current Season"} • Featured tape`,
      ...sharedVideo,
    },
  };

  return videosBySport[sport?.id] || {
    title: `${profile.name} Highlight Video`,
    subtitle: "Featured tape",
    ...sharedVideo,
  };
}

function gameLogRows(profile, sport) {
  const moments = (profile?.clutchMoments || []).slice(0, 5);
  if (moments.length) {
    return moments.map((moment, index) => ({
      date: formatShortDate(moment.date),
      opponent: moment.opponent,
      result: index % 2 === 0 ? `W ${3 + (index % 3)}-${1 + (index % 2)}` : `L ${1 + index}-${2 + index}`,
      impact: moment.statLine || (sport?.stats?.[0] ? `${sport.stats[0].label} ${sport.stats[0].value}` : "Strong performance"),
      minutes: `${75 + (index * 5)}'`,
    }));
  }

  return (profile?.schedule || []).slice(0, 5).map((item, index) => ({
    date: formatShortDate(item.date),
    opponent: item.opponent,
    result: index % 2 === 0 ? `W ${2 + index}-${1}` : `L ${1}-${2 + index}`,
    impact: (sport?.stats?.[index % Math.max(1, sport?.stats?.length || 1)]?.value) || "Active",
    minutes: `${70 + (index * 4)}'`,
  }));
}

function numericStatValue(value) {
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function metricValueForSport(sport, keywords, fallback = "N/A") {
  const lookup = (sport?.stats || []).find((item) => keywords.some((keyword) => normalizeText(item.label).includes(normalizeText(keyword))));
  return lookup?.value || fallback;
}

function metricImprovesWhenLower(label) {
  const normalized = normalizeText(label);
  return ["100m", "200m", "400m", "40 yard", "40 yard dash", "era", "whip", "time"].some((token) => normalized.includes(token));
}

function linePath(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function progressionChartMarkup(sport) {
  const rows = sport?.progression || [];
  if (!rows.length) {
    return `<div class="pp-empty">Progression data will appear once season stats are connected.</div>`;
  }

  const keys = Object.keys(rows[0]).filter((key) => key !== "year").slice(0, 3);
  const width = 320;
  const height = 190;
  const chartLeft = 42;
  const chartRight = width - 22;
  const chartTop = 22;
  const chartBottom = 132;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;
  const palette = ["#2563eb", "#f97316", "#14b8a6"];

  const series = keys.map((key, index) => {
    const raw = rows.map((row) => numericStatValue(row[key]));
    const min = Math.min(...raw);
    const max = Math.max(...raw);
    const span = max - min || 1;
    const invert = metricImprovesWhenLower(key);
    const points = raw.map((value, pointIndex) => {
      const normalized = invert ? (max - value) / span : (value - min) / span;
      return {
        x: chartLeft + ((chartWidth / Math.max(1, raw.length - 1)) * pointIndex),
        y: chartBottom - (normalized * chartHeight),
        value,
      };
    });
    return { key, color: palette[index % palette.length], points };
  });

  const gridLines = 4;

  return `
    <div class="pp-chart-shell">
      <svg class="pp-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${sport.label} progression chart`)}">
        ${Array.from({ length: gridLines }, (_, index) => {
          const y = chartTop + ((chartHeight / (gridLines - 1)) * index);
          return `<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" class="pp-chart-grid-line"></line>`;
        }).join("")}
        ${series.map((item) => `<path d="${linePath(item.points)}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>`).join("")}
        ${series.map((item) => item.points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="${item.color}"></circle>`).join("")).join("")}
        ${rows.map((row, index) => {
          const x = chartLeft + ((chartWidth / Math.max(1, rows.length - 1)) * index);
          return `<text x="${x}" y="${height - 20}" text-anchor="middle" class="pp-chart-axis-label">${escapeHtml(row.year)}</text>`;
        }).join("")}
      </svg>
      <div class="pp-chart-legend">
        ${series.map((item) => `
          <span><i style="background:${item.color}"></i>${escapeHtml(item.key)}</span>
        `).join("")}
      </div>
    </div>
  `;
}

function comparisonRowsForSport(sport) {
  return (sport?.compareRadar || []).slice(0, 5).map((item) => ({
    label: item.stat,
    athlete: item.marcus,
    average: item.avg,
  }));
}

function splitCardsForSport(profile, sport) {
  const sportId = sport?.id || "default";
  const rules = {
    basketball: [
      { label: "Home PPG", value: Number((numericStatValue(metricValueForSport(sport, ["ppg", "points"])) + 1.6).toFixed(1)), note: "Home floor" },
      { label: "Away PPG", value: Number((numericStatValue(metricValueForSport(sport, ["ppg", "points"])) - 1.2).toFixed(1)), note: "Road games" },
      { label: "League FG%", value: `${Math.max(38, Math.round(numericStatValue(metricValueForSport(sport, ["fg"])) - 3))}%`, note: "Conference" },
      { label: "Playoff AST", value: Number((numericStatValue(metricValueForSport(sport, ["apg", "assists"])) + 0.8).toFixed(1)), note: "Postseason" },
    ],
    soccer: [
      { label: "Home Goals", value: numericStatValue(metricValueForSport(sport, ["goals", "goal"])) + 2, note: "Home matches" },
      { label: "Away Assists", value: numericStatValue(metricValueForSport(sport, ["assists", "assist"])) - 1, note: "Road matches" },
      { label: "Pass Acc.", value: `${seededValue(`${profile.userId}:${sportId}:pass`, 78, 91)}%`, note: "League play" },
      { label: "Chances", value: seededValue(`${profile.userId}:${sportId}:chances`, 18, 34), note: "Last 5 matches" },
    ],
    football: [
      { label: "Home Yards", value: seededValue(`${profile.userId}:${sportId}:yards`, 280, 410), note: "Home games" },
      { label: "Road TDs", value: seededValue(`${profile.userId}:${sportId}:td`, 4, 9), note: "Away games" },
      { label: "Catch Rate", value: `${seededValue(`${profile.userId}:${sportId}:catch`, 61, 83)}%`, note: "Targets caught" },
      { label: "Explosive Plays", value: seededValue(`${profile.userId}:${sportId}:explosive`, 7, 16), note: "20+ yards" },
    ],
    baseball: [
      { label: "Home AVG", value: `.${seededValue(`${profile.userId}:${sportId}:avg-home`, 310, 388)}`, note: "Home series" },
      { label: "OBP", value: `.${seededValue(`${profile.userId}:${sportId}:obp`, 360, 440)}`, note: "Season" },
      { label: "SB Rate", value: `${seededValue(`${profile.userId}:${sportId}:sb`, 72, 92)}%`, note: "Stolen bases" },
      { label: "Vs RHP", value: `.${seededValue(`${profile.userId}:${sportId}:vrhp`, 285, 364)}`, note: "Split" },
    ],
    track: [
      { label: "Finals Rate", value: `${seededValue(`${profile.userId}:${sportId}:finals`, 55, 92)}%`, note: "Meets entered" },
      { label: "PR Events", value: seededValue(`${profile.userId}:${sportId}:pr`, 2, 6), note: "Season bests" },
      { label: "Podiums", value: seededValue(`${profile.userId}:${sportId}:podiums`, 3, 9), note: "Top 3 finishes" },
      { label: "Relay Split", value: `${seededValue(`${profile.userId}:${sportId}:split`, 42, 49)}.${seededValue(`${profile.userId}:${sportId}:split-dec`, 10, 99)}`, note: "4x100 split" },
    ],
    default: [
      { label: "Verified Events", value: seededValue(`${profile.userId}:${sportId}:events`, 6, 14), note: "Logged this year" },
      { label: "Top Finish", value: `#${seededValue(`${profile.userId}:${sportId}:finish`, 1, 8)}`, note: "Best result" },
      { label: "Consistency", value: `${seededValue(`${profile.userId}:${sportId}:consistency`, 72, 93)}%`, note: "Week to week" },
      { label: "Impact", value: seededValue(`${profile.userId}:${sportId}:impact`, 8, 18), note: "Key moments" },
    ],
  };

  return rules[sportId] || rules.default;
}

function sportContextItems(profile, sport) {
  return [
    { label: "Sport", value: sport.label },
    { label: "Primary Position", value: sport.position || profile.position },
    { label: "Season", value: sport.season || "Current" },
    { label: "Team", value: sport.team || profile.school },
    { label: "Record", value: sport.record || "Active" },
    { label: "Active Sports", value: String(profile.sports?.length || 1) },
    { label: "Class", value: profile.gradYear },
    { label: "School", value: profile.school },
  ];
}

function sportEventRows(profile, sport) {
  const scheduled = (profile.schedule || [])
    .filter((item) => item.sport === sport.id)
    .slice(0, 5)
    .map((item) => ({
      title: item.opponent,
      detail: `${formatLongDate(item.date)} • ${(item.type || "event").replace(/-/g, " ")}`,
      meta: item.venueName || item.location || "Venue TBD",
    }));

  if (scheduled.length) return scheduled;

  return (sport.timeline || []).slice(0, 4).map((item) => ({
    title: `${item.year} Season Marker`,
    detail: item.milestone,
    meta: item.rank,
  }));
}

function postEngagement(post, key) {
  return seededValue(`${post?.post_id || post?.caption || "post"}:${key}`, key === "likes" ? 48 : 12, key === "likes" ? 320 : 64);
}

function actionButtonsMarkup() {
  if (state.isSelf) {
    return `
      <button type="button" class="pp-btn pp-btn--primary" data-action="edit-profile">Edit Profile</button>
      <button type="button" class="pp-btn" data-action="share-profile">Share</button>
      <button type="button" class="pp-btn" data-action="download-profile">Download</button>
    `;
  }

  return `
    <button type="button" class="pp-btn pp-btn--primary" data-action="message-profile">Message</button>
    <button type="button" class="pp-btn" data-action="toggle-follow">${state.isFollowing ? "Following" : "Follow"}</button>
    <button type="button" class="pp-btn" data-action="share-profile">Share</button>
  `;
}

function shouldShowScoutPanel() {
  return canUseScoutWorkspace({
    viewerRole: state.viewerRole,
    viewerUserId: state.viewerUserId,
    targetUserId: state.targetUserId,
    isSelf: state.isSelf,
  });
}

function scoutNoteUpdatedLabel(value) {
  if (!value) return "Private to scouts on this account.";
  return `Saved ${formatRelativeTime(value)} • Private to scouts on this account.`;
}

function scoutPanelMarkup(profile) {
  if (!shouldShowScoutPanel() || !profile) return "";

  const workspace = state.scoutWorkspace || { saved: false, shortlisted: false, note: "", updatedAt: "" };

  return `
    <aside class="pp-card pp-scout-panel">
      <div class="pp-card-head">
        <h3>Scout Panel</h3>
        <span class="pp-chip">Private</span>
      </div>

      <div class="pp-scout-actions">
        <button type="button" class="pp-btn ${workspace.saved ? "pp-btn--primary" : ""}" data-action="toggle-save-athlete">
          ${workspace.saved ? "Saved Athlete" : "Save Athlete"}
        </button>
        <button type="button" class="pp-btn ${workspace.shortlisted ? "pp-btn--primary" : ""}" data-action="toggle-shortlist-athlete">
          ${workspace.shortlisted ? "On Shortlist" : "Add to shortlist"}
        </button>
      </div>

      <div class="pp-scout-note-box">
        <label class="pp-scout-label" for="scout-private-notes">Private Notes</label>
        <textarea
          id="scout-private-notes"
          class="pp-scout-textarea"
          placeholder="Write evaluation notes, recruiting fit, and next steps."
        >${escapeHtml(workspace.note)}</textarea>
        <p class="pp-scout-note-meta">${escapeHtml(scoutNoteUpdatedLabel(workspace.updatedAt))}</p>
        <button type="button" class="pp-btn pp-btn--primary" data-action="save-scout-note">
          Save Notes
        </button>
      </div>

      <div class="pp-scout-athlete-meta">
        <strong>${escapeHtml(profile.name)}</strong>
        <span>${escapeHtml(profile.position)} • ${escapeHtml(profile.school)}</span>
        <small>${escapeHtml(profile.ranking)}</small>
      </div>
    </aside>
  `;
}

function stageMarkup() {
  const content = tabStageMarkup();
  if (!shouldShowScoutPanel()) return content;

  return `
    <div class="pp-stage-shell">
      <div class="pp-stage-main">${content}</div>
      ${scoutPanelMarkup(state.profile)}
    </div>
  `;
}

function tabStageMarkup() {
  const profile = state.profile;
  const sport = currentSport();

  if (!profile || !sport) {
    return `<div class="pp-empty">Profile data is still loading.</div>`;
  }

  switch (state.activeTab) {
    case "stats":
      return statsTabMarkup(profile, sport);
    case "schedule":
      return scheduleTabMarkup(profile);
    case "posts":
      return postsTabMarkup(profile);
    case "achievements":
      return achievementsTabMarkup(profile, sport);
    case "media":
      return mediaTabMarkup(profile, sport);
    case "academics":
      return academicsTabMarkup(profile);
    case "overview":
    default:
      return overviewTabMarkup(profile, sport);
  }
}

function measurablesCardMarkup(profile) {
  const m = profile?.measurables || {};
  const entries = Object.entries(m).filter(([, v]) => v);
  if (!entries.length) return "";

  return `
    <article class="pp-card pp-card--measurables">
      <div class="pp-card-head">
        <h3>Measurables</h3>
      </div>
      <div class="pp-measurables-grid">
        ${entries.map(([label, value]) => `
          <div class="pp-measurable-item">
            <div class="pp-measurable-val">${escapeHtml(value)}</div>
            <div class="pp-measurable-label">${escapeHtml(label)}</div>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function realStatsCardMarkup(profile) {
  const rs = profile?.realSeasonStats;
  if (!rs || !Object.keys(rs).length) return "";

  const statEntries = Object.entries(rs)
    .filter(([, v]) => v && v.avg !== undefined)
    .sort((a, b) => (b[1].avg || 0) - (a[1].avg || 0))
    .slice(0, 6);

  if (!statEntries.length) return "";

  return `
    <article class="pp-card pp-card--real-stats">
      <div class="pp-card-head">
        <h3>Season Averages</h3>
        <span class="pp-chip">Live Data</span>
      </div>
      <div class="pp-real-stats-grid">
        ${statEntries.map(([key, data]) => {
          const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          const avg = data.avg;
          const total = data.total;
          const games = data.games;
          return `
            <div class="pp-real-stat">
              <div class="pp-real-stat-val">${escapeHtml(avg % 1 === 0 ? String(avg) : avg.toFixed(1))}</div>
              <div class="pp-real-stat-label">${escapeHtml(label)}</div>
              <div class="pp-real-stat-meta">${escapeHtml(String(total))} total · ${escapeHtml(String(games))} GP</div>
            </div>
          `;
        }).join("")}
      </div>
    </article>
  `;
}

function overviewTabMarkup(profile, sport) {
  const achievements = genericAchievementItems(profile, sport);
  const recent = recentPosts().slice(0, 4);
  const gameLog = gameLogRows(profile, sport).slice(0, 5);
  const seasonStats = genericSeasonStats(profile, sport);
  const highlightVideo = highlightVideoConfig(profile, sport);

  return `
    <div class="pp-grid pp-grid--overview">
      <article class="pp-card">
        <div class="pp-card-head">
          <h3>About ${escapeHtml(profile.name.split(" ")[0] || profile.name)}</h3>
        </div>
        <p class="pp-copy">${escapeHtml(profile.bio || "No athlete summary is available yet.")}</p>
        <div class="pp-chip-stack">
          ${(profile.strengths || []).map((item) => `<span class="pp-chip">${escapeHtml(item)}</span>`).join("")}
        </div>
      </article>

      ${measurablesCardMarkup(profile)}
      ${realStatsCardMarkup(profile)}

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Top Achievements</h3>
          <button type="button" class="pp-link-btn" data-switch-tab="achievements">View all</button>
        </div>
        <div class="pp-timeline pp-timeline--overview">
          ${achievements.map((item) => `
            <div class="pp-timeline-row">
              <strong>${escapeHtml(item.year)}</strong>
              <div>
                <h4>${escapeHtml(item.title)}</h4>
                <p>${escapeHtml(item.detail)}</p>
              </div>
            </div>
          `).join("")}
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Season Stats (${escapeHtml(String(seasonStats.year))})</h3>
          <button type="button" class="pp-link-btn" data-switch-tab="stats">View all</button>
        </div>
        <div class="pp-mini-stats pp-mini-stats--season">
          ${seasonStats.items.map((stat) => `
            <div class="pp-mini-stat">
              <strong>${escapeHtml(stat.value)}</strong>
              <span>${escapeHtml(stat.label)}</span>
            </div>
          `).join("")}
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Recent Posts</h3>
          <button type="button" class="pp-link-btn" data-switch-tab="posts">View all</button>
        </div>
        ${recent.length ? `
          <div class="pp-post-grid ${recent.length === 1 ? "pp-post-grid--single" : ""}">
            ${recent.map((post) => {
              const media = mediaSource(post);
              const thumb = media?.media_url || null;
              const isVideo = media?.media_type === "video";
              return `
                <article class="pp-post-tile">
                  ${thumb ? `
                    <div class="pp-post-tile-thumb">
                      ${isVideo
                        ? `<video class="pp-post-tile-img" src="${escapeHtml(thumb)}" preload="none"></video><span class="pp-post-tile-play">▶</span>`
                        : `<img class="pp-post-tile-img" src="${escapeHtml(thumb)}" alt="${escapeHtml(post.caption || "Post image")}" loading="lazy">`
                      }
                    </div>
                  ` : ""}
                  <div class="pp-post-tile-body">
                    <div class="pp-post-tile-author">
                      <img src="${escapeHtml(avatarImageFor(profile))}" alt="${escapeHtml(profile.name)}">
                      <div>
                        <strong>${escapeHtml(profile.name)}</strong>
                        <span>${escapeHtml(formatRelativeTime(post.created_at))}</span>
                      </div>
                    </div>
                    <p class="pp-post-tile-caption">${escapeHtml(post.caption || "No caption")}</p>
                    <div class="pp-post-tile-actions">
                      <span class="pp-action-icon">Likes: ${post.interactions_count || 0}</span>
                    </div>
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        ` : `<div class="pp-empty">No visible posts yet.</div>`}
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Game Log</h3>
        </div>
        <div class="pp-table">
          <div class="pp-table-head">
            <span>Date</span>
            <span>Opponent</span>
            <span>Result</span>
            <span>Impact</span>
            <span>Min</span>
          </div>
          ${gameLog.map((row) => `
            <div class="pp-table-row">
              <span>${escapeHtml(row.date)}</span>
              <span>${escapeHtml(row.opponent)}</span>
              <span>${escapeHtml(row.result)}</span>
              <span>${escapeHtml(row.impact)}</span>
              <span>${escapeHtml(row.minutes)}</span>
            </div>
          `).join("")}
        </div>
      </article>

      <article class="pp-card pp-card--video">
        <div class="pp-card-head">
          <h3>Highlight Video</h3>
          <button type="button" class="pp-link-btn" data-open-url="${escapeHtml(highlightVideo.watchUrl)}">Watch on YouTube</button>
        </div>
        <div class="pp-video-embed-wrap">
          <iframe
            class="pp-video-embed"
            src="${escapeHtml(highlightVideo.embedUrl)}"
            title="${escapeHtml(highlightVideo.title)}"
            loading="lazy"
            referrerpolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Basic Information</h3>
        </div>
        <div class="pp-basic-info">
          <div><span>Full Name</span><strong>${escapeHtml(profile.name)}</strong></div>
          <div><span>Date of Birth</span><strong>${escapeHtml(`${profile.gradYear - 18}-05-12`)}</strong></div>
          <div><span>Position</span><strong>${escapeHtml(profile.position)}</strong></div>
          <div><span>Jersey Number</span><strong>${escapeHtml(profile.number)}</strong></div>
          <div><span>Email</span><strong>${escapeHtml(profile.email || "Available on request")}</strong></div>
          <div><span>Phone</span><strong>${escapeHtml(`(${seededValue(profile.name, 210, 979)}) ${seededValue(profile.school, 120, 889)}-${seededValue(profile.position, 1000, 9999)}`)}</strong></div>
        </div>
      </article>
    </div>
  `;
}

function statsTabMarkup(profile, sport) {
  const chartConfig = sportChartConfig(sport);
  const leadMetric = progressionLeadMetric(sport);
  return `
    <div class="pp-tab-stack">
      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Season Performance</h3>
          <div class="pp-stats-toolbar">
            <label class="pp-stats-select">
              <span>Sport</span>
              <select data-sport-select>
                ${(profile.sports || []).map((item) => `
                  <option value="${escapeHtml(item.id)}" ${state.activeSportId === item.id ? "selected" : ""}>
                    ${escapeHtml(`${item.icon} ${item.label}`)}
                  </option>
                `).join("")}
              </select>
            </label>
          </div>
        </div>
        <div class="pp-stat-grid">
          ${(sport.stats || []).map((stat) => {
            const badge = badgeMeta(stat.badge);
            return `
              <article class="pp-stat-card">
                <strong>${escapeHtml(stat.value)}</strong>
                <span>${escapeHtml(stat.label)}</span>
                <small class="pp-badge is-${badge.tone}">${badge.icon} ${badge.short}</small>
              </article>
            `;
          }).join("")}
        </div>
      </article>

      <div class="pp-grid pp-grid--charts">
        <article class="pp-card pp-card--chart" data-chart-card="line">
          <div class="pp-card-head">
            <h3>Performance Over Time</h3>
          </div>
          <div class="pp-stats-chart-wrap">
            <canvas id="pp-stats-line-chart" class="pp-stats-chart-canvas" aria-label="${escapeHtml(`${sport.label} line chart`)}"></canvas>
          </div>
          <p class="pp-stats-chart-note">${escapeHtml(leadMetric || "Progression trend from connected stats.")}</p>
        </article>

        <article class="pp-card pp-card--chart" data-chart-card="bar">
          <div class="pp-card-head">
            <h3>Per-Game Stats</h3>
          </div>
          <div class="pp-stats-chart-wrap">
            <canvas id="pp-stats-bar-chart" class="pp-stats-chart-canvas" aria-label="${escapeHtml(`${sport.label} bar chart`)}"></canvas>
          </div>
          <p class="pp-stats-chart-note">${escapeHtml(`${chartConfig.barMetrics.length || 0} tracked metrics for ${sport.label}.`)}</p>
        </article>

        <article class="pp-card pp-card--chart" data-chart-card="radar">
          <div class="pp-card-head">
            <h3>Skill Distribution</h3>
          </div>
          <div class="pp-stats-chart-wrap">
            <canvas id="pp-stats-radar-chart" class="pp-stats-chart-canvas" aria-label="${escapeHtml(`${sport.label} radar chart`)}"></canvas>
          </div>
          <p class="pp-stats-chart-note">${escapeHtml(`${sport.compareRadar?.length || 0} skill areas compared against role average.`)}</p>
        </article>
      </div>

      <div class="pp-grid pp-grid--split">
        <article class="pp-card">
          <div class="pp-card-head">
            <h3>Sport Context</h3>
          </div>
          <div class="pp-basic-info">
            ${sportContextItems(profile, sport).map((item) => `
              <div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>
            `).join("")}
          </div>
        </article>

        <article class="pp-card">
          <div class="pp-card-head">
            <h3>Year over Year</h3>
          </div>
          <div class="pp-progress-table">
            ${(sport.progression || []).map((row) => `
              <div class="pp-progress-row">
                <strong>${escapeHtml(row.year)}</strong>
                <div class="pp-progress-values">
                  ${Object.entries(row)
                    .filter(([key]) => key !== "year")
                    .map(([label, value]) => `<span>${escapeHtml(label)} <b>${escapeHtml(value)}</b></span>`)
                    .join("")}
                </div>
              </div>
            `).join("")}
          </div>
        </article>
      </div>

      <div class="pp-grid pp-grid--split">
        <article class="pp-card">
          <div class="pp-card-head">
            <h3>Splits + Situational Stats</h3>
          </div>
          <div class="pp-mini-stats">
            ${splitCardsForSport(profile, sport).map((item) => `
              <div class="pp-mini-stat">
                <strong>${escapeHtml(item.value)}</strong>
                <span>${escapeHtml(item.label)}</span>
                <small>${escapeHtml(item.note)}</small>
              </div>
            `).join("")}
          </div>
        </article>

        <article class="pp-card">
          <div class="pp-card-head">
            <h3>Profile Summary</h3>
          </div>
          <div class="pp-mini-stats">
            <div class="pp-mini-stat"><strong>${escapeHtml(sport.team || profile.school)}</strong><span>Team</span></div>
            <div class="pp-mini-stat"><strong>${escapeHtml(sport.record || "Active")}</strong><span>Record</span></div>
            <div class="pp-mini-stat"><strong>${escapeHtml(sport.season || "Current")}</strong><span>Season</span></div>
            <div class="pp-mini-stat"><strong>${escapeHtml(profile.ranking)}</strong><span>Ranking</span></div>
          </div>
        </article>

        <article class="pp-card">
          <div class="pp-card-head">
            <h3>${escapeHtml(sport.label)} Event Log</h3>
          </div>
          <div class="pp-list">
            ${sportEventRows(profile, sport).map((item) => `
              <div class="pp-list-row">
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.detail)}</span>
                <small>${escapeHtml(item.meta)}</small>
              </div>
            `).join("")}
          </div>
        </article>

        <article class="pp-card">
          <div class="pp-card-head">
            <h3>Development Timeline</h3>
          </div>
          <div class="pp-timeline">
            ${(sport.timeline || []).map((item) => `
              <div class="pp-timeline-row">
                <strong>${escapeHtml(item.year)}</strong>
                <div>
                  <h4>${escapeHtml(item.rank)}</h4>
                  <p>${escapeHtml(item.milestone)}</p>
                </div>
              </div>
            `).join("")}
          </div>
        </article>

        <article class="pp-card">
          <div class="pp-card-head">
            <h3>${escapeHtml(sport.label)} Honors</h3>
          </div>
          <div class="pp-chip-stack">
            ${(sport.awards || []).map((award) => `<span class="pp-chip">${escapeHtml(award)}</span>`).join("")}
            <span class="pp-chip">${escapeHtml(`${profile.sports?.length || 1} Sport${(profile.sports?.length || 1) > 1 ? "s" : ""} Active`)}</span>
            <span class="pp-chip">${escapeHtml(`${sport.grade || "Current"} ${sport.season || "Season"}`)}</span>
          </div>
        </article>
      </div>
    </div>
  `;
}

function postsTabMarkup(profile) {
  return `
    <div class="pp-post-feed">
      ${recentPosts().length ? recentPosts().map((post) => `
        <article class="pp-post-card pp-post-card--full">
          <div class="pp-post-topline">
            <div class="pp-post-author">
              <img src="${escapeHtml(avatarImageFor(profile))}" alt="${escapeHtml(profile.name)}">
              <div>
                <strong>${escapeHtml(profile.name)}</strong>
                <span>${escapeHtml(formatRelativeTime(post.created_at))}</span>
              </div>
            </div>
            <span class="pp-chip">${escapeHtml(post.visibility || "public")}</span>
          </div>
          <p>${escapeHtml(post.caption || "No caption added.")}</p>
          ${postMediaMarkup(post, profile, "pp-post-media pp-post-media--large")}
          <div class="pp-post-actions">
            <span class="pp-action-icon">Likes: ${post.interactions_count || 0}</span>
            <span>↗ Share</span>
          </div>
        </article>
      `).join("") : `<div class="pp-empty">No visible posts are available for this profile.</div>`}
    </div>
  `;
}

function achievementsTabMarkup(profile, sport) {
  const achievements = achievementItems(profile);
  return `
    <div class="pp-grid pp-grid--split">
      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Achievements</h3>
        </div>
        <div class="pp-timeline">
          ${achievements.map((item) => `
            <div class="pp-timeline-row">
              <strong>${escapeHtml(item.year)}</strong>
              <div>
                <h4>${escapeHtml(item.title)}</h4>
                <p>${escapeHtml(item.detail)}</p>
              </div>
            </div>
          `).join("")}
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Recruiting + Event History</h3>
        </div>
        <div class="pp-list">
          ${(profile.offers || []).map((offer) => `
            <div class="pp-list-row">
              <strong>${escapeHtml(offer.school)}</strong>
              <span>${escapeHtml(offer.official ? "Official Offer" : `${offer.sport} Interest`)}</span>
              <small>${escapeHtml(formatLongDate(offer.date))}</small>
            </div>
          `).join("")}
          ${(profile.events || []).map((event) => `
            <div class="pp-list-row">
              <strong>${escapeHtml(event.name)}</strong>
              <span>${escapeHtml(event.result || "Verified Event")}</span>
              <small>${escapeHtml(formatLongDate(event.date))}</small>
            </div>
          `).join("")}
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>${escapeHtml(sport.label)} Honors</h3>
        </div>
        <div class="pp-chip-stack">
          ${(sport.awards || []).map((award) => `<span class="pp-chip">${escapeHtml(award)}</span>`).join("")}
        </div>
      </article>
    </div>
  `;
}

function mediaTabMarkup(profile, sport) {
  const mediaPosts = recentPosts().filter((post) => mediaSource(post)?.media_url);
  const library = mediaPosts.length
    ? mediaPosts.map((post) => ({
        title: post.caption || `${profile.name} media`,
        image: mediaSource(post)?.media_url || heroImageFor(profile),
        type: mediaSource(post)?.media_type || post.post_type || "image",
        meta: `${post.post_type || "media"} • ${formatRelativeTime(post.created_at)}`,
      }))
    : (profile.highlights || []).map((item) => ({
        title: item.title,
        image: item.mediaUrl || heroImageFor(profile),
        type: item.type || "image",
        meta: `${item.type} • ${item.duration}`,
      }));

  const featured = library[0];

  return `
    <div class="pp-tab-stack">
      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Featured Media</h3>
        </div>
        ${featured ? `
          <button type="button" class="pp-video-card pp-video-card--wide" data-open-url="${escapeHtml(featured.image)}">
            ${featured.type === "video"
              ? `<div class="pp-video-thumb pp-video-thumb--wide pp-video-thumb--video"><span class="pp-play-icon">▶</span></div>`
              : `<div class="pp-video-thumb pp-video-thumb--wide" style="background-image:url('${escapeHtml(featured.image)}')"><span class="pp-play-icon">▶</span></div>`}
            <div class="pp-video-meta">
              <strong>${escapeHtml(featured.title)}</strong>
              <span>${escapeHtml(featured.meta)}</span>
            </div>
          </button>
        ` : `<div class="pp-empty">No media available.</div>`}
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Media Library</h3>
        </div>
        <div class="pp-media-grid">
          ${library.map((item) => `
            <button type="button" class="pp-media-card" data-open-url="${escapeHtml(item.image)}">
              ${item.type === "video"
                ? `<div class="pp-media-cover pp-media-cover--video"><span class="pp-play-icon">▶</span></div>`
                : `<div class="pp-media-cover" style="background-image:url('${escapeHtml(item.image)}')"></div>`}
              <div class="pp-media-copy">
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.meta)}</span>
              </div>
            </button>
          `).join("")}
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>${escapeHtml(sport.label)} Film Notes</h3>
        </div>
        <p class="pp-copy">${escapeHtml(profile.playingStyle)}</p>
      </article>
    </div>
  `;
}

function academicsTabMarkup(profile) {
  const readiness = profile.readiness?.score || 82;
  return `
    <div class="pp-grid pp-grid--split">
      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Academic Snapshot</h3>
        </div>
        <div class="pp-basic-info">
          <div><span>GPA</span><strong>${escapeHtml(profile.gpa)}</strong></div>
          <div><span>Class</span><strong>${escapeHtml(profile.gradYear)}</strong></div>
          <div><span>Hometown</span><strong>${escapeHtml(profile.hometown)}</strong></div>
          <div><span>Readiness</span><strong>${escapeHtml(`${readiness}%`)}</strong></div>
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Goals + Fit</h3>
        </div>
        <p class="pp-copy">${escapeHtml(profile.goals || "No academic goals shared yet.")}</p>
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Coach Quote</h3>
        </div>
        <blockquote class="pp-quote">“${escapeHtml(profile.coachQuote?.text || "Trusted athlete with strong long-term upside.")}”</blockquote>
        <p class="pp-quote-meta">${escapeHtml(profile.coachQuote?.author || "Program Staff")} • ${escapeHtml(profile.coachQuote?.role || "Coach")}</p>
      </article>
    </div>
  `;
}

function scheduleTabMarkup(profile) {
  const items = scheduleItems(profile);
  const upcoming = items.filter((item) => item.startDate.getTime() >= Date.now());
  const monthStart = new Date(state.scheduleMonth.getFullYear(), state.scheduleMonth.getMonth(), 1);
  const firstCell = new Date(monthStart);
  firstCell.setDate(firstCell.getDate() - firstCell.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    const events = items.filter((item) => item.dateKey === key);
    return { date, events, inMonth: date.getMonth() === monthStart.getMonth() };
  });

  return `
    <div class="pp-tab-stack">
      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Upcoming Events</h3>
        </div>
        <div class="pp-schedule-list">
          ${upcoming.length ? upcoming.map((item) => {
            const category = scheduleCategoryMeta(item.category);
            return `
              <div class="pp-schedule-row">
                <div class="pp-schedule-date">
                  <span>${escapeHtml(item.startDate.toLocaleDateString(undefined, { month: "short" }))}</span>
                  <strong>${item.startDate.getDate()}</strong>
                </div>
                <div class="pp-schedule-copy">
                  <div class="pp-schedule-topline">
                    <strong>${escapeHtml(item.opponent)}</strong>
                    <span class="pp-schedule-tag" style="--pp-schedule-color:${category.color}">${escapeHtml(category.label)}</span>
                  </div>
                  <p>${escapeHtml(formatLongDate(item.date))} • ${escapeHtml(formatTime(item.date))}</p>
                  <small>${escapeHtml(item.venueName)}</small>
                </div>
              </div>
            `;
          }).join("") : `<div class="pp-empty">No upcoming events are available yet.</div>`}
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Monthly Schedule</h3>
          <div class="pp-inline-actions">
            <button type="button" class="pp-link-btn" data-month-step="-1">Previous</button>
            <span class="pp-month-label">${escapeHtml(monthLabel(state.scheduleMonth))}</span>
            <button type="button" class="pp-link-btn" data-month-step="1">Next</button>
          </div>
        </div>

        <div class="pp-calendar-legend">
          ${Object.entries(SCHEDULE_CATEGORY_META).map(([, meta]) => `
            <span><i style="background:${meta.color}"></i>${escapeHtml(meta.label)}</span>
          `).join("")}
        </div>

        <div class="pp-calendar-grid">
          ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span class="pp-calendar-weekday">${day}</span>`).join("")}
          ${days.map((day) => `
            <div class="pp-calendar-day ${day.inMonth ? "" : "is-muted"} ${day.events.length ? "has-event" : ""}">
              <div class="pp-calendar-day-head">
                <span>${day.date.getDate()}</span>
                ${day.events.length ? `<strong>${day.events.length}</strong>` : ""}
              </div>
              <div class="pp-calendar-dots">
                ${day.events.slice(0, 3).map((item) => {
                  const category = scheduleCategoryMeta(item.category);
                  return `<i style="background:${category.color}"></i>`;
                }).join("")}
              </div>
              ${day.events.length ? `<small>${escapeHtml(day.events[0].opponent)}</small>` : ""}
            </div>
          `).join("")}
        </div>
      </article>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// ── Non-athlete profile rendering (coach / scout / school_admin)
// ═══════════════════════════════════════════════════════════════

const ROLE_TABS = {
  coach:        [{ id: "overview", label: "Overview" }, { id: "posts", label: "Posts" }],
  scout:        [{ id: "overview", label: "Overview" }, { id: "posts", label: "Posts" }],
  school_admin: [{ id: "overview", label: "Overview" }, { id: "posts", label: "Posts" }],
};

const ROLE_HERO_IMAGES = {
  coach:        "https://images.unsplash.com/photo-1526232761682-d26e03ac148e?auto=format&fit=crop&w=1600&q=80",
  scout:        "https://images.unsplash.com/photo-1560272564-c83b66b1ad12?auto=format&fit=crop&w=1600&q=80",
  school_admin: "https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=1600&q=80",
};

function roleHeroMetrics() {
  const role = state.role;
  if (role === "coach") {
    const c = state.coachRow || {};
    const teamCount = state.coachTeams?.length || 0;
    return [
      { label: "Teams", value: String(teamCount) },
      { label: "Experience", value: c.years_experience ? `${c.years_experience} yrs` : "N/A" },
      { label: "Posts", value: String(state.counts.posts || 0) },
      { label: "Followers", value: String(state.counts.followers || 0) },
    ].filter((m) => m.value && m.value !== "N/A");
  }
  if (role === "scout") {
    const s = state.scoutRow || {};
    return [
      { label: "Organization", value: s.organization || "Independent" },
      { label: "Title", value: s.title || "Scout" },
      { label: "Posts", value: String(state.counts.posts || 0) },
      { label: "Following", value: String(state.counts.following || 0) },
    ].filter((m) => m.value);
  }
  // school_admin
  const sch = state.schoolRow || {};
  return [
    { label: "Location", value: sch.location || "N/A" },
    { label: "Posts", value: String(state.counts.posts || 0) },
    { label: "Followers", value: String(state.counts.followers || 0) },
    { label: "Following", value: String(state.counts.following || 0) },
  ].filter((m) => m.value && m.value !== "N/A");
}

function roleSubtitle() {
  const role = state.role;
  if (role === "coach") {
    const c = state.coachRow || {};
    const teamNames = (state.coachTeams || []).slice(0, 2).map((t) => t.name || t.sports?.name || "Team").join(", ");
    return teamNames || (c.years_experience ? `${c.years_experience} years coaching` : "Coach");
  }
  if (role === "scout") {
    const s = state.scoutRow || {};
    return [s.title, s.organization].filter(Boolean).join(" at ") || "Scout";
  }
  // school_admin
  const sch = state.schoolRow || {};
  return sch.location || "School Administrator";
}

function roleBio() {
  if (state.role === "coach") return state.coachRow?.bio || "";
  if (state.role === "school_admin") return state.schoolRow?.description || "";
  return "";
}

function roleRoleName() {
  const map = { coach: "Coach", scout: "Scout", school_admin: "School Admin", school: "School" };
  return map[state.role] || "Member";
}

function coachOverviewMarkup() {
  const profile = state.profile;
  const bio = roleBio();
  const teams = state.coachTeams || [];
  const recent = recentPosts().slice(0, 3);

  return `
    <div class="pp-grid pp-grid--overview">
      <article class="pp-card">
        <div class="pp-card-head"><h3>About</h3></div>
        <p class="pp-copy">${escapeHtml(bio || "No bio available yet.")}</p>
        ${state.coachRow?.years_experience ? `<div class="pp-chip-stack"><span class="pp-chip">${escapeHtml(state.coachRow.years_experience)} years experience</span></div>` : ""}
      </article>

      <article class="pp-card">
        <div class="pp-card-head"><h3>Teams</h3></div>
        ${teams.length ? `
          <div class="pp-list">
            ${teams.map((t) => `
              <div class="pp-list-row">
                <strong>${escapeHtml(t.name || "Team")}</strong>
                <span>${escapeHtml(t.sports?.name || "Sport")}${t.sports?.gender ? ` (${escapeHtml(t.sports.gender)})` : ""}</span>
                <small>${escapeHtml(t.seasons?.name || "Current Season")}</small>
              </div>
            `).join("")}
          </div>
        ` : `<div class="pp-empty">No teams assigned yet.</div>`}
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Recent Posts</h3>
          ${recent.length ? `<button type="button" class="pp-link-btn" data-switch-tab="posts">View all</button>` : ""}
        </div>
        ${recent.length ? `
          <div class="pp-post-grid">
            ${recent.map((post) => `
              <article class="pp-post-tile">
                <div class="pp-post-tile-body">
                  <div class="pp-post-tile-author">
                    <img src="${escapeHtml(avatarImageFor(profile))}" alt="${escapeHtml(profile.name)}">
                    <div>
                      <strong>${escapeHtml(profile.name)}</strong>
                      <span>${escapeHtml(formatRelativeTime(post.created_at))}</span>
                    </div>
                  </div>
                  <p class="pp-post-tile-caption">${escapeHtml(post.caption || "No caption")}</p>
                  <div class="pp-post-tile-actions">
                    <span class="pp-action-icon">Likes: ${post.interactions_count || 0}</span>
                  </div>
                </div>
              </article>
            `).join("")}
          </div>
        ` : `<div class="pp-empty">No posts yet.</div>`}
      </article>

      <article class="pp-card">
        <div class="pp-card-head"><h3>Contact</h3></div>
        <div class="pp-basic-info">
          <div><span>Name</span><strong>${escapeHtml(profile.name)}</strong></div>
          <div><span>Email</span><strong>${escapeHtml(profile.email || "Available on request")}</strong></div>
          <div><span>Role</span><strong>${escapeHtml(roleRoleName())}</strong></div>
        </div>
      </article>
    </div>
  `;
}

function scoutOverviewMarkup() {
  const profile = state.profile;
  const s = state.scoutRow || {};
  const recent = recentPosts().slice(0, 3);

  return `
    <div class="pp-grid pp-grid--overview">
      <article class="pp-card">
        <div class="pp-card-head"><h3>About</h3></div>
        <div class="pp-basic-info">
          <div><span>Organization</span><strong>${escapeHtml(s.organization || "Independent")}</strong></div>
          <div><span>Title</span><strong>${escapeHtml(s.title || "Scout")}</strong></div>
          <div><span>Email</span><strong>${escapeHtml(profile.email || "Available on request")}</strong></div>
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head"><h3>Activity</h3></div>
        <div class="pp-mini-stats pp-mini-stats--season">
          <div class="pp-mini-stat"><strong>${state.counts.posts || 0}</strong><span>Posts</span></div>
          <div class="pp-mini-stat"><strong>${state.counts.followers || 0}</strong><span>Followers</span></div>
          <div class="pp-mini-stat"><strong>${state.counts.following || 0}</strong><span>Following</span></div>
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Recent Posts</h3>
          ${recent.length ? `<button type="button" class="pp-link-btn" data-switch-tab="posts">View all</button>` : ""}
        </div>
        ${recent.length ? `
          <div class="pp-post-grid">
            ${recent.map((post) => `
              <article class="pp-post-tile">
                <div class="pp-post-tile-body">
                  <div class="pp-post-tile-author">
                    <img src="${escapeHtml(avatarImageFor(profile))}" alt="${escapeHtml(profile.name)}">
                    <div>
                      <strong>${escapeHtml(profile.name)}</strong>
                      <span>${escapeHtml(formatRelativeTime(post.created_at))}</span>
                    </div>
                  </div>
                  <p class="pp-post-tile-caption">${escapeHtml(post.caption || "No caption")}</p>
                </div>
              </article>
            `).join("")}
          </div>
        ` : `<div class="pp-empty">No posts yet.</div>`}
      </article>
    </div>
  `;
}

function schoolOverviewMarkup() {
  const profile = state.profile;
  const sch = state.schoolRow || {};
  const recent = recentPosts().slice(0, 3);

  return `
    <div class="pp-grid pp-grid--overview">
      <article class="pp-card">
        <div class="pp-card-head"><h3>About</h3></div>
        <p class="pp-copy">${escapeHtml(sch.description || "No school description available yet.")}</p>
      </article>

      <article class="pp-card">
        <div class="pp-card-head"><h3>School Info</h3></div>
        <div class="pp-basic-info">
          <div><span>School Name</span><strong>${escapeHtml(sch.name || profile.name)}</strong></div>
          <div><span>Location</span><strong>${escapeHtml(sch.location || "Not specified")}</strong></div>
          <div><span>Contact</span><strong>${escapeHtml(profile.email || "Available on request")}</strong></div>
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head"><h3>Activity</h3></div>
        <div class="pp-mini-stats pp-mini-stats--season">
          <div class="pp-mini-stat"><strong>${state.counts.posts || 0}</strong><span>Posts</span></div>
          <div class="pp-mini-stat"><strong>${state.counts.followers || 0}</strong><span>Followers</span></div>
          <div class="pp-mini-stat"><strong>${state.counts.following || 0}</strong><span>Following</span></div>
        </div>
      </article>

      <article class="pp-card">
        <div class="pp-card-head">
          <h3>Recent Posts</h3>
          ${recent.length ? `<button type="button" class="pp-link-btn" data-switch-tab="posts">View all</button>` : ""}
        </div>
        ${recent.length ? `
          <div class="pp-post-grid">
            ${recent.map((post) => `
              <article class="pp-post-tile">
                <div class="pp-post-tile-body">
                  <div class="pp-post-tile-author">
                    <img src="${escapeHtml(avatarImageFor(profile))}" alt="${escapeHtml(profile.name)}">
                    <div>
                      <strong>${escapeHtml(profile.name)}</strong>
                      <span>${escapeHtml(formatRelativeTime(post.created_at))}</span>
                    </div>
                  </div>
                  <p class="pp-post-tile-caption">${escapeHtml(post.caption || "No caption")}</p>
                </div>
              </article>
            `).join("")}
          </div>
        ` : `<div class="pp-empty">No posts yet.</div>`}
      </article>
    </div>
  `;
}

function roleOverviewTabMarkup() {
  if (state.role === "coach") return coachOverviewMarkup();
  if (state.role === "scout") return scoutOverviewMarkup();
  return schoolOverviewMarkup();
}

function roleStageMarkup() {
  if (state.activeTab === "posts") return postsTabMarkup(state.profile);
  return roleOverviewTabMarkup();
}

function renderRoleProfile() {
  const root = document.querySelector("#profile-experience");
  if (!root) return;
  destroyProfileStatsCharts();

  const profile = state.profile;
  if (!profile) {
    root.innerHTML = `<div class="pp-empty">Loading profile…</div>`;
    return;
  }

  const heroImage = ROLE_HERO_IMAGES[state.role] || ROLE_HERO_IMAGES.coach;
  const heroMetrics = roleHeroMetrics();
  const tabs = ROLE_TABS[state.role] || ROLE_TABS.coach;

  root.innerHTML = `
    <section class="pp-profile">
      <div class="pp-hero" style="background-image:linear-gradient(180deg, rgba(8,15,28,.22), rgba(8,15,28,.88)), url('${escapeHtml(heroImage)}')">
        ${state.isSelf ? `<button type="button" class="pp-cover-edit-btn" data-action="change-cover" title="Change cover photo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg></button>` : ""}
        <div class="pp-hero-main">
          <div class="pp-identity">
            <div class="pp-avatar-wrap">
              <img class="pp-avatar" src="${escapeHtml(avatarImageFor(profile))}" alt="${escapeHtml(profile.name)}">
              ${state.isSelf ? `<button type="button" class="pp-avatar-edit-btn" data-action="change-avatar" title="Change profile picture"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg></button>` : `<span class="pp-avatar-badge">${escapeHtml(roleRoleName()[0])}</span>`}
            </div>
            <div class="pp-headline">
              <div class="pp-name-row">
                <h1>${escapeHtml(profile.name)}</h1>
                <span class="pp-chip pp-chip--role">${escapeHtml(roleRoleName())}</span>
              </div>
              <p class="pp-role-line">${escapeHtml(roleSubtitle())}</p>
              <div class="pp-social-stats">
                <span class="pp-social-stat">${state.counts.posts ?? 0} <small>Posts</small></span>
                <span class="pp-social-stat pp-social-stat--clickable" data-show-follow="followers">${state.counts.followers ?? 0} <small>Followers</small></span>
                <span class="pp-social-stat pp-social-stat--clickable" data-show-follow="following">${state.counts.following ?? 0} <small>Following</small></span>
              </div>
              <div class="pp-action-row">
                ${actionButtonsMarkup()}
              </div>
            </div>
          </div>
        </div>

        <div class="pp-metrics-bar">
          ${heroMetrics.map((item) => `
            <div class="pp-metric-tile">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="pp-tab-bar">
        <div class="pp-tabs">
          ${tabs.map((tab) => `
            <button type="button" class="pp-tab ${state.activeTab === tab.id ? "is-active" : ""}" data-tab-id="${tab.id}">
              ${escapeHtml(tab.label)}
            </button>
          `).join("")}
        </div>
      </div>

      <div class="pp-stage">
        ${roleStageMarkup()}
      </div>
    </section>
    <div id="profile-toast" class="pp-toast" hidden></div>
  `;
}

function renderProfile() {
  // Route to role-specific profile for non-athletes
  if (state.role && state.role !== "athlete" && state.role !== "user") {
    renderRoleProfile();
    return;
  }

  const root = document.querySelector("#profile-experience");
  if (!root) return;
  destroyProfileStatsCharts();

  const profile = state.profile;
  const sport = currentSport();
  if (!profile || !sport) {
    root.innerHTML = `<div class="pp-empty">Loading profile…</div>`;
    return;
  }

  const heroMetrics = heroMetricItems(profile, sport);

  root.innerHTML = `
    <section class="pp-profile">
      <div class="pp-hero" style="background-image:linear-gradient(180deg, rgba(8,15,28,.22), rgba(8,15,28,.88)), url('${escapeHtml(heroImageFor(profile))}')">
        ${state.isSelf ? `<button type="button" class="pp-cover-edit-btn" data-action="change-cover" title="Change cover photo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg></button>` : ""}
        <div class="pp-hero-main">
          <div class="pp-identity">
            <div class="pp-avatar-wrap">
              <img class="pp-avatar" src="${escapeHtml(avatarImageFor(profile))}" alt="${escapeHtml(profile.name)}">
              ${state.isSelf ? `<button type="button" class="pp-avatar-edit-btn" data-action="change-avatar" title="Change profile picture"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg></button>` : `<span class="pp-avatar-badge">V</span>`}
            </div>
            <div class="pp-headline">
              <div class="pp-name-row">
                <h1>${escapeHtml(profile.name)}</h1>
                <span class="pp-verified">Verified</span>
              </div>
              <p class="pp-role-line">${escapeHtml(profile.position)} • ${escapeHtml(sport.label)}</p>
              <p class="pp-meta-line">${escapeHtml(profile.school)} • ${escapeHtml(profile.hometown)} • Class of ${escapeHtml(profile.gradYear)}</p>
              <p class="pp-summary-line">${escapeHtml(formatScoutSummary(profile))}</p>
              <div class="pp-social-stats">
                <span class="pp-social-stat">${state.counts.posts ?? 0} <small>Posts</small></span>
                <span class="pp-social-stat pp-social-stat--clickable" data-show-follow="followers">${state.counts.followers ?? 0} <small>Followers</small></span>
                <span class="pp-social-stat pp-social-stat--clickable" data-show-follow="following">${state.counts.following ?? 0} <small>Following</small></span>
              </div>
              <div class="pp-action-row">
                ${actionButtonsMarkup()}
              </div>
            </div>
          </div>

          <aside class="pp-rating-card">
            <span>Athlete Rating</span>
            <strong>${escapeHtml(ratingFor(profile))}</strong>
            <p>Ranked ${escapeHtml(profile.ranking)}<br>Class of ${escapeHtml(profile.gradYear)}</p>
          </aside>
        </div>

        <div class="pp-metrics-bar">
          ${heroMetrics.map((item) => `
            <div class="pp-metric-tile">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="pp-tab-bar">
        <div class="pp-tabs">
          ${availableTabs().map((tab) => `
            <button type="button" class="pp-tab ${state.activeTab === tab.id ? "is-active" : ""}" data-tab-id="${tab.id}">
              ${escapeHtml(tab.label)}
            </button>
          `).join("")}
        </div>
        <div class="pp-tab-meta">Profile Views ${escapeHtml(profileViewsFor(profile))}</div>
      </div>

      <div class="pp-stage">
        ${stageMarkup()}
      </div>
    </section>
    <div id="profile-toast" class="pp-toast" hidden></div>
  `;

  if (state.activeTab === "stats") {
    void mountProfileStatsCharts({ sport }).catch((error) => {
      console.error("Stats charts failed", error);
    });
  }
}

// ── Follow list popup (Instagram-style) ─────────────────────
function ensureFollowOverlay() {
  let overlay = document.getElementById("pp-follow-overlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "pp-follow-overlay";
  // Inline critical styles so it works even with cached CSS
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "9999",
    background: "rgba(0,0,0,.55)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity .25s ease"
  });

  overlay.innerHTML = `
    <div id="pp-follow-modal" style="
      background:var(--surface); border-radius:16px; width:92%; max-width:420px;
      max-height:70vh; display:flex; flex-direction:column;
      box-shadow:0 24px 80px rgba(0,0,0,.5); transform:translateY(16px) scale(.97);
      transition:transform .25s ease; overflow:hidden; border:1px solid var(--line);
    ">
      <div style="
        display:flex; align-items:center; justify-content:space-between;
        padding:18px 20px; border-bottom:1px solid var(--line); flex-shrink:0;
      ">
        <h3 id="pp-follow-modal-title" style="margin:0; font-size:1rem; font-weight:700; color:var(--text);">Followers</h3>
        <button id="pp-follow-modal-close" style="
          width:32px; height:32px; border-radius:50%; border:none;
          background:var(--surface-2); color:var(--muted); font-size:1.2rem; cursor:pointer;
          display:grid; place-items:center; transition:.15s;
        ">&times;</button>
      </div>
      <div id="pp-follow-modal-body" style="
        padding:6px 0; overflow-y:auto; flex:1;
      ">
        <div style="text-align:center; padding:40px 20px; color:var(--muted); font-size:.875rem;">Loading...</div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeFollowModal();
  });
  // Close button
  overlay.querySelector("#pp-follow-modal-close").addEventListener("click", closeFollowModal);
  // Hover effect on close btn
  const closeBtn = overlay.querySelector("#pp-follow-modal-close");
  closeBtn.addEventListener("mouseenter", () => { closeBtn.style.background = "#e8e8e8"; });
  closeBtn.addEventListener("mouseleave", () => { closeBtn.style.background = "var(--surface-2)"; });

  return overlay;
}

function showFollowOverlay(overlay) {
  // Force reflow, then animate in
  void overlay.offsetWidth;
  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  const modal = overlay.querySelector("#pp-follow-modal");
  if (modal) {
    modal.style.transform = "translateY(0) scale(1)";
  }
}

async function openFollowModal(mode) {
  const overlay = ensureFollowOverlay();
  const title  = document.getElementById("pp-follow-modal-title");
  const body   = document.getElementById("pp-follow-modal-body");
  if (!overlay || !body) return;

  if (title) title.textContent = mode === "followers" ? "Followers" : "Following";
  body.innerHTML = `<div style="text-align:center; padding:40px 20px; color:var(--muted); font-size:.875rem;">Loading...</div>`;
  showFollowOverlay(overlay);

  try {
    let userIds = [];
    if (mode === "followers") {
      const { data, error } = await supabase
        .from("follow")
        .select("follower_user_id")
        .eq("followed_user_id", state.targetUserId);
      if (error) throw error;
      userIds = (data || []).map((r) => r.follower_user_id);
    } else {
      const { data, error } = await supabase
        .from("follow")
        .select("followed_user_id")
        .eq("follower_user_id", state.targetUserId);
      if (error) throw error;
      userIds = (data || []).map((r) => r.followed_user_id);
    }

    if (!userIds.length) {
      body.innerHTML = `<div style="text-align:center; padding:40px 20px; color:var(--muted); font-size:.875rem;">No ${mode} yet.</div>`;
      return;
    }

    // Fetch display info — try user_directory first, fallback to school_join_requests
    let infoMap = new Map();
    try {
      const { data: dirRows } = await supabase
        .from("user_directory")
        .select("user_id, display_name, email")
        .in("user_id", userIds);
      for (const r of (dirRows || [])) {
        if (r.user_id) infoMap.set(r.user_id, { display_name: r.display_name, email: r.email });
      }
    } catch (_) { /* view may not exist */ }

    // Fill gaps from school_join_requests
    const missing = userIds.filter((id) => !infoMap.has(id));
    if (missing.length) {
      const { data: sjrRows } = await supabase
        .from("school_join_requests")
        .select("user_id, display_name, email")
        .in("user_id", missing);
      for (const r of (sjrRows || [])) {
        if (r.user_id && !infoMap.has(r.user_id)) {
          infoMap.set(r.user_id, { display_name: r.display_name, email: r.email });
        }
      }
    }

    body.innerHTML = userIds.map((uid) => {
      const info = infoMap.get(uid) || {};
      const name = info.display_name || info.email || "User";
      const initials = name.split(/\s+/).slice(0, 2).map((w) => (w[0] || "").toUpperCase()).join("") || "U";
      const avatarUrl = `https://i.pravatar.cc/80?u=${encodeURIComponent(uid)}`;
      const isViewer = uid === state.viewerUserId;
      const profileUrl = isViewer ? "profile.html" : `user-profile.html?user_id=${uid}`;
      return `
        <a href="${profileUrl}" style="
          display:flex; align-items:center; gap:14px; padding:12px 20px;
          text-decoration:none; color:inherit; transition:background .12s;
        " onmouseenter="this.style.background='#f7f7f7'" onmouseleave="this.style.background='transparent'">
          <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(initials)}"
               onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"
               style="width:48px; height:48px; border-radius:50%; object-fit:cover; flex-shrink:0;">
          <div style="
            width:48px; height:48px; border-radius:50%; background:linear-gradient(135deg,#245f73,#3a8f9f);
            display:none; place-items:center; flex-shrink:0; color:#fff; font-weight:700; font-size:.9rem;
          ">${escapeHtml(initials)}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:.9rem; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${escapeHtml(name)}
            </div>
            ${info.email && info.display_name ? `<div style="font-size:.75rem; color:var(--muted); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(info.email)}</div>` : ""}
          </div>
        </a>`;
    }).join("");
  } catch (err) {
    console.error("Failed to load follow list:", err);
    body.innerHTML = `<div style="text-align:center; padding:40px 20px; color:var(--muted); font-size:.875rem;">Failed to load list.</div>`;
  }
}

function closeFollowModal() {
  const overlay = document.getElementById("pp-follow-overlay");
  if (!overlay) return;
  overlay.style.opacity = "0";
  overlay.style.pointerEvents = "none";
  const modal = overlay.querySelector("#pp-follow-modal");
  if (modal) modal.style.transform = "translateY(16px) scale(.97)";
}

// Close on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeFollowModal(); closeEditProfileModal(); }
});

// ── Edit Profile modal (athlete-editable fields) ────────────
function ensureEditProfileOverlay() {
  let overlay = document.getElementById("pp-edit-overlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "pp-edit-overlay";
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "9999",
    background: "rgba(0,0,0,.55)", backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    opacity: "0", pointerEvents: "none", transition: "opacity .25s ease",
  });

  overlay.innerHTML = `
    <div id="pp-edit-modal" style="
      background:var(--surface); border-radius:16px; width:94%; max-width:520px;
      max-height:85vh; display:flex; flex-direction:column;
      box-shadow:0 24px 80px rgba(0,0,0,.5); transform:translateY(16px) scale(.97);
      transition:transform .25s ease; overflow:hidden; border:1px solid var(--line);
    ">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid var(--line); flex-shrink:0;">
        <h3 style="margin:0; font-size:1.05rem; font-weight:700; color:var(--text);">Edit Profile</h3>
        <button id="pp-edit-close" style="width:32px;height:32px;border-radius:50%;border:none;background:var(--surface-2);color:var(--muted);font-size:1.2rem;cursor:pointer;display:grid;place-items:center;">&times;</button>
      </div>
      <div id="pp-edit-body" style="padding:20px 22px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:16px;">
      </div>
      <div style="padding:14px 22px; border-top:1px solid var(--line); flex-shrink:0; display:flex; gap:10px; justify-content:flex-end;">
        <div id="pp-edit-status" style="flex:1; font-size:.8rem; color:var(--muted); align-self:center;"></div>
        <button id="pp-edit-cancel" style="padding:8px 18px; border-radius:8px; border:1px solid var(--line); background:var(--surface-2); color:var(--text); font-size:.85rem; cursor:pointer; font-weight:600;">Cancel</button>
        <button id="pp-edit-save" style="padding:8px 22px; border-radius:8px; border:none; background:var(--brand); color:#fff; font-size:.85rem; cursor:pointer; font-weight:600;">Save Changes</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeEditProfileModal(); });
  overlay.querySelector("#pp-edit-close").addEventListener("click", closeEditProfileModal);
  overlay.querySelector("#pp-edit-cancel").addEventListener("click", closeEditProfileModal);
  overlay.querySelector("#pp-edit-save").addEventListener("click", () => void saveEditProfile());

  return overlay;
}

function fieldHtml(label, id, type, value, placeholder, extra = "") {
  if (type === "textarea") {
    return `<div style="display:flex; flex-direction:column; gap:4px;">
      <label style="font-size:.75rem; font-weight:600; text-transform:uppercase; letter-spacing:.5px; color:var(--muted);" for="${id}">${label}</label>
      <textarea id="${id}" placeholder="${placeholder}" style="padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-size:.875rem; min-height:80px; resize:vertical; font-family:inherit; color:var(--text); background:var(--surface-2);" ${extra}>${escapeHtml(value || "")}</textarea>
    </div>`;
  }
  return `<div style="display:flex; flex-direction:column; gap:4px;">
    <label style="font-size:.75rem; font-weight:600; text-transform:uppercase; letter-spacing:.5px; color:var(--muted);" for="${id}">${label}</label>
    <input id="${id}" type="${type}" value="${escapeHtml(value || "")}" placeholder="${placeholder}" style="padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-size:.875rem; color:var(--text); background:var(--surface-2);" ${extra}>
  </div>`;
}

function inchesToFeetStr(inches) {
  if (!inches) return "";
  const ft = Math.floor(inches / 12);
  const inPart = inches % 12;
  return `${ft}'${inPart}"`;
}

function feetStrToInches(str) {
  if (!str) return null;
  const m = String(str).match(/(\d+)'?\s*(\d*)"?/);
  if (!m) return null;
  return parseInt(m[1], 10) * 12 + (parseInt(m[2], 10) || 0);
}

async function openEditProfileModal() {
  const overlay = ensureEditProfileOverlay();
  const body = document.getElementById("pp-edit-body");
  if (!body) return;

  // Load existing athlete_profiles data
  let existing = null;
  try {
    const { data } = await supabase
      .from("athlete_profiles")
      .select("*")
      .eq("user_id", state.targetUserId)
      .limit(1);
    existing = data?.[0] || null;
  } catch (_) {}

  const profile = state.profile || {};
  const measurables = existing?.measurables || {};

  body.innerHTML = `
    <div style="font-size:.8rem; color:var(--muted); margin-bottom:4px;">Update your profile info. Changes are saved to the database and shown on your profile.</div>

    ${fieldHtml("Bio", "edit-bio", "textarea", existing?.bio || profile.bio || "", "Tell scouts about yourself...")}

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
      ${fieldHtml("Height", "edit-height", "text", existing?.height_inches ? inchesToFeetStr(existing.height_inches) : (profile.measurables?.Height || ""), "e.g. 6'1\"")}
      ${fieldHtml("Weight (lbs)", "edit-weight", "number", existing?.weight_lbs || "", "e.g. 178")}
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
      ${fieldHtml("GPA", "edit-gpa", "number", existing?.gpa || profile.gpa || "", "e.g. 3.8", 'step="0.01" min="0" max="5"')}
      ${fieldHtml("Position", "edit-position", "text", existing?.position || profile.position || "", "e.g. Point Guard")}
    </div>

    ${fieldHtml("Hometown", "edit-hometown", "text", existing?.hometown || profile.hometown || "", "e.g. Atlanta, GA")}

    ${fieldHtml("Recruiting Goals", "edit-goals", "textarea", existing?.goals || profile.goals || "", "What are you looking for in a college program?")}

    <div style="border-top:1px solid var(--line); padding-top:14px;">
      <div style="font-size:.75rem; font-weight:600; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin-bottom:8px;">Measurables</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        ${fieldHtml("Wingspan", "edit-wingspan", "text", measurables.wingspan || profile.measurables?.Wingspan || "", "e.g. 6'4\"")}
        ${fieldHtml("Vertical", "edit-vertical", "text", measurables.vertical || profile.measurables?.Vertical || "", 'e.g. 32"')}
        ${fieldHtml("40yd / Speed", "edit-speed", "text", measurables.speed || profile.measurables?.Speed || "", "e.g. 4.52 sec")}
        ${fieldHtml("Standing Reach", "edit-reach", "text", measurables.reach || profile.measurables?.Reach || "", "e.g. 8'0\"")}
      </div>
    </div>

    <div style="border-top:1px solid var(--line); padding-top:14px;">
      <div style="font-size:.75rem; font-weight:600; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin-bottom:8px;">Highlight Videos</div>
      <div id="edit-highlights-list" style="display:flex; flex-direction:column; gap:8px;"></div>
      <button id="edit-add-highlight" type="button" style="margin-top:8px; padding:6px 14px; border-radius:6px; border:1px dashed var(--line); background:transparent; color:#245f73; font-size:.8rem; cursor:pointer; font-weight:600;">+ Add Highlight</button>
    </div>
  `;

  // Populate highlights
  const highlights = existing?.highlights || [];
  const hlList = body.querySelector("#edit-highlights-list");
  if (hlList) {
    highlights.forEach((hl, i) => addHighlightRow(hlList, hl, i));
    if (!highlights.length) addHighlightRow(hlList, {}, 0);
  }

  body.querySelector("#edit-add-highlight")?.addEventListener("click", () => {
    const list = body.querySelector("#edit-highlights-list");
    const idx = list?.children.length || 0;
    addHighlightRow(list, {}, idx);
  });

  // Show overlay
  void overlay.offsetWidth;
  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  const modal = overlay.querySelector("#pp-edit-modal");
  if (modal) modal.style.transform = "translateY(0) scale(1)";
}

function addHighlightRow(container, hl, index) {
  if (!container) return;
  const row = document.createElement("div");
  row.style.cssText = "display:grid; grid-template-columns:1fr 2fr auto; gap:8px; align-items:center;";
  row.innerHTML = `
    <input type="text" class="hl-title" value="${escapeHtml(hl.title || "")}" placeholder="Title" style="padding:8px 10px; border:1px solid var(--line); border-radius:6px; font-size:.8rem;">
    <input type="url" class="hl-url" value="${escapeHtml(hl.url || "")}" placeholder="https://youtube.com/..." style="padding:8px 10px; border:1px solid var(--line); border-radius:6px; font-size:.8rem;">
    <button type="button" class="hl-remove" style="width:28px;height:28px;border-radius:50%;border:1px solid var(--line);background:var(--surface-2);color:var(--muted);font-size:1rem;cursor:pointer;display:grid;place-items:center;">&times;</button>
  `;
  row.querySelector(".hl-remove").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function closeEditProfileModal() {
  const overlay = document.getElementById("pp-edit-overlay");
  if (!overlay) return;
  overlay.style.opacity = "0";
  overlay.style.pointerEvents = "none";
  const modal = overlay.querySelector("#pp-edit-modal");
  if (modal) modal.style.transform = "translateY(16px) scale(.97)";
}

async function saveEditProfile() {
  const status = document.getElementById("pp-edit-status");
  if (status) { status.textContent = "Saving..."; status.style.color = "#245f73"; }

  try {
    const bio = document.getElementById("edit-bio")?.value?.trim() || "";
    const heightStr = document.getElementById("edit-height")?.value?.trim() || "";
    const weightStr = document.getElementById("edit-weight")?.value?.trim() || "";
    const gpaStr = document.getElementById("edit-gpa")?.value?.trim() || "";
    const position = document.getElementById("edit-position")?.value?.trim() || "";
    const hometown = document.getElementById("edit-hometown")?.value?.trim() || "";
    const goals = document.getElementById("edit-goals")?.value?.trim() || "";

    const wingspan = document.getElementById("edit-wingspan")?.value?.trim() || "";
    const vertical = document.getElementById("edit-vertical")?.value?.trim() || "";
    const speed = document.getElementById("edit-speed")?.value?.trim() || "";
    const reach = document.getElementById("edit-reach")?.value?.trim() || "";

    // Collect highlights
    const hlRows = document.querySelectorAll("#edit-highlights-list > div");
    const highlights = [];
    hlRows.forEach((row) => {
      const title = row.querySelector(".hl-title")?.value?.trim();
      const url = row.querySelector(".hl-url")?.value?.trim();
      if (url) highlights.push({ title: title || "Highlight", url, platform: url.includes("youtube") ? "YouTube" : "Link" });
    });

    const upsertData = {
      user_id: state.targetUserId,
      bio,
      height_inches: feetStrToInches(heightStr),
      weight_lbs: weightStr ? parseInt(weightStr, 10) : null,
      gpa: gpaStr ? parseFloat(gpaStr) : null,
      position,
      hometown,
      goals,
      highlights,
      measurables: { wingspan, vertical, speed, reach },
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("athlete_profiles")
      .upsert(upsertData, { onConflict: "user_id" });

    if (error) throw error;

    if (status) { status.textContent = "Saved!"; status.style.color = "#16a34a"; }

    // Reload profile to show updated data
    setTimeout(async () => {
      closeEditProfileModal();
      const bundle = await loadProfileBundle(state.targetUserId);
      state.profile = bundle.profile;
      renderProfile();
    }, 600);

  } catch (err) {
    console.error("Save profile failed:", err);
    if (status) { status.textContent = err.message || "Failed to save."; status.style.color = "#ef4444"; }
  }
}

// ── Role-specific edit modal (coach / scout / school_admin) ──
async function openRoleEditModal() {
  const overlay = ensureEditProfileOverlay();
  const body = document.getElementById("pp-edit-body");
  if (!body) return;

  const profile = state.profile || {};
  const role = state.role;

  if (role === "coach") {
    const c = state.coachRow || {};
    body.innerHTML = `
      <div style="font-size:.8rem; color:var(--muted); margin-bottom:4px;">Update your coach profile.</div>
      ${fieldHtml("Bio", "edit-bio", "textarea", c.bio || "", "Tell athletes and scouts about your coaching background...")}
      ${fieldHtml("Years of Experience", "edit-experience", "number", c.years_experience || "", "e.g. 12", 'min="0" max="60"')}
    `;
  } else if (role === "scout") {
    const s = state.scoutRow || {};
    body.innerHTML = `
      <div style="font-size:.8rem; color:var(--muted); margin-bottom:4px;">Update your scout profile.</div>
      ${fieldHtml("Organization", "edit-org", "text", s.organization || "", "e.g. National Scouting Bureau")}
      ${fieldHtml("Title", "edit-title", "text", s.title || "", "e.g. Regional Scout, Director of Recruiting")}
    `;
  } else {
    const sch = state.schoolRow || {};
    body.innerHTML = `
      <div style="font-size:.8rem; color:var(--muted); margin-bottom:4px;">Update your school profile.</div>
      ${fieldHtml("School Name", "edit-school-name", "text", sch.name || "", "e.g. Westview High School")}
      ${fieldHtml("Description", "edit-school-desc", "textarea", sch.description || "", "Tell athletes about your athletic program...")}
      ${fieldHtml("Location", "edit-school-loc", "text", sch.location || "", "e.g. Atlanta, GA")}
    `;
  }

  // Rewire save button
  const saveBtn = document.getElementById("pp-edit-save");
  if (saveBtn) {
    const newSave = saveBtn.cloneNode(true);
    saveBtn.replaceWith(newSave);
    newSave.addEventListener("click", () => void saveRoleProfile());
  }

  void overlay.offsetWidth;
  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  const modal = overlay.querySelector("#pp-edit-modal");
  if (modal) modal.style.transform = "translateY(0) scale(1)";
}

async function saveRoleProfile() {
  const status = document.getElementById("pp-edit-status");
  if (status) { status.textContent = "Saving..."; status.style.color = "#245f73"; }

  try {
    const role = state.role;

    if (role === "coach") {
      const bio = document.getElementById("edit-bio")?.value?.trim() || "";
      const yrs = document.getElementById("edit-experience")?.value?.trim() || "";
      const { error } = await supabase
        .from("coaches")
        .update({ bio, years_experience: yrs ? parseInt(yrs, 10) : null })
        .eq("user_id", state.targetUserId);
      if (error) throw error;
      if (state.coachRow) { state.coachRow.bio = bio; state.coachRow.years_experience = yrs ? parseInt(yrs, 10) : null; }
    } else if (role === "scout") {
      const org = document.getElementById("edit-org")?.value?.trim() || "";
      const title = document.getElementById("edit-title")?.value?.trim() || "";
      const { error } = await supabase
        .from("scouts")
        .update({ organization: org, title })
        .eq("user_id", state.targetUserId);
      if (error) throw error;
      if (state.scoutRow) { state.scoutRow.organization = org; state.scoutRow.title = title; }
    } else {
      const name = document.getElementById("edit-school-name")?.value?.trim() || "";
      const desc = document.getElementById("edit-school-desc")?.value?.trim() || "";
      const loc = document.getElementById("edit-school-loc")?.value?.trim() || "";
      const { error } = await supabase
        .from("schools")
        .update({ name, description: desc, location: loc })
        .eq("user_id", state.targetUserId);
      if (error) throw error;
      if (state.schoolRow) { state.schoolRow.name = name; state.schoolRow.description = desc; state.schoolRow.location = loc; }
    }

    if (status) { status.textContent = "Saved!"; status.style.color = "#16a34a"; }

    setTimeout(() => {
      closeEditProfileModal();
      renderProfile();
    }, 600);
  } catch (err) {
    console.error("Save role profile failed:", err);
    if (status) { status.textContent = err.message || "Failed to save."; status.style.color = "#ef4444"; }
  }
}

// ── Profile image upload ─────────────────────────────────────
async function uploadProfileImage(file, userId, type) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${type}/${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("profile-images").upload(path, file, {
    cacheControl: "3600",
    upsert: true,
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from("profile-images").getPublicUrl(path);
  return pub.publicUrl;
}

function createHiddenFileInput(accept, onChange) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.style.display = "none";
  input.addEventListener("change", onChange);
  document.body.appendChild(input);
  return input;
}

async function handleAvatarUpload() {
  const input = createHiddenFileInput("image/*", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    showToast("Uploading profile picture...");
    try {
      const url = await uploadProfileImage(file, state.targetUserId, "avatars");
      await supabase.from("users").update({ avatar_url: url }).eq("user_id", state.targetUserId);
      state.profile.avatarUrl = url;
      renderProfile();
      showToast("Profile picture updated!");
    } catch (err) {
      console.error("Avatar upload failed:", err);
      showToast("Upload failed. Try a smaller image.");
    }
  });
  input.click();
}

async function handleCoverUpload() {
  const input = createHiddenFileInput("image/*", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    showToast("Uploading cover photo...");
    try {
      const url = await uploadProfileImage(file, state.targetUserId, "covers");
      await supabase.from("users").update({ cover_url: url }).eq("user_id", state.targetUserId);
      state.profile.coverUrl = url;
      renderProfile();
      showToast("Cover photo updated!");
    } catch (err) {
      console.error("Cover upload failed:", err);
      showToast("Upload failed. Try a smaller image.");
    }
  });
  input.click();
}

async function toggleFollow() {
  if (!state.viewerUserId || !state.targetUserId || state.isSelf) return;

  try {
    if (state.isFollowing) {
      const { error } = await supabase
        .from("follow")
        .delete()
        .eq("follower_user_id", state.viewerUserId)
        .eq("followed_user_id", state.targetUserId);
      if (error) throw error;
      state.isFollowing = false;
      state.counts.followers = Math.max(0, (state.counts.followers || 0) - 1);
      showToast("Unfollowed profile.");
    } else {
      const { error } = await supabase
        .from("follow")
        .insert({ follower_user_id: state.viewerUserId, followed_user_id: state.targetUserId });
      if (error) throw error;
      state.isFollowing = true;
      state.counts.followers = (state.counts.followers || 0) + 1;
      showToast("Now following profile.");
    }

    renderProfile();
  } catch (error) {
    console.error("Follow toggle failed", error);
    setStatus(error.message || "Unable to update follow state.", true);
  }
}

function bindEvents() {
  if (state.mounted) return;
  state.mounted = true;

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const tabId = target.closest("[data-tab-id]")?.dataset.tabId;
    if (tabId) {
      state.activeTab = tabId;
      renderProfile();
      return;
    }

    const switchTab = target.closest("[data-switch-tab]")?.dataset.switchTab;
    if (switchTab) {
      state.activeTab = switchTab;
      renderProfile();
      return;
    }

    const sportId = target.closest("[data-sport-id]")?.dataset.sportId;
    if (sportId) {
      state.activeSportId = sportId;
      renderProfile();
      return;
    }

    const monthStep = target.closest("[data-month-step]")?.dataset.monthStep;
    if (monthStep) {
      state.scheduleMonth = new Date(state.scheduleMonth.getFullYear(), state.scheduleMonth.getMonth() + Number(monthStep), 1);
      renderProfile();
      return;
    }

    const action = target.closest("[data-action]")?.dataset.action;
    if (action === "toggle-follow") {
      void toggleFollow();
      return;
    }

    // Follow list modal
    const showFollow = target.closest("[data-show-follow]")?.dataset.showFollow;
    if (showFollow) {
      void openFollowModal(showFollow);
      return;
    }
    if (target.closest("[data-close-follow]")) {
      closeFollowModal();
      return;
    }

    if (action === "toggle-save-athlete") {
      const next = toggleSavedAthlete({
        viewerUserId: state.viewerUserId,
        targetUserId: state.targetUserId,
      });
      state.scoutWorkspace = getScoutWorkspaceState({
        viewerRole: state.viewerRole,
        viewerUserId: state.viewerUserId,
        targetUserId: state.targetUserId,
        isSelf: state.isSelf,
      });
      renderProfile();
      showToast(next.savedAthletes?.includes(state.targetUserId) ? "Athlete saved." : "Athlete removed from saved.");
      return;
    }
    if (action === "toggle-shortlist-athlete") {
      const next = toggleShortlistedAthlete({
        viewerUserId: state.viewerUserId,
        targetUserId: state.targetUserId,
      });
      state.scoutWorkspace = getScoutWorkspaceState({
        viewerRole: state.viewerRole,
        viewerUserId: state.viewerUserId,
        targetUserId: state.targetUserId,
        isSelf: state.isSelf,
      });
      renderProfile();
      showToast(next.shortlistAthletes?.includes(state.targetUserId) ? "Added to shortlist." : "Removed from shortlist.");
      return;
    }
    if (action === "save-scout-note") {
      const noteField = document.querySelector("#scout-private-notes");
      const note = noteField instanceof HTMLTextAreaElement ? noteField.value : "";
      saveScoutNotes({
        viewerUserId: state.viewerUserId,
        targetUserId: state.targetUserId,
        note,
      });
      state.scoutWorkspace = getScoutWorkspaceState({
        viewerRole: state.viewerRole,
        viewerUserId: state.viewerUserId,
        targetUserId: state.targetUserId,
        isSelf: state.isSelf,
      });
      renderProfile();
      showToast("Scout notes saved.");
      return;
    }
    if (action === "share-profile") {
      navigator.clipboard?.writeText(window.location.href);
      showToast("Profile link copied.");
      return;
    }
    if (action === "edit-profile") {
      if (state.role === "coach" || state.role === "scout" || state.role === "school_admin" || state.role === "school") {
        void openRoleEditModal();
      } else {
        void openEditProfileModal();
      }
      return;
    }
    if (action === "change-avatar") {
      void handleAvatarUpload();
      return;
    }
    if (action === "change-cover") {
      void handleCoverUpload();
      return;
    }
    if (action === "download-profile") {
      showToast("PDF export is staged for a later step.");
      return;
    }
    if (action === "message-profile") {
      if (!state.viewerUserId) { showToast("Sign in to send messages."); return; }
      // Navigate to messages page with user_id — it will find or create the conversation
      window.location.href = `messages.html?user_id=${encodeURIComponent(state.targetUserId)}`;
      return;
    }

    const url = target.closest("[data-open-url]")?.dataset.openUrl;
    if (url) {
      window.open(url, "_blank", "noopener");
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;

    if (target.matches("[data-sport-select]")) {
      state.activeSportId = target.value;
      renderProfile();
    }
  });
}

const PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function cacheKey(bootKey) { return `ua:profile:${bootKey}`; }

function restoreFromCache(bootKey) {
  try {
    const raw = sessionStorage.getItem(cacheKey(bootKey));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > PROFILE_CACHE_TTL) { sessionStorage.removeItem(cacheKey(bootKey)); return null; }
    return data;
  } catch (_) { return null; }
}

function saveToCache(bootKey, bundle) {
  try {
    sessionStorage.setItem(cacheKey(bootKey), JSON.stringify({ ts: Date.now(), data: bundle }));
  } catch (_) { /* storage full — ignore */ }
}

async function bootstrap(session, viewerRoleOverride = "") {
  if (!session?.user?.id) return;

  const key = `${state.mode}:${session.user.id}:${queryParam("user_id") || ""}`;
  if (state.bootKey === key && state.profile) return;
  if (state.bootPromise) return state.bootPromise;

  // Try to paint from cache immediately before any network request
  const cached = restoreFromCache(key);
  if (cached) {
    state.viewerUserId  = cached.viewerUserId;
    state.viewerRole    = cached.viewerRole;
    state.targetUserId  = cached.targetUserId;
    state.isSelf        = cached.isSelf;
    state.isFollowing   = cached.isFollowing;
    state.profile       = cached.profile;
    state.posts         = cached.posts;
    state.counts        = cached.counts;
    state.role          = cached.role;
    state.activeTab     = "overview";
    state.activeSportId = state.profile?.sports?.[0]?.id || "";
    state.bootKey       = key;
    state.scoutWorkspace = getScoutWorkspaceState({
      viewerRole: state.viewerRole,
      viewerUserId: state.viewerUserId,
      targetUserId: state.targetUserId,
      isSelf: state.isSelf,
    });
    renderProfile(); // instant — no skeleton needed
  } else {
    renderSkeleton();
  }

  state.bootPromise = (async () => {
    try {
      state.viewerUserId = await fetchViewerAppUserId(session.user.id);
      if (!state.viewerUserId) throw new Error("No app user is linked to this session yet.");
      const dbViewerRole = await fetchViewerRole(state.viewerUserId);
      state.viewerRole = normalizeRole(
        dbViewerRole
        || viewerRoleOverride
        || getGlobalAppState()?.auth?.role
        || session.user?.user_metadata?.role
      );

      if (state.mode === "self") {
        const requestedUserId = queryParam("user_id");
        if (requestedUserId && requestedUserId !== state.viewerUserId) {
          window.location.replace(publicProfileUrl(requestedUserId));
          return;
        }
        state.targetUserId = state.viewerUserId;
      } else {
        state.targetUserId = queryParam("user_id");
        if (!state.targetUserId || state.targetUserId === state.viewerUserId) {
          window.location.replace(privateProfileUrl());
          return;
        }
      }

      state.isSelf = state.targetUserId === state.viewerUserId;
      state.isFollowing = await fetchIsFollowing();
      const bundle = await loadProfileBundle(state.targetUserId);

      state.profile = bundle.profile;
      state.posts = bundle.posts;
      state.counts = bundle.counts;
      state.role = bundle.role;
      state.coachRow = bundle.coachRow || null;
      state.schoolRow = bundle.schoolRow || null;
      state.scoutRow = bundle.scoutRow || null;

      // Load coach teams if profile is a coach
      if (bundle.role === "coach" && state.targetUserId) {
        try { state.coachTeams = await loadCoachTeams(state.targetUserId); } catch (_) { state.coachTeams = []; }
      } else {
        state.coachTeams = [];
      }

      state.scoutWorkspace = getScoutWorkspaceState({
        viewerRole: state.viewerRole,
        viewerUserId: state.viewerUserId,
        targetUserId: state.targetUserId,
        isSelf: state.isSelf,
      });
      state.activeTab = "overview";
      state.activeSportId = state.profile?.sports?.[0]?.id || "";
      const upcomingEvent = scheduleItems(state.profile).find((item) => item.startDate.getTime() >= Date.now()) || scheduleItems(state.profile)[0] || null;
      state.scheduleMonth = upcomingEvent
        ? new Date(upcomingEvent.startDate.getFullYear(), upcomingEvent.startDate.getMonth(), 1)
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      state.bootKey = key;

      // Persist to cache for next visit
      saveToCache(key, {
        viewerUserId: state.viewerUserId,
        viewerRole: state.viewerRole,
        targetUserId: state.targetUserId,
        isSelf: state.isSelf,
        isFollowing: state.isFollowing,
        profile: state.profile,
        posts: state.posts,
        counts: state.counts,
        role: state.role,
      });

      renderProfile();
      setStatus("");
    } catch (error) {
      console.error("Profile bootstrap failed", error);
      const root = document.querySelector("#profile-experience");
      if (root && !state.profile) {
        root.innerHTML = `<div class="pp-empty pp-empty--error">${escapeHtml(error.message || "Unable to load profile.")}</div>`;
      }
      setStatus(error.message || "Unable to load profile.", true);
    } finally {
      state.bootPromise = null;
    }
  })();

  return state.bootPromise;
}

export function mountProfileExperience(mode) {
  state.mode = mode;
  bindEvents();

  window.addEventListener("session-ready", async ({ detail }) => {
    await bootstrap(detail?.session, detail?.role);
  });

  void supabase.auth.getSession().then(async ({ data, error }) => {
    if (error) {
      console.error("Profile session check failed", error);
      return;
    }
    if (data?.session) {
      await bootstrap(data.session);
    }
  });
}

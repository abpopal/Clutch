import { supabase } from "./supabaseClient.js";
import { badgeMeta, buildAthleteProfile, formatScoutSummary, getSportMeta } from "./athleteData.js?v=20260430";
import { getGlobalAppState, normalizeRole } from "./roleUtils.js";
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

  // Run school name, counts, posts, and stats all in parallel
  const [schoolName, counts, posts, stats] = await Promise.all([
    records.athleteRow?.school_id
      ? fetchSchoolName(records.athleteRow.school_id)
      : Promise.resolve(records.schoolRow?.name || ""),
    fetchCounts(userId),
    fetchVisiblePosts(userId, state.isSelf, state.isFollowing),
    fetchAthleteStats(records.athleteRow?.athlete_id),
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
  };
}

function heroMetricItems(profile, sport) {
  const metrics = [
    { label: "Height", value: profile?.measurables?.Height || "6'1\"" },
    { label: "Weight", value: profile?.measurables?.Weight || "178 lbs" },
    { label: "Speed", value: profile?.measurables?.Speed || "4.52 sec" },
    { label: "GPA", value: profile?.gpa || "3.8" },
  ];
  (sport?.stats || []).slice(0, 2).forEach((stat) => {
    metrics.push({ label: stat.label, value: stat.value });
  });
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
                      <span>❤ ${postEngagement(post, "likes")}</span>
                      <span>💬 ${postEngagement(post, "comments")}</span>
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
            <span>❤ ${postEngagement(post, "likes")}</span>
            <span>💬 ${postEngagement(post, "comments")}</span>
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

function renderProfile() {
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
        <div class="pp-hero-main">
          <div class="pp-identity">
            <div class="pp-avatar-wrap">
              <img class="pp-avatar" src="${escapeHtml(avatarImageFor(profile))}" alt="${escapeHtml(profile.name)}">
              <span class="pp-avatar-badge">✓</span>
            </div>
            <div class="pp-headline">
              <div class="pp-name-row">
                <h1>${escapeHtml(profile.name)}</h1>
                <span class="pp-verified">Verified</span>
              </div>
              <p class="pp-role-line">${escapeHtml(profile.position)} • ${escapeHtml(sport.label)}</p>
              <p class="pp-meta-line">${escapeHtml(profile.school)} • ${escapeHtml(profile.hometown)} • Class of ${escapeHtml(profile.gradYear)}</p>
              <p class="pp-summary-line">${escapeHtml(formatScoutSummary(profile))}</p>
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
      showToast("Unfollowed profile.");
    } else {
      const { error } = await supabase
        .from("follow")
        .insert({ follower_user_id: state.viewerUserId, followed_user_id: state.targetUserId });
      if (error) throw error;
      state.isFollowing = true;
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
      showToast("Profile editing will be connected next.");
      return;
    }
    if (action === "download-profile") {
      showToast("PDF export is staged for a later step.");
      return;
    }
    if (action === "message-profile") {
      // Create a conversation and redirect to messages page
      const viewerId = state.viewerUserId;
      if (!viewerId) { showToast("Sign in to send messages."); return; }
      try {
        // Check if a conversation already exists between these two users
        const { data: existing } = await supabase
          .from("message")
          .select("conversation_id")
          .or(`sender_user_id.eq.${viewerId}`)
          .limit(50);

        // Create new conversation
        const { data: convoRow, error: convoErr } = await supabase
          .from("conversation")
          .insert({})
          .select("conversation_id")
          .single();

        if (convoErr || !convoRow?.conversation_id) throw new Error("Could not start conversation.");

        // Send an opening message so the conversation is visible in the list
        await supabase.from("message").insert({
          conversation_id: convoRow.conversation_id,
          sender_user_id: viewerId,
          body: "👋 Hey! I'd like to connect with you.",
        });

        window.location.href = `messages.html?convo=${convoRow.conversation_id}`;
      } catch (err) {
        showToast(err.message || "Could not open messaging.");
      }
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

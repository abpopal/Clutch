import { supabase } from "./supabaseClient.js";
import {
  badgeMeta,
  buildAthleteProfile,
  formatScoutSummary,
  getSportMeta,
  normalizeText,
  readinessLabel,
  renderBarcodeSvg,
  renderPseudoQrSvg,
  sportOptionsForCompare,
  VERIFICATION_BADGES,
} from "./athleteData.js";

const TAB_ITEMS = [
  { id: "profile", label: "Profile" },
  { id: "stats", label: "Stats" },
  { id: "clutch", label: "Clutch" },
  { id: "media", label: "Media" },
  { id: "schedule", label: "Schedule" },
  { id: "scout", label: "Scout" },
];

const SCOUT_MODES = [
  { id: "view", label: "Scout View" },
  { id: "compare", label: "Compare" },
  { id: "search", label: "Search" },
];

const nameEl = document.querySelector("#hero-name");
const positionEl = document.querySelector("#hero-position");
const heroEl = document.querySelector("#ua-hero");
const heroWatermarkEl = document.querySelector("#hero-watermark");
const heroInitialsEl = document.querySelector("#hero-avatar-initials");
const heroVerificationEl = document.querySelector("#hero-verification-badges");
const statusEl = document.querySelector("#profile-status");
const chipRowEl = document.querySelector("#identity-chip-row");
const scoutSummaryEl = document.querySelector("#scout-summary-line");
const ctaStripEl = document.querySelector("#identity-cta-strip");
const topTabsEl = document.querySelector("#profile-top-tabs");
const bottomTabsEl = document.querySelector("#profile-bottom-tabs");
const tabStageEl = document.querySelector("#athlete-tab-content");
const primaryActionBtn = document.querySelector("#profile-primary-action");
const secondaryActionBtn = document.querySelector("#profile-secondary-action");
const toastEl = document.querySelector("#profile-toast");
const heroBgInput = document.querySelector("#hero-bg-input");
const avatarInput = document.querySelector("#avatar-input");
const heroBgTrigger = document.querySelector("#hero-bg-trigger");
const avatarTrigger = document.querySelector("#avatar-trigger");

const STORAGE_KEYS = {
  edits: "ua-profile-edits",
  notes: "ua-scout-notes",
  watchlist: "ua-watchlist",
};

const state = {
  viewerUserId: null,
  targetUserId: null,
  isSelfProfile: false,
  isFollowing: false,
  athlete: null,
  athleteDirectory: [],
  activeTab: "profile",
  activeSportId: "basketball",
  activeMetric: "",
  activeTimelineYear: "",
  compareMetric: "",
  editMode: false,
  idPanelExpanded: false,
  scoutMode: "view",
  compareAId: "",
  compareBId: "",
  scoutSearch: "",
  watchlist: new Set(readStoredJson(STORAGE_KEYS.watchlist, [])),
  notesByAthleteId: readStoredJson(STORAGE_KEYS.notes, {}),
  editsByAthleteId: readStoredJson(STORAGE_KEYS.edits, {}),
  imageOverrides: {},
  featuredMediaId: "",
  mediaTypeFilter: "All",
  mediaSportFilter: "all",
  selectedDateKey: "",
  scheduleMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  montageSelections: {
    stats: true,
    awards: true,
    timeline: true,
    clutch: true,
    film: true,
  },
  montageGenerated: false,
  scoutReportVisible: false,
};

let eventsBound = false;
let bootstrappedAuthUserId = "";
let bootstrapPromise = null;

function readStoredJson(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function queryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return (params.get(name) || "").trim();
}

function formatShortDate(value) {
  if (!value) return "TBD";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(isoString) {
  if (!isoString) return "Now";
  return new Date(isoString).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatRelative(isoString) {
  if (!isoString) return "Now";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function slugDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function currentAthlete() {
  return state.athlete;
}

function selectedSport(athlete = currentAthlete()) {
  if (!athlete?.sports?.length) return null;
  return athlete.sports.find((sport) => sport.id === state.activeSportId) || athlete.sports[0];
}

function selectedHighlight(athlete = currentAthlete()) {
  const highlights = athlete?.highlights || [];
  return highlights.find((item) => item.id === state.featuredMediaId) || highlights.find((item) => item.featured) || highlights[0] || null;
}

function athleteOverride(athleteId) {
  return state.editsByAthleteId[athleteId] || {};
}

function imageOverride(athleteId) {
  return state.imageOverrides[athleteId] || {};
}

function applyOverrides(athlete) {
  if (!athlete) return null;
  const override = athleteOverride(athlete.athleteId);
  const images = imageOverride(athlete.athleteId);
  return {
    ...athlete,
    ...override,
    measurables: { ...athlete.measurables, ...(override.measurables || {}) },
    coachQuote: { ...athlete.coachQuote, ...(override.coachQuote || {}) },
    heroBackgroundUrl: images.heroBackgroundUrl || athlete.heroBackgroundUrl || "",
    avatarUrl: images.avatarUrl || athlete.avatarUrl || "",
  };
}

function replaceHistoryUser(userId) {
  const url = new URL(window.location.href);
  if (userId) {
    url.searchParams.set("user_id", userId);
  } else {
    url.searchParams.delete("user_id");
  }
  window.history.replaceState({}, "", url.toString());
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.add("is-visible");
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toastEl.classList.remove("is-visible");
    toastEl.hidden = true;
  }, 2200);
}

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.toggle("is-error", isError);
}

async function fetchAppUserId(authUserId) {
  const { data, error } = await supabase
    .from("users")
    .select("user_id")
    .eq("firebase_uid", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data?.user_id || null;
}

async function ensureViewerUserId(session) {
  if (!session?.user?.id) return null;

  const existingUserId = await fetchAppUserId(session.user.id);
  if (existingUserId) return existingUserId;

  const metadataRole = (session.user?.user_metadata?.role || "general").toLowerCase();
  const appRole = metadataRole === "general" ? "viewer" : metadataRole;

  const { error: insertError } = await supabase
    .from("users")
    .insert({ firebase_uid: session.user.id, role: appRole });

  if (insertError && insertError.code !== "23505") {
    throw insertError;
  }

  const viewerUserId = await fetchAppUserId(session.user.id);
  if (!viewerUserId) {
    throw new Error("Signed in, but no linked athlete profile could be created.");
  }

  const { error: directoryError } = await supabase
    .from("user_directory")
    .upsert(
      {
        user_id: viewerUserId,
        display_name: session.user?.user_metadata?.name || session.user?.email || "Untitled Athlete",
        email: session.user?.email || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (directoryError) {
    console.warn("Unable to sync user directory from profile bootstrap", directoryError);
  }

  return viewerUserId;
}

async function fetchIsFollowing() {
  if (!state.viewerUserId || !state.targetUserId || state.viewerUserId === state.targetUserId) return false;
  const { data, error } = await supabase
    .from("follow")
    .select("follower_user_id")
    .eq("follower_user_id", state.viewerUserId)
    .eq("followed_user_id", state.targetUserId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function toggleFollow() {
  if (!state.viewerUserId || !state.targetUserId || state.isSelfProfile || !primaryActionBtn) return;
  primaryActionBtn.disabled = true;
  try {
    if (state.isFollowing) {
      const { error } = await supabase
        .from("follow")
        .delete()
        .eq("follower_user_id", state.viewerUserId)
        .eq("followed_user_id", state.targetUserId);
      if (error) throw error;
      state.isFollowing = false;
      showToast("Removed from watch list.");
    } else {
      const { error } = await supabase
        .from("follow")
        .insert({ follower_user_id: state.viewerUserId, followed_user_id: state.targetUserId });
      if (error) throw error;
      state.isFollowing = true;
      showToast("Added to watch list.");
    }
    updateHeroActions();
  } catch (error) {
    console.error("Follow toggle failed", error);
    setStatus(error.message || "Unable to update follow state.", true);
  } finally {
    primaryActionBtn.disabled = false;
  }
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

async function fetchPosts(userId) {
  const filters = ["public"];
  if (state.isFollowing || state.isSelfProfile) filters.push("followers");
  if (state.isSelfProfile) filters.push("private");

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

async function fetchAthleteStats(athleteId) {
  if (!athleteId) return [];
  const { data, error } = await supabase
    .from("athlete_stat")
    .select("sport,stat_key,stat_value,source")
    .eq("athlete_id", athleteId)
    .limit(80);
  if (error) throw error;
  return data || [];
}

async function fetchProfileBundle(userId) {
  const [{ data: directory }, { data: userRow }, { data: athleteRow }] = await Promise.all([
    supabase.from("user_directory").select("user_id,display_name,email").eq("user_id", userId).maybeSingle(),
    supabase.from("users").select("user_id,role").eq("user_id", userId).maybeSingle(),
    supabase.from("athletes").select("athlete_id,user_id,school_id,position,graduation_year").eq("user_id", userId).maybeSingle(),
  ]);

  let schoolName = "";
  if (athleteRow?.school_id) {
    const { data: schoolRow } = await supabase.from("schools").select("name").eq("school_id", athleteRow.school_id).maybeSingle();
    schoolName = schoolRow?.name || "";
  }

  const [stats, counts] = await Promise.all([
    fetchAthleteStats(athleteRow?.athlete_id),
    fetchCounts(userId),
  ]);
  const posts = await fetchPosts(userId);

  return {
    directory,
    userRow,
    athleteRow,
    schoolName,
    stats,
    posts,
    counts,
  };
}

async function fetchAthleteDirectory() {
  const [directoryRes, usersRes, athletesRes, schoolsRes] = await Promise.all([
    supabase.from("user_directory").select("user_id,display_name,email").limit(5000),
    supabase.from("users").select("user_id,role").limit(2000),
    supabase.from("athletes").select("athlete_id,user_id,school_id,position,graduation_year").limit(2000),
    supabase.from("schools").select("school_id,name").limit(2000),
  ]);

  for (const response of [directoryRes, usersRes, athletesRes, schoolsRes]) {
    if (response.error) throw response.error;
  }

  const directories = directoryRes.data || [];
  const users = new Map((usersRes.data || []).map((row) => [row.user_id, row]));
  const schools = new Map((schoolsRes.data || []).map((row) => [row.school_id, row.name]));

  return (athletesRes.data || []).map((athleteRow) => {
    const directory = directories.find((row) => row.user_id === athleteRow.user_id) || {
      user_id: athleteRow.user_id,
      display_name: "Untitled Athlete",
      email: "",
    };
    const preview = buildAthleteProfile({
      userId: athleteRow.user_id,
      directory,
      athleteRow,
      schoolName: schools.get(athleteRow.school_id) || "",
      stats: [],
      posts: [],
      counts: { posts: 0, followers: 0, following: 0 },
      fallbackRole: users.get(athleteRow.user_id)?.role || "athlete",
    });
    return applyOverrides(preview);
  });
}

function updateHeroActions() {
  if (!primaryActionBtn || !secondaryActionBtn || !state.athlete) return;
  primaryActionBtn.textContent = state.isSelfProfile ? "Edit Profile" : (state.isFollowing ? "Watching" : "Follow");
  primaryActionBtn.classList.toggle("warn", state.isFollowing && !state.isSelfProfile);
  secondaryActionBtn.textContent = "Share";
}

function syncSelectedSport() {
  const athlete = currentAthlete();
  if (!athlete?.sports?.length) return;
  if (!athlete.sports.some((sport) => sport.id === state.activeSportId)) {
    state.activeSportId = athlete.sports[0].id;
  }
  const sport = selectedSport(athlete);
  const metrics = Object.keys((sport?.progression || [])[0] || {}).filter((key) => key !== "year");
  if (!state.activeMetric || !metrics.includes(state.activeMetric)) {
    state.activeMetric = metrics[0] || sport?.stats?.[0]?.label || "";
  }
  if (!state.compareMetric || !metrics.includes(state.compareMetric)) {
    state.compareMetric = state.activeMetric;
  }
  const timelineYears = (sport?.timeline || []).map((row) => row.year);
  if (!state.activeTimelineYear || !timelineYears.includes(state.activeTimelineYear)) {
    state.activeTimelineYear = timelineYears[timelineYears.length - 1] || "";
  }
}

function renderTabs() {
  const top = TAB_ITEMS.map((tab) => `
    <button type="button" class="${state.activeTab === tab.id ? "active" : ""}" data-tab-target="${tab.id}">
      ${tab.label}
    </button>
  `).join("");

  const bottom = TAB_ITEMS.map((tab) => `
    <button type="button" class="ua-bottom-nav-btn ${state.activeTab === tab.id ? "active" : ""}" data-tab-target="${tab.id}">
      <span>${tab.label}</span>
    </button>
  `).join("");

  topTabsEl.innerHTML = top;
  bottomTabsEl.innerHTML = bottom;
}

function renderHero() {
  const athlete = currentAthlete();
  if (!athlete) return;
  if (nameEl) nameEl.textContent = athlete.name;
  if (positionEl) positionEl.textContent = athlete.position;
  if (heroWatermarkEl) heroWatermarkEl.textContent = athlete.number;

  const background = athlete.heroBackgroundUrl
    ? `linear-gradient(180deg, rgba(8, 8, 8, 0.18), rgba(8, 8, 8, 0.78)), url("${athlete.heroBackgroundUrl}") center/cover`
    : `linear-gradient(135deg, rgba(215, 162, 61, 0.22), rgba(22, 22, 19, 0.34)), radial-gradient(circle at top right, rgba(255, 255, 255, 0.06), transparent 35%)`;
  heroEl.style.background = background;

  const avatarHtml = athlete.avatarUrl
    ? `<img src="${athlete.avatarUrl}" alt="${escapeHtml(athlete.name)} avatar">`
    : `<span>${escapeHtml(athlete.initials)}</span>`;
  avatarTrigger.innerHTML = `${avatarHtml}<span class="ua-avatar-upload">UPLOAD</span>`;
  if (heroInitialsEl) heroInitialsEl.textContent = athlete.initials;

  heroVerificationEl.innerHTML = ["coach", "school"].map((key) => {
    const badge = badgeMeta(key);
    return `<span class="ua-verify-pill is-${badge.tone}">${badge.icon} ${badge.label}</span>`;
  }).join("");

  scoutSummaryEl.textContent = formatScoutSummary(athlete);
  setStatus(state.isSelfProfile ? "Live self profile connected." : "Live athlete profile connected.");
}

function renderIdentityRow() {
  const athlete = currentAthlete();
  if (!athlete) return;
  const counts = athlete.liveCounts || { posts: 0, followers: 0, following: 0 };
  chipRowEl.innerHTML = [
    `Class of ${athlete.gradYear}`,
    athlete.school,
    athlete.hometown,
    athlete.ranking,
    "Verified",
    athlete.athleteId,
    `${counts.followers} followers`,
  ].map((item, index) => `
    <span class="ua-chip ${index === 3 ? "is-alert" : ""} ${item === "Verified" ? "is-success" : ""}">${escapeHtml(item)}</span>
  `).join("");

  ctaStripEl.innerHTML = `
    <button type="button" class="ua-strip-btn ${state.isFollowing ? "is-active" : ""}" data-cta="watch">${state.isSelfProfile ? "My Profile" : (state.isFollowing ? "Watching" : "Follow")}</button>
    <button type="button" class="ua-strip-btn" data-cta="share">Share</button>
    <button type="button" class="ua-strip-btn" data-cta="contact">Contact</button>
    <button type="button" class="ua-strip-btn" data-cta="pdf">PDF</button>
    <button type="button" class="ua-strip-btn" data-cta="compare">Compare</button>
    <a class="ua-strip-btn" href="${state.isSelfProfile ? "profile-posts.html" : `profile-posts.html?user_id=${encodeURIComponent(state.targetUserId)}`}">All Posts</a>
  `;
}

function primaryMediaUrl(post) {
  const media = Array.isArray(post?.post_media) ? post.post_media.find((item) => item?.media_url) : null;
  return media?.media_url || "";
}

function progressRing(percent) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;
  return `
    <svg viewBox="0 0 120 120" class="ua-ring-svg">
      <circle cx="60" cy="60" r="${radius}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10"></circle>
      <circle cx="60" cy="60" r="${radius}" fill="none" stroke="url(#ring-gradient)" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" transform="rotate(-90 60 60)"></circle>
      <defs>
        <linearGradient id="ring-gradient" x1="0%" x2="100%">
          <stop offset="0%" stop-color="#f1c66a"></stop>
          <stop offset="100%" stop-color="#d7a23d"></stop>
        </linearGradient>
      </defs>
      <text x="60" y="56" text-anchor="middle" class="ua-ring-score">${percent}</text>
      <text x="60" y="74" text-anchor="middle" class="ua-ring-label">Score</text>
    </svg>
  `;
}

function renderVerificationLegend() {
  return Object.values(VERIFICATION_BADGES).map((badge) => `
    <span class="ua-verify-pill is-${badge.tone}">${badge.icon} ${badge.label}</span>
  `).join("");
}

function renderListRows(items, rowBuilder, emptyText) {
  if (!items?.length) {
    return `<div class="ua-empty">${escapeHtml(emptyText)}</div>`;
  }
  return items.map(rowBuilder).join("");
}

function profileTabMarkup() {
  const athlete = currentAthlete();
  const readiness = athlete.readiness || { score: 0, items: [] };
  const doneCount = readiness.items.filter((item) => item.done).length;
  const shortcuts = `
    <div class="ua-inline-actions">
      <button type="button" class="btn" data-upload="hero">Upload Background</button>
      <button type="button" class="btn" data-upload="avatar">Upload Profile Photo</button>
      ${state.editMode
        ? `<button type="button" class="btn primary" data-edit-action="save">💾 Save</button><button type="button" class="btn" data-edit-action="cancel">✕</button>`
        : `<button type="button" class="btn primary" data-edit-action="toggle">✏️ Edit</button>`}
    </div>
  `;

  const editField = (label, field, value, type = "text") => `
    <label class="ua-edit-field">
      <span>${label}</span>
      ${type === "textarea"
        ? `<textarea data-edit-field="${field}">${escapeHtml(value || "")}</textarea>`
        : `<input type="text" data-edit-field="${field}" value="${escapeHtml(value || "")}">`}
    </label>
  `;

  return `
    <div class="ua-panel-grid">
      <article class="ua-panel">
        <div class="ua-panel-head">
          <div>
            <p class="eyebrow">Profile</p>
            <h2>Identity and recruiting trust</h2>
          </div>
          ${shortcuts}
        </div>

        <div class="ua-id-card">
          <div class="ua-id-card-copy">
            <span class="ua-id-kicker">Untitled Athletic ID</span>
            <strong>${escapeHtml(athlete.athleteId)}</strong>
            <div class="ua-inline-actions">
              <button type="button" class="btn" data-copy-id="true">Copy ID</button>
              <button type="button" class="btn" data-scan-toggle="true">${state.idPanelExpanded ? "Hide Scan" : "Scan"}</button>
            </div>
          </div>
          ${state.idPanelExpanded ? `
            <div class="ua-id-visuals">
              <div class="ua-qr-card">
                ${renderPseudoQrSvg(athlete.qrValue)}
                <span>${escapeHtml(athlete.qrValue)}</span>
              </div>
              <div class="ua-barcode-card">
                ${renderBarcodeSvg(athlete.barcodeValue)}
                <button type="button" class="btn" data-download-card="true">Download ID Card</button>
              </div>
            </div>
          ` : ""}
        </div>

        <section class="ua-copy-block">
          <h3>Bio</h3>
          ${state.editMode ? editField("Bio", "bio", athlete.bio, "textarea") : `<p>${escapeHtml(athlete.bio)}</p>`}
        </section>

        <section class="ua-copy-block">
          <h3>Playing Style</h3>
          ${state.editMode ? editField("Playing Style", "playingStyle", athlete.playingStyle, "textarea") : `<p>${escapeHtml(athlete.playingStyle)}</p>`}
        </section>

        <section class="ua-copy-block">
          <h3>Strength Tags</h3>
          <div class="ua-pill-row">
            ${(athlete.strengths || []).map((tag) => `<span class="ua-chip">${escapeHtml(tag)}</span>`).join("")}
          </div>
        </section>

        <section class="ua-copy-block">
          <h3>Goals</h3>
          ${state.editMode ? editField("Goals", "goals", athlete.goals, "textarea") : `<p>${escapeHtml(athlete.goals)}</p>`}
        </section>

        <section class="ua-copy-block">
          <h3>Physical Measurables</h3>
          <div class="ua-measurable-grid">
            ${Object.entries(athlete.measurables || {}).map(([label, value]) => `
              <div class="ua-measurable-card">
                <span>${escapeHtml(label)}</span>
                ${state.editMode
                  ? `<input type="text" data-edit-field="measurables.${escapeHtml(label)}" value="${escapeHtml(value)}">`
                  : `<strong>${escapeHtml(value)}</strong>`}
              </div>
            `).join("")}
          </div>
        </section>

        <section class="ua-copy-block">
          <h3>Academic Profile</h3>
          <div class="ua-academic-grid">
            ${["gpa", "gradYear", "hometown"].map((field) => `
              <div class="ua-measurable-card">
                <span>${field === "gpa" ? "GPA" : field === "gradYear" ? "Grad Year" : "Hometown"}</span>
                ${state.editMode
                  ? `<input type="text" data-edit-field="${field}" value="${escapeHtml(athlete[field])}">`
                  : `<strong>${escapeHtml(athlete[field])}</strong>`}
              </div>
            `).join("")}
          </div>
        </section>
      </article>

      <article class="ua-panel">
        <section class="ua-verified-quote">
          <span class="ua-verify-pill is-coach">✓ Coach Verified</span>
          <blockquote>${escapeHtml(athlete.coachQuote?.text || "")}</blockquote>
          <p>${escapeHtml(athlete.coachQuote?.author || "")} • ${escapeHtml(athlete.coachQuote?.role || "")}</p>
        </section>

        <section class="ua-copy-block">
          <div class="ua-panel-head">
            <div>
              <p class="eyebrow">Offers</p>
              <h3>Scholarship interest and offers</h3>
            </div>
          </div>
          <div class="ua-stack-list">
            ${renderListRows(
              athlete.offers,
              (offer) => `
                <article class="ua-list-row ${offer.official ? "is-official" : ""}">
                  <div>
                    <strong>${escapeHtml(offer.school)}</strong>
                    <p>${escapeHtml(offer.sport)} • ${escapeHtml(formatShortDate(offer.date))}</p>
                  </div>
                  <span class="ua-chip ${offer.official ? "is-info" : ""}">${offer.official ? "Official Offer" : "Interest"}</span>
                </article>
              `,
              "No official recruiting activity is listed yet."
            )}
          </div>
        </section>

        <section class="ua-copy-block">
          <div class="ua-panel-head">
            <div>
              <p class="eyebrow">Events</p>
              <h3>Event appearances</h3>
            </div>
          </div>
          <div class="ua-stack-list">
            ${renderListRows(
              athlete.events,
              (event) => `
                <article class="ua-list-row">
                  <div>
                    <strong>${escapeHtml(event.name)}</strong>
                    <p>${escapeHtml(formatShortDate(event.date))}</p>
                  </div>
                  <span class="ua-chip">${escapeHtml(event.result)}</span>
                </article>
              `,
              "No showcase appearances are listed yet."
            )}
          </div>
        </section>

        <section class="ua-copy-block">
          <h3>CTA Row</h3>
          <div class="ua-inline-actions">
            <button type="button" class="btn" data-cta="share">Share Profile</button>
            <button type="button" class="btn" data-cta="pdf">Download PDF</button>
            <button type="button" class="btn" data-cta="contact">Contact Coach</button>
          </div>
        </section>

        <section class="ua-readiness-panel">
          <div class="ua-readiness-ring">${progressRing(readiness.score || 0)}</div>
          <div class="ua-readiness-copy">
            <h3>Scout Readiness Score</h3>
            <p class="ua-score-label">${escapeHtml(readinessLabel(readiness.score || 0))}</p>
            <p>${doneCount} complete • ${Math.max(0, readiness.items.length - doneCount)} left for the Premium Badge.</p>
            <div class="ua-readiness-list">
              ${readiness.items.map((item) => `
                <div class="ua-readiness-row">
                  <span>${item.done ? "✓" : "○"} ${escapeHtml(item.label)}</span>
                  <strong>${item.weight} pts</strong>
                </div>
              `).join("")}
            </div>
          </div>
        </section>
      </article>
    </div>
  `;
}

function growthDelta(sport, metric) {
  const progression = sport?.progression || [];
  if (progression.length < 2 || !metric) return "0%";
  const start = Number(progression[0][metric] || 0);
  const end = Number(progression[progression.length - 1][metric] || 0);
  if (!start && !end) return "0%";
  const isTrackMetric = metric.toLowerCase().includes("100") || metric.toLowerCase().includes("200");
  const percent = isTrackMetric
    ? ((start - end) / Math.max(start, 0.001)) * 100
    : ((end - start) / Math.max(start, 0.001)) * 100;
  return `${Math.round(percent)}%`;
}

function lineChartSvg(sport, metric, compareValues = null) {
  const rows = sport?.progression || [];
  if (!rows.length || !metric) return `<div class="ua-empty">No progression data available.</div>`;
  const values = rows.map((row) => Number(row[metric] || 0));
  const allValues = compareValues ? values.concat(compareValues) : values;
  const max = Math.max(...allValues, 1);
  const min = Math.min(...allValues, 0);
  const width = 520;
  const height = 220;
  const pad = 26;
  const point = (value, index, total) => {
    const x = pad + ((width - pad * 2) / Math.max(1, total - 1)) * index;
    const y = height - pad - ((value - min) / Math.max(1, max - min || 1)) * (height - pad * 2);
    return [x, y];
  };
  const points = values.map((value, index) => point(value, index, values.length));
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  const comparePoints = compareValues ? compareValues.map((value, index) => point(value, index, compareValues.length)) : [];
  const compareLine = comparePoints.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="ua-chart-svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="#11100d"></rect>
      ${rows.map((row, index) => {
        const [x] = point(values[index], index, rows.length);
        return `<text x="${x}" y="${height - 6}" text-anchor="middle" fill="rgba(255,255,255,0.58)" font-size="11">${escapeHtml(row.year)}</text>`;
      }).join("")}
      <path d="${line}" fill="none" stroke="#d7a23d" stroke-width="4" stroke-linecap="round"></path>
      ${compareValues ? `<path d="${compareLine}" fill="none" stroke="#7a92ff" stroke-width="3" stroke-linecap="round" stroke-dasharray="7 7"></path>` : ""}
      ${points.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="${index === points.length - 1 ? 6 : 4}" fill="#f8f2df"></circle>`).join("")}
    </svg>
  `;
}

function radarChartSvg(items, leftLabel = "Athlete", rightLabel = "Average") {
  if (!items?.length) return `<div class="ua-empty">No compare data available.</div>`;
  const size = 280;
  const center = size / 2;
  const radius = 96;
  const count = items.length;
  const polygonFor = (key) => items.map((item, index) => {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / count;
    const value = Number(item[key] || 0) / 100;
    const x = center + Math.cos(angle) * radius * value;
    const y = center + Math.sin(angle) * radius * value;
    return `${x},${y}`;
  }).join(" ");

  return `
    <div class="ua-radar-wrap">
      <svg viewBox="0 0 ${size} ${size}" class="ua-radar-svg">
        ${[1, 0.75, 0.5, 0.25].map((ratio) => `
          <polygon points="${items.map((item, index) => {
            const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / count;
            const x = center + Math.cos(angle) * radius * ratio;
            const y = center + Math.sin(angle) * radius * ratio;
            return `${x},${y}`;
          }).join(" ")}" fill="none" stroke="rgba(255,255,255,0.09)"></polygon>
        `).join("")}
        ${items.map((item, index) => {
          const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / count;
          const x = center + Math.cos(angle) * (radius + 18);
          const y = center + Math.sin(angle) * (radius + 18);
          return `
            <line x1="${center}" y1="${center}" x2="${center + Math.cos(angle) * radius}" y2="${center + Math.sin(angle) * radius}" stroke="rgba(255,255,255,0.12)"></line>
            <text x="${x}" y="${y}" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="11">${escapeHtml(item.stat)}</text>
          `;
        }).join("")}
        <polygon points="${polygonFor("avg")}" fill="rgba(122, 146, 255, 0.14)" stroke="#7a92ff" stroke-width="2"></polygon>
        <polygon points="${polygonFor("marcus")}" fill="rgba(215, 162, 61, 0.18)" stroke="#d7a23d" stroke-width="2"></polygon>
      </svg>
      <div class="ua-radar-legend">
        <span><i class="ua-dot is-gold"></i>${escapeHtml(leftLabel)}</span>
        <span><i class="ua-dot is-blue"></i>${escapeHtml(rightLabel)}</span>
      </div>
    </div>
  `;
}

function statsTabMarkup() {
  const athlete = currentAthlete();
  const sport = selectedSport(athlete);
  const metrics = Object.keys((sport?.progression || [])[0] || {}).filter((key) => key !== "year");
  const timelineItem = (sport?.timeline || []).find((item) => item.year === state.activeTimelineYear) || sport?.timeline?.[sport.timeline.length - 1];
  const comparisonSeries = sport?.positionAverages?.[state.compareMetric] || null;

  return `
    <article class="ua-panel">
      <div class="ua-panel-head">
        <div>
          <p class="eyebrow">Stats</p>
          <h2>${escapeHtml(athlete.name)} performance intelligence</h2>
        </div>
        <div class="ua-pill-row">
          ${(athlete.sports || []).map((item) => `
            <button type="button" class="ua-sport-pill ${state.activeSportId === item.id ? "active" : ""}" data-sport-id="${item.id}">
              ${escapeHtml(item.icon)} ${escapeHtml(item.label)}
            </button>
          `).join("")}
        </div>
      </div>

      <div class="ua-stat-grid ${sport?.stats?.length > 4 ? "is-three" : ""}">
        ${(sport?.stats || []).map((stat) => {
          const badge = badgeMeta(stat.badge);
          return `
            <article class="ua-stat-card">
              <strong>${escapeHtml(stat.value)}</strong>
              <span>${escapeHtml(stat.label)}</span>
              <small class="ua-verify-pill is-${badge.tone}">${badge.icon} ${badge.label}</small>
            </article>
          `;
        }).join("")}
      </div>

      <div class="ua-legend-row">${renderVerificationLegend()}</div>

      <section class="ua-copy-block">
        <div class="ua-panel-head">
          <div>
            <p class="eyebrow">Progression</p>
            <h3>Year-over-year chart</h3>
          </div>
          <div class="ua-pill-row">
            ${metrics.map((metric) => `
              <button type="button" class="ua-metric-pill ${state.activeMetric === metric ? "active" : ""}" data-metric="${escapeHtml(metric)}">
                ${escapeHtml(metric)}
              </button>
            `).join("")}
          </div>
        </div>
        ${lineChartSvg(sport, state.activeMetric)}
        <div class="ua-growth-badge">Growth ${escapeHtml(growthDelta(sport, state.activeMetric))}</div>
      </section>

      <details class="ua-accordion" open>
        <summary>${escapeHtml(sport?.icon || "•")} Growth Timeline</summary>
        <div class="ua-pill-row">
          ${(sport?.timeline || []).map((item) => `
            <button type="button" class="ua-metric-pill ${state.activeTimelineYear === item.year ? "active" : ""}" data-timeline-year="${escapeHtml(item.year)}">
              ${escapeHtml(item.emoji)} ${escapeHtml(item.year)}
            </button>
          `).join("")}
        </div>
        ${timelineItem ? `
          <div class="ua-timeline-card">
            <div class="ua-milestone-banner">${escapeHtml(timelineItem.milestone)}</div>
            <div class="ua-measurable-grid">
              ${Object.entries(timelineItem.stats || {}).map(([label, value]) => `
                <div class="ua-measurable-card">
                  <span>${escapeHtml(label)}</span>
                  <strong>${escapeHtml(value)}</strong>
                </div>
              `).join("")}
            </div>
            <div class="ua-pill-row">${(timelineItem.awards || []).map((award) => `<span class="ua-chip">${escapeHtml(award)}</span>`).join("")}</div>
            <p class="ua-muted-line">${escapeHtml(timelineItem.rank || "")}</p>
          </div>
        ` : `<div class="ua-empty">No timeline snapshot found.</div>`}
      </details>

      <details class="ua-accordion" open>
        <summary>Compare vs. Position Average</summary>
        <div class="ua-compare-grid">
          ${radarChartSvg(sport?.compareRadar || [], athlete.name, "Position Avg")}
          <div>
            <div class="ua-pill-row">
              ${metrics.map((metric) => `
                <button type="button" class="ua-metric-pill ${state.compareMetric === metric ? "active" : ""}" data-compare-metric="${escapeHtml(metric)}">
                  ${escapeHtml(metric)}
                </button>
              `).join("")}
            </div>
            ${lineChartSvg(sport, state.compareMetric, comparisonSeries)}
          </div>
        </div>
      </details>

      <div class="ua-season-grid">
        <article class="ua-info-card"><span>Season / Grade</span><strong>${escapeHtml(sport?.season || "")} • ${escapeHtml(sport?.grade || "")}</strong></article>
        <article class="ua-info-card"><span>Team</span><strong>${escapeHtml(sport?.team || "")}</strong></article>
        <article class="ua-info-card"><span>Record</span><strong>${escapeHtml(sport?.record || "")}</strong></article>
      </div>

      <article class="ua-awards-card">
        <p class="eyebrow">Awards</p>
        <h3>${escapeHtml(sport?.label || "")} season honors</h3>
        <div class="ua-pill-row">${(sport?.awards || []).map((award) => `<span class="ua-chip">${escapeHtml(award)}</span>`).join("")}</div>
      </article>
    </article>
  `;
}

function clutchScore(athlete) {
  const base = Math.min(95, Math.round((athlete.readiness?.score || 80) * 0.45 + (athlete.clutchMoments?.length || 0) * 12));
  return Math.max(68, base);
}

function clutchTabMarkup() {
  const athlete = currentAthlete();
  const score = clutchScore(athlete);
  return `
    <div class="ua-panel-grid">
      <article class="ua-panel">
        <div class="ua-panel-head">
          <div>
            <p class="eyebrow">Clutch</p>
            <h2>Pressure moments and Clutch Score™</h2>
          </div>
        </div>

        <div class="ua-clutch-score">
          <div>
            <strong>${score}</strong>
            <span>Clutch Score™</span>
          </div>
          <div class="ua-gradient-bar"><span style="width:${score}%"></span></div>
        </div>

        <div class="ua-season-grid">
          <article class="ua-info-card"><span>Playoff PPG</span><strong>${(selectedSport()?.stats || [])[0]?.value || "18.4"}</strong></article>
          <article class="ua-info-card"><span>Pressure FG%</span><strong>51.2%</strong></article>
          <article class="ua-info-card"><span>Comeback Wins</span><strong>${Math.max(2, athlete.clutchMoments?.length || 2)}</strong></article>
        </div>

        <div class="ua-stack-list">
          ${renderListRows(
            athlete.clutchMoments,
            (moment) => {
              const badge = badgeMeta(moment.badge);
              return `
                <details class="ua-accordion ua-moment-card">
                  <summary>
                    <span class="ua-chip is-${escapeHtml(moment.type)}">${escapeHtml(moment.type.toUpperCase())}</span>
                    <span class="ua-verify-pill is-${badge.tone}">${badge.icon} ${badge.label}</span>
                    <strong>${escapeHtml(moment.title)}</strong>
                    <small>${escapeHtml(moment.opponent)} • ${escapeHtml(formatShortDate(moment.date))}</small>
                  </summary>
                  <p><em>${escapeHtml(moment.context)}</em></p>
                  <p>${escapeHtml(moment.statLine)}</p>
                  <p>${escapeHtml(moment.summary)}</p>
                  <button type="button" class="btn" data-play-moment="${escapeHtml(moment.title)}">Play Film</button>
                </details>
              `;
            },
            "No verified clutch moments are listed yet."
          )}
        </div>
      </article>

      <article class="ua-panel">
        <div class="ua-panel-head">
          <div>
            <p class="eyebrow">Montage Builder</p>
            <h2>One-click scout presentation</h2>
          </div>
        </div>

        <div class="ua-montage-preview">
          <span>Untitled Athletic</span>
          <strong>${escapeHtml(athlete.name)}</strong>
          <p>${escapeHtml(athlete.school)} • ${escapeHtml(athlete.position)}</p>
          <div class="ua-pill-row">
            ${(selectedSport()?.stats || []).slice(0, 3).map((stat) => `<span class="ua-chip">${escapeHtml(stat.label)} ${escapeHtml(stat.value)}</span>`).join("")}
          </div>
        </div>

        <div class="ua-toggle-list">
          ${[
            ["stats", "Stats"],
            ["awards", "Awards"],
            ["timeline", "Timeline"],
            ["clutch", "Clutch Moments"],
            ["film", "Film"],
          ].map(([key, label]) => `
            <label class="ua-toggle-row">
              <span>${escapeHtml(label)}</span>
              <input type="checkbox" data-montage-toggle="${key}" ${state.montageSelections[key] ? "checked" : ""}>
            </label>
          `).join("")}
        </div>

        <div class="ua-inline-actions">
          <button type="button" class="btn primary" data-generate-montage="true">Generate Montage</button>
        </div>

        ${state.montageGenerated ? `
          <div class="ua-generated-state">
            <strong>Montage Ready</strong>
            <p>Share link, PDF export, and scout deck have been staged for this athlete.</p>
            <div class="ua-inline-actions">
              <button type="button" class="btn" data-cta="share">Share Link</button>
              <button type="button" class="btn" data-cta="pdf">Export PDF</button>
            </div>
          </div>
        ` : ""}
      </article>
    </div>
  `;
}

function mediaTabMarkup() {
  const athlete = currentAthlete();
  const highlight = selectedHighlight(athlete);
  const typeFilters = ["All", "Highlights", "Full Games", "Workouts"];
  const sportFilters = ["all", ...(athlete.sports || []).map((sport) => sport.id)];
  const filtered = (athlete.highlights || []).filter((item) => {
    const typeMatch = state.mediaTypeFilter === "All" || item.type === state.mediaTypeFilter;
    const sportMatch = state.mediaSportFilter === "all" || item.sport === state.mediaSportFilter;
    return typeMatch && sportMatch;
  });

  return `
    <article class="ua-panel">
      <div class="ua-panel-head">
        <div>
          <p class="eyebrow">Media</p>
          <h2>Featured film and filtered media</h2>
        </div>
      </div>

      ${highlight ? `
        <article class="ua-featured-media">
          <div class="ua-featured-visual ${highlight.mediaUrl ? "has-image" : ""}" style="${highlight.mediaUrl ? `background-image:linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.72)), url('${highlight.mediaUrl}')` : ""}">
            <button type="button" class="ua-play-btn" data-play-moment="${escapeHtml(highlight.title)}">▶</button>
          </div>
          <div class="ua-featured-copy">
            <div class="ua-pill-row">
              <span class="ua-chip is-info">FEATURED</span>
              <span class="ua-chip">${escapeHtml(getSportMeta(highlight.sport).icon)} ${escapeHtml(getSportMeta(highlight.sport).label)}</span>
              <span class="ua-chip">${escapeHtml(highlight.source)}</span>
              <span class="ua-chip">${escapeHtml(highlight.duration)}</span>
              <span class="ua-chip">${escapeHtml(highlight.season)}</span>
            </div>
            <h3>${escapeHtml(highlight.title)}</h3>
            <p>${escapeHtml(highlight.type)} • ${escapeHtml(highlight.views)} views</p>
            <div class="ua-inline-actions">
              <button type="button" class="btn" data-cta="share">Share</button>
            </div>
          </div>
        </article>
      ` : `<div class="ua-empty">No media available.</div>`}

      <div class="ua-filter-stack">
        <div class="ua-pill-row">
          ${typeFilters.map((type) => `
            <button type="button" class="ua-metric-pill ${state.mediaTypeFilter === type ? "active" : ""}" data-media-type="${escapeHtml(type)}">${escapeHtml(type)}</button>
          `).join("")}
        </div>
        <div class="ua-pill-row">
          ${sportFilters.map((sportId) => `
            <button type="button" class="ua-metric-pill ${state.mediaSportFilter === sportId ? "active" : ""}" data-media-sport="${escapeHtml(sportId)}">
              ${sportId === "all" ? "All Sports" : `${escapeHtml(getSportMeta(sportId).icon)} ${escapeHtml(getSportMeta(sportId).label)}`}
            </button>
          `).join("")}
        </div>
      </div>

      <div class="ua-media-grid">
        ${filtered.length ? filtered.map((item) => `
          <button type="button" class="ua-media-card ${state.featuredMediaId === item.id ? "is-featured" : ""}" data-feature-media="${escapeHtml(item.id)}">
            <div class="ua-media-thumb ${item.mediaUrl ? "has-image" : ""}" style="${item.mediaUrl ? `background-image:linear-gradient(180deg, rgba(0,0,0,.12), rgba(0,0,0,.7)), url('${item.mediaUrl}')` : ""}">
              <span class="ua-media-play">▶</span>
            </div>
            <div class="ua-media-copy">
              <div class="ua-pill-row">
                <span class="ua-chip">${escapeHtml(getSportMeta(item.sport).icon)}</span>
                <span class="ua-chip">${escapeHtml(item.source)}</span>
                <span class="ua-chip">${escapeHtml(item.type)}</span>
              </div>
              <strong>${escapeHtml(item.title)}</strong>
              <span>${escapeHtml(item.duration)} • ${escapeHtml(item.views)} views</span>
            </div>
          </button>
        `).join("") : `<div class="ua-empty">No media matches both filters.</div>`}
      </div>
    </article>
  `;
}

function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function scheduleTabMarkup() {
  const athlete = currentAthlete();
  const schedule = athlete.schedule || [];
  const today = new Date();
  const nextEvent = schedule
    .filter((item) => new Date(item.date).getTime() >= today.getTime())
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0] || schedule[0];

  const monthStart = new Date(state.scheduleMonth.getFullYear(), state.scheduleMonth.getMonth(), 1);
  const firstCell = new Date(monthStart);
  firstCell.setDate(firstCell.getDate() - firstCell.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    const key = slugDate(date);
    const events = schedule.filter((item) => slugDate(item.date) === key);
    return { date, key, events, inMonth: date.getMonth() === monthStart.getMonth() };
  });
  const selectedEvents = schedule.filter((item) => slugDate(item.date) === state.selectedDateKey);

  return `
    <article class="ua-panel">
      <div class="ua-panel-head">
        <div>
          <p class="eyebrow">Schedule</p>
          <h2>Calendar and upcoming events</h2>
        </div>
      </div>

      ${nextEvent ? `
        <article class="ua-next-event">
          <div>
            <span class="ua-chip is-info">${escapeHtml(getSportMeta(nextEvent.sport).icon)} Next Event</span>
            <h3>${escapeHtml(nextEvent.opponent)}</h3>
            <p>${escapeHtml(nextEvent.location)} • ${escapeHtml(formatShortDate(nextEvent.date))} • ${escapeHtml(formatTime(nextEvent.date))}</p>
          </div>
          <div class="ua-inline-actions">
            <button type="button" class="btn" data-notify-event="${escapeHtml(nextEvent.id)}">Notify</button>
            <button type="button" class="btn" data-open-map="${escapeHtml(nextEvent.location)}">Map</button>
          </div>
        </article>
      ` : ""}

      <div class="ua-calendar-shell">
        <div class="ua-panel-head">
          <button type="button" class="btn" data-month-step="-1">←</button>
          <h3>${escapeHtml(monthLabel(state.scheduleMonth))}</h3>
          <button type="button" class="btn" data-month-step="1">→</button>
        </div>
        <div class="ua-calendar-grid">
          ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span class="ua-calendar-weekday">${day}</span>`).join("")}
          ${days.map((day) => `
            <button type="button" class="ua-calendar-day ${day.inMonth ? "" : "is-faded"} ${state.selectedDateKey === day.key ? "is-selected" : ""} ${slugDate(today) === day.key ? "is-today" : ""}" data-date-key="${day.key}">
              <span>${day.date.getDate()}</span>
              <small class="ua-day-dots">${day.events.map((event) => `<i class="ua-day-dot is-${escapeHtml(event.type)}"></i>`).join("")}</small>
            </button>
          `).join("")}
        </div>
      </div>

      ${state.selectedDateKey ? `
        <div class="ua-stack-list">
          ${selectedEvents.length ? selectedEvents.map((event) => `
            <article class="ua-list-row">
              <div>
                <strong>${escapeHtml(getSportMeta(event.sport).icon)} ${escapeHtml(event.opponent)}</strong>
                <p>${escapeHtml(event.location)} • ${escapeHtml(formatTime(event.date))}</p>
              </div>
              <div class="ua-inline-actions">
                <span class="ua-chip">${escapeHtml(event.type)}</span>
                <button type="button" class="btn" data-notify-event="${escapeHtml(event.id)}">Notify</button>
              </div>
            </article>
          `).join("") : `<div class="ua-empty">No events on the selected date.</div>`}
        </div>
      ` : `
        <div class="ua-stack-list">
          ${schedule.length ? schedule.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).map((event) => `
            <article class="ua-upcoming-row">
              <div class="ua-date-tile">
                <span>${new Date(event.date).toLocaleDateString(undefined, { month: "short" })}</span>
                <strong>${new Date(event.date).getDate()}</strong>
              </div>
              <div>
                <strong>${escapeHtml(getSportMeta(event.sport).icon)} ${escapeHtml(event.opponent)}</strong>
                <p>${escapeHtml(event.location)} • ${escapeHtml(formatTime(event.date))}</p>
              </div>
              <span class="ua-chip">${escapeHtml(event.type)}</span>
            </article>
          `).join("") : `<div class="ua-empty">No scheduled events yet.</div>`}
        </div>
      `}
    </article>
  `;
}

function recruiterFit(athlete) {
  const readiness = athlete.readiness?.score || 0;
  const academics = Math.min(99, Math.round((Number(athlete.gpa) || 3.5) * 25));
  const clutch = clutchScore(athlete);
  const growth = Math.min(96, Math.max(70, 65 + athlete.sports.length * 4));
  return {
    overall: Math.round((readiness + academics + clutch + growth) / 4),
    athleticism: Math.round((clutch + growth) / 2),
    academics,
    character: Math.round((readiness + 6 + athlete.strengths.length * 2)),
    growth,
  };
}

function scoutViewMarkup(athlete) {
  const fit = recruiterFit(athlete);
  const notes = state.notesByAthleteId[athlete.athleteId] || [];
  const sport = selectedSport(athlete);
  const growth = growthDelta(sport, state.activeMetric || Object.keys((sport?.progression || [])[0] || {}).find((key) => key !== "year"));

  return `
    <div class="ua-panel-grid">
      <article class="ua-panel">
        <div class="ua-inline-actions">
          <button type="button" class="btn ${state.watchlist.has(athlete.athleteId) ? "warn" : ""}" data-watchlist-toggle="${escapeHtml(athlete.athleteId)}">
            ${state.watchlist.has(athlete.athleteId) ? "★ Watchlisted" : "☆ Watchlist"}
          </button>
          <button type="button" class="btn" data-cta="pdf">Export Card</button>
          <button type="button" class="btn" data-toggle-scout-report="true">${state.scoutReportVisible ? "Hide" : "Show"} Scout Report</button>
        </div>

        ${state.scoutReportVisible ? `
          <article class="ua-report-card">
            <h3>Scout Report</h3>
            <p>${escapeHtml(athlete.name)} (${escapeHtml(athlete.athleteId)}) is a ${escapeHtml(athlete.position)} from ${escapeHtml(athlete.school)} with a ${escapeHtml(athlete.gpa)} GPA and ${escapeHtml(athlete.ranking)} standing. Growth on the ${escapeHtml(sport?.label || "primary")} track is ${escapeHtml(growth)}, with a Clutch Score™ of ${clutchScore(athlete)} and a presentation profile that emphasizes verified context, coach trust, and multi-sport credibility.</p>
            <div class="ua-inline-actions">
              <button type="button" class="btn" data-copy-report="true">Copy Report</button>
              <button type="button" class="btn" data-cta="pdf">Export PDF</button>
            </div>
          </article>
        ` : ""}

        <article class="ua-fit-card">
          <div class="ua-panel-head">
            <div>
              <p class="eyebrow">Recruiter Fit Score™</p>
              <h3>${fit.overall}</h3>
            </div>
          </div>
          <div class="ua-gradient-bar is-purple"><span style="width:${fit.overall}%"></span></div>
          <div class="ua-fit-grid">
            ${[
              ["Athleticism", fit.athleticism],
              ["Academics", fit.academics],
              ["Character", Math.min(97, fit.character)],
              ["Growth Trend", fit.growth],
            ].map(([label, value]) => `
              <article class="ua-mini-score">
                <strong>${value}</strong>
                <span>${label}</span>
                <div class="ua-gradient-bar is-purple"><span style="width:${value}%"></span></div>
              </article>
            `).join("")}
          </div>
        </article>
      </article>

      <article class="ua-panel">
        <section class="ua-copy-block">
          <h3>Recruiter Interest Log</h3>
          <div class="ua-stack-list">
            ${renderListRows(
              athlete.recruiters,
              (row) => `
                <article class="ua-list-row">
                  <div>
                    <strong>${escapeHtml(row.school)}</strong>
                    <p>${escapeHtml(row.contact)} • ${escapeHtml(formatShortDate(row.date))}</p>
                  </div>
                  <span class="ua-chip ${row.interested ? "is-info" : ""}">${row.interested ? "Interested" : "Evaluated"}</span>
                </article>
              `,
              "No recruiter log entries yet."
            )}
          </div>
        </section>

        <section class="ua-copy-block">
          <h3>Scout Notes</h3>
          <div class="ua-note-entry">
            <input id="scout-note-input" type="text" placeholder="Add a private scout note">
            <button type="button" class="btn primary" data-save-note="true">+</button>
          </div>
          <div class="ua-stack-list">
            ${notes.length ? notes.map((note) => `
              <article class="ua-note-card">
                <strong>${escapeHtml(note.date)}</strong>
                <p>${escapeHtml(note.body)}</p>
              </article>
            `).join("") : `<div class="ua-empty">No private notes for this athlete yet.</div>`}
          </div>
        </section>
      </article>
    </div>
  `;
}

function compareViewMarkup(athlete) {
  const athleteA = state.athleteDirectory.find((item) => item.userId === (state.compareAId || athlete.userId)) || athlete;
  const athleteB = state.athleteDirectory.find((item) => item.userId === (state.compareBId || state.athleteDirectory.find((item) => item.userId !== athleteA.userId)?.userId)) || athlete;
  const sharedSports = sportOptionsForCompare(athleteA, athleteB);
  const compareSport = sharedSports.find((item) => item.id === state.activeSportId) || sharedSports[0] || athleteA.sports[0];
  const leftSport = athleteA.sports.find((item) => item.id === compareSport?.id) || athleteA.sports[0];
  const rightSport = athleteB.sports.find((item) => item.id === compareSport?.id) || athleteB.sports[0];
  const leftStats = (leftSport?.stats || []).slice(0, 4);
  const rightStats = (rightSport?.stats || []).slice(0, 4);

  return `
    <article class="ua-panel">
      <div class="ua-panel-head">
        <div>
          <p class="eyebrow">Compare</p>
          <h2>Side-by-side athlete evaluation</h2>
        </div>
      </div>

      <div class="ua-compare-selectors">
        <label>
          Athlete A
          <select data-compare-select="a">
            ${state.athleteDirectory.map((item) => `<option value="${escapeHtml(item.userId)}" ${item.userId === athleteA.userId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
          </select>
        </label>
        <label>
          Athlete B
          <select data-compare-select="b">
            ${state.athleteDirectory.map((item) => `<option value="${escapeHtml(item.userId)}" ${item.userId === athleteB.userId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
          </select>
        </label>
      </div>

      <div class="ua-pill-row">
        ${sharedSports.map((item) => `<button type="button" class="ua-sport-pill ${compareSport?.id === item.id ? "active" : ""}" data-sport-id="${escapeHtml(item.id)}">${escapeHtml(item.icon)} ${escapeHtml(item.label)}</button>`).join("")}
      </div>

      <div class="ua-compare-id-grid">
        ${[athleteA, athleteB].map((item, index) => `
          <article class="ua-identity-compare-card ${index === 0 ? "is-a" : "is-b"}">
            <span class="ua-switcher-avatar">${escapeHtml(item.initials)}</span>
            <strong>${escapeHtml(item.name)}</strong>
            <p>${escapeHtml(item.school)} • ${escapeHtml(item.gradYear)}</p>
            <small>${escapeHtml(item.position)} • ${escapeHtml(item.athleteId)}</small>
          </article>
        `).join("")}
      </div>

      <div class="ua-compare-measure-grid">
        ${Object.keys(athleteA.measurables || {}).map((label) => `
          <div class="ua-compare-measure-row">
            <strong>${escapeHtml(athleteA.measurables[label] || "-")}</strong>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(athleteB.measurables?.[label] || "-")}</strong>
          </div>
        `).join("")}
      </div>

      <div class="ua-stat-compare-grid">
        ${leftStats.map((stat, index) => `
          <article class="ua-compare-stat-card">
            <strong>${escapeHtml(stat.value)}</strong>
            <span>${escapeHtml(stat.label)}</span>
            <em>${escapeHtml(rightStats[index]?.value || "-")}</em>
          </article>
        `).join("")}
      </div>

      <div class="ua-compare-grid">
        ${radarChartSvg((leftSport?.compareRadar || []).map((item, index) => ({
          stat: item.stat,
          marcus: item.marcus,
          avg: rightSport?.compareRadar?.[index]?.marcus || rightSport?.compareRadar?.[index]?.avg || 0,
        })), athleteA.name, athleteB.name)}
        <div class="ua-stack-list">
          ${[
            [athleteA.name, athleteA.readiness?.score || 0, "is-gold"],
            [athleteB.name, athleteB.readiness?.score || 0, "is-blue"],
          ].map(([label, value, tone]) => `
            <article class="ua-ready-bar-card">
              <div class="ua-panel-head">
                <strong>${escapeHtml(label)}</strong>
                <span>${value}</span>
              </div>
              <div class="ua-gradient-bar ${tone === "is-blue" ? "is-blue" : ""}"><span style="width:${value}%"></span></div>
            </article>
          `).join("")}
        </div>
      </div>
    </article>
  `;
}

function scoutSearchViewMarkup() {
  const query = normalizeText(state.scoutSearch);
  const filtered = state.athleteDirectory.filter((athlete) => {
    if (!query) return true;
    return normalizeText(`${athlete.name} ${athlete.athleteId} ${athlete.school} ${athlete.searchTokens}`).includes(query);
  });

  return `
    <article class="ua-panel">
      <div class="ua-panel-head">
        <div>
          <p class="eyebrow">Search</p>
          <h2>ATHLETES array search mode</h2>
        </div>
      </div>

      <label class="ua-edit-field">
        <span>Search athletes</span>
        <input id="scout-search-input" type="search" placeholder="Name, athlete ID, school, or sport" value="${escapeHtml(state.scoutSearch)}">
      </label>

      <div class="ua-search-grid">
        ${filtered.map((athlete) => `
          <article class="ua-search-athlete-card">
            <div class="ua-panel-head">
              <div>
                <strong>${escapeHtml(athlete.name)}</strong>
                <p>${escapeHtml(athlete.school)} • Class of ${escapeHtml(athlete.gradYear)}</p>
              </div>
              <span class="ua-chip">${athlete.readiness?.score || 0}</span>
            </div>
            <small class="ua-mono">${escapeHtml(athlete.athleteId)}</small>
            <div class="ua-pill-row">${(athlete.sports || []).map((sport) => `<span class="ua-chip">${escapeHtml(sport.icon)}</span>`).join("")}</div>
            <div class="ua-inline-actions">
              <button type="button" class="btn" data-switch-profile="${escapeHtml(athlete.userId)}">Open Athlete</button>
            </div>
          </article>
        `).join("")}
      </div>
    </article>
  `;
}

function scoutTabMarkup() {
  const athlete = currentAthlete();
  return `
    <article class="ua-panel">
      <div class="ua-panel-head">
        <div>
          <p class="eyebrow">Scout</p>
          <h2>Scout tools, compare mode, and search</h2>
        </div>
        <div class="ua-pill-row">
          ${SCOUT_MODES.map((mode) => `
            <button type="button" class="ua-metric-pill ${state.scoutMode === mode.id ? "active" : ""}" data-scout-mode="${mode.id}">
              ${escapeHtml(mode.label)}
            </button>
          `).join("")}
        </div>
      </div>
      ${state.scoutMode === "view" ? scoutViewMarkup(athlete) : state.scoutMode === "compare" ? compareViewMarkup(athlete) : scoutSearchViewMarkup()}
    </article>
  `;
}

function renderActiveTab() {
  if (!state.athlete) return;
  const markup = {
    profile: profileTabMarkup(),
    stats: statsTabMarkup(),
    clutch: clutchTabMarkup(),
    media: mediaTabMarkup(),
    schedule: scheduleTabMarkup(),
    scout: scoutTabMarkup(),
  }[state.activeTab];
  tabStageEl.innerHTML = markup || `<div class="ua-empty">Tab unavailable.</div>`;
}

function renderAll() {
  syncSelectedSport();
  renderTabs();
  renderHero();
  renderIdentityRow();
  updateHeroActions();
  renderActiveTab();
}

async function loadAthlete(userId) {
  const bundle = await fetchProfileBundle(userId);
  state.targetUserId = userId;
  state.isSelfProfile = state.viewerUserId === userId;
  state.isFollowing = await fetchIsFollowing();
  const athlete = buildAthleteProfile({
    userId,
    directory: bundle.directory,
    athleteRow: bundle.athleteRow,
    schoolName: bundle.schoolName,
    stats: bundle.stats,
    posts: bundle.posts,
    counts: bundle.counts,
    fallbackRole: bundle.userRow?.role || "athlete",
  });
  state.athlete = applyOverrides(athlete);
  state.featuredMediaId = selectedHighlight(state.athlete)?.id || "";
  state.selectedDateKey = "";
  replaceHistoryUser(userId);
  renderAll();
}

function setNested(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }
    cursor[part] = cursor[part] || {};
    cursor = cursor[part];
  });
}

function saveProfileEdits() {
  const athlete = currentAthlete();
  if (!athlete) return;
  const override = { ...(state.editsByAthleteId[athlete.athleteId] || {}) };
  Array.from(tabStageEl.querySelectorAll("[data-edit-field]")).forEach((field) => {
    const path = field.dataset.editField;
    setNested(override, path, field.value.trim());
  });
  state.editsByAthleteId[athlete.athleteId] = override;
  writeStoredJson(STORAGE_KEYS.edits, state.editsByAthleteId);
  state.editMode = false;
  state.athlete = applyOverrides(athlete);
  renderAll();
  showToast("Profile changes saved for this session.");
}

function cancelProfileEdits() {
  state.editMode = false;
  renderAll();
}

function handleCta(action) {
  const athlete = currentAthlete();
  if (!athlete) return;
  if (action === "compare") {
    state.activeTab = "scout";
    state.scoutMode = "compare";
    renderAll();
    return;
  }
  if (action === "contact") {
    window.alert(athlete.email ? `Primary contact: ${athlete.email}` : "Coach contact flow will attach to a real messaging system at launch.");
    return;
  }
  if (action === "share") {
    navigator.clipboard?.writeText(athlete.qrValue);
    showToast("Profile link copied.");
    return;
  }
  if (action === "pdf") {
    window.alert("PDF export is staged in the UI. Production export wiring is still pending.");
    return;
  }
  if (action === "watch" && !state.isSelfProfile) {
    toggleFollow();
  }
}

function saveScoutNote() {
  const athlete = currentAthlete();
  const input = document.querySelector("#scout-note-input");
  if (!athlete || !input?.value.trim()) return;
  state.notesByAthleteId[athlete.athleteId] = [
    {
      date: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      body: input.value.trim(),
    },
    ...(state.notesByAthleteId[athlete.athleteId] || []),
  ];
  writeStoredJson(STORAGE_KEYS.notes, state.notesByAthleteId);
  renderActiveTab();
}

function toggleWatchlist(athleteId) {
  if (state.watchlist.has(athleteId)) {
    state.watchlist.delete(athleteId);
  } else {
    state.watchlist.add(athleteId);
  }
  writeStoredJson(STORAGE_KEYS.watchlist, Array.from(state.watchlist));
  renderActiveTab();
}

function bindGlobalEvents() {
  if (eventsBound) return;
  eventsBound = true;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const tabTarget = target.closest("[data-tab-target]")?.dataset.tabTarget;
    if (tabTarget) {
      state.activeTab = tabTarget;
      renderAll();
      return;
    }

    const switchUserId = target.closest("[data-switch-profile]")?.dataset.switchProfile;
    if (switchUserId) {
      loadAthlete(switchUserId);
      return;
    }

    const cta = target.closest("[data-cta]")?.dataset.cta;
    if (cta) {
      handleCta(cta);
      return;
    }

    if (target.closest("[data-upload='hero']")) heroBgInput?.click();
    if (target.closest("[data-upload='avatar']")) avatarInput?.click();

    if (target.closest("[data-copy-id]")) {
      navigator.clipboard?.writeText(currentAthlete()?.athleteId || "");
      showToast("Athlete ID copied.");
      return;
    }

    if (target.closest("[data-scan-toggle]")) {
      state.idPanelExpanded = !state.idPanelExpanded;
      renderActiveTab();
      return;
    }

    const editAction = target.closest("[data-edit-action]")?.dataset.editAction;
    if (editAction === "toggle") {
      state.editMode = true;
      renderActiveTab();
      return;
    }
    if (editAction === "save") {
      saveProfileEdits();
      return;
    }
    if (editAction === "cancel") {
      cancelProfileEdits();
      return;
    }

    const sportId = target.closest("[data-sport-id]")?.dataset.sportId;
    if (sportId) {
      state.activeSportId = sportId;
      renderActiveTab();
      return;
    }

    const metric = target.closest("[data-metric]")?.dataset.metric;
    if (metric) {
      state.activeMetric = metric;
      renderActiveTab();
      return;
    }

    const timelineYear = target.closest("[data-timeline-year]")?.dataset.timelineYear;
    if (timelineYear) {
      state.activeTimelineYear = timelineYear;
      renderActiveTab();
      return;
    }

    const compareMetric = target.closest("[data-compare-metric]")?.dataset.compareMetric;
    if (compareMetric) {
      state.compareMetric = compareMetric;
      renderActiveTab();
      return;
    }

    const mediaType = target.closest("[data-media-type]")?.dataset.mediaType;
    if (mediaType) {
      state.mediaTypeFilter = mediaType;
      renderActiveTab();
      return;
    }

    const mediaSport = target.closest("[data-media-sport]")?.dataset.mediaSport;
    if (mediaSport) {
      state.mediaSportFilter = mediaSport;
      renderActiveTab();
      return;
    }

    const featureMedia = target.closest("[data-feature-media]")?.dataset.featureMedia;
    if (featureMedia) {
      state.featuredMediaId = featureMedia;
      renderActiveTab();
      return;
    }

    if (target.closest("[data-generate-montage]")) {
      state.montageGenerated = true;
      renderActiveTab();
      showToast("Montage presentation generated.");
      return;
    }

    const playMoment = target.closest("[data-play-moment]")?.dataset.playMoment;
    if (playMoment) {
      window.alert(`Opening film clip: ${playMoment}`);
      return;
    }

    const monthStep = target.closest("[data-month-step]")?.dataset.monthStep;
    if (monthStep) {
      state.scheduleMonth = new Date(state.scheduleMonth.getFullYear(), state.scheduleMonth.getMonth() + Number(monthStep), 1);
      renderActiveTab();
      return;
    }

    const dateKey = target.closest("[data-date-key]")?.dataset.dateKey;
    if (dateKey) {
      state.selectedDateKey = state.selectedDateKey === dateKey ? "" : dateKey;
      renderActiveTab();
      return;
    }

    const notifyId = target.closest("[data-notify-event]")?.dataset.notifyEvent;
    if (notifyId) {
      window.alert(`Notify Me is staged for ${notifyId}. Production push notifications are still pending.`);
      return;
    }

    const mapLocation = target.closest("[data-open-map]")?.dataset.openMap;
    if (mapLocation) {
      window.alert(`Map shortcut for ${mapLocation}`);
      return;
    }

    const scoutMode = target.closest("[data-scout-mode]")?.dataset.scoutMode;
    if (scoutMode) {
      state.scoutMode = scoutMode;
      renderActiveTab();
      return;
    }

    const watchToggle = target.closest("[data-watchlist-toggle]")?.dataset.watchlistToggle;
    if (watchToggle) {
      toggleWatchlist(watchToggle);
      return;
    }

    if (target.closest("[data-toggle-scout-report]")) {
      state.scoutReportVisible = !state.scoutReportVisible;
      renderActiveTab();
      return;
    }

    if (target.closest("[data-copy-report]")) {
      const report = tabStageEl.querySelector(".ua-report-card p")?.textContent || "";
      navigator.clipboard?.writeText(report);
      showToast("Scout report copied.");
      return;
    }

    if (target.closest("[data-save-note]")) {
      saveScoutNote();
      return;
    }
  });

  tabStageEl?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.matches("[data-montage-toggle]")) {
      state.montageSelections[target.dataset.montageToggle] = target.checked;
      return;
    }

    if (target.matches("[data-compare-select='a']")) {
      state.compareAId = target.value;
      renderActiveTab();
      return;
    }

    if (target.matches("[data-compare-select='b']")) {
      state.compareBId = target.value;
      renderActiveTab();
      return;
    }
  });

  tabStageEl?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === "scout-search-input") {
      state.scoutSearch = target.value;
      renderActiveTab();
    }
  });

  primaryActionBtn?.addEventListener("click", () => {
    if (state.isSelfProfile) {
      state.activeTab = "profile";
      state.editMode = true;
      renderAll();
      return;
    }
    toggleFollow();
  });

  secondaryActionBtn?.addEventListener("click", () => handleCta("share"));

  heroBgTrigger?.addEventListener("click", () => heroBgInput?.click());
  avatarTrigger?.addEventListener("click", () => avatarInput?.click());

  heroBgInput?.addEventListener("change", () => {
    const file = heroBgInput.files?.[0];
    const athlete = currentAthlete();
    if (!file || !athlete) return;
    state.imageOverrides[athlete.athleteId] = {
      ...(state.imageOverrides[athlete.athleteId] || {}),
      heroBackgroundUrl: URL.createObjectURL(file),
    };
    state.athlete = applyOverrides(athlete);
    renderHero();
    showToast("Hero background updated for this session.");
  });

  avatarInput?.addEventListener("change", () => {
    const file = avatarInput.files?.[0];
    const athlete = currentAthlete();
    if (!file || !athlete) return;
    state.imageOverrides[athlete.athleteId] = {
      ...(state.imageOverrides[athlete.athleteId] || {}),
      avatarUrl: URL.createObjectURL(file),
    };
    state.athlete = applyOverrides(athlete);
    renderHero();
    showToast("Profile photo updated for this session.");
  });
}

async function bootstrapProfile(session) {
  if (!session?.user?.id) return;
  if (bootstrappedAuthUserId === session.user.id && state.athlete) return;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      bindGlobalEvents();
      setStatus("Loading athlete profile…");
      state.viewerUserId = await ensureViewerUserId(session);
      state.targetUserId = queryParam("user_id") || state.viewerUserId;

      if (!state.targetUserId) {
        throw new Error("No athlete profile is linked to this account yet.");
      }

      if (!state.compareAId) state.compareAId = state.targetUserId;
      await loadAthlete(state.targetUserId);

      try {
        state.athleteDirectory = await fetchAthleteDirectory();
        if (!state.compareAId) state.compareAId = state.targetUserId;
        if (!state.compareBId) {
          state.compareBId = state.athleteDirectory.find((item) => item.userId !== state.targetUserId)?.userId || state.targetUserId;
        }
      } catch (directoryError) {
        console.warn("Athlete directory unavailable", directoryError);
        state.athleteDirectory = state.athlete ? [state.athlete] : [];
      }

      bootstrappedAuthUserId = session.user.id;
    } catch (error) {
      console.error("Profile load failed", error);
      if (nameEl) nameEl.textContent = "Profile unavailable";
      if (positionEl) positionEl.textContent = error.message || "Unable to load athlete profile.";
      if (tabStageEl) {
        tabStageEl.innerHTML = `<div class="ua-empty">${escapeHtml(error.message || "Unable to load athlete profile.")}</div>`;
      }
      setStatus(error.message || "Unable to load athlete profile.", true);
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
}

window.addEventListener("session-ready", async ({ detail }) => {
  await bootstrapProfile(detail?.session);
});

void supabase.auth.getSession().then(async ({ data, error }) => {
  if (error) {
    console.error("Profile session check failed", error);
    return;
  }
  if (data?.session) {
    await bootstrapProfile(data.session);
  }
});

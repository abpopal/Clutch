import { supabase } from "./supabaseClient.js";
import { buildAthleteProfile, normalizeText } from "./athleteData.js";
import { normalizeRole, roleLabel } from "./roleUtils.js";

const resultEl = document.querySelector("#search-results");
const postResultEl = document.querySelector("#search-post-results");
const searchSummaryEl = document.querySelector("#search-summary");

const exactQueryInput = document.querySelector("#exact-query");
const roleFilter = document.querySelector("#filter-role");
const sportFilter = document.querySelector("#filter-sport");

let viewerAppUserId = null;
let followingSet = new Set();
let directoryRows = [];
let allPosts = [];
let eventsBound = false;

function queryParamValue(key) {
  const params = new URLSearchParams(window.location.search);
  return (params.get(key) || "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(isoString) {
  if (!isoString) return "Now";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function resolveViewerUserId(authUserId) {
  const { data, error } = await supabase
    .from("users")
    .select("user_id")
    .eq("auth_uid", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data?.user_id || null;
}

async function loadFollowing() {
  if (!viewerAppUserId) return;
  const { data } = await supabase
    .from("follow")
    .select("followed_user_id")
    .eq("follower_user_id", viewerAppUserId);
  followingSet = new Set((data || []).map((r) => r.followed_user_id));
}

async function followUser(targetUserId) {
  if (!viewerAppUserId || !targetUserId || viewerAppUserId === targetUserId) return;
  const { error } = await supabase
    .from("follow")
    .insert({ follower_user_id: viewerAppUserId, followed_user_id: targetUserId });
  if (error) throw error;
  followingSet.add(targetUserId);
}

async function unfollowUser(targetUserId) {
  if (!viewerAppUserId || !targetUserId) return;
  const { error } = await supabase
    .from("follow")
    .delete()
    .eq("follower_user_id", viewerAppUserId)
    .eq("followed_user_id", targetUserId);
  if (error) throw error;
  followingSet.delete(targetUserId);
}

function rowName(user, school, directoryEntry) {
  return directoryEntry?.display_name || school?.name || user?.display_name || user?.name || `User ${String(user?.user_id || "").slice(0, 8)}`;
}

function rowEmail(user, directoryEntry) {
  return directoryEntry?.email || user?.email || user?.contact_email || user?.primary_email || "";
}

async function loadDirectory() {
  const [directoryRes, usersRes, schoolsRes, athletesRes, coachesRes, scoutsRes, postsRes] = await Promise.all([
    supabase.from("user_directory").select("user_id,display_name,email").limit(5000),
    supabase.from("users").select("user_id,role").limit(2000),
    supabase.from("schools").select("school_id,user_id,name,location").limit(2000),
    supabase.from("athletes").select("athlete_id,user_id,school_id,position,graduation_year,sport,bio").limit(2000),
    supabase.from("coaches").select("coach_id,user_id,bio,years_experience").limit(2000),
    supabase.from("scouts").select("scout_id,user_id,organization,title").limit(2000),
    supabase.from("post").select("author_user_id,author_role,caption,created_at").order("created_at", { ascending: false }).limit(150),
  ]);

  for (const res of [directoryRes, usersRes, schoolsRes, athletesRes, coachesRes, scoutsRes, postsRes]) {
    if (res.error) throw res.error;
  }

  const users = usersRes.data || [];
  const userDirectory = directoryRes.data || [];
  const schools = schoolsRes.data || [];
  const athletes = athletesRes.data || [];
  const coaches = coachesRes.data || [];
  const scouts = scoutsRes.data || [];
  const posts = postsRes.data || [];

  const userById = new Map(users.map((row) => [row.user_id, row]));
  const directoryByUserId = new Map(userDirectory.map((row) => [row.user_id, row]));
  const schoolById = new Map(schools.map((row) => [row.school_id, row]));
  const schoolByUserId = new Map(schools.map((row) => [row.user_id, row]));
  const athleteByUserId = new Map(athletes.map((row) => [row.user_id, row]));
  const coachByUserId = new Map(coaches.map((row) => [row.user_id, row]));
  const scoutByUserId = new Map(scouts.map((row) => [row.user_id, row]));

  directoryRows = Array.from(new Set([...users.map((row) => row.user_id), ...userDirectory.map((row) => row.user_id)])).map((userId) => {
    const user = userById.get(userId) || { user_id: userId, role: "viewer" };
    const directoryEntry = directoryByUserId.get(userId) || null;
    const athleteRow = athleteByUserId.get(userId) || null;
    const school = schoolByUserId.get(userId) || null;
    const assignedSchool = athleteRow?.school_id ? schoolById.get(athleteRow.school_id) : null;
    const coach = coachByUserId.get(userId) || null;
    const scout = scoutByUserId.get(userId) || null;

    const role = normalizeRole(user.role || "viewer");
    const name = rowName(user, school, directoryEntry);
    const email = rowEmail(user, directoryEntry);
    const schoolName = assignedSchool?.name || school?.name || "";
    const athletePreview = athleteRow
      ? buildAthleteProfile({
          userId,
          directory: { user_id: userId, display_name: name, email },
          athleteRow,
          schoolName,
          stats: [],
          posts: [],
          counts: { posts: 0, followers: 0, following: 0 },
          fallbackRole: role,
        })
      : null;

    const subtitle =
      role === "athlete"
        ? `${athleteRow?.position || "Athlete"} • Class ${athleteRow?.graduation_year || "TBD"}`
        : role === "coach"
          ? coach?.bio || "Coach"
          : role === "school_admin"
            ? school?.location || "School"
            : scout?.organization || "Scout";

    return {
      userId,
      role,
      name,
      email,
      schoolName,
      location: school?.location || assignedSchool?.location || "",
      sport: athleteRow?.position || coach?.bio || scout?.title || "",
      subtitle,
      athleteId: athletePreview?.athleteId || "",
      readiness: athletePreview?.readiness?.score || 0,
      sportIcons: athletePreview?.sports?.map((sportRow) => sportRow.icon) || [],
      searchText: normalizeText([
        name,
        email,
        schoolName,
        subtitle,
        athletePreview?.athleteId,
        athletePreview?.searchTokens,
      ].filter(Boolean).join(" ")),
    };
  });

  allPosts = posts.map((post) => {
    const author = directoryRows.find((row) => row.userId === post.author_user_id);
    return {
      userId: post.author_user_id,
      authorName: author?.name || "Creator",
      authorRole: post.author_role || author?.role || "member",
      authorAthleteId: author?.athleteId || "",
      caption: post.caption || "",
      created_at: post.created_at,
    };
  });
}

function updateSummary(query, peopleCount, postCount) {
  if (!searchSummaryEl) return;
  const items = [
    query ? `Query: ${query}` : "Showing all athletes",
    `${peopleCount} people found`,
    `${postCount} matching posts`,
  ];
  searchSummaryEl.innerHTML = items.map((item) => `<span class="ua-chip">${escapeHtml(item)}</span>`).join("");
}

function renderSearchRows(rows) {
  if (!resultEl) return;
  if (!rows.length) {
    resultEl.innerHTML = `<div class="ua-empty">No people matched that search.</div>`;
    return;
  }

  resultEl.innerHTML = rows.map((row) => {
    const isSelf = viewerAppUserId === row.userId;
    const isFollowing = followingSet.has(row.userId);
    const initials = escapeHtml(row.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase());
    const roleClass = `src-role-${row.role.replace(/_/g, "-")}`;
    return `
    <article class="src-card" data-open-id="${row.userId}">
      <div class="src-top">
        <div class="src-avatar ${roleClass}">${initials}</div>
        <div class="src-identity">
          <span class="src-name">${escapeHtml(row.name)}</span>
          <span class="src-subtitle">${escapeHtml(row.subtitle || row.schoolName || "Member")}</span>
        </div>
        <span class="src-role-badge ${roleClass}">${escapeHtml(roleLabel(row.role))}</span>
      </div>
      ${row.athleteId || row.schoolName || row.location ? `
      <div class="src-details">
        ${row.athleteId ? `<span class="src-detail"><svg class="src-detail-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2a1 1 0 011-1h8a1 1 0 011 1v1H3V2zm0 2h10v1H3V4zm1 2h8l-.5 8H4.5L4 6z"/></svg>${escapeHtml(row.athleteId)}</span>` : ""}
        ${row.schoolName ? `<span class="src-detail"><svg class="src-detail-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 5l7 4 7-4-7-4zM2 7v4l6 3.5L14 11V7L8 10.5 2 7z"/></svg>${escapeHtml(row.schoolName)}</span>` : ""}
        ${row.location ? `<span class="src-detail"><svg class="src-detail-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a5 5 0 00-5 5c0 4.5 5 9 5 9s5-4.5 5-9a5 5 0 00-5-5zm0 7a2 2 0 110-4 2 2 0 010 4z"/></svg>${escapeHtml(row.location)}</span>` : ""}
      </div>` : ""}
      ${row.readiness || (row.sportIcons && row.sportIcons.length) ? `
      <div class="src-tags">
        ${row.readiness ? `<span class="src-tag src-tag-readiness">${row.readiness}% ready</span>` : ""}
        ${(row.sportIcons || []).map((icon) => `<span class="src-tag">${escapeHtml(icon)}</span>`).join("")}
      </div>` : ""}
      <div class="src-actions">
        <button class="src-btn src-btn-profile" type="button" data-open-id="${row.userId}">View Profile</button>
        ${isSelf ? "" : `<button class="src-btn src-btn-follow ${isFollowing ? "is-following" : ""}" type="button" data-follow-id="${row.userId}">${isFollowing ? "Following" : "Follow"}</button>`}
      </div>
    </article>
  `;
  }).join("");

  Array.from(resultEl.querySelectorAll("article.src-card[data-open-id]")).forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-follow-id]")) return;
      window.location.href = `user-profile.html?user_id=${encodeURIComponent(card.dataset.openId)}`;
    });
  });

  Array.from(resultEl.querySelectorAll("[data-follow-id]")).forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.followId;
      const isCurrentlyFollowing = followingSet.has(targetId);
      button.disabled = true;
      try {
        if (isCurrentlyFollowing) {
          await unfollowUser(targetId);
          button.textContent = "Follow";
          button.classList.remove("is-following");
        } else {
          await followUser(targetId);
          button.textContent = "Following";
          button.classList.add("is-following");
        }
      } catch (error) {
        console.error("Follow toggle failed", error);
        button.textContent = "Error";
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderPostResults(rows) {
  if (!postResultEl) return;
  if (!rows.length) {
    postResultEl.innerHTML = `<div class="ua-empty">No posts matched your search.</div>`;
    return;
  }
  postResultEl.innerHTML = rows.map((row) => `
    <article class="post-card">
      <div class="post-card-head">
        <div>
          <strong>${escapeHtml(row.authorName)}</strong>
          <div class="post-meta-line">${escapeHtml(row.authorRole)} ${row.authorAthleteId ? `• ${escapeHtml(row.authorAthleteId)}` : ""}</div>
        </div>
        <span class="tag">${escapeHtml(formatTime(row.created_at))}</span>
      </div>
      <p class="post-caption">${escapeHtml(row.caption)}</p>
      <div class="post-card-foot">
        <span class="pill">Matched post</span>
      </div>
    </article>
  `).join("");
}

function runSearchFilters() {
  const query = normalizeText(exactQueryInput?.value || queryParamValue("q"));
  const selectedRole = normalizeText(roleFilter?.value || "all");
  const selectedSport = normalizeText(sportFilter?.value || "");

  const people = directoryRows.filter((row) => {
    const queryMatch = !query || row.searchText.includes(query);
    const roleMatch = selectedRole === "all" || normalizeText(row.role) === selectedRole;
    const sportMatch = !selectedSport || normalizeText(`${row.sport} ${row.subtitle} ${row.searchText}`).includes(selectedSport);
    return queryMatch && roleMatch && sportMatch;
  }).sort((a, b) => {
    if (query) {
      const aStarts = a.searchText.startsWith(query) ? 1 : 0;
      const bStarts = b.searchText.startsWith(query) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
    }
    return (b.readiness || 0) - (a.readiness || 0);
  });

  const postMatches = allPosts.filter((row) => {
    if (!query) return true;
    return normalizeText(`${row.authorName} ${row.authorAthleteId} ${row.caption}`).includes(query);
  }).slice(0, 10);

  renderSearchRows(people.slice(0, 24));
  renderPostResults(postMatches);
  updateSummary(query, people.length, postMatches.length);
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;
  [exactQueryInput, roleFilter, sportFilter].forEach((el) => {
    el?.addEventListener("input", runSearchFilters);
    el?.addEventListener("change", runSearchFilters);
  });
}

window.addEventListener("session-ready", async ({ detail }) => {
  try {
    viewerAppUserId = await resolveViewerUserId(detail.session.user.id);
    await Promise.all([loadDirectory(), loadFollowing()]);
    if (exactQueryInput && queryParamValue("q")) {
      exactQueryInput.value = queryParamValue("q");
    }
    bindEvents();
    runSearchFilters();
  } catch (error) {
    console.error("Search load failed", error);
    if (resultEl) resultEl.innerHTML = `<div class="ua-empty">${escapeHtml(error.message || "Unable to load search directory.")}</div>`;
  }
});

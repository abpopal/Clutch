import { supabase } from "./supabaseClient.js";
import { loadAthleteDirectory } from "./athleteDirectoryData.js?v=20260418b";
import { normalizeText } from "./athleteData.js";
import { getGlobalAppState, isScout } from "./roleUtils.js";
import { getSavedAthleteIds, getScoutWorkspaceSnapshot, toggleSavedAthlete } from "./scoutWorkspace.js?v=20260418b";
import { loadWatchlists, createWatchlist, updateWatchlist, deleteWatchlist, addAthleteToWatchlist, removeAthleteFromWatchlist, updateWatchlistAthlete } from "./watchlistStore.js";
import { createScoutAthleteMap } from "./scoutAthleteMap.js";
import { summarizeRegions } from "./scoutRegionInsights.js";

const queryInput = document.querySelector("#scout-filter-query");
const sportFilter = document.querySelector("#scout-filter-sport");
const positionFilter = document.querySelector("#scout-filter-position");
const locationFilter = document.querySelector("#scout-filter-location");
const ratingFilter = document.querySelector("#scout-filter-rating");
const sortSelect = document.querySelector("#scout-sort");
const filterToggleBtn = document.querySelector("#scout-filter-toggle");
const advancedFiltersEl = document.querySelector("#scout-advanced-filters");

const resultsEl = document.querySelector("#scout-dashboard-results");
const savedEl = document.querySelector("#scout-dashboard-saved");
const statusEl = document.querySelector("#scout-dashboard-status");
const summaryEl = document.querySelector("#scout-dashboard-summary");
const savedCountEl = document.querySelector("#scout-saved-count");
const heroCountEl = document.querySelector("#scout-hero-count");
const totalCountEl = document.querySelector("#scout-total-athletes");
const visibleCountEl = document.querySelector("#scout-visible-athletes");
const savedMetricEl = document.querySelector("#scout-saved-athletes");
const sportCountEl = document.querySelector("#scout-sport-count");
const regionCountEl = document.querySelector("#scout-region-count");
const mapStatusEl = document.querySelector("#scout-map-status");
const mapEl = document.querySelector("#scout-athlete-map");
const topRegionsEl = document.querySelector("#scout-top-regions");
const topAthletesWeekEl = document.querySelector("#scout-top-athletes-week");
const risingProspectsEl = document.querySelector("#scout-rising-prospects");
const nearbyAthletesEl = document.querySelector("#scout-nearby-athletes");
const topNearbyEl = document.querySelector("#scout-top-nearby");
const welcomeTitleEl = document.querySelector("#scout-welcome-title");
const notesSummaryEl = document.querySelector("#scout-notes-summary");

const state = {
  initialized: false,
  viewerUserId: "",
  viewerName: "Scout",
  athletes: [],
  selectedAthleteId: "",
  map: null,
  filters: {
    query: "",
    sport: "all",
    position: "all",
    location: "all",
    rating: "all",
    sort: "rating",
  },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function uniqueValues(items) {
  return Array.from(new Set((items || []).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function hashNumber(value) {
  return String(value || "")
    .split("")
    .reduce((acc, char) => ((acc * 33) + char.charCodeAt(0)) >>> 0, 5381);
}

function performanceDisplay(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0.0";
  return (numeric / 10).toFixed(1);
}

function trendDeltaFor(athlete) {
  const hash = hashNumber(`${athlete.userId}:${athlete.performanceRating}`);
  return Number((((hash % 8) + 2) / 10).toFixed(1));
}

function savedAthleteIds() {
  return getSavedAthleteIds({ viewerUserId: state.viewerUserId });
}

function sortAthletes(rows) {
  const items = [...rows];
  if (state.filters.sort === "name") {
    return items.sort((left, right) => left.name.localeCompare(right.name));
  }
  if (state.filters.sort === "readiness") {
    return items.sort((left, right) => (
      Number(right.readiness || 0) - Number(left.readiness || 0)
      || Number(right.performanceRating || 0) - Number(left.performanceRating || 0)
      || left.name.localeCompare(right.name)
    ));
  }
  return items.sort((left, right) => (
    Number(right.performanceRating || 0) - Number(left.performanceRating || 0)
    || Number(right.readiness || 0) - Number(left.readiness || 0)
    || left.name.localeCompare(right.name)
  ));
}

function filteredAthletes() {
  const query = normalizeText(state.filters.query);
  const items = state.athletes.filter((athlete) => {
    if (query && !athlete.searchText.includes(query)) return false;
    if (state.filters.sport !== "all" && !athlete.sportLabels.includes(state.filters.sport)) return false;
    if (state.filters.position !== "all" && athlete.position !== state.filters.position) return false;
    if (state.filters.location !== "all" && athlete.location !== state.filters.location) return false;
    if (state.filters.rating !== "all") {
      const threshold = Number(state.filters.rating);
      if (Number.isFinite(threshold) && Number(athlete.performanceRating || 0) < threshold) return false;
    }
    return true;
  });

  return sortAthletes(items);
}

function scoutName() {
  return state.viewerName || "Scout";
}

function athleteTier(rating) {
  const r = Number(rating || 0) / 10;
  if (r >= 9) return { tier: "elite", label: "Elite", icon: "E" };
  if (r >= 8) return { tier: "premium", label: "Premium", icon: "P" };
  if (r >= 7) return { tier: "rising", label: "Rising", icon: "R" };
  return { tier: "standard", label: "Standard", icon: "S" };
}

function athleteCardMarkup(athlete, { saved = false, compact = false } = {}) {
  const stats = (athlete.profile?.sports?.[0]?.stats || []).slice(0, compact ? 2 : 3);
  const ratingVal = performanceDisplay(athlete.performanceRating);
  const { tier, label: tierLabel, icon: tierIcon } = athleteTier(athlete.performanceRating);
  const trend = trendDeltaFor(athlete);
  const readiness = Number(athlete.readiness || 0);
  const readinessDisplay = readiness > 0 ? (readiness / 10).toFixed(1) : "—";

  return `
    <article class="sc-card sc-card--${tier} ${compact ? "sc-card--compact" : ""} ${state.selectedAthleteId === athlete.userId ? "sc-card--selected" : ""}" data-athlete-card-id="${escapeHtml(athlete.userId)}">
      <div class="sc-card-accent"></div>
      <div class="sc-card-header">
        <div class="sc-avatar-wrap">
          <img class="sc-avatar" src="https://i.pravatar.cc/320?u=${encodeURIComponent(athlete.userId || athlete.athleteId || athlete.name)}" alt="${escapeHtml(athlete.name)}">
          <div class="sc-rating-badge sc-rating-badge--${tier}">${escapeHtml(ratingVal)}</div>
        </div>
        <div class="sc-header-info">
          <div class="sc-name">${escapeHtml(athlete.name)}</div>
          <div class="sc-meta">${escapeHtml(athlete.position)} · ${escapeHtml(athlete.schoolName || "Untitled Athletic Academy")}</div>
          <div class="sc-tags">
            <span class="sc-tier-tag sc-tier-tag--${tier}">${tierIcon} ${escapeHtml(tierLabel)}</span>
            <span class="sc-sport-tag">${escapeHtml(athlete.primarySportLabel || "Athlete")}</span>
            ${athlete.gradYear ? `<span class="sc-grad-tag">Class ${escapeHtml(athlete.gradYear)}</span>` : ""}
          </div>
        </div>
        <button class="sc-save-btn ${saved ? "sc-save-btn--saved" : ""}" type="button" data-save-id="${escapeHtml(athlete.userId)}" title="${saved ? "Saved" : "Save Athlete"}">
          ${saved ? "★" : "☆"}
        </button>
      </div>

      ${!compact ? `
      <div class="sc-card-body">
        <div class="sc-metrics-row">
          <div class="sc-metric">
            <div class="sc-metric-val">${escapeHtml(ratingVal)}</div>
            <div class="sc-metric-label">Rating</div>
          </div>
          <div class="sc-metric">
            <div class="sc-metric-val">${escapeHtml(readinessDisplay)}</div>
            <div class="sc-metric-label">Readiness</div>
          </div>
          <div class="sc-metric">
            <div class="sc-metric-val sc-metric-val--trend">+${trend.toFixed(1)}</div>
            <div class="sc-metric-label">Trend</div>
          </div>
        </div>

        ${stats.length ? `
          <div class="sc-stats-row">
            ${stats.map((item) => `
              <div class="sc-stat">
                <div class="sc-stat-val">${escapeHtml(item.value || "—")}</div>
                <div class="sc-stat-label">${escapeHtml(item.label)}</div>
              </div>
            `).join("")}
          </div>
        ` : ""}

        ${athlete.location ? `<div class="sc-location">${escapeHtml(athlete.location)}</div>` : ""}
      </div>
      ` : ""}

      <div class="sc-card-footer">
        <a class="sc-action-btn" href="user-profile.html?user_id=${encodeURIComponent(athlete.userId)}">Profile</a>
        <a class="sc-action-btn" href="compare.html?athlete_a=${encodeURIComponent(athlete.userId)}">Compare</a>
      </div>
    </article>
  `;
}

function renderFilters() {
  const sportOptions = uniqueValues(state.athletes.flatMap((athlete) => athlete.sportLabels));
  const positionOptions = uniqueValues(state.athletes.map((athlete) => athlete.position));
  const locationOptions = uniqueValues(state.athletes.map((athlete) => athlete.location));

  if (sportFilter && !sportFilter.dataset.ready) {
    sportFilter.innerHTML = [
      `<option value="all">All sports</option>`,
      ...sportOptions.map((sport) => `<option value="${escapeHtml(sport)}">${escapeHtml(sport)}</option>`),
    ].join("");
    sportFilter.dataset.ready = "true";
  }

  if (positionFilter && !positionFilter.dataset.ready) {
    positionFilter.innerHTML = [
      `<option value="all">All positions</option>`,
      ...positionOptions.map((position) => `<option value="${escapeHtml(position)}">${escapeHtml(position)}</option>`),
    ].join("");
    positionFilter.dataset.ready = "true";
  }

  if (locationFilter && !locationFilter.dataset.ready) {
    locationFilter.innerHTML = [
      `<option value="all">All locations</option>`,
      ...locationOptions.map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`),
    ].join("");
    locationFilter.dataset.ready = "true";
  }

  if (ratingFilter && !ratingFilter.dataset.ready) {
    ratingFilter.innerHTML = [
      `<option value="all">All ratings</option>`,
      `<option value="90">9.0+</option>`,
      `<option value="80">8.0+</option>`,
      `<option value="70">7.0+</option>`,
      `<option value="60">6.0+</option>`,
    ].join("");
    ratingFilter.dataset.ready = "true";
  }
}

function renderSummary(results, savedIds, regionInsights) {
  if (summaryEl) {
    summaryEl.textContent = `${results.length} athletes shown`;
  }
  if (savedCountEl) {
    savedCountEl.textContent = `${savedIds.length} saved`;
  }
  if (heroCountEl) {
    heroCountEl.textContent = String(savedIds.length);
  }
  if (totalCountEl) {
    totalCountEl.textContent = String(state.athletes.length);
  }
  if (visibleCountEl) {
    visibleCountEl.textContent = String(results.length);
  }
  if (savedMetricEl) {
    savedMetricEl.textContent = String(savedIds.length);
  }
  if (sportCountEl) {
    sportCountEl.textContent = String(new Set(state.athletes.flatMap((athlete) => athlete.sportLabels)).size);
  }
  if (regionCountEl) {
    regionCountEl.textContent = String(regionInsights.regions.length);
  }
  if (welcomeTitleEl) {
    welcomeTitleEl.textContent = `Welcome back, ${scoutName()}`;
  }
}

function miniAthleteRow(athlete, mode = "rating") {
  if (!athlete) return `<div class="pp-empty">No athletes available.</div>`;
  const rightText = mode === "trend"
    ? `+${trendDeltaFor(athlete).toFixed(1)}`
    : performanceDisplay(athlete.performanceRating);
  const subText = mode === "trend"
    ? `▲ ${performanceDisplay(athlete.readiness)} readiness`
    : athlete.primarySportLabel || athlete.position;

  return `
    <div class="scout-mini-row">
      <img src="https://i.pravatar.cc/320?u=${encodeURIComponent(athlete.userId || athlete.athleteId || athlete.name)}" alt="${escapeHtml(athlete.name)}">
      <div class="scout-mini-copy">
        <strong>${escapeHtml(athlete.name)}</strong>
        <p>${escapeHtml(athlete.schoolName || "Untitled Athletic Academy")}</p>
        <span>${escapeHtml(subText)}</span>
      </div>
      <div class="scout-mini-score">
        <strong>${escapeHtml(rightText)}</strong>
        <span>${escapeHtml(mode === "trend" ? `+${trendDeltaFor(athlete).toFixed(1)}` : athlete.position)}</span>
      </div>
    </div>
  `;
}

function compactAthleteRow(athlete, supplemental = "") {
  if (!athlete) return `<div class="pp-empty">No athletes available.</div>`;
  return `
    <div class="scout-mini-row">
      <img src="https://i.pravatar.cc/320?u=${encodeURIComponent(athlete.userId || athlete.athleteId || athlete.name)}" alt="${escapeHtml(athlete.name)}">
      <div class="scout-mini-copy">
        <strong>${escapeHtml(athlete.name)}</strong>
        <p>${escapeHtml(athlete.position)}</p>
        <span>${escapeHtml(athlete.schoolName || "Untitled Athletic Academy")}</span>
      </div>
      <div class="scout-mini-score">
        <strong>${escapeHtml(performanceDisplay(athlete.performanceRating))}</strong>
        <span>${escapeHtml(supplemental || athlete.primarySportLabel || "")}</span>
      </div>
    </div>
  `;
}

function nearbyAthletes(results, regionInsights) {
  const selected = results.find((athlete) => athlete.userId === state.selectedAthleteId);
  const targetRegionKey = selected?.region?.key || regionInsights.topRegions[0]?.key || results[0]?.region?.key || "";
  return results.filter((athlete) => athlete.region?.key === targetRegionKey);
}

function renderInsights(results, regionInsights) {
  const topAthletes = results.slice(0, 3);
  const rising = [...results]
    .sort((left, right) => trendDeltaFor(right) - trendDeltaFor(left))
    .slice(0, 3);
  const nearby = nearbyAthletes(results, regionInsights).slice(0, 3);
  const topNearby = nearbyAthletes(results, regionInsights).slice(0, 4);

  if (topAthletesWeekEl) {
    topAthletesWeekEl.innerHTML = topAthletes.length
      ? topAthletes.map((athlete) => miniAthleteRow(athlete, "rating")).join("")
      : `<div class="pp-empty">No athletes match the current filters.</div>`;
  }

  if (risingProspectsEl) {
    risingProspectsEl.innerHTML = rising.length
      ? rising.map((athlete) => miniAthleteRow(athlete, "trend")).join("")
      : `<div class="pp-empty">No rising prospects available.</div>`;
  }

  if (nearbyAthletesEl) {
    nearbyAthletesEl.innerHTML = nearby.length
      ? nearby.map((athlete) => miniAthleteRow(athlete, "rating")).join("")
      : `<div class="pp-empty">Nearby athletes will appear once locations line up.</div>`;
  }

  if (topNearbyEl) {
    topNearbyEl.innerHTML = topNearby.length
      ? topNearby.map((athlete) => compactAthleteRow(athlete, athlete.region?.area || "")).join("")
      : `<div class="pp-empty">Nearby athlete insights will appear here.</div>`;
  }
}

function regionTierColor(avgRating) {
  if (avgRating >= 88) return "#2563eb";
  if (avgRating >= 78) return "#14b8a6";
  if (avgRating >= 65) return "#f59e0b";
  return "#64748b";
}

function renderRegions(regionInsights) {
  if (!topRegionsEl) return;
  const maxCount = Math.max(1, ...regionInsights.topRegions.map((r) => r.athleteCount));

  topRegionsEl.innerHTML = regionInsights.topRegions.length
    ? regionInsights.topRegions.map((region, i) => {
        const pct = Math.round((region.athleteCount / maxCount) * 100);
        const color = regionTierColor(region.averagePerformanceRating);
        return `
          <div class="sd-region-row">
            <div class="sd-region-rank">${i + 1}</div>
            <div class="sd-region-info">
              <div class="sd-region-name">${escapeHtml(region.district)}</div>
              <div class="sd-region-area">${escapeHtml(region.area)}</div>
              <div class="sd-region-bar-wrap">
                <div class="sd-region-bar" style="width:${pct}%; background:${color}"></div>
              </div>
            </div>
            <div class="sd-region-stats">
              <span class="sd-region-count">${escapeHtml(String(region.athleteCount))}</span>
              <span class="sd-region-avg" style="color:${color}">${escapeHtml(performanceDisplay(region.averagePerformanceRating))} avg</span>
            </div>
          </div>`;
      }).join("")
    : `<div class="pp-empty">Regional insights will appear once athlete locations are available.</div>`;
}

function renderNotesSummary() {
  if (!notesSummaryEl) return;
  const snapshot = getScoutWorkspaceSnapshot({ viewerUserId: state.viewerUserId });
  const entries = Object.entries(snapshot.notesByAthlete || {})
    .map(([targetUserId, note]) => ({ targetUserId, ...note }))
    .filter((item) => String(item.text || "").trim())
    .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());

  if (!entries.length) {
    notesSummaryEl.textContent = "Private notes saved from athlete profiles will be summarized here.";
    return;
  }

  const latest = entries[0];
  const athlete = state.athletes.find((item) => item.userId === latest.targetUserId);
  notesSummaryEl.textContent = `${entries.length} private note${entries.length === 1 ? "" : "s"} saved. Latest: ${athlete?.name || "athlete"} • ${String(latest.text).slice(0, 78)}${String(latest.text).length > 78 ? "…" : ""}`;
}

function renderDashboard() {
  const results = filteredAthletes();
  const savedIds = savedAthleteIds();
  const regionInsights = summarizeRegions(results);
  const savedRows = savedIds
    .map((userId) => state.athletes.find((athlete) => athlete.userId === userId))
    .filter(Boolean);

  renderSummary(results, savedIds, regionInsights);
  renderInsights(results, regionInsights);
  renderRegions(regionInsights);
  renderNotesSummary();

  if (resultsEl) {
    resultsEl.innerHTML = results.length
      ? results.map((athlete) => athleteCardMarkup(athlete, { saved: savedIds.includes(athlete.userId) })).join("")
      : `<div class="pp-empty">No athletes match the current filters.</div>`;
  }

  if (savedEl) {
    savedEl.innerHTML = savedRows.length
      ? savedRows.map((athlete) => athleteCardMarkup(athlete, { saved: true, compact: true })).join("")
      : `<div class="pp-empty">Saved athletes will appear here.</div>`;
  }

  if (state.map) {
    state.map.render({ athletes: results, regions: regionInsights.regions });
  }

  if (mapStatusEl) {
    const mappedCount = results.filter((athlete) => Number.isFinite(athlete?.coordinates?.lat) && Number.isFinite(athlete?.coordinates?.lng)).length;
    mapStatusEl.textContent = mappedCount
      ? `${mappedCount} athlete${mappedCount === 1 ? "" : "s"} mapped`
      : "No mapped athletes match the current filters.";
  }
}

async function initMap() {
  if (!mapEl || state.map) return;
  try {
    state.map = await createScoutAthleteMap({
      container: mapEl,
      onSelectAthlete: (athlete) => {
        state.selectedAthleteId = athlete.userId;
        renderDashboard();
        const card = document.querySelector(`[data-athlete-card-id="${CSS.escape(athlete.userId)}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
    });
  } catch (error) {
    console.error("Scout map load failed", error);
    if (mapStatusEl) mapStatusEl.textContent = "Map unavailable right now.";
    if (mapEl) mapEl.innerHTML = `<div class="pp-empty pp-empty--error">Map could not be loaded.</div>`;
  }
}

function bindSidebarLinks() {
  const links = Array.from(document.querySelectorAll(".scout-dashboard-nav-link[href^='#']"));
  if (!links.length) return;
  links.forEach((link) => {
    link.addEventListener("click", () => {
      links.forEach((item) => item.classList.remove("is-active"));
      link.classList.add("is-active");
    });
  });
}

function bindEvents() {
  queryInput?.addEventListener("input", () => {
    state.filters.query = String(queryInput.value || "");
    renderDashboard();
  });

  sportFilter?.addEventListener("change", () => {
    state.filters.sport = sportFilter.value || "all";
    renderDashboard();
  });

  positionFilter?.addEventListener("change", () => {
    state.filters.position = positionFilter.value || "all";
    renderDashboard();
  });

  locationFilter?.addEventListener("change", () => {
    state.filters.location = locationFilter.value || "all";
    renderDashboard();
  });

  ratingFilter?.addEventListener("change", () => {
    state.filters.rating = ratingFilter.value || "all";
    renderDashboard();
  });

  sortSelect?.addEventListener("change", () => {
    state.filters.sort = sortSelect.value || "rating";
    renderDashboard();
  });

  filterToggleBtn?.addEventListener("click", () => {
    const nextHidden = !advancedFiltersEl?.hidden;
    if (advancedFiltersEl) advancedFiltersEl.hidden = nextHidden;
    filterToggleBtn.classList.toggle("is-active", !nextHidden);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const button = target.closest("[data-save-id]");
    if (button) {
      toggleSavedAthlete({
        viewerUserId: state.viewerUserId,
        targetUserId: button.dataset.saveId,
      });
      renderDashboard();
      return;
    }

    const card = target.closest("[data-athlete-card-id]");
    if (!card) return;
    const athlete = state.athletes.find((item) => item.userId === card.dataset.athleteCardId);
    if (!athlete) return;
    state.selectedAthleteId = athlete.userId;
    state.map?.selectAthlete(athlete);
    renderDashboard();
  });
}

// ── Watchlists ────────────────────────────────────────────────
const wlCreateBtn = document.querySelector("#wl-create-btn");
const wlCreateForm = document.querySelector("#wl-create-form");
const wlNameInput = document.querySelector("#wl-name-input");
const wlColorInput = document.querySelector("#wl-color-input");
const wlSaveBtn = document.querySelector("#wl-save-btn");
const wlCancelBtn = document.querySelector("#wl-cancel-btn");
const wlTabsEl = document.querySelector("#wl-tabs");
const wlPanelEl = document.querySelector("#wl-active-panel");

const wlState = {
  lists: [],
  activeId: null,
  addingAthleteId: null,
};

const PRIORITY_ICONS = { high: "H", normal: "N", low: "L" };
const WL_COLORS = ["#2d9bb2","#8b5cf6","#ef4444","#f59e0b","#14b8a6","#ec4899","#6366f1","#22c55e"];

function wlActiveList() {
  return wlState.lists.find((l) => l.watchlist_id === wlState.activeId) || null;
}

function renderWlTabs() {
  if (!wlTabsEl) return;
  if (!wlState.lists.length) { wlTabsEl.innerHTML = ""; return; }
  wlTabsEl.innerHTML = wlState.lists.map((l) => `
    <button class="wl-tab ${l.watchlist_id === wlState.activeId ? "wl-tab--active" : ""}"
            data-wl-tab="${l.watchlist_id}" style="border-color:${escapeHtml(l.color || "#2d9bb2")}">
      <span class="wl-tab-dot" style="background:${escapeHtml(l.color || "#2d9bb2")}"></span>
      ${escapeHtml(l.name)}
      <span class="wl-tab-count">${(l.watchlist_athletes || []).length}</span>
    </button>
  `).join("");
}

function renderWlPanel() {
  if (!wlPanelEl) return;
  const list = wlActiveList();
  if (!list) {
    wlPanelEl.innerHTML = `<div class="sd-empty">Create a watchlist to start tracking athletes.</div>`;
    return;
  }

  const entries = (list.watchlist_athletes || [])
    .map((e) => {
      const athlete = state.athletes.find((a) => a.userId === e.athlete_id);
      return athlete ? { ...e, athlete } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      const po = { high: 0, normal: 1, low: 2 };
      return (po[a.priority] ?? 1) - (po[b.priority] ?? 1);
    });

  const addDropdown = state.athletes
    .filter((a) => !entries.some((e) => e.athlete_id === a.userId))
    .slice(0, 100)
    .map((a) => `<option value="${escapeHtml(a.userId)}">${escapeHtml(a.name)} — ${escapeHtml(a.primarySportLabel || a.position)}</option>`)
    .join("");

  wlPanelEl.innerHTML = `
    <div class="wl-panel-head">
      <div class="wl-panel-info">
        <span class="wl-panel-color" style="background:${escapeHtml(list.color || "#2d9bb2")}"></span>
        <h3 class="wl-panel-name">${escapeHtml(list.name)}</h3>
        <span class="wl-panel-badge">${entries.length} athlete${entries.length === 1 ? "" : "s"}</span>
      </div>
      <div class="wl-panel-actions">
        <button class="ua-btn ua-btn--ghost ua-btn--sm" data-wl-rename="${list.watchlist_id}">Rename</button>
        <button class="ua-btn ua-btn--ghost ua-btn--sm wl-btn-danger" data-wl-delete="${list.watchlist_id}">Delete</button>
      </div>
    </div>
    <div class="wl-add-row">
      <select class="wl-add-select" id="wl-add-select">
        <option value="">+ Add athlete…</option>
        ${addDropdown}
      </select>
      <select class="wl-add-priority" id="wl-add-priority">
        <option value="normal">Normal</option>
        <option value="high">High</option>
        <option value="low">Low</option>
      </select>
      <button class="ua-btn ua-btn--primary ua-btn--sm" id="wl-add-athlete-btn">Add</button>
    </div>
    ${entries.length ? `
      <div class="wl-athlete-list">
        ${entries.map((e) => `
          <div class="wl-athlete-row" data-wl-athlete="${e.athlete_id}">
            <img class="wl-athlete-avatar" src="https://i.pravatar.cc/320?u=${encodeURIComponent(e.athlete.userId)}" alt="">
            <div class="wl-athlete-info">
              <strong>${escapeHtml(e.athlete.name)}</strong>
              <span>${escapeHtml(e.athlete.primarySportLabel || e.athlete.position)} · ${escapeHtml(e.athlete.schoolName || "")}</span>
              ${e.notes ? `<span class="wl-athlete-notes">${escapeHtml(e.notes)}</span>` : ""}
            </div>
            <div class="wl-athlete-rating">${escapeHtml(performanceDisplay(e.athlete.performanceRating))}</div>
            <span class="wl-athlete-priority wl-priority-${e.priority}" title="${e.priority}">${PRIORITY_ICONS[e.priority] || "N"}</span>
            <select class="wl-priority-select" data-wl-change-priority="${e.athlete_id}">
              <option value="high" ${e.priority === "high" ? "selected" : ""}>High</option>
              <option value="normal" ${e.priority === "normal" ? "selected" : ""}>Normal</option>
              <option value="low" ${e.priority === "low" ? "selected" : ""}>Low</option>
            </select>
            <button class="wl-remove-btn" data-wl-remove="${e.athlete_id}" title="Remove">✕</button>
          </div>
        `).join("")}
      </div>
    ` : `<div class="sd-empty">No athletes in this list yet. Use the dropdown above to add some.</div>`}
  `;
}

function renderWatchlists() {
  renderWlTabs();
  renderWlPanel();
}

async function refreshWatchlists() {
  if (!state.viewerUserId) return;
  try {
    wlState.lists = await loadWatchlists(state.viewerUserId);
    if (wlState.lists.length && !wlState.activeId) {
      wlState.activeId = wlState.lists[0].watchlist_id;
    }
    if (wlState.activeId && !wlState.lists.some((l) => l.watchlist_id === wlState.activeId)) {
      wlState.activeId = wlState.lists[0]?.watchlist_id || null;
    }
    renderWatchlists();
  } catch (err) {
    console.error("Watchlists load failed", err);
  }
}

function bindWatchlistEvents() {
  wlCreateBtn?.addEventListener("click", () => {
    if (wlCreateForm) wlCreateForm.hidden = false;
    wlNameInput?.focus();
  });

  wlCancelBtn?.addEventListener("click", () => {
    if (wlCreateForm) wlCreateForm.hidden = true;
    if (wlNameInput) wlNameInput.value = "";
  });

  wlSaveBtn?.addEventListener("click", async () => {
    const name = wlNameInput?.value?.trim();
    if (!name) return;
    const color = wlColorInput?.value || "#2d9bb2";
    try {
      await createWatchlist(state.viewerUserId, { name, color });
      if (wlNameInput) wlNameInput.value = "";
      if (wlCreateForm) wlCreateForm.hidden = true;
      await refreshWatchlists();
    } catch (err) {
      console.error("Create watchlist failed", err);
    }
  });

  wlNameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") wlSaveBtn?.click();
  });

  // Tab clicks
  wlTabsEl?.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-wl-tab]");
    if (!tab) return;
    wlState.activeId = tab.dataset.wlTab;
    renderWatchlists();
  });

  // Panel delegated events
  document.addEventListener("click", async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    // Delete list
    const delBtn = target.closest("[data-wl-delete]");
    if (delBtn) {
      if (!confirm("Delete this watchlist and all its athletes?")) return;
      try {
        await deleteWatchlist(delBtn.dataset.wlDelete);
        wlState.activeId = null;
        await refreshWatchlists();
      } catch (err) { console.error(err); }
      return;
    }

    // Rename list
    const renBtn = target.closest("[data-wl-rename]");
    if (renBtn) {
      const list = wlState.lists.find((l) => l.watchlist_id === renBtn.dataset.wlRename);
      if (!list) return;
      const newName = prompt("Rename watchlist:", list.name);
      if (!newName?.trim()) return;
      try {
        await updateWatchlist(list.watchlist_id, { name: newName.trim() });
        await refreshWatchlists();
      } catch (err) { console.error(err); }
      return;
    }

    // Remove athlete
    const rmBtn = target.closest("[data-wl-remove]");
    if (rmBtn && wlState.activeId) {
      try {
        await removeAthleteFromWatchlist(wlState.activeId, rmBtn.dataset.wlRemove);
        await refreshWatchlists();
      } catch (err) { console.error(err); }
      return;
    }

    // Add athlete
    if (target.id === "wl-add-athlete-btn") {
      const sel = document.querySelector("#wl-add-select");
      const priSel = document.querySelector("#wl-add-priority");
      const athleteId = sel?.value;
      const priority = priSel?.value || "normal";
      if (!athleteId || !wlState.activeId) return;
      try {
        await addAthleteToWatchlist(wlState.activeId, athleteId, { priority });
        await refreshWatchlists();
      } catch (err) { console.error(err); }
    }
  });

  // Priority change
  document.addEventListener("change", async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const athleteId = target.dataset?.wlChangePriority;
    if (!athleteId || !wlState.activeId) return;
    try {
      await updateWatchlistAthlete(wlState.activeId, athleteId, { priority: target.value });
      await refreshWatchlists();
    } catch (err) { console.error(err); }
  });
}

async function resolveViewerUserId(auth) {
  if (auth?.appUserId) return auth.appUserId;
  const authUserId = auth?.session?.user?.id || auth?.authUser?.id;
  if (!authUserId) return null;

  const { data, error } = await supabase
    .from("users")
    .select("user_id")
    .eq("auth_uid", authUserId)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? (data[0]?.user_id || null) : null;
}

async function initScoutDashboard() {
  const auth = getGlobalAppState().auth;
  if (!auth?.session && !auth?.authUser) return;

  if (!isScout(auth)) {
    window.location.replace("index.html");
    return;
  }

  if (state.initialized) {
    renderDashboard();
    return;
  }

  try {
    setStatus("Loading scout dashboard…");
    state.viewerUserId = await resolveViewerUserId(auth);
    state.viewerName = auth?.session?.user?.user_metadata?.name
      || auth?.authUser?.user_metadata?.name
      || auth?.session?.user?.email?.split("@")[0]
      || "Scout";

    if (!state.viewerUserId) {
      throw new Error("Unable to resolve the scout account.");
    }

    state.athletes = await loadAthleteDirectory();
    await initMap();
    renderFilters();
    bindEvents();
    bindSidebarLinks();
    bindWatchlistEvents();
    renderDashboard();
    await refreshWatchlists();
    state.initialized = true;
    setStatus("Scout dashboard ready.");
  } catch (error) {
    console.error("Scout dashboard load failed", error);
    setStatus(error.message || "Unable to load the scout dashboard.", true);
    if (resultsEl) {
      resultsEl.innerHTML = `<div class="pp-empty pp-empty--error">Unable to load athlete directory.</div>`;
    }
  }
}

window.addEventListener("session-ready", () => {
  void initScoutDashboard();
});

window.addEventListener("ua-app-state-change", () => {
  if (!state.initialized) {
    void initScoutDashboard();
  }
});

void initScoutDashboard();

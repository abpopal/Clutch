import { supabase } from "./supabaseClient.js";
import { getSportMeta, normalizeText } from "./athleteData.js";
import { loadAthleteDirectory } from "./athleteDirectoryData.js";

const athleteASelect = document.querySelector("#compare-athlete-a");
const athleteBSelect = document.querySelector("#compare-athlete-b");
const sportSelect = document.querySelector("#compare-sport");
const statusEl = document.querySelector("#compare-status");
const stageEl = document.querySelector("#compare-stage");

const state = {
  athletes: [],
  athleteAId: "",
  athleteBId: "",
  sportId: "",
  chartMetric: "",
};

let eventsBound = false;

function queryParamValue(key) {
  const params = new URLSearchParams(window.location.search);
  return (params.get(key) || "").trim();
}

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function avatarUrlFor(seed) {
  return `https://i.pravatar.cc/320?u=${encodeURIComponent(seed || "athlete")}`;
}

function rowName(user, school, directoryEntry) {
  return directoryEntry?.display_name || school?.name || user?.display_name || user?.name || `User ${String(user?.user_id || "").slice(0, 8)}`;
}

function commonSports(athleteA, athleteB) {
  const sportIds = new Set((athleteA?.sports || []).map((sport) => sport.id));
  return (athleteB?.sports || []).filter((sport) => sportIds.has(sport.id));
}

function selectedAthlete(userId) {
  return state.athletes.find((athlete) => athlete.userId === userId) || null;
}

function selectedSport(athlete, sportId) {
  return athlete?.sports?.find((sport) => sport.id === sportId) || athlete?.sports?.[0] || null;
}

function numericValue(value) {
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function metricImprovesWhenLower(label) {
  const normalized = normalizeText(label);
  return ["100m", "200m", "400m", "40 yard", "40 yard dash", "era", "whip", "time"].some((token) => normalized.includes(token));
}

function sharedStats(sportA, sportB) {
  const mapA = new Map((sportA?.stats || []).map((item) => [item.label, item]));
  const mapB = new Map((sportB?.stats || []).map((item) => [item.label, item]));
  const labels = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));
  return labels.map((label) => ({
    label,
    a: mapA.get(label) || null,
    b: mapB.get(label) || null,
  }));
}

function commonProgressionMetrics(sportA, sportB) {
  const progressionA = sportA?.progression || [];
  const progressionB = sportB?.progression || [];
  if (!progressionA.length || !progressionB.length) return [];
  const keysA = Object.keys(progressionA[0]).filter((key) => key !== "year");
  const keysB = new Set(Object.keys(progressionB[0]).filter((key) => key !== "year"));
  return keysA.filter((key) => keysB.has(key));
}

function syncStateSelections() {
  const athleteA = selectedAthlete(state.athleteAId);
  const athleteB = selectedAthlete(state.athleteBId);

  if (!athleteA && state.athletes[0]) state.athleteAId = state.athletes[0].userId;
  if (!athleteB) {
    const fallbackB = state.athletes.find((athlete) => athlete.userId !== state.athleteAId) || state.athletes[0];
    if (fallbackB) state.athleteBId = fallbackB.userId;
  }
  if (state.athleteAId && state.athleteAId === state.athleteBId) {
    const alternate = state.athletes.find((athlete) => athlete.userId !== state.athleteAId);
    if (alternate) state.athleteBId = alternate.userId;
  }

  const nextA = selectedAthlete(state.athleteAId);
  const nextB = selectedAthlete(state.athleteBId);
  const sports = commonSports(nextA, nextB);
  if (!sports.some((sport) => sport.id === state.sportId)) {
    state.sportId = sports[0]?.id || "";
  }

  const sportA = selectedSport(nextA, state.sportId);
  const sportB = selectedSport(nextB, state.sportId);
  const metrics = commonProgressionMetrics(sportA, sportB);
  if (!metrics.includes(state.chartMetric)) {
    state.chartMetric = metrics[0] || "";
  }
}

function buildStatRows(sportA, sportB) {
  return sharedStats(sportA, sportB).map((item) => {
    const aValue = item.a?.value || "—";
    const bValue = item.b?.value || "—";
    const aNumeric = numericValue(aValue);
    const bNumeric = numericValue(bValue);
    const comparable = Number.isFinite(aNumeric) && Number.isFinite(bNumeric);
    const lowerBetter = metricImprovesWhenLower(item.label);
    let betterSide = "";

    if (comparable && aNumeric !== bNumeric) {
      betterSide = lowerBetter
        ? (aNumeric < bNumeric ? "a" : "b")
        : (aNumeric > bNumeric ? "a" : "b");
    }

    return {
      label: item.label,
      aValue,
      bValue,
      betterSide,
      aBadge: item.a?.badge || "",
      bBadge: item.b?.badge || "",
    };
  });
}

function buildInsights(athleteA, athleteB, sportA, sportB) {
  const stats = buildStatRows(sportA, sportB)
    .map((item) => {
      const aNumeric = numericValue(item.aValue);
      const bNumeric = numericValue(item.bValue);
      if (!Number.isFinite(aNumeric) || !Number.isFinite(bNumeric) || aNumeric === bNumeric) return null;
      const lowerBetter = metricImprovesWhenLower(item.label);
      const leader = lowerBetter
        ? (aNumeric < bNumeric ? athleteA.name : athleteB.name)
        : (aNumeric > bNumeric ? athleteA.name : athleteB.name);
      const diff = Math.abs(aNumeric - bNumeric);
      return {
        label: item.label,
        leader,
        diff,
        text: `${leader} leads ${item.label} by ${diff.toFixed(diff % 1 ? 1 : 0)}.`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.diff - left.diff)
    .slice(0, 3);

  if (stats.length) return stats;

  return [
    { text: `${athleteA.name} and ${athleteB.name} share ${sportA?.label || "a sport"} in the current structured profile.` },
    { text: `${athleteA.name} readiness: ${athleteA.readiness?.score || "N/A"}.` },
    { text: `${athleteB.name} readiness: ${athleteB.readiness?.score || "N/A"}.` },
  ];
}

function linePath(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function chartMarkup(athleteA, athleteB, sportA, sportB) {
  const metric = state.chartMetric;
  if (!metric) {
    return `<div class="compare-chart-empty">No shared progression metric is available for these athletes yet.</div>`;
  }

  const rowsA = sportA.progression || [];
  const rowsB = sportB.progression || [];
  const valuesA = rowsA.map((row) => numericValue(row[metric]));
  const valuesB = rowsB.map((row) => numericValue(row[metric]));
  const combined = [...valuesA, ...valuesB].filter(Number.isFinite);
  if (!combined.length) {
    return `<div class="compare-chart-empty">The selected metric does not have numeric progression data.</div>`;
  }

  const min = Math.min(...combined);
  const max = Math.max(...combined);
  const span = max - min || 1;
  const width = 760;
  const height = 260;
  const chartLeft = 46;
  const chartRight = width - 26;
  const chartTop = 24;
  const chartBottom = height - 52;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;
  const lowerBetter = metricImprovesWhenLower(metric);

  const pointsFor = (rows, values) => values.map((value, index) => {
    const normalized = lowerBetter ? (max - value) / span : (value - min) / span;
    return {
      x: chartLeft + ((chartWidth / Math.max(1, rows.length - 1)) * index),
      y: chartBottom - (normalized * chartHeight),
    };
  });

  const pointsA = pointsFor(rowsA, valuesA);
  const pointsB = pointsFor(rowsB, valuesB);
  const years = rowsA.map((row) => row.year);

  return `
    <div class="compare-chart-shell">
      <svg class="compare-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${metric} comparison chart`)}">
        ${Array.from({ length: 4 }, (_, index) => {
          const y = chartTop + ((chartHeight / 3) * index);
          return `<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" class="compare-grid-line"></line>`;
        }).join("")}
        <path d="${linePath(pointsA)}" fill="none" stroke="#2563eb" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="${linePath(pointsB)}" fill="none" stroke="#f97316" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="9 7"></path>
        ${pointsA.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="#2563eb"></circle>`).join("")}
        ${pointsB.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="#f97316"></circle>`).join("")}
        ${years.map((year, index) => {
          const x = chartLeft + ((chartWidth / Math.max(1, years.length - 1)) * index);
          return `<text x="${x}" y="${height - 20}" text-anchor="middle" class="compare-axis-label">${escapeHtml(year)}</text>`;
        }).join("")}
      </svg>
      <div class="compare-chart-legend">
        <span><i style="background:#2563eb"></i>${escapeHtml(athleteA.name)}</span>
        <span><i style="background:#f97316"></i>${escapeHtml(athleteB.name)}</span>
      </div>
    </div>
  `;
}

function metricPillsMarkup(metrics) {
  return metrics.map((metric) => `
    <button type="button" class="compare-metric-pill ${state.chartMetric === metric ? "is-active" : ""}" data-chart-metric="${escapeHtml(metric)}">
      ${escapeHtml(metric)}
    </button>
  `).join("");
}

function personCardMarkup(athlete, sport) {
  return `
    <article class="compare-person-card">
      <div class="compare-person-topline">
        <img class="compare-avatar" src="${escapeHtml(avatarUrlFor(athlete.userId || athlete.athleteId || athlete.name))}" alt="${escapeHtml(athlete.name)}">
        <div>
          <h3>${escapeHtml(athlete.name)}</h3>
          <p>${escapeHtml(sport?.position || athlete.position)} • ${escapeHtml(sport?.label || "Athlete")}</p>
        </div>
      </div>

      <div class="compare-person-meta">
        <span>${escapeHtml(athlete.school)}</span>
        <span>Class ${escapeHtml(athlete.gradYear)}</span>
        <span>${escapeHtml(athlete.ranking)}</span>
      </div>

      <div class="compare-summary-grid">
        <div class="compare-stat-card">
          <div class="compare-stat-card-head">
            <strong>${escapeHtml(athlete.gpa || "N/A")}</strong>
            <span>GPA</span>
          </div>
          <div class="compare-pill-row">
            <span class="compare-pill">${escapeHtml(athlete.measurables?.Height || "Height TBD")}</span>
            <span class="compare-pill">${escapeHtml(athlete.measurables?.Weight || "Weight TBD")}</span>
          </div>
        </div>

        <div class="compare-stat-card">
          <div class="compare-stat-card-head">
            <strong>${escapeHtml(String(athlete.readiness?.score || "0"))}</strong>
            <span>Readiness</span>
          </div>
          <div class="compare-pill-row">
            ${(athlete.strengths || []).slice(0, 2).map((item) => `<span class="compare-pill">${escapeHtml(item)}</span>`).join("")}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderSelectOptions() {
  const options = state.athletes.map((athlete) => `
    <option value="${escapeHtml(athlete.userId)}">${escapeHtml(`${athlete.name} • ${athlete.school}`)}</option>
  `).join("");

  if (athleteASelect) athleteASelect.innerHTML = options;
  if (athleteBSelect) athleteBSelect.innerHTML = options;

  if (athleteASelect) athleteASelect.value = state.athleteAId;
  if (athleteBSelect) athleteBSelect.value = state.athleteBId;
}

function renderSportOptions() {
  const athleteA = selectedAthlete(state.athleteAId);
  const athleteB = selectedAthlete(state.athleteBId);
  const sports = commonSports(athleteA, athleteB);

  if (!sportSelect) return;

  if (!sports.length) {
    sportSelect.innerHTML = `<option value="">No shared sports</option>`;
    sportSelect.disabled = true;
    return;
  }

  sportSelect.disabled = false;
  sportSelect.innerHTML = sports.map((sport) => {
    const meta = getSportMeta(sport.id);
    return `<option value="${escapeHtml(sport.id)}">${escapeHtml(`${meta.icon} ${sport.label}`)}</option>`;
  }).join("");
  sportSelect.value = state.sportId;
}

function renderComparison() {
  if (!stageEl) return;

  syncStateSelections();
  renderSelectOptions();
  renderSportOptions();

  const athleteA = selectedAthlete(state.athleteAId);
  const athleteB = selectedAthlete(state.athleteBId);
  if (!athleteA || !athleteB) {
    stageEl.innerHTML = `<div class="compare-empty">Two athlete profiles are required before comparison can render.</div>`;
    return;
  }

  const sportA = selectedSport(athleteA, state.sportId);
  const sportB = selectedSport(athleteB, state.sportId);
  if (!sportA || !sportB) {
    stageEl.innerHTML = `<div class="compare-empty">These athletes do not currently share a sport in the structured profile data.</div>`;
    return;
  }

  const statRows = buildStatRows(sportA, sportB);
  const metrics = commonProgressionMetrics(sportA, sportB);
  const insights = buildInsights(athleteA, athleteB, sportA, sportB);

  stageEl.innerHTML = `
    <div class="compare-stage-main">
      <div>
        <div class="compare-person-grid">
          ${personCardMarkup(athleteA, sportA)}
          ${personCardMarkup(athleteB, sportB)}
        </div>

        <section class="compare-chart-card">
          <div class="compare-chart-head">
            <div>
              <p class="eyebrow">Performance Trend</p>
              <h3>${escapeHtml(sportA.label)} progression over time</h3>
            </div>
            <div class="compare-metric-pills">
              ${metricPillsMarkup(metrics)}
            </div>
          </div>
          ${chartMarkup(athleteA, athleteB, sportA, sportB)}
        </section>

        <section class="compare-card">
          <div class="compare-card-head">
            <div>
              <p class="eyebrow">Stat Breakdown</p>
              <h2>Side-by-side stats comparison</h2>
            </div>
          </div>

          <div class="compare-stat-grid">
            ${statRows.map((row) => `
              <article class="compare-stat-card">
                <div class="compare-stat-card-head">
                  <strong>${escapeHtml(row.label)}</strong>
                  <span>${escapeHtml(sportA.label)}</span>
                </div>
                <div class="compare-stat-values">
                  <div class="compare-metric">
                    <div class="compare-metric-name">${escapeHtml(athleteA.name)}</div>
                    <div class="compare-metric-value ${row.betterSide === "a" ? "is-better" : ""}">${escapeHtml(row.aValue)}</div>
                  </div>
                  <div class="compare-vs">vs</div>
                  <div class="compare-metric is-right">
                    <div class="compare-metric-name">${escapeHtml(athleteB.name)}</div>
                    <div class="compare-metric-value ${row.betterSide === "b" ? "is-better" : ""}">${escapeHtml(row.bValue)}</div>
                  </div>
                </div>
              </article>
            `).join("")}
          </div>
        </section>
      </div>

      <aside class="compare-insight-card">
        <h3>Key Differences</h3>
        <ol class="compare-insight-list">
          ${insights.map((item) => `<li>${escapeHtml(item.text)}</li>`).join("")}
        </ol>
      </aside>
    </div>
  `;
}

async function loadAthletes() {
  const rows = await loadAthleteDirectory();
  state.athletes = rows.map((row) => row.profile).sort((left, right) => left.name.localeCompare(right.name));

  const athleteAQuery = queryParamValue("athlete_a");
  const athleteBQuery = queryParamValue("athlete_b");
  state.athleteAId = state.athletes.some((athlete) => athlete.userId === athleteAQuery) ? athleteAQuery : (state.athletes[0]?.userId || "");
  state.athleteBId = state.athletes.some((athlete) => athlete.userId === athleteBQuery)
    ? athleteBQuery
    : (state.athletes.find((athlete) => athlete.userId !== state.athleteAId)?.userId || state.athleteAId);
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  athleteASelect?.addEventListener("change", () => {
    state.athleteAId = athleteASelect.value;
    renderComparison();
  });

  athleteBSelect?.addEventListener("change", () => {
    state.athleteBId = athleteBSelect.value;
    renderComparison();
  });

  sportSelect?.addEventListener("change", () => {
    state.sportId = sportSelect.value;
    renderComparison();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const metric = target.closest("[data-chart-metric]")?.dataset.chartMetric;
    if (!metric) return;
    state.chartMetric = metric;
    renderComparison();
  });
}

async function initComparison(session) {
  if (!session?.user?.id) return;
  try {
    setStatus("Loading athlete comparison…");
    await loadAthletes();
    bindEvents();
    renderComparison();
    setStatus("Comparison ready.");
  } catch (error) {
    console.error("Comparison load failed", error);
    if (stageEl) {
      stageEl.innerHTML = `<div class="compare-empty">${escapeHtml(error.message || "Unable to load athlete comparison.")}</div>`;
    }
    setStatus(error.message || "Unable to load athlete comparison.", true);
  }
}

window.addEventListener("session-ready", async ({ detail }) => {
  await initComparison(detail?.session);
});

void supabase.auth.getSession().then(async ({ data, error }) => {
  if (error) {
    console.error("Compare session check failed", error);
    return;
  }
  if (data?.session) {
    await initComparison(data.session);
  }
});

const CHART_JS_SRC = "https://cdn.jsdelivr.net/npm/chart.js";

const SPORT_STATS_CONFIG = {
  basketball: {
    lineMetrics: ["PPG", "APG", "RPG"],
    barMetrics: ["PPG", "APG", "RPG", "FG%", "STL"],
  },
  soccer: {
    lineMetrics: ["Goals", "Assists", "Pass Acc."],
    barMetrics: ["Goals", "Assists", "Pass Acc.", "Chances", "MOTM"],
  },
  football: {
    lineMetrics: ["YDS", "TD", "REC"],
    barMetrics: ["YDS", "TD", "REC", "YAC"],
  },
  baseball: {
    lineMetrics: ["AVG", "OBP", "SB"],
    barMetrics: ["AVG", "OBP", "SB", "RBI"],
  },
  track: {
    lineMetrics: ["100M", "200M", "Long Jump"],
    barMetrics: ["100M", "200M", "Long Jump"],
  },
  default: {
    lineMetrics: [],
    barMetrics: [],
  },
};

let chartJsPromise = null;
let activeCharts = [];

function numericValue(value) {
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function fallbackMetrics(list, key, count) {
  return (list || [])
    .map((item) => item?.[key])
    .filter(Boolean)
    .slice(0, count);
}

function metricImprovesWhenLower(label) {
  const normalized = String(label || "").toLowerCase();
  return ["100m", "200m", "400m", "40 yard", "40 yard dash", "era", "whip", "time"].some((token) => normalized.includes(token));
}

function uniqueMetrics(metrics) {
  return Array.from(new Set((metrics || []).filter(Boolean)));
}

function resolveChartConfig(sport) {
  const preset = SPORT_STATS_CONFIG[sport?.id] || SPORT_STATS_CONFIG.default;
  const progressionKeys = Object.keys((sport?.progression || [])[0] || {}).filter((key) => key !== "year");
  const statLabels = (sport?.stats || []).map((item) => item.label);

  return {
    lineMetrics: uniqueMetrics([
      ...preset.lineMetrics.filter((metric) => progressionKeys.includes(metric)),
      ...fallbackMetrics(
        progressionKeys.map((metric) => ({ metric })),
        "metric",
        3
      ),
    ]),
    barMetrics: uniqueMetrics([
      ...preset.barMetrics.filter((metric) => statLabels.includes(metric)),
      ...fallbackMetrics(
        statLabels.map((metric) => ({ metric })),
        "metric",
        5
      ),
    ]),
  };
}

function noteElement(container) {
  return container?.querySelector(".pp-stats-chart-note");
}

function setChartNote(container, message) {
  const el = noteElement(container);
  if (!el) return;
  el.textContent = message;
}

function lineChartConfig(sport) {
  const chartConfig = resolveChartConfig(sport);
  const labels = (sport?.progression || []).map((row) => row.year);
  const palette = ["#2563eb", "#f97316", "#14b8a6"];

  return {
    type: "line",
    data: {
      labels,
      datasets: chartConfig.lineMetrics.map((metric, index) => ({
        label: metric,
        data: (sport?.progression || []).map((row) => numericValue(row[metric])),
        fill: false,
        borderColor: palette[index % palette.length],
        backgroundColor: palette[index % palette.length],
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.24,
        borderWidth: 3,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#667085",
            boxWidth: 10,
            usePointStyle: true,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#667085" },
          grid: { color: "rgba(226, 232, 240, 0.7)" },
        },
        y: {
          beginAtZero: false,
          ticks: { color: "#667085" },
          grid: { color: "rgba(226, 232, 240, 0.7)" },
        },
      },
    },
  };
}

function barChartConfig(sport) {
  const chartConfig = resolveChartConfig(sport);
  const labels = chartConfig.barMetrics;

  return {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: `${sport?.label || "Sport"} stats`,
        data: labels.map((label) => {
          const item = (sport?.stats || []).find((stat) => stat.label === label);
          return numericValue(item?.value);
        }),
        backgroundColor: [
          "rgba(37, 99, 235, 0.85)",
          "rgba(59, 130, 246, 0.82)",
          "rgba(96, 165, 250, 0.82)",
          "rgba(147, 197, 253, 0.84)",
          "rgba(14, 165, 233, 0.82)",
        ],
        borderRadius: 10,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
      },
      scales: {
        x: {
          ticks: { color: "#667085" },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#667085" },
          grid: { color: "rgba(226, 232, 240, 0.7)" },
        },
      },
    },
  };
}

function radarChartConfig(sport) {
  const rows = sport?.compareRadar || [];
  return {
    type: "radar",
    data: {
      labels: rows.map((item) => item.stat),
      datasets: [
        {
          label: "Athlete",
          data: rows.map((item) => item.marcus),
          backgroundColor: "rgba(37, 99, 235, 0.16)",
          borderColor: "#2563eb",
          pointBackgroundColor: "#2563eb",
          pointBorderColor: "#ffffff",
          borderWidth: 2.5,
        },
        {
          label: "Position Avg",
          data: rows.map((item) => item.avg),
          backgroundColor: "rgba(20, 184, 166, 0.12)",
          borderColor: "#14b8a6",
          pointBackgroundColor: "#14b8a6",
          pointBorderColor: "#ffffff",
          borderWidth: 2.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#667085",
            boxWidth: 10,
            usePointStyle: true,
          },
        },
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            display: false,
          },
          pointLabels: {
            color: "#667085",
            font: {
              size: 12,
            },
          },
          angleLines: {
            color: "rgba(226, 232, 240, 0.8)",
          },
          grid: {
            color: "rgba(226, 232, 240, 0.8)",
          },
        },
      },
    },
  };
}

export function destroyProfileStatsCharts() {
  activeCharts.forEach((chart) => {
    try {
      chart.destroy();
    } catch (_error) {
      // Ignore teardown issues when profile re-renders quickly.
    }
  });
  activeCharts = [];
}

async function ensureChartJs() {
  if (window.Chart) return window.Chart;
  if (chartJsPromise) return chartJsPromise;

  chartJsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-chartjs-loader="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Chart), { once: true });
      existing.addEventListener("error", () => reject(new Error("Chart.js failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = CHART_JS_SRC;
    script.async = true;
    script.dataset.chartjsLoader = "true";
    script.onload = () => resolve(window.Chart);
    script.onerror = () => reject(new Error("Chart.js failed to load."));
    document.head.appendChild(script);
  });

  return chartJsPromise;
}

function hasUsableLineData(sport) {
  const config = resolveChartConfig(sport);
  return Boolean((sport?.progression || []).length && config.lineMetrics.length);
}

function hasUsableBarData(sport) {
  const config = resolveChartConfig(sport);
  return Boolean(config.barMetrics.length);
}

function hasUsableRadarData(sport) {
  return Boolean((sport?.compareRadar || []).length);
}

export async function mountProfileStatsCharts({ sport }) {
  destroyProfileStatsCharts();

  if (!sport) return;

  const lineContainer = document.querySelector('[data-chart-card="line"]');
  const barContainer = document.querySelector('[data-chart-card="bar"]');
  const radarContainer = document.querySelector('[data-chart-card="radar"]');

  setChartNote(lineContainer, hasUsableLineData(sport) ? "Performance trend from the structured progression data." : "No line-chart data is available for this sport yet.");
  setChartNote(barContainer, hasUsableBarData(sport) ? "Current per-game or current-season stat snapshot." : "No bar-chart stats are available for this sport yet.");
  setChartNote(radarContainer, hasUsableRadarData(sport) ? "Skill distribution versus position average." : "No radar comparison data is available for this sport yet.");

  if (!hasUsableLineData(sport) && !hasUsableBarData(sport) && !hasUsableRadarData(sport)) return;

  const Chart = await ensureChartJs();

  const lineCanvas = document.querySelector("#pp-stats-line-chart");
  const barCanvas = document.querySelector("#pp-stats-bar-chart");
  const radarCanvas = document.querySelector("#pp-stats-radar-chart");

  if (lineCanvas && hasUsableLineData(sport)) {
    activeCharts.push(new Chart(lineCanvas, lineChartConfig(sport)));
  }

  if (barCanvas && hasUsableBarData(sport)) {
    activeCharts.push(new Chart(barCanvas, barChartConfig(sport)));
  }

  if (radarCanvas && hasUsableRadarData(sport)) {
    activeCharts.push(new Chart(radarCanvas, radarChartConfig(sport)));
  }
}

export function sportChartConfig(sport) {
  return resolveChartConfig(sport);
}

export function progressionLeadMetric(sport) {
  const config = resolveChartConfig(sport);
  const metric = config.lineMetrics[0];
  if (!metric) return "";
  const values = (sport?.progression || []).map((row) => numericValue(row[metric])).filter(Number.isFinite);
  if (values.length < 2) return metric;

  const delta = values[values.length - 1] - values[0];
  if (delta === 0) return metric;

  const direction = metricImprovesWhenLower(metric)
    ? (delta < 0 ? "improving" : "flat")
    : (delta > 0 ? "improving" : "flat");
  return `${metric} ${direction}`;
}

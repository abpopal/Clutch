const LEAFLET_CSS_ID = "ua-leaflet-css";
const LEAFLET_SCRIPT_ID = "ua-leaflet-script";
const LEAFLET_HEAT_ID = "ua-leaflet-heat";
const LEAFLET_CSS_HREF = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS_SRC = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_HEAT_SRC = "https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js";
const LEAFLET_CSS_INTEGRITY = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const LEAFLET_JS_INTEGRITY = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadCss() {
  if (document.getElementById(LEAFLET_CSS_ID)) return;
  const link = document.createElement("link");
  link.id = LEAFLET_CSS_ID;
  link.rel = "stylesheet";
  link.href = LEAFLET_CSS_HREF;
  link.crossOrigin = "";
  link.integrity = LEAFLET_CSS_INTEGRITY;
  document.head.appendChild(link);
}

function loadScript(id, src, integrity) {
  const win = /** @type {any} */ (window);
  if (id === LEAFLET_SCRIPT_ID && win.L) return Promise.resolve(win.L);

  const existing = document.getElementById(id);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(win.L), { once: true });
      existing.addEventListener("error", () => reject(new Error(`${id} failed to load.`)), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    if (integrity) {
      script.crossOrigin = "";
      script.integrity = integrity;
    }
    script.addEventListener("load", () => resolve(win.L), { once: true });
    script.addEventListener("error", () => reject(new Error(`${id} failed to load.`)), { once: true });
    document.body.appendChild(script);
  });
}

async function loadLeaflet() {
  loadCss();
  await loadScript(LEAFLET_SCRIPT_ID, LEAFLET_JS_SRC, LEAFLET_JS_INTEGRITY);
  await loadScript(LEAFLET_HEAT_ID, LEAFLET_HEAT_SRC, null);
  return /** @type {any} */ (window).L;
}

function popupMarkup(athlete) {
  const rating = Math.round(Number(athlete.performanceRating || 0));
  return `
    <div class="scout-map-popup">
      <strong>${escapeHtml(athlete.name)}</strong>
      <span>${escapeHtml(athlete.position)} • ${escapeHtml(athlete.primarySportLabel || "Athlete")}</span>
      <span>${escapeHtml(athlete.schoolName || "Untitled Athletic Academy")}</span>
      <span>${escapeHtml(athlete.location || "Location pending")}</span>
      <div class="scout-map-popup-meta">
        <span>${escapeHtml(String(rating || 0))} rating</span>
        ${athlete.gradYear ? `<span>Class ${escapeHtml(athlete.gradYear)}</span>` : ""}
      </div>
      <a href="user-profile.html?user_id=${encodeURIComponent(athlete.userId)}">Open profile</a>
    </div>
  `;
}

function regionPopupMarkup(region) {
  return `
    <div class="scout-map-popup scout-map-popup--region">
      <strong>${escapeHtml(region.district)}</strong>
      <span>${escapeHtml(region.area)}</span>
      <div class="scout-map-popup-meta">
        <span>${escapeHtml(String(region.averagePerformanceRating))} avg rating</span>
        <span>${escapeHtml(String(region.athleteCount))} athletes</span>
      </div>
      ${region.topAthletes?.length ? `<span>Top: ${escapeHtml(region.topAthletes.map((athlete) => athlete.name).join(", "))}</span>` : ""}
    </div>
  `;
}

function markerIcon(L, athlete) {
  const score = Math.round(Number(athlete.performanceRating || 0)) || 0;
  const tone = score >= 90 ? "elite" : score >= 80 ? "strong" : "solid";
  return L.divIcon({
    className: "scout-map-marker-icon",
    html: `<span class="scout-map-marker-icon__badge scout-map-marker-icon__badge--${tone}">${escapeHtml(String(score))}</span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -12],
  });
}

/* ── View‑mode toggle control ─────────────────────────────────── */
function createViewToggle(L, onToggle) {
  const ViewToggle = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const wrap = L.DomUtil.create("div", "scout-map-toggle leaflet-bar");
      wrap.innerHTML = `
        <button class="smt-btn smt-btn--active" data-view="markers" title="Markers">Pin</button>
        <button class="smt-btn" data-view="heat" title="Heat Map">Heat</button>
        <button class="smt-btn" data-view="both" title="Both">Both</button>
      `;
      L.DomEvent.disableClickPropagation(wrap);
      wrap.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-view]");
        if (!btn) return;
        wrap.querySelectorAll(".smt-btn").forEach((b) => b.classList.remove("smt-btn--active"));
        btn.classList.add("smt-btn--active");
        onToggle(btn.dataset.view);
      });
      return wrap;
    },
  });
  return new ViewToggle();
}

/* ── Legend control ────────────────────────────────────────────── */
function createLegend(L) {
  const Legend = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() {
      const div = L.DomUtil.create("div", "scout-map-legend");
      div.innerHTML = `
        <div class="sml-title">Density</div>
        <div class="sml-bar"></div>
        <div class="sml-labels"><span>Low</span><span>Med</span><span>High</span></div>
      `;
      return div;
    },
  });
  return new Legend();
}

export async function createScoutAthleteMap({ container, onSelectAthlete } = {}) {
  if (!container) {
    return {
      render() {},
      selectAthlete() {},
      destroy() {},
    };
  }

  const L = await loadLeaflet();
  const map = L.map(container, {
    center: [39.5, -98.35],
    zoom: 4,
    scrollWheelZoom: false,
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  }).addTo(map);

  const regionLayerGroup = L.layerGroup().addTo(map);
  const athleteLayerGroup = L.layerGroup().addTo(map);
  let heatLayer = null;
  let legendControl = null;
  let markersByUserId = new Map();
  let currentView = "markers"; // "markers" | "heat" | "both"

  function setView(view) {
    currentView = view;
    const showMarkers = view === "markers" || view === "both";
    const showHeat = view === "heat" || view === "both";

    if (showMarkers) {
      if (!map.hasLayer(athleteLayerGroup)) map.addLayer(athleteLayerGroup);
      if (!map.hasLayer(regionLayerGroup)) map.addLayer(regionLayerGroup);
    } else {
      if (map.hasLayer(athleteLayerGroup)) map.removeLayer(athleteLayerGroup);
      if (map.hasLayer(regionLayerGroup)) map.removeLayer(regionLayerGroup);
    }

    if (heatLayer) {
      if (showHeat) {
        if (!map.hasLayer(heatLayer)) map.addLayer(heatLayer);
      } else {
        if (map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
      }
    }

    if (legendControl) {
      if (showHeat) {
        if (!legendControl._map) legendControl.addTo(map);
      } else {
        if (legendControl._map) legendControl.remove();
      }
    }
  }

  // Add toggle control
  createViewToggle(L, setView).addTo(map);
  legendControl = createLegend(L);

  function regionColor(region) {
    if (region.averagePerformanceRating >= 88) return "#2563eb";
    if (region.averagePerformanceRating >= 78) return "#14b8a6";
    return "#f59e0b";
  }

  function render({ athletes = [], regions = [] } = {}) {
    regionLayerGroup.clearLayers();
    athleteLayerGroup.clearLayers();
    markersByUserId = new Map();
    if (heatLayer && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);

    const valid = athletes.filter((athlete) => Number.isFinite(athlete?.coordinates?.lat) && Number.isFinite(athlete?.coordinates?.lng));
    const validRegions = regions.filter((region) => Number.isFinite(region?.center?.lat) && Number.isFinite(region?.center?.lng));

    // ── Region circles ──
    validRegions.forEach((region) => {
      const color = regionColor(region);
      const radius = 22000 + (region.athleteCount * 5000);
      const circle = L.circle([region.center.lat, region.center.lng], {
        radius,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.08,
      });
      circle.bindPopup(regionPopupMarkup(region));
      circle.addTo(regionLayerGroup);
    });

    // ── Athlete markers ──
    valid.forEach((athlete) => {
      const marker = L.marker([athlete.coordinates.lat, athlete.coordinates.lng], {
        icon: markerIcon(L, athlete),
      });
      marker.bindPopup(popupMarkup(athlete));
      marker.on("click", () => {
        if (typeof onSelectAthlete === "function") onSelectAthlete(athlete);
      });
      marker.addTo(athleteLayerGroup);
      markersByUserId.set(athlete.userId, marker);
    });

    // ── Heat layer ──
    if (valid.length && L.heatLayer) {
      const heatPoints = valid.map((a) => {
        const intensity = Math.max(0.3, (Number(a.performanceRating) || 50) / 100);
        return [a.coordinates.lat, a.coordinates.lng, intensity];
      });
      heatLayer = L.heatLayer(heatPoints, {
        radius: 35,
        blur: 25,
        maxZoom: 10,
        max: 1.0,
        gradient: {
          0.2: "#1a1a5e",
          0.4: "#2d9bb2",
          0.6: "#14b8a6",
          0.8: "#f59e0b",
          1.0: "#ef4444",
        },
      });
    }

    // Apply current view mode
    setView(currentView);

    // ── Fit bounds ──
    const boundsPoints = [
      ...valid.map((athlete) => [athlete.coordinates.lat, athlete.coordinates.lng]),
      ...validRegions.map((region) => [region.center.lat, region.center.lng]),
    ];

    if (valid.length === 1 && !validRegions.length) {
      map.setView([valid[0].coordinates.lat, valid[0].coordinates.lng], 8);
    } else if (boundsPoints.length > 1) {
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, { padding: [24, 24] });
    } else {
      map.setView([39.5, -98.35], 4);
    }

    window.setTimeout(() => map.invalidateSize(), 0);
  }

  function selectAthlete(athlete) {
    const marker = athlete ? markersByUserId.get(athlete.userId) : null;
    if (!marker) return;
    marker.openPopup();
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 7), { duration: 0.4 });
  }

  function destroy() {
    map.remove();
  }

  return {
    render,
    selectAthlete,
    destroy,
  };
}

const LEAFLET_CSS_ID = "ua-leaflet-css";
const LEAFLET_SCRIPT_ID = "ua-leaflet-script";
const LEAFLET_CSS_HREF = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS_SRC = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
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

function loadScript() {
  if (window.L) return Promise.resolve(window.L);

  const existing = document.getElementById(LEAFLET_SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(window.L), { once: true });
      existing.addEventListener("error", () => reject(new Error("Leaflet failed to load.")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = LEAFLET_SCRIPT_ID;
    script.src = LEAFLET_JS_SRC;
    script.crossOrigin = "";
    script.integrity = LEAFLET_JS_INTEGRITY;
    script.addEventListener("load", () => resolve(window.L), { once: true });
    script.addEventListener("error", () => reject(new Error("Leaflet failed to load.")), { once: true });
    document.body.appendChild(script);
  });
}

async function loadLeaflet() {
  loadCss();
  return loadScript();
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

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const regionLayerGroup = L.layerGroup().addTo(map);
  const athleteLayerGroup = L.layerGroup().addTo(map);
  let markersByUserId = new Map();

  function regionColor(region) {
    if (region.averagePerformanceRating >= 88) return "#2563eb";
    if (region.averagePerformanceRating >= 78) return "#14b8a6";
    return "#f59e0b";
  }

  function render({ athletes = [], regions = [] } = {}) {
    regionLayerGroup.clearLayers();
    athleteLayerGroup.clearLayers();
    markersByUserId = new Map();

    const valid = athletes.filter((athlete) => Number.isFinite(athlete?.coordinates?.lat) && Number.isFinite(athlete?.coordinates?.lng));
    const validRegions = regions.filter((region) => Number.isFinite(region?.center?.lat) && Number.isFinite(region?.center?.lng));

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

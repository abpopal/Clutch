import { supabase } from "./supabaseClient.js";

const profileRole = document.querySelector("#profile-role");
const profileTitle = document.querySelector("#profile-title");
const profileSubtitle = document.querySelector("#profile-subtitle");
const profileTags = document.querySelector("#profile-tags");
const profileVerification = document.querySelector("#profile-verification");

const nameInput = document.querySelector("#profile-name");
const sportInput = document.querySelector("#profile-sport");
const affiliationInput = document.querySelector("#profile-affiliation");
const locationInput = document.querySelector("#profile-location");
const bioInput = document.querySelector("#profile-bio");

const statsCopy = document.querySelector("#profile-stats-copy");
const saveBtn = document.querySelector("#save-profile");
const statusEl = document.querySelector("#profile-status");

let sessionCache = null;
let roleCache = "general";

const roleDescriptions = {
  athlete: "Athlete profile with stats, highlights, and recruitment inbox visibility.",
  school: "School profile with sports offered, schedule widget, and affiliated coaches.",
  coach: "Coach profile with roster preview, certifications, and team updates.",
  scout: "Scout profile with organization, region, and recruiting watchlist context.",
  general: "General user profile focused on follows, feed preferences, and notifications.",
};

const roleStatsCopy = {
  athlete: "Season totals and averages, trend charts, and coach-approved stats.",
  school: "Athlete verification status, team counts, and upcoming event coverage.",
  coach: "Team stat leaders, attendance records, and pending stat approvals.",
  scout: "Watchlist movement, offer pipeline statuses, and saved search alerts.",
  general: "Followed schools and upcoming games personalized to your interests.",
};

function setStatus(text, type = "") {
  if (!statusEl) return;
  statusEl.textContent = text || "";
  statusEl.classList.remove("error", "success");
  if (type) statusEl.classList.add(type);
}

function fillTags(role, metadata) {
  if (!profileTags) return;
  profileTags.innerHTML = "";

  const tags = [
    role,
    metadata?.sport,
    metadata?.affiliation,
    metadata?.location,
    metadata?.grad_year ? `Class of ${metadata.grad_year}` : null,
  ].filter(Boolean);

  tags.forEach((entry) => {
    const tag = document.createElement("span");
    tag.textContent = entry;
    profileTags.appendChild(tag);
  });
}

function applyRoleView(role, metadata = {}) {
  if (profileRole) profileRole.textContent = `Role: ${role}`;
  if (profileTitle) profileTitle.textContent = `${metadata.name || "Account"} Profile`;
  if (profileSubtitle) profileSubtitle.textContent = roleDescriptions[role] || roleDescriptions.general;
  if (profileVerification) profileVerification.textContent = metadata.verification_status || "Pending";
  if (statsCopy) statsCopy.textContent = roleStatsCopy[role] || roleStatsCopy.general;

  nameInput.value = metadata.name || "";
  sportInput.value = metadata.sport || "";
  affiliationInput.value = metadata.affiliation || "";
  locationInput.value = metadata.location || "";
  bioInput.value = metadata.bio || "";

  fillTags(role, metadata);
}

async function saveProfile() {
  if (!sessionCache?.user) return;
  setStatus("");

  const existingMetadata = sessionCache.user.user_metadata || {};
  const updatedData = {
    ...existingMetadata,
    name: nameInput.value.trim(),
    sport: sportInput.value.trim(),
    affiliation: affiliationInput.value.trim(),
    location: locationInput.value.trim(),
    bio: bioInput.value.trim(),
  };

  try {
    const { data, error } = await supabase.auth.updateUser({ data: updatedData });
    if (error) throw error;

    sessionCache = { ...sessionCache, user: data.user || sessionCache.user };
    applyRoleView(roleCache, updatedData);
    setStatus("Profile metadata saved.", "success");
  } catch (error) {
    console.error("Failed to save profile metadata", error);
    setStatus(error.message || "Failed to save profile.", "error");
  }
}

saveBtn?.addEventListener("click", saveProfile);

window.addEventListener("session-ready", ({ detail }) => {
  const session = detail?.session;
  const role = (detail?.role || "general").toLowerCase();

  if (!session?.user) return;

  sessionCache = session;
  roleCache = role;

  applyRoleView(role, session.user.user_metadata || {});
});

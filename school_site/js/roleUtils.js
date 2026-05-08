export const APP_ROLES = ["athlete", "scout", "coach", "school_admin", "user"];

const ROLE_ALIASES = {
  athlete: "athlete",
  scout: "scout",
  coach: "coach",
  school_admin: "school_admin",
  school: "school_admin",
  user: "user",
  viewer: "user",
  general: "user",
};

const ROLE_LABELS = {
  athlete: "Athlete",
  scout: "Scout",
  coach: "Coach",
  school_admin: "School Admin",
  user: "User",
};

export function normalizeRole(role) {
  return ROLE_ALIASES[String(role || "").trim().toLowerCase()] || "user";
}

export function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || "User";
}

export function getUserRole(user) {
  return normalizeRole(user?.role || user?.appRole || user?.user_metadata?.role);
}

export function isScout(user) {
  return getUserRole(user) === "scout";
}

export function isAthlete(user) {
  return getUserRole(user) === "athlete";
}

export function isCoach(user) {
  return getUserRole(user) === "coach";
}

export function isSchool(user) {
  return getUserRole(user) === "school_admin";
}

export function isSchoolAdmin(user) {
  return getUserRole(user) === "school_admin";
}

export function isUser(user) {
  return getUserRole(user) === "user";
}

export function buildAuthState({ session = null, appUserId = null, role = "user" } = {}) {
  return {
    session,
    authUser: session?.user || null,
    appUserId,
    role: normalizeRole(role),
  };
}

export function getGlobalAppState() {
  if (typeof window === "undefined") return { auth: buildAuthState() };
  return window.__UA_APP_STATE || { auth: buildAuthState() };
}

export function setGlobalAppState(partialState = {}) {
  if (typeof window === "undefined") return partialState;
  const previous = getGlobalAppState();
  const nextState = {
    ...previous,
    ...partialState,
  };

  if (partialState.auth) {
    nextState.auth = {
      ...previous.auth,
      ...partialState.auth,
      role: normalizeRole(partialState.auth.role),
    };
  }

  window.__UA_APP_STATE = nextState;
  window.dispatchEvent(new CustomEvent("ua-app-state-change", { detail: nextState }));
  return nextState;
}

if (typeof window !== "undefined") {
  window.uaRoleUtils = {
    APP_ROLES,
    normalizeRole,
    roleLabel,
    getUserRole,
    isScout,
    isAthlete,
    isCoach,
    isSchool,
    isSchoolAdmin,
    isUser,
    getGlobalAppState,
  };
}

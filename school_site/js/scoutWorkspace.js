import { isScout, normalizeRole } from "./roleUtils.js";

const STORAGE_KEY = "ua-scout-workspace:v1";

function emptyWorkspace() {
  return {
    savedAthletes: [],
    shortlistAthletes: [],
    notesByAthlete: {},
  };
}

function readStore() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function writeStore(store) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (_error) {
    // Ignore storage failures so the profile still renders.
  }
}

function workspaceForScout(store, viewerUserId) {
  const current = store?.[viewerUserId];
  if (!current || typeof current !== "object") return emptyWorkspace();
  return {
    savedAthletes: Array.isArray(current.savedAthletes) ? current.savedAthletes : [],
    shortlistAthletes: Array.isArray(current.shortlistAthletes) ? current.shortlistAthletes : [],
    notesByAthlete: current.notesByAthlete && typeof current.notesByAthlete === "object" ? current.notesByAthlete : {},
  };
}

function updateWorkspace(viewerUserId, updater) {
  if (!viewerUserId) return emptyWorkspace();
  const store = readStore();
  const current = workspaceForScout(store, viewerUserId);
  const next = updater(current) || current;
  store[viewerUserId] = {
    ...emptyWorkspace(),
    ...next,
  };
  writeStore(store);
  return workspaceForScout(store, viewerUserId);
}

function uniqueList(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

export function canUseScoutWorkspace({ viewerRole, viewerUserId, targetUserId, isSelf }) {
  if (!viewerUserId || !targetUserId || isSelf) return false;
  return isScout({ role: normalizeRole(viewerRole) });
}

export function getScoutWorkspaceState({ viewerRole, viewerUserId, targetUserId, isSelf }) {
  if (!canUseScoutWorkspace({ viewerRole, viewerUserId, targetUserId, isSelf })) {
    return null;
  }

  const current = workspaceForScout(readStore(), viewerUserId);
  const noteEntry = current.notesByAthlete?.[targetUserId] || {};

  return {
    saved: current.savedAthletes.includes(targetUserId),
    shortlisted: current.shortlistAthletes.includes(targetUserId),
    note: String(noteEntry.text || ""),
    updatedAt: noteEntry.updatedAt || "",
  };
}

export function getSavedAthleteIds({ viewerUserId }) {
  if (!viewerUserId) return [];
  const current = workspaceForScout(readStore(), viewerUserId);
  return uniqueList(current.savedAthletes);
}

export function getScoutWorkspaceSnapshot({ viewerUserId }) {
  if (!viewerUserId) return emptyWorkspace();
  return workspaceForScout(readStore(), viewerUserId);
}

export function toggleSavedAthlete({ viewerUserId, targetUserId }) {
  return updateWorkspace(viewerUserId, (current) => {
    const exists = current.savedAthletes.includes(targetUserId);
    return {
      ...current,
      savedAthletes: exists
        ? current.savedAthletes.filter((id) => id !== targetUserId)
        : uniqueList([...current.savedAthletes, targetUserId]),
    };
  });
}

export function toggleShortlistedAthlete({ viewerUserId, targetUserId }) {
  return updateWorkspace(viewerUserId, (current) => {
    const exists = current.shortlistAthletes.includes(targetUserId);
    return {
      ...current,
      shortlistAthletes: exists
        ? current.shortlistAthletes.filter((id) => id !== targetUserId)
        : uniqueList([...current.shortlistAthletes, targetUserId]),
    };
  });
}

export function saveScoutNotes({ viewerUserId, targetUserId, note }) {
  const text = String(note || "").trim();
  return updateWorkspace(viewerUserId, (current) => {
    const nextNotes = {
      ...current.notesByAthlete,
      [targetUserId]: {
        text,
        updatedAt: new Date().toISOString(),
      },
    };

    return {
      ...current,
      notesByAthlete: nextNotes,
    };
  });
}

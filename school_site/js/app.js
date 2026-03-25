import { supabase } from "./supabaseClient.js";

const ROLE_LABELS = {
  athlete: "Athlete",
  school: "School Admin",
  coach: "Coach",
  scout: "Scout",
  viewer: "General User",
  general: "General User",
};

const COMMANDS = [
  { label: "Go to Home Feed", hint: "Posts from followed accounts", href: "index.html" },
  { label: "Open Pulse", hint: "Trending posts and momentum", href: "pulse.html" },
  { label: "Open Search", hint: "Find athletes, coaches, schools, and posts", href: "explore.html" },
  { label: "Open Profile", hint: "Profile and athlete details", href: "profile.html" },
];

document.addEventListener("DOMContentLoaded", () => {
  const body = document.body;
  const currentPage = body.dataset.page || "home";
  const requiresSession = body.dataset.requiresSession !== "false";

  const sessionChip = document.querySelector("#session-chip");
  const signOutBtn = document.querySelector("#sign-out-btn");
  const navButtons = Array.from(document.querySelectorAll(".nav-btn"));
  const rolePill = document.querySelector("#role-pill");

  const menuBtn = document.querySelector("#menu-btn");
  const mobileOverlay = document.querySelector("#mobile-overlay");
  const searchInput = document.querySelector("#global-search");
  const notifBtn = document.querySelector("#notif-btn");
  const notifCount = document.querySelector("#notif-count");

  let currentRole = "general";

  function setActiveNav() {
    navButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === currentPage);
    });
  }

  function roleAllowed(allowedList, role) {
    if (!allowedList) return true;
    const list = allowedList
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (list.length === 0) return true;
    if (list.includes(role)) return true;
    if (role === "viewer" && list.includes("general")) return true;
    return false;
  }

  function applyRoleVisibility(role) {
    currentRole = role || "general";
    if (rolePill) rolePill.textContent = ROLE_LABELS[currentRole] || currentRole;

    Array.from(document.querySelectorAll("[data-role-allow]")).forEach((el) => {
      const allowed = roleAllowed(el.getAttribute("data-role-allow"), currentRole);
      el.hidden = !allowed;
    });
  }

  function toggleSidebar(open) {
    document.body.classList.toggle("sidebar-open", open);
  }

  function buildPalette(sessionRole) {
    if (document.querySelector("#command-palette")) return;

    const palette = document.createElement("div");
    palette.id = "command-palette";
    palette.className = "command-palette";
    palette.innerHTML = `
      <div class="command-card" role="dialog" aria-label="Command palette">
        <input id="command-input" type="text" placeholder="Jump to page or search topic...">
        <div id="command-results" class="command-results"></div>
      </div>
    `;
    document.body.appendChild(palette);

    const input = palette.querySelector("#command-input");
    const resultsEl = palette.querySelector("#command-results");

    function renderCommands(filter = "") {
      const normalized = filter.trim().toLowerCase();
      const available = COMMANDS.filter((cmd) => {
        if (cmd.roles) {
          const allowed = cmd.roles.includes(sessionRole) || (sessionRole === "viewer" && cmd.roles.includes("general"));
          if (!allowed) return false;
        }
        if (!normalized) return true;
        return cmd.label.toLowerCase().includes(normalized) || cmd.hint.toLowerCase().includes(normalized);
      });

      resultsEl.innerHTML = "";
      if (!available.length) {
        const empty = document.createElement("div");
        empty.className = "placeholder";
        empty.textContent = "No results";
        resultsEl.appendChild(empty);
        return;
      }

      available.forEach((cmd) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "command-item";
        item.innerHTML = `<strong>${cmd.label}</strong><br><small>${cmd.hint}</small>`;
        item.addEventListener("click", () => {
          window.location.href = cmd.href;
        });
        resultsEl.appendChild(item);
      });
    }

    function openPalette() {
      palette.classList.add("open");
      input.value = "";
      renderCommands("");
      input.focus();
    }

    function closePalette() {
      palette.classList.remove("open");
    }

    document.addEventListener("keydown", (event) => {
      const isPaletteKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isPaletteKey) {
        event.preventDefault();
        if (palette.classList.contains("open")) {
          closePalette();
        } else {
          openPalette();
        }
      }

      if (event.key === "Escape" && palette.classList.contains("open")) {
        closePalette();
      }
    });

    palette.addEventListener("click", (event) => {
      if (event.target === palette) closePalette();
    });

    input.addEventListener("input", () => renderCommands(input.value));
  }

  async function syncUserDirectoryFromSession(session) {
    try {
      const { data: appUser, error: appUserError } = await supabase
        .from("users")
        .select("user_id")
        .eq("firebase_uid", session.user.id)
        .maybeSingle();
      if (appUserError || !appUser?.user_id) return;

      const metadataName = session.user?.user_metadata?.name || null;
      const metadataEmail = session.user?.email || null;

      await supabase.from("user_directory").upsert(
        {
          user_id: appUser.user_id,
          display_name: metadataName,
          email: metadataEmail,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    } catch (_error) {
      // Ignore missing user_directory deployments.
    }
  }

  function updateSession(session) {
    if (!session) {
      if (sessionChip) sessionChip.textContent = "Not signed in";
      if (signOutBtn) signOutBtn.hidden = true;
      applyRoleVisibility("general");

      if (requiresSession) {
        window.location.href = "login.html";
      }
      return;
    }

    const email = session.user?.email || "Signed in";
    const metadataRole = (session.user?.user_metadata?.role || "general").toLowerCase();
    const role = metadataRole === "general" ? "viewer" : metadataRole;
    const unread = Number(session.user?.user_metadata?.unread_notifications || 4);

    if (sessionChip) sessionChip.textContent = email;
    if (signOutBtn) signOutBtn.hidden = false;
    if (notifCount) notifCount.textContent = String(unread);

    applyRoleVisibility(role);
    buildPalette(role);
    syncUserDirectoryFromSession(session);

    if (currentPage === "login") {
      window.location.href = "index.html";
      return;
    }

    window.dispatchEvent(new CustomEvent("session-ready", { detail: { session, role } }));
  }

  async function initSession() {
    if (sessionChip) sessionChip.textContent = "Checking session...";
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error("Failed to get session", error);
    }
    updateSession(data.session);
  }

  menuBtn?.addEventListener("click", () => {
    const open = !document.body.classList.contains("sidebar-open");
    toggleSidebar(open);
  });

  mobileOverlay?.addEventListener("click", () => toggleSidebar(false));

  searchInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const query = searchInput.value.trim();
    if (!query) return;
    window.location.href = `explore.html?q=${encodeURIComponent(query)}`;
  });

  notifBtn?.addEventListener("click", () => {
    const count = notifCount?.textContent || "0";
    window.alert(`Notifications center: ${count} unread. Connect realtime notifications for a full panel.`);
  });

  signOutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "login.html";
  });

  setActiveNav();
  initSession();

  supabase.auth.onAuthStateChange((_event, session) => {
    updateSession(session);
  });
});

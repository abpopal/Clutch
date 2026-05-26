import { supabase } from "./supabaseClient.js";
import { buildAuthState, normalizeRole, roleLabel, setGlobalAppState } from "./roleUtils.js";

/* ── Theme toggle ────────────────────────────────────────── */
// Apply saved theme immediately (before render)
(function initTheme() {
  const saved = localStorage.getItem("ua-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
})();

// Bind theme toggle — called after header partial loads
function bindThemeToggle() {
  const cb = document.querySelector("#theme-toggle-cb");
  if (!cb) return;
  const theme = document.documentElement.getAttribute("data-theme");
  cb.checked = theme === "light";

  cb.addEventListener("change", () => {
    const next = cb.checked ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("ua-theme", next);
  });
}

const COMMANDS = [
  { label: "Go to Home Feed", hint: "Posts from followed accounts", href: "index.html" },
  { label: "Open Pulse", hint: "Trending posts and momentum", href: "pulse.html" },
  { label: "Open Search", hint: "Find athletes by name, ID, school, sport, or email", href: "explore.html" },
  { label: "Open Athlete Profile", hint: "Structured recruiting and athlete details", href: "profile.html" },
  { label: "Open Scout Dashboard", hint: "Scout-only athlete search, filters, and saved athletes", href: "scout-dashboard.html", roles: ["scout"] },
  { label: "Open School Dashboard", hint: "School-admin workspace for athletes, staff, teams, matches, and media", href: "school-dashboard.html", roles: ["school_admin"] },
];

const HEADER_CACHE_KEY = "ua:header:v20260524a";
const SIDEBAR_CACHE_KEY = "ua:sidebar:v20260524a";

async function loadPartial(selector, url, cacheKey) {
  const host = document.querySelector(selector);
  if (!host) return;

  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    host.innerHTML = cached;
    fetch(url, { cache: "default" })
      .then((r) => r.ok ? r.text() : null)
      .then((html) => { if (html) sessionStorage.setItem(cacheKey, html); })
      .catch(() => {});
    return;
  }

  const response = await fetch(url, { cache: "default" });
  if (!response.ok) throw new Error(`Unable to load partial (${response.status})`);
  const html = await response.text();
  host.innerHTML = html;
  try { sessionStorage.setItem(cacheKey, html); } catch (_) {}
}

async function mountSharedHeader() {
  await loadPartial("[data-shared-header]", "partials/site-header.html?v=20260524a", HEADER_CACHE_KEY);
}

async function mountSharedSidebar() {
  await loadPartial("#sidebar[data-shared-sidebar]", "partials/sidebar.html?v=20260524a", SIDEBAR_CACHE_KEY);
  // Move any page-specific sidebar-extra content into the slot
  const extraSlot = document.querySelector("#sidebar-extra");
  const extraSource = document.querySelector("[data-sidebar-extra-content]");
  if (extraSlot && extraSource) {
    extraSlot.innerHTML = extraSource.innerHTML;
    extraSource.remove();
  }
}

async function initApp() {
  try {
    await mountSharedSidebar();
    await mountSharedHeader();
    bindThemeToggle();
  } catch (error) {
    console.error("Header mount failed", error);
  }

  const body = document.body;
  const currentPage = body.dataset.page || "home";
  const requiresSession = body.dataset.requiresSession !== "false";

  const signOutBtn = document.querySelector("#sign-out-btn");
  const navButtons = Array.from(document.querySelectorAll(".nav-btn"));
  const rolePill = document.querySelector("#role-pill");
  const headerRole = document.querySelector("#header-role");
  const sidebar = document.querySelector("#sidebar");
  const headerAccount = document.querySelector("#header-account");
  const accountMenuBtn = document.querySelector("#account-menu-btn");
  const accountMenu = document.querySelector("#account-menu");
  const headerAvatar = document.querySelector("#header-avatar");

  const menuBtn = document.querySelector("#menu-btn");
  const mobileOverlay = document.querySelector("#mobile-overlay");
  const searchInput = document.querySelector("#global-search");
  const notifBtn = document.querySelector("#notif-btn");
  const notifCount = document.querySelector("#notif-count");
  const desktopSidebarQuery = window.matchMedia("(max-width: 1080px)");

  let currentRole = "user";

  function avatarUrlFor(seed) {
    return `https://i.pravatar.cc/320?u=${encodeURIComponent(seed || "ua-user")}`;
  }

  function closeAccountMenu() {
    if (!accountMenuBtn || !accountMenu) return;
    accountMenu.hidden = true;
    accountMenuBtn.setAttribute("aria-expanded", "false");
  }

  function toggleAccountMenu() {
    if (!accountMenuBtn || !accountMenu) return;
    const nextOpen = accountMenu.hidden;
    accountMenu.hidden = !nextOpen;
    accountMenuBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  }

  async function updateHeaderAccount(session, appUserId) {
    if (!headerAccount || !accountMenuBtn || !headerAvatar) return;

    if (!session) {
      headerAccount.hidden = true;
      closeAccountMenu();
      return;
    }

    const seed = appUserId || session.user?.user_metadata?.name || session.user?.id;
    headerAvatar.alt = `${session.user?.user_metadata?.name || "User"} profile photo`;
    headerAccount.hidden = false;

    // Try to load real avatar from users table
    if (appUserId) {
      try {
        const row = await fetchFirst(
          supabase.from("users").select("avatar_url").eq("user_id", appUserId)
        );
        if (row?.avatar_url) {
          headerAvatar.src = row.avatar_url;
          return;
        }
      } catch (_) { /* fall through to default */ }
    }
    headerAvatar.src = avatarUrlFor(seed);
  }

  async function fetchFirst(query) {
    const { data, error } = await query.limit(1);
    if (error) throw error;
    return Array.isArray(data) ? (data[0] || null) : (data || null);
  }

  async function ensureRoleRow(appUserId, role, metadata = {}) {
    if (!appUserId || !role) return;

    const ensureRoleRecord = async (table, payload) => {
      const existing = await fetchFirst(
        supabase
          .from(table)
          .select("user_id")
          .eq("user_id", appUserId)
      );
      if (existing) return;
      const { error } = await supabase.from(table).insert(payload);
      if (error && error.code !== "23505") throw error;
    };

    if (role === "school_admin" || role === "school") {
      await ensureRoleRecord("schools", {
        user_id: appUserId,
        name: metadata.name || metadata.affiliation || "School",
        location: metadata.location || null,
        description: metadata.bio || null,
      });
      return;
    }

    if (role === "coach") {
      await ensureRoleRecord("coaches", {
        user_id: appUserId,
        bio: metadata.bio || null,
        years_experience: null,
      });
      return;
    }

    if (role === "athlete") {
      await ensureRoleRecord("athletes", {
        user_id: appUserId,
        position: metadata.sport || null,
        graduation_year: metadata.grad_year || null,
      });
      return;
    }

    if (role === "scout") {
      await ensureRoleRecord("scouts", {
        user_id: appUserId,
        organization: metadata.affiliation || null,
        title: metadata.sport || null,
      });
    }
  }

  async function ensureAppUserFromSession(session) {
    if (!session?.user?.id) return null;

    const rawRole = String(session.user?.user_metadata?.role || "user").trim().toLowerCase();
    const metadataRole = normalizeRole(rawRole);
    const appRole = rawRole; // Use raw role for DB insert (CHECK constraint matches raw values)
    const metadata = {
      name: session.user?.user_metadata?.name || null,
      sport: session.user?.user_metadata?.sport || null,
      affiliation: session.user?.user_metadata?.affiliation || null,
      location: session.user?.user_metadata?.location || null,
      grad_year: session.user?.user_metadata?.grad_year || null,
      bio: session.user?.user_metadata?.bio || null,
    };

    const existingUser = await fetchFirst(
      supabase
        .from("users")
        .select("user_id,role")
        .eq("auth_uid", session.user.id)
    );

    let appUserId = existingUser?.user_id || null;
    const existingRole = normalizeRole(existingUser?.role);

    if (!appUserId) {
      const { data: createdUser, error: insertError } = await supabase
        .from("users")
        .insert({ auth_uid: session.user.id, role: appRole })
        .select("user_id")
        .single();

      if (insertError && insertError.code !== "23505") throw insertError;

      if (!createdUser?.user_id) {
        const retryUser = await fetchFirst(
          supabase
            .from("users")
            .select("user_id,role")
            .eq("auth_uid", session.user.id)
        );
        appUserId = retryUser?.user_id || null;
      } else {
        appUserId = createdUser.user_id;
      }
    }

    if (appUserId) {
      // Don't update role if it's just a normalization difference (e.g. "school" vs "school_admin")
      const dbRole = existingUser?.role || appRole;
      await ensureRoleRow(appUserId, normalizeRole(dbRole), metadata);
      await supabase.from("user_directory").upsert(
        {
          user_id: appUserId,
          display_name: metadata.name,
          email: session.user?.email || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    }

    return appUserId;
  }

  function setActiveNav() {
    navButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === currentPage);
    });
  }

  function roleAllowed(allowedList, role) {
    if (!allowedList) return true;
    const list = allowedList
      .split(",")
      .map((value) => normalizeRole(value))
      .filter(Boolean);
    if (list.length === 0) return true;
    return list.includes(normalizeRole(role));
  }

  function applyRoleVisibility(role) {
    currentRole = normalizeRole(role);
    if (rolePill) rolePill.textContent = roleLabel(currentRole);
    if (headerRole) {
      headerRole.textContent = roleLabel(currentRole);
      headerRole.hidden = false;
    }

    Array.from(document.querySelectorAll("[data-role-allow]")).forEach((el) => {
      const allowed = roleAllowed(el.getAttribute("data-role-allow"), currentRole);
      el.hidden = !allowed;
    });
  }

  function toggleSidebar(open) {
    document.body.classList.toggle("sidebar-open", open);
  }

  function isMobileSidebar() {
    return desktopSidebarQuery.matches;
  }

  function syncSidebarState() {
    if (isMobileSidebar()) {
      document.body.classList.remove("sidebar-collapsed", "sidebar-peek");
      toggleSidebar(false);
      return;
    }

    document.body.classList.add("sidebar-collapsed");
    document.body.classList.remove("sidebar-open");
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
          const allowed = cmd.roles.map((role) => normalizeRole(role)).includes(normalizeRole(sessionRole));
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
      return await ensureAppUserFromSession(session);
    } catch (_error) {
      // Ignore bootstrap failures here so auth UI remains reachable.
      return null;
    }
  }

  async function updateSession(session) {
    if (!session) {
      applyRoleVisibility("user");
      if (headerRole) headerRole.hidden = true;
      updateHeaderAccount(null, null);
      setGlobalAppState({ auth: buildAuthState() });

      if (requiresSession) {
        window.location.href = "login.html";
      }
      return;
    }

    const role = normalizeRole(session.user?.user_metadata?.role);

    applyRoleVisibility(role);
    buildPalette(role);
    const appUserId = await syncUserDirectoryFromSession(session);
    currentAppUserId = appUserId;
    updateHeaderAccount(session, appUserId);
    setGlobalAppState({ auth: buildAuthState({ session, appUserId, role }) });

    // Load unread notification count + subscribe to realtime
    if (appUserId) {
      supabase
        .from("notifications")
        .select("notification_id", { count: "exact", head: true })
        .eq("user_id", appUserId)
        .neq("type", "message")
        .is("read_at", null)
        .then(({ count }) => {
          if (typeof count === "number") updateBadge(count);
        })
        .catch(() => {/* ignore */});

      subscribeToNotifications(appUserId);

      // Unread message count badge on sidebar Messages link
      supabase
        .from("notifications")
        .select("notification_id", { count: "exact", head: true })
        .eq("user_id", appUserId)
        .eq("type", "message")
        .is("read_at", null)
        .then(({ count }) => {
          const msgLink = document.querySelector('.nav-btn[data-nav="messages"]');
          if (msgLink && typeof count === "number" && count > 0) {
            let badge = msgLink.querySelector(".nav-msg-badge");
            if (!badge) {
              badge = document.createElement("span");
              badge.className = "nav-msg-badge";
              msgLink.appendChild(badge);
            }
            badge.textContent = count > 99 ? "99+" : String(count);
          }
        })
        .catch(() => {});
    }

    if (currentPage === "login") {
      window.location.href = "index.html";
      return;
    }

    window.dispatchEvent(new CustomEvent("session-ready", { detail: { session, role } }));
  }

  async function initSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error("Failed to get session", error);
    }
    await updateSession(data.session);
  }

  menuBtn?.addEventListener("click", () => {
    if (!isMobileSidebar()) return;
    const open = !document.body.classList.contains("sidebar-open");
    toggleSidebar(open);
  });

  mobileOverlay?.addEventListener("click", () => toggleSidebar(false));

  menuBtn?.setAttribute("aria-label", "Open menu");
  if (menuBtn) menuBtn.textContent = "Menu";

  accountMenuBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAccountMenu();
  });

  sidebar?.addEventListener("mouseenter", () => {
    if (!isMobileSidebar() && document.body.classList.contains("sidebar-collapsed")) {
      document.body.classList.add("sidebar-peek");
    }
  });

  sidebar?.addEventListener("mouseleave", () => {
    document.body.classList.remove("sidebar-peek");
  });

  sidebar?.addEventListener("focusin", () => {
    if (!isMobileSidebar() && document.body.classList.contains("sidebar-collapsed")) {
      document.body.classList.add("sidebar-peek");
    }
  });

  sidebar?.addEventListener("focusout", (event) => {
    if (!sidebar.contains(event.relatedTarget)) {
      document.body.classList.remove("sidebar-peek");
    }
  });

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isMobileSidebar()) toggleSidebar(false);
    });
  });

  desktopSidebarQuery.addEventListener("change", () => {
    syncSidebarState();
  });

  searchInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const query = searchInput.value.trim();
    if (!query) return;
    window.location.href = `explore.html?q=${encodeURIComponent(query)}`;
  });

  // ── Notification panel ──────────────────────────────────────────
  const notifPanel = document.querySelector("#notif-panel");
  const notifList  = document.querySelector("#notif-list");
  const notifMarkRead = document.querySelector("#notif-mark-read");

  let notifOpen = false;
  let currentAppUserId = null;
  let notifChannel = null;

  const NOTIF_ICONS = {
    follow: "F", unfollow: "F", message: "M",
    team_invite: "T", match_scheduled: "S", stat_posted: "St",
    profile_view: "V", scout_save: "Sv", achievement: "A", general: "N",
  };

  function formatNotifTime(iso) {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 60) return `${Math.max(1, m)}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  function escHtml(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }

  function notifLinkFor(n) {
    if (n.link) return n.link;
    // Fallback links based on notification type
    switch (n.type) {
      case "follow":
      case "unfollow":
      case "profile_view":
        // body usually starts with the user's name — no user_id available, go to explore
        return "explore.html";
      case "message":
        return "messages.html";
      case "stat_posted":
      case "achievement":
        return "profile.html";
      case "scout_save":
        return "scout-dashboard.html";
      case "team_invite":
      case "match_scheduled":
        return "school-dashboard.html";
      default:
        return "";
    }
  }

  function notifItemHtml(n) {
    const icon = n.icon || NOTIF_ICONS[n.type] || "N";
    const link = notifLinkFor(n);
    const linkAttr = link ? ` data-notif-link="${escHtml(link)}"` : "";
    const isUnread = !n.read_at;
    return `
      <div class="notif-item${isUnread ? " unread" : " read"}" data-notif-id="${n.notification_id}" data-notif-type="${escHtml(n.type || "general")}"${linkAttr}>
        <span class="notif-item-icon notif-icon-${escHtml(n.type || "general")}">${icon}</span>
        <div class="notif-item-content">
          <span class="notif-item-title">${escHtml(n.title || n.type)}${isUnread ? '<span class="notif-unread-dot"></span>' : ""}</span>
          ${n.body ? `<span class="notif-item-body">${escHtml(n.body)}</span>` : ""}
          <span class="notif-item-time">${formatNotifTime(n.created_at)}</span>
        </div>
      </div>`;
  }

  function showNotifToast(n) {
    const icon = n.icon || NOTIF_ICONS[n.type] || "N";
    const el = document.createElement("div");
    el.className = "notif-toast";
    el.innerHTML = `<span class="notif-toast-icon">${icon}</span><div class="notif-toast-body"><strong>${escHtml(n.title || n.type)}</strong>${n.body ? `<span>${escHtml(n.body)}</span>` : ""}</div>`;
    if (n.link) {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => { window.location.href = n.link; });
    }
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      el.addEventListener("transitionend", () => el.remove());
    }, 5000);
  }

  function updateBadge(count) {
    if (notifCount) {
      notifCount.textContent = String(count);
      notifCount.hidden = count === 0;
    }
    if (count > 0 && notifBtn) notifBtn.classList.add("has-unread");
    else if (notifBtn) notifBtn.classList.remove("has-unread");
  }

  async function loadNotifications(appUserId) {
    if (!appUserId || !notifList) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("notification_id, type, title, body, icon, link, read_at, created_at")
      .eq("user_id", appUserId)
      .neq("type", "message")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error || !data) {
      if (notifList) notifList.innerHTML = `<div class="notif-empty">Could not load notifications.</div>`;
      return;
    }

    const unread = data.filter((n) => !n.read_at).length;
    updateBadge(unread);

    if (!data.length) {
      notifList.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
      return;
    }

    notifList.innerHTML = data.map(notifItemHtml).join("");
  }

  async function markAllRead(appUserId) {
    if (!appUserId) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", appUserId)
      .is("read_at", null);
    updateBadge(0);
    document.querySelectorAll(".notif-item.unread").forEach((el) => el.classList.remove("unread"));
  }

  async function markOneRead(notifId) {
    if (!notifId) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("notification_id", notifId)
      .is("read_at", null);
  }

  function subscribeToNotifications(appUserId) {
    if (notifChannel) supabase.removeChannel(notifChannel);
    notifChannel = supabase
      .channel("notif-" + appUserId)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${appUserId}` },
        (payload) => {
          const n = payload.new;
          // Skip message notifications — those go to the messages page
          if (n.type === "message") return;
          showNotifToast(n);
          // bump badge
          const cur = parseInt(notifCount?.textContent || "0", 10);
          updateBadge(cur + 1);
          // prepend to list if panel open
          if (notifList && !notifPanel?.hidden) {
            const empty = notifList.querySelector(".notif-empty");
            if (empty) empty.remove();
            notifList.insertAdjacentHTML("afterbegin", notifItemHtml(n));
          }
        }
      )
      .subscribe();
  }

  notifBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    notifOpen = !notifOpen;
    if (notifPanel) notifPanel.hidden = !notifOpen;
    notifBtn.setAttribute("aria-expanded", String(notifOpen));
    if (notifOpen && currentAppUserId) loadNotifications(currentAppUserId);
  });

  notifMarkRead?.addEventListener("click", () => markAllRead(currentAppUserId));

  // Click on a notification item → mark read + navigate
  document.addEventListener("click", (e) => {
    const item = e.target.closest?.(".notif-item");
    if (!item) return;

    const id = item.dataset.notifId;
    const link = item.dataset.notifLink;

    // Mark as read visually + in DB
    if (item.classList.contains("unread")) {
      item.classList.remove("unread");
      item.classList.add("read");
      const dot = item.querySelector(".notif-unread-dot");
      if (dot) dot.remove();
      if (id) markOneRead(id);
      // Decrement badge
      const cur = parseInt(notifCount?.textContent || "0", 10);
      updateBadge(Math.max(0, cur - 1));
    }

    // Navigate if there's a link
    if (link) window.location.href = link;
  });

  document.addEventListener("click", (e) => {
    const wrap = document.querySelector("#notif-wrap");
    if (wrap && !wrap.contains(e.target) && notifOpen) {
      notifOpen = false;
      if (notifPanel) notifPanel.hidden = true;
      notifBtn?.setAttribute("aria-expanded", "false");
    }
  });

  // Use event delegation so it catches both sidebar + header account-menu buttons,
  // even the one injected by the async header partial fetch.
  document.addEventListener("click", async (event) => {
    if (event.target.closest("#sign-out-btn")) {
      await supabase.auth.signOut();
      window.location.href = "login.html";
    }
  });

  document.addEventListener("click", (event) => {
    if (!accountMenu || !accountMenuBtn) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (accountMenu.contains(target) || accountMenuBtn.contains(target)) return;
    closeAccountMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAccountMenu();
  });

  setActiveNav();
  syncSidebarState();
  initSession();

  supabase.auth.onAuthStateChange((_event, session) => {
    void updateSession(session);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

const OFFICER_OVERVIEW_PATH = "../overview/overview.html";
const ADMIN_DASHBOARD_PATH = "../admin-dashboard/admin-dashboard.html";
const MOBILE_BREAKPOINT = 820;

function normalizePath(pathname) {
  return String(pathname || "")
    .replace(/\\+/g, "/")
    .replace(/index\.html$/i, "")
    .replace(/\/$/, "");
}

function readStoredProfile() {
  try {
    return JSON.parse(sessionStorage.getItem("studentProfile") || "null");
  } catch {
    return null;
  }
}

function isAdminSession() {
  const profile = readStoredProfile();
  return String(profile?.role || "").trim().toLowerCase() === "admin";
}

function isAdminDashboardPath() {
  return normalizePath(window.location.pathname).includes(
    "/usc-admin/admin-dashboard/admin-dashboard"
  );
}

function guardAdminFromOfficerPages() {
  if (isAdminSession() && !isAdminDashboardPath()) {
    window.location.replace(ADMIN_DASHBOARD_PATH);
    return true;
  }

  return false;
}

function setActiveSidebarLink() {
  const currentPath = normalizePath(window.location.pathname);

  document.querySelectorAll(".nav-btn[href]").forEach((link) => {
    try {
      const linkUrl = new URL(link.getAttribute("href"), window.location.href);
      const linkPath = normalizePath(linkUrl.pathname);

      link.classList.toggle("active", currentPath === linkPath);
    } catch (error) {
      console.warn("Unable to resolve sidebar link:", error);
    }
  });
}

function bindDataNavButtons() {
  document.querySelectorAll("[data-nav]").forEach((element) => {
    element.addEventListener("click", () => {
      const nextPage = element.getAttribute("data-nav");

      if (nextPage) {
        window.location.href = nextPage;
      }
    });
  });
}

/* =========================================================
   MOBILE SIDEBAR
   ========================================================= */

function isMobileViewport() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function getSidebarElements() {
  return {
    toggle: document.querySelector("[data-sidebar-toggle]"),
    sidebar: document.querySelector(".sidebar"),
    overlay: document.querySelector("[data-sidebar-overlay]")
  };
}

function openSidebar() {
  if (!isMobileViewport()) return;

  const { toggle, sidebar, overlay } = getSidebarElements();

  if (!sidebar) return;

  sidebar.classList.add("open");
  overlay?.classList.add("open");

  document.body.classList.add("sidebar-open");

  toggle?.setAttribute("aria-expanded", "true");
  toggle?.setAttribute("aria-label", "Close sidebar");

  document.body.style.overflow = "hidden";
}

function closeSidebar() {
  const { toggle, sidebar, overlay } = getSidebarElements();

  sidebar?.classList.remove("open");
  overlay?.classList.remove("open");

  document.body.classList.remove("sidebar-open");

  toggle?.setAttribute("aria-expanded", "false");
  toggle?.setAttribute("aria-label", "Open sidebar");

  document.body.style.overflow = "";
}

function toggleSidebar() {
  const { sidebar } = getSidebarElements();

  if (!sidebar) return;

  if (sidebar.classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

function bindResponsiveSidebar() {
  const { toggle, sidebar, overlay } = getSidebarElements();

  if (!toggle || !sidebar || !overlay) return;

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    toggleSidebar();
  });

  overlay.addEventListener("click", closeSidebar);

  document.querySelectorAll(".sidebar .nav-btn").forEach((link) => {
    link.addEventListener("click", () => {
      if (isMobileViewport()) {
        closeSidebar();
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();
    }
  });

  window.addEventListener("resize", () => {
    if (!isMobileViewport()) {
      closeSidebar();
    }
  });
}

/* =========================================================
   OFFICER NOTIFICATION BELL
   ========================================================= */

function installNotificationStyles() {
  if (document.getElementById("officer-notification-styles")) return;

  const style = document.createElement("style");

  style.id = "officer-notification-styles";

  style.textContent = `
    .nav-right {
      position: relative;
    }

    .bell {
      cursor: pointer !important;
      width: 38px;
      height: 38px;
      display: grid !important;
      place-items: center;
      border-radius: 50%;
      transition:
        background .15s ease,
        transform .15s ease;
      user-select: none;
    }

    .bell:hover {
      background: #edf5fb;
    }

    .bell:active {
      transform: scale(.95);
    }

    .bell:focus-visible {
      outline: 3px solid rgba(23, 183, 232, .22);
      outline-offset: 2px;
    }

    .officer-notification-panel {
      position: absolute;
      z-index: 5000;
      top: calc(100% + 10px);
      right: 0;

      width: min(340px, calc(100vw - 24px));

      border: 1px solid #dce6ef;
      border-radius: 14px;

      background: white;

      box-shadow:
        0 16px 40px rgba(12, 39, 67, .18);

      overflow: hidden;
    }

    .officer-notification-panel[hidden] {
      display: none !important;
    }

    .officer-notification-header {
      min-height: 52px;

      padding: 12px 14px;

      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;

      border-bottom: 1px solid #e8eff5;

      background: #f7fbfd;
    }

    .officer-notification-header strong {
      color: #174c9d;
      font-size: 14px;
    }

    .officer-notification-close {
      width: 30px;
      height: 30px;

      display: grid;
      place-items: center;

      padding: 0;

      border: 0;
      border-radius: 8px;

      background: transparent;
      color: #50687e;

      cursor: pointer;

      font-size: 21px;
      line-height: 1;
    }

    .officer-notification-close:hover {
      background: #eaf4f9;
    }

    .officer-notification-content {
      padding: 24px 18px;

      text-align: center;

      color: #65798c;

      font-size: 12px;
      line-height: 1.5;
    }

    .officer-notification-icon {
      font-size: 26px;
      margin-bottom: 8px;
    }

    .officer-notification-content strong {
      display: block;

      margin-bottom: 4px;

      color: #274e73;

      font-size: 13px;
    }

    @media (max-width: 560px) {
      .officer-notification-panel {
        position: fixed;

        top: 116px;
        left: 8px;
        right: 8px;

        width: auto;
      }
    }
  `;

  document.head.appendChild(style);
}

function createNotificationPanel(bell, index) {
  const panel = document.createElement("div");

  panel.className = "officer-notification-panel";
  panel.id = `officer-notification-panel-${index}`;
  panel.hidden = true;

  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Notifications");

  panel.innerHTML = `
    <div class="officer-notification-header">
      <strong>Notifications</strong>

      <button
        type="button"
        class="officer-notification-close"
        aria-label="Close notifications"
      >
        &times;
      </button>
    </div>

    <div class="officer-notification-content">
      <div class="officer-notification-icon">🔔</div>

      <strong>You're all caught up</strong>

      New officer notifications will appear here.
    </div>
  `;

  bell.parentElement?.appendChild(panel);

  return panel;
}

function bindNotificationBell() {
  const bells = document.querySelectorAll(".bell");

  if (!bells.length) return;

  installNotificationStyles();

  bells.forEach((bell, index) => {
    if (bell.dataset.bound === "true") return;

    bell.dataset.bound = "true";

    bell.setAttribute("role", "button");
    bell.setAttribute("tabindex", "0");
    bell.setAttribute("aria-label", "Open notifications");
    bell.setAttribute("aria-expanded", "false");
    bell.setAttribute("aria-haspopup", "dialog");

    const panel = createNotificationPanel(bell, index);

    bell.setAttribute("aria-controls", panel.id);

    function openPanel() {
      document
        .querySelectorAll(".officer-notification-panel")
        .forEach((otherPanel) => {
          if (otherPanel !== panel) {
            otherPanel.hidden = true;
          }
        });

      panel.hidden = false;

      bell.setAttribute("aria-expanded", "true");
    }

    function closePanel(returnFocus = false) {
      panel.hidden = true;

      bell.setAttribute("aria-expanded", "false");

      if (returnFocus) {
        bell.focus();
      }
    }

    function togglePanel() {
      if (panel.hidden) {
        openPanel();
      } else {
        closePanel();
      }
    }

    bell.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      togglePanel();
    });

    bell.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();

        togglePanel();
      }
    });

    panel
      .querySelector(".officer-notification-close")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();

        closePanel(true);
      });

    panel.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    document.addEventListener("click", (event) => {
      if (
        !panel.hidden &&
        !bell.contains(event.target) &&
        !panel.contains(event.target)
      ) {
        closePanel();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        closePanel(true);
      }
    });
  });
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  if (guardAdminFromOfficerPages()) {
    return;
  }

  setActiveSidebarLink();
  bindDataNavButtons();

  bindResponsiveSidebar();
  bindNotificationBell();
});

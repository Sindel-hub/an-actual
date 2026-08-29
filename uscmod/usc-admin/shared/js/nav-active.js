const OFFICER_OVERVIEW_PATH = "../overview/overview.html";
const ADMIN_DASHBOARD_PATH = "../admin-dashboard/admin-dashboard.html";
const OFFICER_MODULES = [
  {
    name: "Dashboard",
    detail: "Officer overview and live summaries",
    href: "../overview/overview.html",
    icon: "fa-table-columns",
    keywords: "dashboard overview home summary"
  },

  {
    name: "Bulletin Board Center",
    detail: "Create and manage USC announcements",
    href: "../announcements/announcements.html",
    icon: "fa-note-sticky",
    keywords: "bulletin announcement announcements post notice"
  },

  {
    name: "Election Management",
    detail: "Election schedule, candidates and voting",
    href: "../elections/elections.html",
    icon: "fa-rectangle-list",
    keywords:
      "election elections voting vote candidate candidates schedule results"
  },

  {
    name: "Events",
    detail: "Create and manage USC events",
    href: "../events/events.html",
    icon: "fa-calendar",
    keywords: "event events calendar activity activities"
  },

  {
    name: "Organizational Chart",
    detail: "View the USC council structure",
    href: "../organizational-chart/organizational-chart.html",
    icon: "fa-users",
    keywords:
      "organization organizational chart officers council structure"
  },

  {
    name: "Complaints Management",
    detail: "Review and manage student complaints",
    href: "../complaints/complaints.html",
    icon: "fa-message",
    keywords:
      "complaint complaints case cases concern concerns"
  }
];
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
  const toggle = document.querySelector("[data-sidebar-toggle]");
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.querySelector("[data-sidebar-overlay]");

  if (!toggle || !sidebar) {
    console.warn("Sidebar toggle or sidebar was not found.");
    return;
  }

  function handleToggle(event) {
    event.preventDefault();
    event.stopPropagation();

    if (sidebar.classList.contains("open")) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  /* Standard tap/click */
  toggle.addEventListener("click", handleToggle);

  /* Overlay closes sidebar */
  if (overlay) {
    overlay.addEventListener("click", closeSidebar);
  }

  /* Close after selecting a menu item on mobile */
  document.querySelectorAll(".sidebar .nav-btn").forEach((link) => {
    link.addEventListener("click", () => {
      if (isMobileViewport()) {
        closeSidebar();
      }
    });
  });

  /* Escape key */
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();
    }
  });

  /* Reset when returning to desktop */
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
  if (document.getElementById("officer-notification-styles")) {
    return;
  }

  const style = document.createElement("style");

  style.id = "officer-notification-styles";

  style.textContent = `
    /* =====================================================
       OFFICER NOTIFICATION BELL
       Shared across all officer modules
       ===================================================== */

    .nav-right {
      position: relative;
    }


    .bell {
      position: relative;

      cursor: pointer !important;

      width: 38px;
      height: 38px;

      display: grid !important;
      place-items: center;

      border: 0;
      border-radius: 50%;

      background: transparent;

      transition:
        background .15s ease,
        transform .15s ease;

      user-select: none;
    }


    .bell:hover {
      background: #edf5fb !important;
    }


    .bell:active {
      transform: scale(.95);
    }


    .bell:focus-visible {
      outline: 3px solid rgba(23, 183, 232, .22);
      outline-offset: 2px;
    }


    /* =====================================================
       NOTIFICATION PANEL
       ===================================================== */

    .officer-notification-panel {
      position: absolute;

      z-index: 5000;

      top: calc(100% + 8px);
      right: 0;
      left: auto;

      width: min(340px, calc(100vw - 24px));
      max-width: calc(100vw - 24px);
      min-width: 260px;

      height: auto;
      max-height: 70vh;

      overflow-x: hidden;
      overflow-y: auto;

      box-sizing: border-box;

      border: 1px solid #dce6ef;
      border-radius: 14px;

      background: #ffffff;

      box-shadow:
        0 16px 40px rgba(12, 39, 67, .18);
    }


    .officer-notification-panel[hidden] {
      display: none !important;
    }


    /* =====================================================
       PANEL HEADER
       ===================================================== */

    .officer-notification-header {
      width: 100%;
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

      white-space: nowrap;
    }


    .officer-notification-close {
      flex: 0 0 30px;

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


    /* =====================================================
       CONTENT
       ===================================================== */

    .officer-notification-content {
      width: 100%;

      padding: 22px 18px;

      text-align: center;

      color: #65798c;

      font-size: 12px;
      line-height: 1.55;

      white-space: normal;
      word-break: normal;
      overflow-wrap: normal;
    }


    .officer-notification-content strong {
      display: block;

      margin-bottom: 5px;

      color: #274e73;

      font-size: 14px;
      line-height: 1.3;

      white-space: normal;
      word-break: normal;
    }


    .officer-notification-icon {
      margin-bottom: 10px;

      font-size: 28px;
    }


    /* =====================================================
       TABLETS / PHONES
       ===================================================== */

    @media (max-width: 820px) {

      .officer-notification-panel {
        position: absolute !important;

        top: calc(100% + 8px) !important;

        right: 0 !important;
        left: auto !important;

        width: min(330px, calc(100vw - 20px)) !important;
        max-width: calc(100vw - 20px) !important;
        min-width: 250px !important;

        max-height: 65vh !important;
      }

    }


    @media (max-width: 560px) {

      .officer-notification-panel {
        /*
         * IMPORTANT:
         * Keep this ABSOLUTE.
         * The old code used position: fixed here,
         * which caused the broken mobile notification UI.
         */
        position: absolute !important;

        top: calc(100% + 8px) !important;

        right: 0 !important;
        left: auto !important;

        width: min(310px, calc(100vw - 16px)) !important;
        max-width: calc(100vw - 16px) !important;
        min-width: 240px !important;

        max-height: 65vh !important;
      }

    }


    @media (max-width: 360px) {

      .officer-notification-panel {
        width: min(290px, calc(100vw - 12px)) !important;
        max-width: calc(100vw - 12px) !important;

        min-width: 220px !important;
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
   SHARED OFFICER MODULE SEARCH
   ========================================================= */

/* =========================================================
   SHARED OFFICER MODULE SEARCH
   ========================================================= */

function bindOfficerModuleSearch() {

  const input =
    document.getElementById("officerQuickSearch");

  const box =
    document.getElementById("officerSearchBox");

  const results =
    document.getElementById("officerSearchResults");

  const clearBtn =
    document.getElementById("officerSearchClear");


  if (!input || !box || !results) {
    return;
  }


  if (input.dataset.moduleSearchBound === "true") {
    return;
  }


  input.dataset.moduleSearchBound = "true";


  let visibleModules = [];


  function closeResults() {

    results.hidden = true;

    results.innerHTML = "";

    visibleModules = [];
  }


  function openModule(module) {

    if (!module?.href) {
      return;
    }

    window.location.href = module.href;
  }


  function renderResults() {

    const query =
      input.value
        .trim()
        .toLowerCase();


    if (clearBtn) {
      clearBtn.hidden = !query;
    }


    /*
     * Empty search = show every module.
     */
    visibleModules =
      query
        ? OFFICER_MODULES.filter(
            (module) => {

              const searchableText = [
                module.name,
                module.detail,
                module.keywords
              ]
                .join(" ")
                .toLowerCase();


              return searchableText.includes(query);

            }
          )
        : [...OFFICER_MODULES];


    results.hidden = false;


    if (!visibleModules.length) {

      results.innerHTML = `
        <div class="officer-search-empty">
          No matching officer module found.
        </div>
      `;

      return;
    }


    results.innerHTML =
      visibleModules
        .map(
          (module, index) => `

            <button
              class="officer-search-result"
              type="button"
              data-search-index="${index}"
            >

              <i
                class="fa-solid ${module.icon}"
                aria-hidden="true"
              ></i>


              <span>

                <strong>
                  ${module.name}
                </strong>

                <small>
                  ${module.detail}
                </small>

              </span>


              <i
                class="fa-solid fa-chevron-right"
                aria-hidden="true"
              ></i>

            </button>

          `
        )
        .join("");
  }


  /*
   * Clicking search container focuses input.
   */
  box.addEventListener(
    "click",
    (event) => {

      if (
        event.target.closest(
          ".officer-search-clear"
        )
      ) {
        return;
      }


      input.focus();

    }
  );


  /*
   * Tapping search opens module list.
   */
  input.addEventListener(
    "focus",
    renderResults
  );


  /*
   * Search while typing.
   */
  input.addEventListener(
    "input",
    renderResults
  );


  /*
   * Enter opens first matching result.
   */
  input.addEventListener(
    "keydown",
    (event) => {

      if (event.key === "Escape") {

        closeResults();

        input.blur();

        return;
      }


      if (
        event.key === "Enter" &&
        visibleModules.length
      ) {

        event.preventDefault();

        openModule(
          visibleModules[0]
        );

      }

    }
  );


  /*
   * Clicking search result.
   */
  results.addEventListener(
    "click",
    (event) => {

      const button =
        event.target.closest(
          "[data-search-index]"
        );


      if (!button) {
        return;
      }


      const index =
        Number(
          button.dataset.searchIndex
        );


      openModule(
        visibleModules[index]
      );

    }
  );


  /*
   * Clear search.
   */
  clearBtn?.addEventListener(
    "click",
    (event) => {

      event.preventDefault();

      event.stopPropagation();

      input.value = "";

      clearBtn.hidden = true;

      renderResults();

      input.focus();

    }
  );


  /*
   * Close search if tapping elsewhere.
   */
  document.addEventListener(
    "pointerdown",
    (event) => {

      if (
        !box.contains(event.target)
      ) {

        closeResults();

      }

    }
  );
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
bindOfficerModuleSearch();
bindNotificationBell();
});

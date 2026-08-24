const OFFICER_OVERVIEW_PATH = "../overview/overview.html";
const ADMIN_DASHBOARD_PATH = "../admin-dashboard/admin-dashboard.html";
const MOBILE_BREAKPOINT = 1080;

function normalizePath(pathname) {
  return String(pathname || "")
    .replace(/\/+/g, "/")
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
  return normalizePath(window.location.pathname).includes("/usc-admin/admin-dashboard/admin-dashboard");
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

function isMobileViewport() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function openSidebar() {
  if (!isMobileViewport()) {
    return;
  }

  document.body.classList.add("sidebar-open");
  document.querySelector("[data-sidebar-toggle]")?.setAttribute("aria-expanded", "true");
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  document.querySelector("[data-sidebar-toggle]")?.setAttribute("aria-expanded", "false");
}

function toggleSidebar() {
  if (document.body.classList.contains("sidebar-open")) {
    closeSidebar();
    return;
  }

  openSidebar();
}

function bindResponsiveSidebar() {
  const toggleButton = document.querySelector("[data-sidebar-toggle]");
  const overlay = document.querySelector("[data-sidebar-overlay]");
  const sidebarLinks = document.querySelectorAll(".sidebar .nav-btn");
  const sidebar = document.querySelector(".sidebar");

  if (!toggleButton || !overlay || !sidebar) {
    return;
  }

  toggleButton.addEventListener("click", toggleSidebar);
  overlay.addEventListener("click", closeSidebar);

  sidebarLinks.forEach((link) => {
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

document.addEventListener("DOMContentLoaded", () => {
  if (guardAdminFromOfficerPages()) {
    return;
  }

  setActiveSidebarLink();
  bindDataNavButtons();
  bindResponsiveSidebar();
});
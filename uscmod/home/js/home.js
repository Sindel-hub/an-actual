import { db } from "../../firebase/firebase-config.js";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const PREVIEW_LIMIT = 5;
const AUTO_SLIDE_MS = 6000;

const dom = {
  slidesHost: document.getElementById("previewSlidesHost"),
  dotsHost: document.getElementById("previewDots"),
  scrollDownBtn: document.getElementById("scrollDownBtn"),
  welcomeSection: document.getElementById("welcome-section"),
  eventsSection: document.getElementById("events-section"),
  heroEventsFlow: document.querySelector(".hero-events-flow"),
  aboutSection: document.getElementById("about-section"),
  eventsFollowingBackground: document.getElementById("eventsFollowingBackground"),
  topHeader: document.getElementById("topHeader"),
  leftArrow: document.querySelector(".preview-arrow.left"),
  rightArrow: document.querySelector(".preview-arrow.right"),
  calendarTitle: document.getElementById("homeCalendarTitle"),
  calendarGrid: document.getElementById("homeCalendarGrid"),
  eventList: document.getElementById("homeEventList"),
  calendarPrev: document.getElementById("homeCalendarPrev"),
  calendarNext: document.getElementById("homeCalendarNext")
};

const announcementsCollection = collection(db, "announcements");

const homeEventState = {
  events: [],
  currentMonth: null,
  selectedDateKey: ""
};

let previewAnnouncements = [];
let previewCurrentSlide = 0;
let previewTimer = 0;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function truncateText(value, maxLength = 220) {
  const text = safeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

function toDate(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseEventDate(rawValue) {
  const cleanValue = safeText(rawValue);
  if (!cleanValue) return null;
  const date = new Date(`${cleanValue}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value) || parseEventDate(value);
  if (!date) return "Latest update";
  return date.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function normalizeDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDay(left, right) {
  return normalizeDateKey(left) === normalizeDateKey(right);
}

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function setArrowState() {
  const disabled = previewAnnouncements.length <= 1;
  if (dom.leftArrow) dom.leftArrow.disabled = disabled;
  if (dom.rightArrow) dom.rightArrow.disabled = disabled;
}

function buildSlide(announcement, role = "active") {
  const title = safeText(announcement.title, "USC Announcement");
  const imageUrl = safeText(announcement.imageUrl);

  const content = imageUrl
    ? `<div class="announcement-poster"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}"></div>`
    : `
      <div class="announcement-fallback">
        <div class="announcement-fallback-seals">
          <img src="assets/SSUlogo.webp" alt="" onerror="this.style.display='none'">
          <img src="assets/USClogo.webp" alt="" onerror="this.style.display='none'">
        </div>
        <div class="fallback-label">ANNOUNCEMENT</div>
        <h3>${escapeHtml(truncateText(title, 72))}</h3>
        <p>${escapeHtml(truncateText(announcement.content, 150))}</p>
      </div>
    `;

  return `
    <article class="preview-slide ${role}" aria-label="${escapeHtml(title)}">
      ${content}
    </article>
  `;
}

function buildFallbackSlide() {
  return `
    <article class="preview-slide active" aria-label="USC announcements">
      <div class="announcement-fallback">
        <div class="announcement-fallback-seals">
          <img src="assets/SSUlogo.webp" alt="" onerror="this.style.display='none'">
          <img src="assets/USClogo.webp" alt="" onerror="this.style.display='none'">
        </div>
        <div class="fallback-label">UNIVERSITY STUDENT COUNCIL</div>
        <h3>Stay connected with USC</h3>
        <p>Published announcements will appear here automatically.</p>
      </div>
    </article>
  `;
}

function renderDots() {
  if (!dom.dotsHost) return;
  const dotCount = previewAnnouncements.length > 0 ? previewAnnouncements.length : 1;
  dom.dotsHost.innerHTML = Array.from({ length: dotCount }, (_, index) => `
      <button class="preview-dot ${index === previewCurrentSlide ? "active" : ""}" type="button" data-dot-index="${index}" aria-label="Go to announcement ${index + 1}"></button>
    `).join("");
}

function renderCarousel() {
  if (!dom.slidesHost) return;
  if (!previewAnnouncements.length) {
    dom.slidesHost.innerHTML = buildFallbackSlide();
    renderDots();
    setArrowState();
    return;
  }

  const total = previewAnnouncements.length;
  const activeIndex = previewCurrentSlide;
  const prevIndex = (activeIndex - 1 + total) % total;
  const nextIndex = (activeIndex + 1) % total;
  const parts = [];

  if (total > 1) parts.push(buildSlide(previewAnnouncements[prevIndex], "prev"));
  parts.push(buildSlide(previewAnnouncements[activeIndex], "active"));
  if (total > 1) parts.push(buildSlide(previewAnnouncements[nextIndex], "next"));

  dom.slidesHost.innerHTML = parts.join("");
  renderDots();
  setArrowState();
}

function stopAutoSlide() {
  if (previewTimer) {
    window.clearInterval(previewTimer);
    previewTimer = 0;
  }
}

function restartAutoSlide() {
  stopAutoSlide();
  if (previewAnnouncements.length <= 1) return;
  previewTimer = window.setInterval(() => changePreviewSlide(1), AUTO_SLIDE_MS);
}

function changePreviewSlide(direction) {
  const total = previewAnnouncements.length;
  if (total <= 1) {
    previewCurrentSlide = 0;
    renderCarousel();
    return;
  }
  previewCurrentSlide = (previewCurrentSlide + direction + total) % total;
  renderCarousel();
}

function goToPreviewSlide(index) {
  const total = previewAnnouncements.length;
  if (total <= 1) {
    previewCurrentSlide = 0;
    renderCarousel();
    return;
  }
  previewCurrentSlide = ((index % total) + total) % total;
  renderCarousel();
}

function startAnnouncementsListener() {
  const announcementsQuery = query(announcementsCollection, orderBy("createdAtMs", "desc"), limit(PREVIEW_LIMIT));

  onSnapshot(
    announcementsQuery,
    (snapshot) => {
      previewAnnouncements = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      if (previewCurrentSlide >= previewAnnouncements.length) previewCurrentSlide = 0;
      renderCarousel();
      restartAutoSlide();
    },
    (error) => {
      console.error("Landing announcement listener error:", error);
      previewAnnouncements = [];
      previewCurrentSlide = 0;
      renderCarousel();
      restartAutoSlide();
    }
  );
}

function formatMonthTitle(date) {
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function getNearestUpcomingEvent(events) {
  const today = getToday();
  return events.find((eventItem) => {
    const eventDate = parseEventDate(eventItem.eventDate);
    return eventDate && eventDate >= today;
  }) || events[0] || null;
}

function getEventMonthAnchor(events) {
  const nearest = getNearestUpcomingEvent(events);
  const baseDate = parseEventDate(nearest?.eventDate) || getToday();
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
}

function getEventsForDate(dateKey) {
  return homeEventState.events.filter((eventItem) => safeText(eventItem.eventDate) === dateKey);
}

function getEventsForVisibleMonth() {
  if (!homeEventState.currentMonth) return [];
  const month = homeEventState.currentMonth.getMonth();
  const year = homeEventState.currentMonth.getFullYear();
  return homeEventState.events.filter((eventItem) => {
    const eventDate = parseEventDate(eventItem.eventDate);
    return eventDate && eventDate.getMonth() === month && eventDate.getFullYear() === year;
  });
}

function syncHomeCalendarSelection() {
  if (!homeEventState.events.length) {
    homeEventState.selectedDateKey = "";
    homeEventState.currentMonth = new Date(getToday().getFullYear(), getToday().getMonth(), 1);
    return;
  }

  if (!homeEventState.currentMonth) {
    homeEventState.currentMonth = getEventMonthAnchor(homeEventState.events);
  }

  const selectedEvents = getEventsForDate(homeEventState.selectedDateKey);
  if (selectedEvents.length) return;

  const monthEvents = getEventsForVisibleMonth();
  if (monthEvents.length) {
    homeEventState.selectedDateKey = safeText(monthEvents[0].eventDate);
    return;
  }

  const nextEvent = getNearestUpcomingEvent(homeEventState.events);
  homeEventState.selectedDateKey = safeText(nextEvent?.eventDate);
}

function buildHomeEventItem(eventItem, isHighlighted = false) {
  const eventDate = parseEventDate(eventItem.eventDate);
  const monthLabel = eventDate ? eventDate.toLocaleDateString([], { month: "short" }).toUpperCase() : "TBA";
  const dayLabel = eventDate ? String(eventDate.getDate()) : "--";
  const audience = safeText(eventItem.audience, "All Students");
  const reminderText = eventItem.reminderEnabled ? "Reminder on" : "Reminder off";
  const description = truncateText(eventItem.description, 120);

  return `
    <div class="event-item ${isHighlighted ? "highlighted" : ""}">
      <div class="event-date-box">
        <span class="event-month">${escapeHtml(monthLabel)}</span>
        <span class="event-day">${escapeHtml(dayLabel)}</span>
      </div>
      <div class="event-text">
        <h3>${escapeHtml(safeText(eventItem.title, "Untitled Event"))}</h3>
        <p>${escapeHtml(safeText(eventItem.venue, "Venue to be announced"))}</p>
        <div class="event-meta-inline">
          <span>${escapeHtml(audience)}</span>
          <span>${escapeHtml(reminderText)}</span>
          <span>${escapeHtml(formatDate(eventItem.eventDate))}</span>
        </div>
        <div class="event-description">${escapeHtml(description)}</div>
      </div>
    </div>
  `;
}

function renderHomeEventList() {
  if (!dom.eventList) return;

  const monthEvents = getEventsForVisibleMonth();
  const sortedEvents = [...monthEvents]
    .sort((left, right) => safeText(left.eventDate).localeCompare(safeText(right.eventDate)))
    .slice(0, 3);

  if (!sortedEvents.length) {
    dom.eventList.innerHTML = `
      <div class="events-empty">
        <div class="events-empty-card">
          <i class="fa-regular fa-calendar"></i>
          <h3>No events scheduled</h3>
          <p>When officers publish an event, it will appear here automatically.</p>
        </div>
      </div>
    `;
    return;
  }

  dom.eventList.innerHTML = sortedEvents
    .map((eventItem, index) => {
      const matchesSelection = safeText(eventItem.eventDate) === homeEventState.selectedDateKey;
      return buildHomeEventItem(eventItem, matchesSelection || index === 0);
    })
    .join("");
}

function renderHomeCalendar() {
  if (!dom.calendarGrid || !dom.calendarTitle || !homeEventState.currentMonth) return;

  const monthAnchor = homeEventState.currentMonth;
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = getToday();
  const eventDaySet = new Set(
    homeEventState.events
      .filter((eventItem) => {
        const eventDate = parseEventDate(eventItem.eventDate);
        return eventDate && eventDate.getFullYear() === year && eventDate.getMonth() === month;
      })
      .map((eventItem) => safeText(eventItem.eventDate))
  );

  dom.calendarTitle.textContent = formatMonthTitle(monthAnchor);
  const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];
  const cells = weekdayLabels.map((label) => `<div class="day-name">${label}</div>`);

  for (let index = 0; index < firstDay.getDay(); index += 1) {
    cells.push('<button class="day-cell muted empty" type="button" disabled aria-hidden="true"></button>');
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const cellDate = new Date(year, month, day);
    const dateKey = normalizeDateKey(cellDate);
    const classNames = ["day-cell"];
    if (eventDaySet.has(dateKey)) classNames.push("has-event");
    if (isSameDay(cellDate, today)) classNames.push("today");
    if (homeEventState.selectedDateKey === dateKey) classNames.push("selected");

    cells.push(`
      <button class="${classNames.join(" ")}" type="button" data-home-calendar-date="${dateKey}" aria-label="${escapeHtml(formatDate(dateKey))}">${day}</button>
    `);
  }

  const remainder = cells.length % 7;
  if (remainder !== 0) {
    for (let index = remainder; index < 7; index += 1) {
      cells.push('<button class="day-cell muted empty" type="button" disabled aria-hidden="true"></button>');
    }
  }

  dom.calendarGrid.innerHTML = cells.join("");
}

function refreshHomeEvents() {
  syncHomeCalendarSelection();
  renderHomeCalendar();
  renderHomeEventList();
}

function startHomeEventsListener() {
  const eventsQuery = query(collection(db, "events"), orderBy("eventDate", "asc"));

  onSnapshot(
    eventsQuery,
    (snapshot) => {
      homeEventState.events = snapshot.docs
        .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
        .filter((eventItem) => safeText(eventItem.status, "Published") === "Published");
      if (!homeEventState.currentMonth) {
        homeEventState.currentMonth = getEventMonthAnchor(homeEventState.events);
      }
      refreshHomeEvents();
    },
    (error) => {
      console.error("Landing events listener error:", error);
      homeEventState.events = [];
      refreshHomeEvents();
    }
  );
}

function bindDotNavigation() {
  dom.dotsHost?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const dotIndex = target.getAttribute("data-dot-index");
    if (dotIndex !== null) {
      goToPreviewSlide(Number(dotIndex));
      restartAutoSlide();
    }
  });
}

function scrollToSection(section) {
  if (!section) return;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindScrollButton() {
  dom.scrollDownBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    scrollToSection(dom.eventsSection);
  });
}

function bindSectionStepNavigation() {
  const sections = [dom.welcomeSection, dom.eventsSection, dom.aboutSection].filter(Boolean);
  if (sections.length < 3) return;

  let locked = false;
  let unlockTimer = 0;
  let touchStartY = 0;
  let touchStartTarget = null;

  const lockNavigation = () => {
    locked = true;
    window.clearTimeout(unlockTimer);
    unlockTimer = window.setTimeout(() => {
      locked = false;
    }, 760);
  };

  const getNearestSectionIndex = () => {
    const viewportAnchor = window.scrollY + Math.min(window.innerHeight * 0.18, 150);
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    sections.forEach((section, index) => {
      const distance = Math.abs(section.offsetTop - viewportAnchor);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    return bestIndex;
  };

  const canScrollInside = (target, direction) => {
    const scrollable = target instanceof Element ? target.closest(".events-side") : null;
    if (!scrollable) return false;
    if (scrollable.scrollHeight <= scrollable.clientHeight + 2) return false;

    if (direction > 0) {
      return scrollable.scrollTop + scrollable.clientHeight < scrollable.scrollHeight - 2;
    }
    return scrollable.scrollTop > 2;
  };

  const tryStep = (direction, sourceTarget) => {
    if (locked || !direction) return false;
    if (canScrollInside(sourceTarget, direction)) return false;

    const currentIndex = getNearestSectionIndex();

    // Only control the first two downward transitions requested for the landing page.
    if (direction > 0 && currentIndex < sections.length - 1) {
      lockNavigation();
      scrollToSection(sections[currentIndex + 1]);
      return true;
    }

    // Going back up should also move one screen at a time, but only when the
    // current section is already near its top so the About content can still scroll naturally.
    if (direction < 0 && currentIndex > 0) {
      const currentTop = sections[currentIndex].offsetTop;
      const nearSectionTop = window.scrollY <= currentTop + 24;
      if (!nearSectionTop) return false;

      lockNavigation();
      scrollToSection(sections[currentIndex - 1]);
      return true;
    }

    return false;
  };

  window.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) < 18) return;
    const direction = event.deltaY > 0 ? 1 : -1;
    if (tryStep(direction, event.target)) event.preventDefault();
  }, { passive: false });

  window.addEventListener("touchstart", (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    touchStartY = touch.clientY;
    touchStartTarget = event.target;
  }, { passive: true });

  window.addEventListener("touchend", (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const delta = touchStartY - touch.clientY;
    if (Math.abs(delta) < 55) return;
    const direction = delta > 0 ? 1 : -1;
    tryStep(direction, touchStartTarget);
  }, { passive: true });
}

function bindEventsFollowingBackground() {
  const layer = dom.eventsFollowingBackground;
  const flow = dom.heroEventsFlow;
  if (!layer || !flow) return;

  let frameId = 0;

  const update = () => {
    frameId = 0;
    const rect = flow.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    // Reveal the ONE viewport-anchored campus image only through the visible
    // part of the Welcome + Upcoming Events wrapper. The layer is gone before
    // About USC, Goals, and the footer enter the viewport.
    if (rect.bottom <= 0 || rect.top >= viewportHeight) {
      layer.classList.remove("is-visible");
      layer.style.clipPath = "inset(100% 0 0 0)";
      layer.style.webkitClipPath = "inset(100% 0 0 0)";
      return;
    }

    const topClip = Math.max(0, rect.top);
    const bottomClip = Math.max(0, viewportHeight - rect.bottom);
    const clipValue = `inset(${topClip}px 0 ${bottomClip}px 0)`;

    layer.style.clipPath = clipValue;
    layer.style.webkitClipPath = clipValue;
    layer.classList.add("is-visible");
  };

  const requestUpdate = () => {
    if (frameId) return;
    frameId = window.requestAnimationFrame(update);
  };

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate, { passive: true });
  window.addEventListener("orientationchange", requestUpdate, { passive: true });
  requestUpdate();
}

function bindHomeCalendarControls() {
  dom.calendarPrev?.addEventListener("click", () => {
    const current = homeEventState.currentMonth || getToday();
    homeEventState.currentMonth = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    const monthEvents = getEventsForVisibleMonth();
    homeEventState.selectedDateKey = monthEvents.length ? safeText(monthEvents[0].eventDate) : "";
    refreshHomeEvents();
  });

  dom.calendarNext?.addEventListener("click", () => {
    const current = homeEventState.currentMonth || getToday();
    homeEventState.currentMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    const monthEvents = getEventsForVisibleMonth();
    homeEventState.selectedDateKey = monthEvents.length ? safeText(monthEvents[0].eventDate) : "";
    refreshHomeEvents();
  });

  dom.calendarGrid?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-home-calendar-date]") : null;
    if (!target) return;
    homeEventState.selectedDateKey = safeText(target.getAttribute("data-home-calendar-date"));
    refreshHomeEvents();
  });
}

function initLandingAnnouncements() {
  if (!dom.slidesHost || !dom.dotsHost) {
    console.error("Missing preview carousel containers in home/home.html");
    return;
  }

  bindDotNavigation();
  bindScrollButton();
  bindSectionStepNavigation();
  bindEventsFollowingBackground();
  bindHomeCalendarControls();
  renderCarousel();
  startAnnouncementsListener();
  startHomeEventsListener();
}

window.changePreviewSlide = (direction) => {
  changePreviewSlide(direction);
  restartAutoSlide();
};

window.goToPreviewSlide = (index) => {
  goToPreviewSlide(index);
  restartAutoSlide();
};

window.addEventListener("load", initLandingAnnouncements);
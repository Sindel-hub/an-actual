import { auth, db } from "../../firebase/firebase-config.js";
import { collection, limit, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { resolveMediaUrl } from "../../shared/security-client.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const PROFILE_KEY = "studentProfile";
const SESSION_KEY = "activeSession";

let events = [];
let activeIndex = 0;
let heroTouchStartX = 0;
let sectionTouchStartY = 0;
let activeSection = 0;
let calendarMonth = null;
let selectedDateKey = "";
let wheelLocked = false;

const background = document.getElementById("eventsHighlightBackground");
const upcomingBackground = document.getElementById("eventsUpcomingBackground");
const titleEl = document.getElementById("eventsHighlightTitle");
const venueEl = document.getElementById("eventsHighlightVenue");
const dateEl = document.getElementById("eventsHighlightDate");
const dotsEl = document.getElementById("eventsHighlightDots");
const moduleEl = document.getElementById("eventsHighlightModule");
const prevButton = document.getElementById("eventsHighlightPrev");
const nextButton = document.getElementById("eventsHighlightNext");
const snapViewport = document.getElementById("eventsSnapViewport");
const snapTrack = document.getElementById("eventsSnapTrack");
const scrollDownButton = document.getElementById("eventsScrollDown");
const scrollUpButton = document.getElementById("eventsScrollUp");
const upcomingList = document.getElementById("eventsUpcomingList");
const calendarTitle = document.getElementById("eventsCalendarTitle");
const calendarGrid = document.getElementById("eventsCalendarGrid");
const calendarPrev = document.getElementById("eventsCalendarPrev");
const calendarNext = document.getElementById("eventsCalendarNext");

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeUrl(value) {
  return clean(value).replace(/["'()\\]/g, "");
}

function getProfile() {
  try {
    return JSON.parse(sessionStorage.getItem(PROFILE_KEY) || "null");
  } catch {
    return null;
  }
}

function guardStudent() {
  const student = getProfile();
  if (sessionStorage.getItem(SESSION_KEY) !== "true" || !student) {
    location.replace("../index/index.html");
    return null;
  }

  const name = clean(student.fullName, "Student");
  const nameEl = document.getElementById("dashboardUserName");
  const initialsEl = document.getElementById("dashboardUserInitials");
  if (nameEl) nameEl.textContent = name;
  if (initialsEl) {
    initialsEl.textContent = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  }
  return student;
}

function parseEventDate(rawValue) {
  const value = clean(rawValue);
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(rawValue) {
  const date = parseEventDate(rawValue);
  if (!date) return "DATE TO BE ANNOUNCED";
  return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }).toUpperCase();
}

function formatCompactTime(eventItem) {
  const start = clean(eventItem.startTime || eventItem.time || "");
  const end = clean(eventItem.endTime || "");
  if (start && end) return `${start} - ${end}`;
  return start || "Time TBA";
}

function eventSortValue(eventItem) {
  const date = parseEventDate(eventItem.eventDate);
  return date ? date.getTime() : Number.MAX_SAFE_INTEGER;
}

function setSection(index, animate = true) {
  activeSection = Math.max(0, Math.min(1, index));
  if (!snapTrack) return;
  snapTrack.classList.toggle("no-transition", !animate);
  snapTrack.style.transform = `translateY(-${activeSection * 50}%)`;
  if (!animate) requestAnimationFrame(() => snapTrack.classList.remove("no-transition"));
}

function setEmptyState() {
  titleEl.textContent = "No Upcoming Events";
  venueEl.textContent = "Watch this space for the next USC activity";
  dateEl.textContent = "—";
  background.style.backgroundImage = 'url("assets/HomeLogo.webp")';
  if (upcomingBackground) upcomingBackground.style.backgroundImage = 'url("assets/HomeLogo.webp")';
  dotsEl.innerHTML = "";
  prevButton.disabled = true;
  nextButton.disabled = true;
  calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  selectedDateKey = "";
  renderUpcomingSection();
}

function renderDots() {
  if (!dotsEl) return;
  dotsEl.innerHTML = events.map((_, index) => (
    `<button type="button" class="events-highlight-dot${index === activeIndex ? " active" : ""}" data-event-index="${index}" aria-label="Show event ${index + 1}"></button>`
  )).join("");
}

function syncCalendarToActiveEvent(force = false) {
  const active = events[activeIndex];
  const activeDate = parseEventDate(active?.eventDate);
  if (!activeDate) return;
  const activeKey = normalizeDateKey(activeDate);
  selectedDateKey = activeKey;
  if (!calendarMonth || force || calendarMonth.getMonth() !== activeDate.getMonth() || calendarMonth.getFullYear() !== activeDate.getFullYear()) {
    calendarMonth = new Date(activeDate.getFullYear(), activeDate.getMonth(), 1);
  }
}

function renderActiveEvent() {
  if (!events.length) {
    setEmptyState();
    return;
  }

  if (activeIndex < 0) activeIndex = events.length - 1;
  if (activeIndex >= events.length) activeIndex = 0;

  const eventItem = events[activeIndex];
  const title = clean(eventItem.title, "USC Event");
  const venue = clean(eventItem.venue, "Samar State University");
  const date = formatDate(eventItem.eventDate);
  const mediaRef = eventItem.imageUrl || eventItem.posterUrl || "assets/HomeLogo.webp";
  const imageUrl = escapeUrl(mediaRef);

  titleEl.textContent = title;
  venueEl.textContent = venue;
  dateEl.textContent = date;
  background.style.backgroundImage = `url("${imageUrl}")`;
  if (upcomingBackground) upcomingBackground.style.backgroundImage = `url("${imageUrl}")`;
  resolveMediaUrl(mediaRef).then((url) => {
    background.style.backgroundImage = `url("${url}")`;
    if (upcomingBackground) upcomingBackground.style.backgroundImage = `url("${url}")`;
  }).catch(() => {});

  const disabled = events.length <= 1;
  prevButton.disabled = disabled;
  nextButton.disabled = disabled;
  syncCalendarToActiveEvent();
  renderDots();
  renderUpcomingSection();
}

function move(direction) {
  if (events.length <= 1) return;
  activeIndex = (activeIndex + direction + events.length) % events.length;
  renderActiveEvent();
}

function eventsForVisibleMonth() {
  if (!calendarMonth) return [];
  const month = calendarMonth.getMonth();
  const year = calendarMonth.getFullYear();
  return events.filter((eventItem) => {
    const date = parseEventDate(eventItem.eventDate);
    return date && date.getMonth() === month && date.getFullYear() === year;
  });
}

function renderUpcomingList() {
  if (!upcomingList) return;
  const monthEvents = eventsForVisibleMonth();
  let candidates = monthEvents.length ? monthEvents : events;
  candidates = [...candidates]
    .sort((a, b) => eventSortValue(a) - eventSortValue(b))
    .slice(0, 3);

  if (!candidates.length) {
    upcomingList.innerHTML = `
      <div class="events-upcoming-empty">
        <i class="fa-regular fa-calendar"></i>
        <strong>No upcoming events yet</strong>
        <span>Published USC events will appear here automatically.</span>
      </div>`;
    return;
  }

  upcomingList.innerHTML = candidates.map((eventItem) => {
    const date = parseEventDate(eventItem.eventDate);
    const dateText = date ? date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }) : "Date TBA";
    const selected = clean(eventItem.eventDate) === selectedDateKey;
    return `
      <button class="events-upcoming-card${selected ? " selected" : ""}" type="button" data-event-id="${escapeHtml(eventItem.id)}">
        <span class="events-upcoming-card-accent" aria-hidden="true"></span>
        <span class="events-upcoming-card-copy">
          <small>${escapeHtml(clean(eventItem.subtitle || eventItem.category, "The Grand Meeting de Avance"))}</small>
          <strong>${escapeHtml(clean(eventItem.title, "USC Event"))}</strong>
          <span>${escapeHtml(dateText)} | ${escapeHtml(formatCompactTime(eventItem))}</span>
          <span>Venue: ${escapeHtml(clean(eventItem.venue, "To be announced"))}</span>
        </span>
      </button>`;
  }).join("");
}

function renderCalendar() {
  if (!calendarMonth || !calendarTitle || !calendarGrid) return;
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  calendarTitle.textContent = calendarMonth.toLocaleDateString([], { month: "long", year: "numeric" });
  const eventDates = new Set(events.map((item) => clean(item.eventDate)).filter(Boolean));
  const cells = ["S", "M", "T", "W", "T", "F", "S"].map((label) => `<div class="events-calendar-day-name">${label}</div>`);

  const previousMonthLast = new Date(year, month, 0).getDate();
  for (let offset = firstDay.getDay(); offset > 0; offset -= 1) {
    cells.push(`<div class="events-calendar-day muted">${previousMonthLast - offset + 1}</div>`);
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, month, day);
    const key = normalizeDateKey(date);
    const classes = ["events-calendar-day"];
    if (eventDates.has(key)) classes.push("has-event");
    if (key === selectedDateKey) classes.push("selected");
    if (date.getTime() === today.getTime()) classes.push("today");
    cells.push(`<button class="${classes.join(" ")}" type="button" data-calendar-date="${key}">${day}</button>`);
  }

  const used = firstDay.getDay() + lastDay.getDate();
  const trailing = (7 - (used % 7)) % 7;
  for (let day = 1; day <= trailing; day += 1) {
    cells.push(`<div class="events-calendar-day muted">${day}</div>`);
  }

  calendarGrid.innerHTML = cells.join("");
}

function renderUpcomingSection() {
  if (!calendarMonth) {
    const firstDate = parseEventDate(events[0]?.eventDate) || new Date();
    calendarMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  }
  renderUpcomingList();
  renderCalendar();
}

function selectEventById(id) {
  const index = events.findIndex((item) => item.id === id);
  if (index < 0) return;
  activeIndex = index;
  renderActiveEvent();
}

function bindSectionNavigation() {
  scrollDownButton?.addEventListener("click", () => setSection(1));
  scrollUpButton?.addEventListener("click", () => setSection(0));

  snapViewport?.addEventListener("wheel", (event) => {
    if (wheelLocked || Math.abs(event.deltaY) < 16) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".events-upcoming-calendar button, .events-upcoming-card, .events-highlight-nav, .events-highlight-dot")) return;
    if (event.deltaY > 0 && activeSection === 0) {
      event.preventDefault();
      setSection(1);
    } else if (event.deltaY < 0 && activeSection === 1) {
      event.preventDefault();
      setSection(0);
    } else {
      return;
    }
    wheelLocked = true;
    window.setTimeout(() => { wheelLocked = false; }, 650);
  }, { passive: false });

  snapViewport?.addEventListener("touchstart", (event) => {
    sectionTouchStartY = event.changedTouches[0]?.clientY || 0;
  }, { passive: true });

  snapViewport?.addEventListener("touchend", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a")) return;
    const endY = event.changedTouches[0]?.clientY || sectionTouchStartY;
    const distance = endY - sectionTouchStartY;
    if (Math.abs(distance) < 60) return;
    if (distance < 0 && activeSection === 0) setSection(1);
    if (distance > 0 && activeSection === 1) setSection(0);
  }, { passive: true });
}

guardStudent();
setSection(0, false);
bindSectionNavigation();

onSnapshot(
  query(collection(db, "events"), orderBy("eventDate", "asc"), limit(30)),
  (snapshot) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const allEvents = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((eventItem) => clean(eventItem.status, "Published") === "Published")
      .sort((a, b) => eventSortValue(a) - eventSortValue(b));

    const upcoming = allEvents.filter((eventItem) => {
      const date = parseEventDate(eventItem.eventDate);
      return !date || date >= now;
    });

    events = upcoming.length ? upcoming : allEvents.slice(-6);
    activeIndex = Math.min(activeIndex, Math.max(0, events.length - 1));
    if (events.length) syncCalendarToActiveEvent(true);
    renderActiveEvent();
  },
  (error) => {
    console.error("Unable to load student events:", error);
    events = [];
    setEmptyState();
  }
);

prevButton?.addEventListener("click", () => move(-1));
nextButton?.addEventListener("click", () => move(1));

dotsEl?.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-event-index]");
  if (!button) return;
  activeIndex = Number(button.dataset.eventIndex) || 0;
  renderActiveEvent();
});

moduleEl?.addEventListener("touchstart", (event) => {
  heroTouchStartX = event.changedTouches[0]?.clientX || 0;
}, { passive: true });

moduleEl?.addEventListener("touchend", (event) => {
  const endX = event.changedTouches[0]?.clientX || heroTouchStartX;
  const distance = endX - heroTouchStartX;
  if (Math.abs(distance) < 50) return;
  move(distance < 0 ? 1 : -1);
}, { passive: true });

upcomingList?.addEventListener("click", (event) => {
  const card = event.target.closest?.("[data-event-id]");
  if (!card) return;
  selectEventById(card.dataset.eventId);
});

calendarGrid?.addEventListener("click", (event) => {
  const dayButton = event.target.closest?.("[data-calendar-date]");
  if (!dayButton) return;
  selectedDateKey = clean(dayButton.dataset.calendarDate);
  const matching = events.find((item) => clean(item.eventDate) === selectedDateKey);
  if (matching) activeIndex = events.findIndex((item) => item.id === matching.id);
  renderUpcomingSection();
});

calendarPrev?.addEventListener("click", () => {
  if (!calendarMonth) return;
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  selectedDateKey = "";
  renderUpcomingSection();
});

calendarNext?.addEventListener("click", () => {
  if (!calendarMonth) return;
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  selectedDateKey = "";
  renderUpcomingSection();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") move(-1);
  if (event.key === "ArrowRight") move(1);
  if ((event.key === "ArrowDown" || event.key === "PageDown") && activeSection === 0) setSection(1);
  if ((event.key === "ArrowUp" || event.key === "PageUp") && activeSection === 1) setSection(0);
});

document.getElementById("studentLogout")?.addEventListener("click", async () => {
  sessionStorage.clear();
  try { await signOut(auth); } catch {}
  location.replace("../index/index.html");
});

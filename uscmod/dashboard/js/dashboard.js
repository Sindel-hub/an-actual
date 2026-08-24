import { auth, db } from "../../firebase/firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { callSecure, hydrateMediaImages, resolveMediaUrl } from "../../shared/security-client.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const SESSION_FLAG_KEY = "activeSession";
const SESSION_PROFILE_KEY = "studentProfile";
const SESSION_EXPIRES_AT_KEY = "sessionExpiresAt";
const LAST_ACTIVITY_AT_KEY = "lastActivityAt";
const ANNOUNCEMENT_LIMIT = 10;
const dashboardEventState = {
  events: [],
  currentMonth: null,
  selectedDateKey: ""
};

let dashboardAnnouncements = [];
let activeSlideIndex = 0;
let autoSlideTimer = 0;

let dashboardBackGuardArmed = true;
let dashboardLogoutInProgress = false;
let dashboardBackPromptLocked = false;

function getStudentProfile() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_PROFILE_KEY) || "null");
  } catch (error) {
    console.error("Unable to parse student session:", error);
    return null;
  }
}

function isStudentSessionActive() {
  return sessionStorage.getItem(SESSION_FLAG_KEY) === "true";
}

function clearStudentSession() {
  sessionStorage.removeItem(SESSION_FLAG_KEY);
  sessionStorage.removeItem(SESSION_PROFILE_KEY);
  sessionStorage.removeItem(SESSION_EXPIRES_AT_KEY);
  sessionStorage.removeItem(LAST_ACTIVITY_AT_KEY);
}

function pushDashboardGuardState() {
  window.history.pushState(
    { dashboardGuard: true, stamp: Date.now() },
    "",
    window.location.href
  );
}

function armDashboardBackButtonWarning() {
  window.history.replaceState(
    { dashboardGuardRoot: true, stamp: Date.now() },
    "",
    window.location.href
  );

  pushDashboardGuardState();

  window.addEventListener("popstate", () => {
    if (!dashboardBackGuardArmed || dashboardLogoutInProgress) {
      return;
    }

    pushDashboardGuardState();

    if (dashboardBackPromptLocked) {
      return;
    }

    dashboardBackPromptLocked = true;

    window.alert(
      "You are still logged in.\n\nPlease use the Log Out button to exit the Student Dashboard."
    );

    setTimeout(() => {
      dashboardBackPromptLocked = false;
    }, 0);
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getInitials(name = "Student") {
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "ST";
}

function safeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function truncateText(value, maxLength = 180) {
  const text = safeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

function toValidDate(value) {
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
  const date = toValidDate(value) || parseEventDate(value);
  if (!date) return "Latest update";
  return date.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function formatDateTime(value, fallback = "No updates yet") {
  const date = toValidDate(value) || parseEventDate(value);
  if (!date) return fallback;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getDateMs(value) {
  return (toValidDate(value) || parseEventDate(value))?.getTime() || 0;
}

function getAnnouncementElements() {
  return {
    slidesHost: document.getElementById("announcementSlides"),
    dotsHost: document.getElementById("sliderDots")
  };
}

function getVoteElements() {
  return {
    eligibleVoters: document.getElementById("dashboardEligibleVoters"),
    votesCast: document.getElementById("dashboardVotesCast"),
    turnoutRate: document.getElementById("dashboardTurnoutRate"),
    turnoutProgress: document.getElementById("dashboardTurnoutProgress"),
    voteStatus: document.getElementById("dashboardVoteStatus"),
    voteLeaders: document.getElementById("dashboardVoteLeaders")
  };
}

function getProfileElements() {
  return {
    dashboardUserName: document.getElementById("dashboardUserName"),
    dashboardUserInitials: document.getElementById("dashboardUserInitials"),
    sidebarGreeting: document.getElementById("sidebarGreeting"),
    sidebarStudentId: document.getElementById("sidebarStudentId"),
    heroWelcomeRole: document.getElementById("heroWelcomeRole"),
    heroWelcomeName: document.getElementById("heroWelcomeName"),
    dashboardToday: document.getElementById("dashboardToday")
  };
}

function getTracklistElements() {
  return {
    totalCases: document.getElementById("tracklistTotalCases"),
    activeCases: document.getElementById("tracklistActiveCases"),
    resolvedCases: document.getElementById("tracklistResolvedCases"),
    latestUpdate: document.getElementById("tracklistLatestUpdate"),
    list: document.getElementById("studentTracklist"),
    empty: document.getElementById("studentTracklistEmpty")
  };
}

function getDashboardEventElements() {
  return {
    title: document.getElementById("dashboardCalendarTitle"),
    grid: document.getElementById("dashboardCalendarGrid"),
    list: document.getElementById("dashboardEventList"),
    prev: document.getElementById("dashboardCalendarPrev"),
    next: document.getElementById("dashboardCalendarNext"),
    jump: document.getElementById("dashboardJumpNextEvent")
  };
}

function redirectToLogin() {
  window.location.replace("../index/index.html");
}

function closeSidebarIfMobile() {
  if (window.innerWidth <= 1100) {
    document.body.classList.remove("sidebar-expanded");
  }
}

function applyStudentProfile() {
  if (!isStudentSessionActive()) {
    redirectToLogin();
    return null;
  }

  const profile = getStudentProfile();
  if (!profile) {
    clearStudentSession();
    redirectToLogin();
    return null;
  }

  const fullName = safeText(profile.fullName, "Student");
  const studentId = safeText(profile.studentId, "Student account");
  const initials = getInitials(fullName);
  const profileEls = getProfileElements();

  if (profileEls.dashboardUserName) profileEls.dashboardUserName.textContent = fullName;
  if (profileEls.dashboardUserInitials) profileEls.dashboardUserInitials.textContent = initials;
  if (profileEls.sidebarGreeting) {
    profileEls.sidebarGreeting.innerHTML = `HELLO,<br>${escapeHtml(fullName).toUpperCase()}`;
  }
  if (profileEls.sidebarStudentId) profileEls.sidebarStudentId.textContent = studentId;
  if (profileEls.heroWelcomeRole) profileEls.heroWelcomeRole.textContent = "Student";
  if (profileEls.heroWelcomeName) profileEls.heroWelcomeName.textContent = fullName;
  if (profileEls.dashboardToday) {
    profileEls.dashboardToday.textContent = new Date().toLocaleDateString([], {
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  return profile;
}

function buildAnnouncementCard(announcement) {
  const category = safeText(announcement.category, "Official Notice");
  const publishedDate = formatDate(announcement.createdAt || announcement.createdAtMs);
  const title = safeText(announcement.title, "Untitled announcement");
  const imageMarkup = safeText(announcement.imageUrl)
    ? `<div class="announcement-image-wrap"><img class="announcement-image" src="${escapeHtml(announcement.imageUrl)}" alt="${escapeHtml(title)}"></div>`
    : `<div class="announcement-image-wrap no-image"><div class="announcement-image-placeholder"><i class="fa-regular fa-image"></i><span>No image uploaded</span></div></div>`;

  return `
    <article class="announcement-card">
      <div class="announcement-card-shell">
        <div class="announcement-media-column">${imageMarkup}</div>
        <div class="announcement-card-body">
          <div class="announcement-meta">
            <span class="announcement-chip">${escapeHtml(category)}</span>
            <span class="announcement-date">${escapeHtml(publishedDate)}</span>
          </div>
          <h3>${escapeHtml(title)}</h3>
          <div class="announcement-copy-panel"><p>${escapeHtml(truncateText(announcement.content, 150))}</p></div>
          <div class="announcement-footer">
            <button class="announcement-read-more" type="button" data-announcement-id="${escapeHtml(announcement.id)}">Read more</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function setVoteStats(turnoutData = {}, voterStatus = {}, electionContext = {}) {
  const els = getVoteElements();
  const totalVotes = Number(turnoutData.ballotsCast || 0);
  const eligibleVoters = Number(turnoutData.eligibleVoters || electionContext.eligibleVoterCount || 0);
  const turnout = eligibleVoters > 0 ? (totalVotes / eligibleVoters) * 100 : 0;
  if (els.eligibleVoters) els.eligibleVoters.textContent = String(eligibleVoters);
  if (els.votesCast) els.votesCast.textContent = String(totalVotes);
  if (els.turnoutRate) els.turnoutRate.textContent = `${turnout.toFixed(1)}%`;
  if (els.turnoutProgress) {
    els.turnoutProgress.textContent = `${totalVotes} / ${eligibleVoters}`;
    els.turnoutProgress.style.width = `${Math.min(turnout, 100)}%`;
  }
  if (els.voteLeaders) {
    els.voteLeaders.textContent = electionContext.resultsVisible
      ? "Official results are available in the Election module."
      : "Candidate totals are hidden until official result publication.";
  }
  if (els.voteStatus) {
    els.voteStatus.textContent = voterStatus?.hasVoted
      ? `Ballot recorded. Receipt: ${safeText(voterStatus.receiptReference, "Recorded")}`
      : (electionContext.votingOpen ? "Voting is open. Your ballot has not been submitted yet." : "No ballot recorded for this election.");
  }
}

function getComplaintStatusClass(status) {
  const normalizedStatus = safeText(status, "Submitted");
  const map = {
    Submitted: "submitted",
    "Under Review": "review",
    "In Progress": "progress",
    Resolved: "resolved",
    Closed: "closed"
  };
  return map[normalizedStatus] || "submitted";
}

function getLatestThreadEntry(complaint) {
  return Array.isArray(complaint?.thread) && complaint.thread.length ? complaint.thread[complaint.thread.length - 1] : null;
}

function getComplaintUpdatedValue(complaint) {
  return complaint?.updatedAt || complaint?.createdAt || null;
}

function getTracklistProgressLabel(status) {
  const normalizedStatus = safeText(status, "Submitted");
  const map = {
    Submitted: "Case received by USC",
    "Under Review": "Case is being assessed",
    "In Progress": "Officer action ongoing",
    Resolved: "Case resolved",
    Closed: "Case closed"
  };
  return map[normalizedStatus] || "Case received by USC";
}

function buildTracklistCard(complaint) {
  const complaintRef = safeText(complaint.complaintRef, complaint.id || "—");
  const status = safeText(complaint.status, "Submitted");
  const statusClass = getComplaintStatusClass(status);
  const category = safeText(complaint.category, "General Concern");
  const subject = safeText(complaint.subject, "Untitled complaint");
  const details = truncateText(complaint.details, 170);
  const incidentDate = complaint.incidentDate ? formatDate(complaint.incidentDate) : "Not specified";
  const submittedAt = formatDateTime(complaint.createdAt, "No submission date");
  const latestUpdate = formatDateTime(getComplaintUpdatedValue(complaint));
  const lastEntry = getLatestThreadEntry(complaint);
  const lastActor = safeText(lastEntry?.by, "System");
  const lastMessage = truncateText(lastEntry?.message || "No thread updates yet.", 150);
  const lastMessageTime = formatDateTime(lastEntry?.at, "Recent");

  return `
    <article class="track-item ${statusClass}">
      <div class="track-item-head">
        <div>
          <div class="track-item-ref">${escapeHtml(complaintRef)}</div>
          <h3>${escapeHtml(subject)}</h3>
          <p class="track-item-meta">
            <span><i class="fa-regular fa-folder-open"></i>${escapeHtml(category)}</span>
            <span><i class="fa-regular fa-calendar"></i>${escapeHtml(submittedAt)}</span>
          </p>
        </div>
        <span class="track-status ${statusClass}">${escapeHtml(status)}</span>
      </div>
      <p class="track-item-details">${escapeHtml(details)}</p>
      <div class="track-item-chips">
        <div class="track-item-chip"><i class="fa-regular fa-clock"></i><span>${escapeHtml(getTracklistProgressLabel(status))}</span></div>
        <div class="track-item-chip"><i class="fa-regular fa-calendar-days"></i><span>Incident: ${escapeHtml(incidentDate)}</span></div>
      </div>
      <div class="track-item-grid">
        <div class="track-mini-card"><small>Latest update</small><strong>${escapeHtml(latestUpdate)}</strong></div>
        <div class="track-mini-card"><small>Last reply source</small><strong>${escapeHtml(lastActor)}</strong></div>
      </div>
      <div class="track-thread-preview ${lastActor === "Officer" ? "officer" : "student"}">
        <div class="track-thread-head"><strong>${escapeHtml(lastActor)} update</strong><span>${escapeHtml(lastMessageTime)}</span></div>
        <p>${escapeHtml(lastMessage)}</p>
      </div>
    </article>
  `;
}

function renderTracklist(complaints) {
  const els = getTracklistElements();
  const totalCases = complaints.length;
  const activeCases = complaints.filter((item) => ["Submitted", "Under Review", "In Progress"].includes(safeText(item.status))).length;
  const resolvedCases = complaints.filter((item) => ["Resolved", "Closed"].includes(safeText(item.status))).length;
  const latestCase = complaints[0] || null;

  if (els.totalCases) els.totalCases.textContent = String(totalCases).padStart(2, "0");
  if (els.activeCases) els.activeCases.textContent = String(activeCases);
  if (els.resolvedCases) els.resolvedCases.textContent = String(resolvedCases);
  if (els.latestUpdate) {
    els.latestUpdate.textContent = latestCase ? formatDateTime(getComplaintUpdatedValue(latestCase)) : "No updates yet";
  }
  if (els.list) els.list.innerHTML = complaints.map(buildTracklistCard).join("");
  if (els.empty) els.empty.style.display = complaints.length ? "none" : "flex";
  if (els.list) els.list.style.display = complaints.length ? "grid" : "none";
}

function startComplaintTracklistListener(studentProfile) {
  const studentUid = safeText(studentProfile?.uid);
  if (!studentUid) {
    renderTracklist([]);
    return;
  }

  const complaintsQuery = query(collection(db, "complaints"), where("studentUid", "==", studentUid));
  onSnapshot(
    complaintsQuery,
    (snapshot) => {
      const complaints = snapshot.docs
        .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
        .sort((left, right) => getDateMs(getComplaintUpdatedValue(right)) - getDateMs(getComplaintUpdatedValue(left)));
      renderTracklist(complaints);
    },
    (error) => {
      console.error("Dashboard tracklist listener error:", error);
      renderTracklist([]);
    }
  );
}

function updateSlider() {
  const els = getAnnouncementElements();
  const slides = Array.from(els.slidesHost?.querySelectorAll(".announcement-slide") || []);
  const dots = Array.from(els.dotsHost?.querySelectorAll(".slider-dot") || []);
  if (!slides.length) return;
  slides.forEach((slide) => slide.classList.remove("active"));
  dots.forEach((dot) => dot.classList.remove("active"));
  slides[activeSlideIndex]?.classList.add("active");
  dots[activeSlideIndex]?.classList.add("active");
}

function goToSlide(index) {
  const total = dashboardAnnouncements.length || 1;
  activeSlideIndex = ((index % total) + total) % total;
  updateSlider();
}

function changeSlide(direction) {
  goToSlide(activeSlideIndex + direction);
}

function restartSlider() {
  if (autoSlideTimer) window.clearInterval(autoSlideTimer);
  autoSlideTimer = window.setInterval(() => {
    if (dashboardAnnouncements.length > 1) changeSlide(1);
  }, 6500);
}

function renderSlider() {
  const els = getAnnouncementElements();
  if (!els.slidesHost || !els.dotsHost) return;

  if (!dashboardAnnouncements.length) {
    els.slidesHost.innerHTML = `
      <section class="announcement-slide active">
        <article class="announcement-card">
          <div class="announcement-card-shell">
            <div class="announcement-media-column">
              <div class="announcement-image-wrap no-image">
                <div class="announcement-image-placeholder">Waiting for announcements</div>
              </div>
            </div>
            <div class="announcement-card-body">
              <div class="announcement-meta">
                <span class="announcement-chip">Official Notice</span>
                <span class="announcement-chip soft">All students</span>
                <span class="announcement-date"><i class="fa-regular fa-calendar"></i> Live feed</span>
              </div>
              <h3>No announcements yet</h3>
              <div class="announcement-copy-panel"><p>Announcements posted by the USC admin will appear here automatically.</p></div>
            </div>
          </div>
        </article>
      </section>
    `;
    els.dotsHost.innerHTML = `<button class="slider-dot active" type="button" aria-label="Announcement 1"></button>`;
    return;
  }

  els.slidesHost.innerHTML = dashboardAnnouncements
    .map((announcement, index) => `
      <section class="announcement-slide ${index === activeSlideIndex ? "active" : ""}">${buildAnnouncementCard(announcement)}</section>
    `)
    .join("");
  hydrateMediaImages(els.slidesHost).catch(() => {});

  els.dotsHost.innerHTML = dashboardAnnouncements
    .map((_, index) => `
      <button class="slider-dot ${index === activeSlideIndex ? "active" : ""}" type="button" data-slide-index="${index}" aria-label="Announcement ${index + 1}"></button>
    `)
    .join("");
}

function openAnnouncementModal(announcement) {
  const modal = document.getElementById("dashboardAnnouncementModal");
  const modalImage = document.getElementById("dashboardModalImage");
  const modalCategory = document.getElementById("dashboardModalCategory");
  const modalDate = document.getElementById("dashboardModalDate");
  const modalTitle = document.getElementById("dashboardModalTitle");
  const modalAudience = document.getElementById("dashboardModalAudience");
  const modalContent = document.getElementById("dashboardModalContent");
  if (!modal) return;

  if (modalImage) {
    if (safeText(announcement.imageUrl)) {
      modalImage.src = announcement.imageUrl;
      resolveMediaUrl(announcement.imageUrl).then((url) => { modalImage.src = url; }).catch(() => {});
      modalImage.alt = safeText(announcement.title, "Announcement image");
      modalImage.classList.remove("hidden");
    } else {
      modalImage.removeAttribute("src");
      modalImage.classList.add("hidden");
    }
  }

  if (modalCategory) modalCategory.textContent = safeText(announcement.category, "Official Notice");
  if (modalDate) modalDate.textContent = formatDate(announcement.createdAt || announcement.createdAtMs);
  if (modalTitle) modalTitle.textContent = safeText(announcement.title, "Announcement");
  if (modalAudience) modalAudience.textContent = safeText(announcement.audience, "All students");
  if (modalContent) modalContent.textContent = safeText(announcement.content, "");

  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeAnnouncementModal() {
  const modal = document.getElementById("dashboardAnnouncementModal");
  if (modal) modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function formatMonthTitle(date) {
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
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
  return dashboardEventState.events.filter((eventItem) => safeText(eventItem.eventDate) === dateKey);
}

function getEventsForVisibleMonth() {
  if (!dashboardEventState.currentMonth) return [];
  const month = dashboardEventState.currentMonth.getMonth();
  const year = dashboardEventState.currentMonth.getFullYear();
  return dashboardEventState.events.filter((eventItem) => {
    const eventDate = parseEventDate(eventItem.eventDate);
    return eventDate && eventDate.getMonth() === month && eventDate.getFullYear() === year;
  });
}

function buildDashboardEventItem(eventItem, isHighlighted = false) {
  const eventDate = parseEventDate(eventItem.eventDate);
  const monthLabel = eventDate
    ? eventDate.toLocaleDateString([], { month: "short" }).toUpperCase()
    : "TBA";
  const dayLabel = eventDate ? String(eventDate.getDate()) : "--";
  const audience = safeText(eventItem.audience, "All Students");
  const reminderText = eventItem.reminderEnabled ? "Reminder on" : "Reminder off";
  const description = truncateText(eventItem.description, 120);

  return `
    <article class="event-item ${isHighlighted ? "highlighted" : ""}">
      <div class="event-date">
        <span class="month">${escapeHtml(monthLabel)}</span>
        <span class="day">${escapeHtml(dayLabel)}</span>
      </div>
      <div class="event-copy">
        <h4>${escapeHtml(safeText(eventItem.title, "Untitled Event"))}</h4>
        <p>${escapeHtml(safeText(eventItem.venue, "Venue to be announced"))}</p>
        <div class="event-meta-inline">
          <span>${escapeHtml(audience)}</span>
          <span>${escapeHtml(reminderText)}</span>
          <span>${escapeHtml(formatDate(eventItem.eventDate))}</span>
        </div>
        <div class="event-description">${escapeHtml(description)}</div>
      </div>
    </article>
  `;
}

function renderDashboardEventList() {
  const { list } = getDashboardEventElements();
  if (!list) return;

  const selectedEvents = dashboardEventState.selectedDateKey
    ? getEventsForDate(dashboardEventState.selectedDateKey)
    : [];
  const monthEvents = getEventsForVisibleMonth();
  const eventsToRender = selectedEvents.length ? selectedEvents : monthEvents;

  if (!eventsToRender.length) {
    list.innerHTML = `
      <div class="events-empty">
        <div class="events-empty-card">
          <i class="fa-regular fa-calendar"></i>
          <h3>No events scheduled</h3>
          <p>When an officer publishes an event, it will appear here automatically.</p>
        </div>
      </div>
    `;
    return;
  }

  const sortedEvents = [...eventsToRender].sort((left, right) => safeText(left.eventDate).localeCompare(safeText(right.eventDate)));
  list.innerHTML = sortedEvents
    .map((eventItem, index) => buildDashboardEventItem(eventItem, index === 0))
    .join("");
}

function renderDashboardCalendar() {
  const { title, grid } = getDashboardEventElements();
  if (!title || !grid || !dashboardEventState.currentMonth) return;

  const monthAnchor = dashboardEventState.currentMonth;
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 0 + 1, 0);
  const today = getToday();
  const eventDaySet = new Set(
    dashboardEventState.events
      .filter((eventItem) => {
        const eventDate = parseEventDate(eventItem.eventDate);
        return eventDate && eventDate.getFullYear() === year && eventDate.getMonth() === month;
      })
      .map((eventItem) => safeText(eventItem.eventDate))
  );

  title.textContent = formatMonthTitle(monthAnchor);

  const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];
  const cells = weekdayLabels.map((label) => `<div class="day-head">${label}</div>`);

  for (let index = 0; index < firstDay.getDay(); index += 1) {
    cells.push('<button class="day-cell muted empty" type="button" disabled aria-hidden="true"></button>');
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const cellDate = new Date(year, month, day);
    const dateKey = normalizeDateKey(cellDate);
    const classNames = ["day-cell"];

    if (eventDaySet.has(dateKey)) classNames.push("has-event");
    if (isSameDay(cellDate, today)) classNames.push("today");
    if (dashboardEventState.selectedDateKey === dateKey) classNames.push("selected");

    cells.push(`
      <button class="${classNames.join(" ")}" type="button" data-calendar-date="${dateKey}" aria-label="${escapeHtml(formatDate(dateKey))}">
        ${day}
      </button>
    `);
  }

  const remainder = cells.length % 7;
  if (remainder !== 0) {
    for (let index = remainder; index < 7; index += 1) {
      cells.push('<button class="day-cell muted empty" type="button" disabled aria-hidden="true"></button>');
    }
  }

  grid.innerHTML = cells.join("");
}

function syncDashboardCalendarSelection() {
  if (!dashboardEventState.events.length) {
    dashboardEventState.selectedDateKey = "";
    dashboardEventState.currentMonth = new Date(getToday().getFullYear(), getToday().getMonth(), 1);
    return;
  }

  const visibleMonthDate = dashboardEventState.currentMonth || getEventMonthAnchor(dashboardEventState.events);
  dashboardEventState.currentMonth = new Date(visibleMonthDate.getFullYear(), visibleMonthDate.getMonth(), 1);

  const selectedEvents = getEventsForDate(dashboardEventState.selectedDateKey);
  if (selectedEvents.length) return;

  const monthEvents = getEventsForVisibleMonth();
  if (monthEvents.length) {
    dashboardEventState.selectedDateKey = safeText(monthEvents[0].eventDate);
    return;
  }

  const nextEvent = getNearestUpcomingEvent(dashboardEventState.events);
  dashboardEventState.selectedDateKey = safeText(nextEvent?.eventDate);
}

function refreshDashboardEvents() {
  syncDashboardCalendarSelection();
  renderDashboardCalendar();
  renderDashboardEventList();
}

function startDashboardEventsListener() {
  const eventsQuery = query(collection(db, "events"), orderBy("eventDate", "asc"));
  onSnapshot(
    eventsQuery,
    (snapshot) => {
      dashboardEventState.events = snapshot.docs
        .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
        .filter((eventItem) => safeText(eventItem.status, "Published") === "Published");
      if (!dashboardEventState.currentMonth) {
        dashboardEventState.currentMonth = getEventMonthAnchor(dashboardEventState.events);
      }
      refreshDashboardEvents();
    },
    (error) => {
      console.error("Dashboard events listener error:", error);
      dashboardEventState.events = [];
      refreshDashboardEvents();
    }
  );
}

function bindDashboardEventControls() {
  const { prev, next, jump, grid } = getDashboardEventElements();

  prev?.addEventListener("click", () => {
    const current = dashboardEventState.currentMonth || getToday();
    dashboardEventState.currentMonth = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    const monthEvents = getEventsForVisibleMonth();
    dashboardEventState.selectedDateKey = monthEvents.length ? safeText(monthEvents[0].eventDate) : "";
    refreshDashboardEvents();
  });

  next?.addEventListener("click", () => {
    const current = dashboardEventState.currentMonth || getToday();
    dashboardEventState.currentMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    const monthEvents = getEventsForVisibleMonth();
    dashboardEventState.selectedDateKey = monthEvents.length ? safeText(monthEvents[0].eventDate) : "";
    refreshDashboardEvents();
  });

  jump?.addEventListener("click", () => {
    const nextEvent = getNearestUpcomingEvent(dashboardEventState.events);
    if (!nextEvent) return;
    const date = parseEventDate(nextEvent.eventDate);
    dashboardEventState.currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    dashboardEventState.selectedDateKey = safeText(nextEvent.eventDate);
    refreshDashboardEvents();
    document.getElementById("eventsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  grid?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-calendar-date]") : null;
    if (!target) return;
    dashboardEventState.selectedDateKey = safeText(target.getAttribute("data-calendar-date"));
    refreshDashboardEvents();
  });
}

function bindDashboardEvents() {
  const els = getAnnouncementElements();

  els.dotsHost?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const indexValue = target.getAttribute("data-slide-index");
    if (indexValue !== null) goToSlide(Number(indexValue));
  });

  els.slidesHost?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest("[data-announcement-id]");
    if (!trigger) return;
    const announcementId = trigger.getAttribute("data-announcement-id");
    const announcement = dashboardAnnouncements.find((item) => item.id === announcementId);
    if (announcement) openAnnouncementModal(announcement);
  });

  document.getElementById("dashboardAnnouncementClose")?.addEventListener("click", closeAnnouncementModal);
  document.getElementById("dashboardAnnouncementBackdrop")?.addEventListener("click", closeAnnouncementModal);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAnnouncementModal();
  });

  document.querySelectorAll(".sidebar-link").forEach((button) => {
    button.addEventListener("click", closeSidebarIfMobile);
  });
}

function startAnnouncementListener() {
  const announcementsCollection = collection(db, "announcements");
  const announcementsQuery = query(announcementsCollection, orderBy("createdAtMs", "desc"), limit(ANNOUNCEMENT_LIMIT));

  onSnapshot(
    announcementsQuery,
    (snapshot) => {
      dashboardAnnouncements = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
      if (activeSlideIndex >= dashboardAnnouncements.length) activeSlideIndex = 0;
      renderSlider();
      updateSlider();
      restartSlider();
    },
    (error) => {
      console.error("Dashboard announcement listener error:", error);
      dashboardAnnouncements = [];
      renderSlider();
    }
  );
}

function startVoteListener(studentProfile) {
  let unsubTurnout = null;
  let unsubStatus = null;
  let latestTurnout = {};
  let latestStatus = {};
  let latestContext = {};

  const render = () => setVoteStats(latestTurnout, latestStatus, latestContext);
  const connect = async () => {
    try {
      latestContext = await callSecure("getElectionContext");
      unsubTurnout?.();
      unsubStatus?.();
      const turnoutRef = doc(db, "elections", latestContext.electionId, "turnout", "public");
      const statusRef = doc(db, "elections", latestContext.electionId, "voterStatus", studentProfile.uid);
      unsubTurnout = onSnapshot(turnoutRef, (snap) => { latestTurnout = snap.exists() ? snap.data() : {}; render(); }, (error) => console.warn("Turnout listener:", error));
      unsubStatus = onSnapshot(statusRef, (snap) => { latestStatus = snap.exists() ? snap.data() : {}; render(); }, (error) => console.warn("Voter-status listener:", error));
      render();
    } catch (error) {
      console.error("Dashboard election status unavailable:", error);
      latestContext = {};
      latestTurnout = {};
      latestStatus = {};
      render();
    }
  };
  connect();
  setInterval(connect, 60000);
}

function setPanelActive(button) {
  document.querySelectorAll(".panel-btn").forEach((item) => item.classList.remove("active"));
  button?.classList.add("active");
}

function toggleSidebar() {
  document.body.classList.toggle("sidebar-expanded");
}

async function logout() {
  dashboardBackGuardArmed = false;
  dashboardLogoutInProgress = true;

  clearStudentSession();

  try {
    await signOut(auth);
  } catch (error) {
    console.warn("Sign-out warning:", error);
  }

  window.location.replace("../index/index.html");
}

window.changeSlide = changeSlide;
window.toggleSidebar = toggleSidebar;
window.logout = logout;
window.setPanelActive = setPanelActive;


function setStudentModuleTitle(title = "Dashboard") {
  const titleEl = document.getElementById("studentModuleTitle");
  if (titleEl) titleEl.textContent = title;
}

function bindStudentModuleTitleNavigation() {
  const main = document.querySelector(".student-main");
  if (!main) return;

  setStudentModuleTitle("Dashboard");

  document.querySelectorAll(".student-nav-link[href^='#']").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href") || "";
      if (!href.startsWith("#")) return;
      const target = document.querySelector(href);
      if (!target) return;
      event.preventDefault();
      history.replaceState(history.state, "", href);
      const mainRect = main.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetTop = main.scrollTop + (targetRect.top - mainRect.top) - 10;
      main.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });
  });
}

const studentProfile = applyStudentProfile();
if (studentProfile) {
  armDashboardBackButtonWarning();
  bindStudentModuleTitleNavigation();
  bindDashboardEvents();
  bindDashboardEventControls();
  startAnnouncementListener();
  startVoteListener(studentProfile);
  startComplaintTracklistListener(studentProfile);
  startDashboardEventsListener();
}
import { db, auth } from "../../../firebase/firebase-config.js";
import { secureUpload, hydrateMediaImages } from "../../../shared/security-client.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const eventsCollection = collection(db, "events");

const eventForm = document.getElementById("eventForm");
const eventTitleInput = document.getElementById("eventTitle");
const eventDateInput = document.getElementById("eventDate");
const eventVenueInput = document.getElementById("eventVenue");
const eventDescriptionInput = document.getElementById("eventDescription");
const eventAudienceInput = document.getElementById("eventAudience");
const eventReminderEnabledInput = document.getElementById("eventReminderEnabled");
const eventBackgroundImageInput = document.getElementById("eventBackgroundImage");
const eventImagePickerBtn = document.getElementById("eventImagePickerBtn");
const eventImageFileName = document.getElementById("eventImageFileName");
const eventImagePreviewWrap = document.getElementById("eventImagePreviewWrap");
const eventImagePreview = document.getElementById("eventImagePreview");
const publishEventBtn = document.getElementById("publishEventBtn");
const clearEventBtn = document.getElementById("clearEventBtn");
const scrollToEventFormBtn = document.getElementById("scrollToEventFormBtn");

const upcomingEventCountEl = document.getElementById("upcomingEventCount");
const publishedEventCountEl = document.getElementById("publishedEventCount");
const reminderEnabledCountEl = document.getElementById("reminderEnabledCount");
const confirmedAttendanceCountEl = document.getElementById("confirmedAttendanceCount");
const recentEventsList = document.getElementById("recentEventsList");

let selectedEventImageFile = null;
let selectedEventImageObjectUrl = "";

function safeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseEventDate(rawValue) {
  const cleanValue = safeText(rawValue);
  if (!cleanValue) return null;
  const parsedDate = new Date(`${cleanValue}T00:00:00`);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function formatEventDate(rawValue) {
  const parsedDate = parseEventDate(rawValue);
  return parsedDate
    ? parsedDate.toLocaleDateString([], {
        month: "long",
        day: "numeric",
        year: "numeric"
      })
    : "Date not set";
}

function isUpcomingEvent(eventItem) {
  const eventDate = parseEventDate(eventItem.eventDate);
  if (!eventDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return eventDate >= today;
}

function getEventStatus(eventItem) {
  return isUpcomingEvent(eventItem) ? "Upcoming" : "Completed";
}

function releaseEventImageObjectUrl() {
  if (selectedEventImageObjectUrl) {
    URL.revokeObjectURL(selectedEventImageObjectUrl);
    selectedEventImageObjectUrl = "";
  }
}

function setEventImageFileName(name = "No image selected") {
  if (eventImageFileName) eventImageFileName.textContent = name;
}

function setEventImagePreview(source = "") {
  if (!eventImagePreviewWrap || !eventImagePreview) return;
  if (source) {
    eventImagePreview.src = source;
    eventImagePreview.alt = safeText(eventTitleInput?.value, "Selected event background preview");
    eventImagePreviewWrap.hidden = false;
  } else {
    eventImagePreview.removeAttribute("src");
    eventImagePreviewWrap.hidden = true;
  }
}

function validateImageFile(file) {
  if (!file) return;
  const allowedTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
  const maxFileSize = 5 * 1024 * 1024;
  if (!allowedTypes.has(file.type)) {
    throw new Error("Only JPG, PNG, and WEBP event images are allowed.");
  }
  if (file.size > maxFileSize) {
    throw new Error("Event background image must not exceed 5MB.");
  }
}

async function uploadEventImage(file) {
  if (!file) return { imageUrl: "", imagePath: "" };
  validateImageFile(file);
  const ticket = await secureUpload(file, "event-media");
  return { imageUrl: ticket.publicUrl, imagePath: ticket.path };
}

function resetEventForm() {
  eventForm?.reset();
  selectedEventImageFile = null;
  releaseEventImageObjectUrl();
  setEventImageFileName();
  setEventImagePreview();

  if (eventAudienceInput) eventAudienceInput.value = "All Students";
  if (eventReminderEnabledInput) eventReminderEnabledInput.value = "true";
}

function setLoadingState(isLoading) {
  if (!publishEventBtn) return;
  publishEventBtn.disabled = isLoading;
  publishEventBtn.textContent = isLoading ? "Publishing..." : "Publish Event";
}

function renderEmptyState() {
  if (!recentEventsList) return;
  recentEventsList.innerHTML = `
    <div class="empty-state">
      No events have been published yet.
    </div>
  `;
}

function updateStats(events) {
  const upcomingEvents = events.filter(isUpcomingEvent);
  const remindersEnabled = events.filter((eventItem) => eventItem.reminderEnabled === true);
  const confirmedAttendance = events.reduce(
    (total, eventItem) => total + Number(eventItem.confirmedAttendance || 0),
    0
  );

  if (upcomingEventCountEl) upcomingEventCountEl.textContent = String(upcomingEvents.length);
  if (publishedEventCountEl) publishedEventCountEl.textContent = String(events.length);
  if (reminderEnabledCountEl) reminderEnabledCountEl.textContent = String(remindersEnabled.length);
  if (confirmedAttendanceCountEl) confirmedAttendanceCountEl.textContent = String(confirmedAttendance);
}

function renderEvents(events) {
  if (!recentEventsList) return;
  if (!events.length) {
    renderEmptyState();
    return;
  }

  recentEventsList.innerHTML = events
    .map((eventItem) => {
      const status = getEventStatus(eventItem);
      const badgeClass = status === "Upcoming" ? "live" : "review";
      const reminderText = eventItem.reminderEnabled ? "Reminders enabled" : "Reminders disabled";
      const registeredParticipants = Number(eventItem.registeredParticipants || 0);
      const confirmedAttendance = Number(eventItem.confirmedAttendance || 0);
      const imageUrl = safeText(eventItem.imageUrl || eventItem.posterUrl);
      const imageMarkup = imageUrl
        ? `<img class="event-published-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(safeText(eventItem.title, "Event background"))}">`
        : `<div class="event-published-thumb-placeholder">No background image</div>`;

      return `
        <div class="list-item">
          ${imageMarkup}
          <div class="item-top">
            <div>
              <div class="item-title">${escapeHtml(safeText(eventItem.title, "Untitled Event"))}</div>
              <div class="item-meta">
                Date: ${escapeHtml(formatEventDate(eventItem.eventDate))}<br>
                Venue: ${escapeHtml(safeText(eventItem.venue, "TBA"))}
              </div>
            </div>
            <div class="event-item-controls">
              <div class="badge ${badgeClass}">${status}</div>
              <button class="mini-btn danger" type="button" data-delete-event="${escapeHtml(eventItem.id)}">Delete</button>
            </div>
          </div>
          <div class="item-text">${escapeHtml(safeText(eventItem.description, "No event description provided."))}</div>
          <div class="event-meta-line">
            <span>Audience: ${escapeHtml(safeText(eventItem.audience, "All Students"))}</span>
            <span>${reminderText}</span>
            <span>Registered: ${registeredParticipants}</span>
            <span>Confirmed: ${confirmedAttendance}</span>
          </div>
        </div>
      `;
    })
    .join("");
  hydrateMediaImages(recentEventsList).catch((error) => console.warn("Unable to load event media:", error));
}

function subscribeToEvents() {
  const eventsQuery = query(eventsCollection, orderBy("publishedAtMs", "desc"));
  onSnapshot(
    eventsQuery,
    (snapshot) => {
      const events = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      updateStats(events);
      renderEvents(events);
    },
    (error) => {
      console.error("Unable to read events:", error);
      updateStats([]);
      renderEmptyState();
    }
  );
}

eventImagePickerBtn?.addEventListener("click", () => {
  eventBackgroundImageInput?.click();
});

eventBackgroundImageInput?.addEventListener("change", (event) => {
  const file = event.target.files?.[0] || null;
  releaseEventImageObjectUrl();

  if (!file) {
    selectedEventImageFile = null;
    setEventImageFileName();
    setEventImagePreview();
    return;
  }

  try {
    validateImageFile(file);
    selectedEventImageFile = file;
    selectedEventImageObjectUrl = URL.createObjectURL(file);
    setEventImageFileName(file.name);
    setEventImagePreview(selectedEventImageObjectUrl);
  } catch (error) {
    selectedEventImageFile = null;
    if (eventBackgroundImageInput) eventBackgroundImageInput.value = "";
    setEventImageFileName();
    setEventImagePreview();
    alert(error.message || "Invalid event image.");
  }
});

eventTitleInput?.addEventListener("input", () => {
  if (eventImagePreview && selectedEventImageObjectUrl) {
    eventImagePreview.alt = safeText(eventTitleInput.value, "Selected event background preview");
  }
});

eventForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = safeText(eventTitleInput?.value);
  const eventDate = safeText(eventDateInput?.value);
  const venue = safeText(eventVenueInput?.value);
  const description = safeText(eventDescriptionInput?.value);
  const audience = safeText(eventAudienceInput?.value, "All Students");
  const reminderEnabled = safeText(eventReminderEnabledInput?.value, "true") === "true";

  if (!title || !eventDate || !venue || !description) {
    alert("Please complete all required event fields.");
    return;
  }

  setLoadingState(true);

  try {
    const { imageUrl, imagePath } = await uploadEventImage(selectedEventImageFile);

    await addDoc(eventsCollection, {
      title,
      eventDate,
      venue,
      description,
      audience,
      reminderEnabled,
      imageUrl,
      imagePath,
      status: "Published",
      registeredParticipants: 0,
      confirmedAttendance: 0,
      createdByUid: auth.currentUser?.uid || "",
      createdByEmail: auth.currentUser?.email || "",
      publishedAt: serverTimestamp(),
      publishedAtMs: Date.now(),
      updatedAt: serverTimestamp()
    });

    alert(imageUrl
      ? "Event published successfully with its background image."
      : "Event published successfully.");
    resetEventForm();
  } catch (error) {
    console.error("Unable to publish event:", error);
    alert(error.message || "Failed to publish event.");
  } finally {
    setLoadingState(false);
  }
});

recentEventsList?.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-event]");
  if (!deleteButton) return;

  const eventId = deleteButton.getAttribute("data-delete-event");
  if (!eventId) return;

  const title = deleteButton.closest(".list-item")?.querySelector(".item-title")?.textContent?.trim() || "this event";
  const confirmed = window.confirm(
    `Delete "${title}"?\n\nThis will remove it from the officer dashboard and the student Events module.`
  );
  if (!confirmed) return;

  deleteButton.disabled = true;
  deleteButton.textContent = "Deleting...";

  try {
    await deleteDoc(doc(db, "events", eventId));
  } catch (error) {
    console.error("Unable to delete event:", error);
    alert("Failed to delete the event. Please try again.");
    deleteButton.disabled = false;
    deleteButton.textContent = "Delete";
  }
});

clearEventBtn?.addEventListener("click", resetEventForm);

scrollToEventFormBtn?.addEventListener("click", () => {
  document.getElementById("eventFormCard")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
});

window.addEventListener("beforeunload", releaseEventImageObjectUrl);

resetEventForm();
subscribeToEvents();

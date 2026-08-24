import { db } from "../../../firebase/firebase-config.js";
import { callSecure } from "../../../shared/security-client.js";
import { complaintAttachmentMeta, downloadBlob, isImageAttachment, loadComplaintAttachmentBlob } from "../../../shared/complaint-attachments.js";
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const STATUS_FLOW = ["Submitted", "Under Review", "In Progress", "Resolved", "Closed"];

const inboxContainer = document.getElementById("complaintInbox");
const emptyState = document.getElementById("complaintEmptyState");
const detailPanel = document.getElementById("complaintDetailPanel");

const detailReference = document.getElementById("detailReference");
const detailStatus = document.getElementById("detailStatus");
const detailCategory = document.getElementById("detailCategory");
const detailStudent = document.getElementById("detailStudent");
const detailSubject = document.getElementById("detailSubject");
const detailComplaintText = document.getElementById("detailComplaintText");
const detailReply = document.getElementById("detailReply");
const complaintThread = document.getElementById("complaintThread");
const detailAttachmentPreview = document.getElementById("detailAttachmentPreview");

const updateStatusBtn = document.getElementById("updateStatusBtn");
const sendReplyBtn = document.getElementById("sendReplyBtn");
const deleteComplaintBtn = document.getElementById("deleteComplaintBtn");
const timelineSteps = Array.from(document.querySelectorAll(".timeline-step"));
const loadOlderComplaintsBtn = document.getElementById("loadOlderComplaints");
const complaintInboxScope = document.getElementById("complaintInboxScope");

const LIVE_PAGE_SIZE = 100;
let complaintsCache = [];
let liveComplaints = [];
let olderComplaints = [];
let paginationCursor = null;
let hasMoreOlderComplaints = true;
let selectedComplaintId = null;
let countRefreshTimer = 0;
let attachmentPreviewUrl = "";
let attachmentPreviewToken = 0;

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

function getBadgeClass(status) {
  const map = {
    Submitted: "live",
    "Under Review": "review",
    "In Progress": "progress",
    Resolved: "good",
    Closed: "closed"
  };

  return map[safeText(status, "Submitted")] || "live";
}

function formatDate(value) {
  if (!value) return "-";

  if (value.toDate) {
    return value.toDate().toLocaleString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function getAnonymousComplainantLabel() {
  return "Anonymous Student";
}

function getSelectedComplaint() {
  return complaintsCache.find((item) => item.id === selectedComplaintId) || null;
}

function selectComplaint(id) {
  selectedComplaintId = id;
  renderInbox();
  renderDetails();
}

window.selectComplaint = selectComplaint;

function updateStatusFlow(status) {
  const activeIndex = STATUS_FLOW.indexOf(safeText(status, "Submitted"));

  timelineSteps.forEach((step, index) => {
    step.classList.remove("active", "completed");

    if (index < activeIndex) {
      step.classList.add("completed");
    } else if (index === activeIndex) {
      step.classList.add("active");
    }
  });
}

function setButtonLoading(button, isLoading, loadingText, idleText) {
  if (!button) return;

  button.disabled = isLoading;
  button.textContent = isLoading ? loadingText : idleText;
}

function setCount(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value ?? 0);
}

async function refreshComplaintCounts() {
  try {
    const base = collection(db, "complaints");
    const [submitted, review, progress, resolved] = await Promise.all([
      getCountFromServer(query(base, where("status", "==", "Submitted"))),
      getCountFromServer(query(base, where("status", "==", "Under Review"))),
      getCountFromServer(query(base, where("status", "==", "In Progress"))),
      getCountFromServer(query(base, where("status", "in", ["Resolved", "Closed"])))
    ]);
    setCount("submittedCount", submitted.data().count);
    setCount("reviewCount", review.data().count);
    setCount("progressCount", progress.data().count);
    setCount("resolvedCount", resolved.data().count);
  } catch (error) {
    console.warn("Complaint aggregate counts unavailable:", error);
    // The visible page still receives a local count fallback.
    setCount("submittedCount", complaintsCache.filter((c) => c.status === "Submitted").length);
    setCount("reviewCount", complaintsCache.filter((c) => c.status === "Under Review").length);
    setCount("progressCount", complaintsCache.filter((c) => c.status === "In Progress").length);
    setCount("resolvedCount", complaintsCache.filter((c) => ["Resolved", "Closed"].includes(c.status)).length);
  }
}

function scheduleCountRefresh() {
  clearTimeout(countRefreshTimer);
  countRefreshTimer = setTimeout(refreshComplaintCounts, 650);
}

function mergeComplaintPages() {
  const byId = new Map();
  [...liveComplaints, ...olderComplaints].forEach((item) => byId.set(item.id, item));
  complaintsCache = Array.from(byId.values()).sort((a, b) => {
    const toMs = (value) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || new Date(value || 0).getTime() || 0;
    return toMs(b.createdAt || b.updatedAt) - toMs(a.createdAt || a.updatedAt);
  });
  if (complaintInboxScope) {
    complaintInboxScope.textContent = `Showing ${complaintsCache.length} loaded complaint${complaintsCache.length === 1 ? "" : "s"}. Newest records update live.`;
  }
}

function renderInbox() {
  if (!inboxContainer) return;

  if (!complaintsCache.length) {
    inboxContainer.innerHTML = `
      <div class="note-box" style="margin-top:0;">
        <strong>No complaints yet</strong>
        <p>Student submissions will appear here automatically.</p>
      </div>
    `;
    return;
  }

  inboxContainer.innerHTML = complaintsCache
    .map((item) => {
      const badgeClass = getBadgeClass(item.status);
      const isSelected = item.id === selectedComplaintId ? " is-selected" : "";
      const lastUpdate = formatDate(item.updatedAt || item.createdAt);
      const anonymousLabel = getAnonymousComplainantLabel();

      return `
        <button class="list-item complaint-list-item${isSelected}" type="button" onclick="selectComplaint('${item.id}')">
          <div class="item-top">
            <div>
              <div class="item-title">${escapeHtml(safeText(item.subject, "Untitled Complaint"))}</div>
              <div class="item-meta">
                Ref: ${escapeHtml(safeText(item.complaintRef, item.id))}<br>
                Category: ${escapeHtml(safeText(item.category, "-"))}<br>
                Complainant: ${escapeHtml(anonymousLabel)}
              </div>
            </div>
            <div class="badge ${badgeClass}">${escapeHtml(safeText(item.status, "Submitted"))}</div>
          </div>
          <div class="case-meta-inline">
            <span>Submitted: ${escapeHtml(formatDate(item.createdAt))}</span>
            <span>Last update: ${escapeHtml(lastUpdate)}</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderThread(selected) {
  if (!complaintThread) return;

  const threadEntries = Array.isArray(selected.thread) ? selected.thread : [];

  if (!threadEntries.length) {
    complaintThread.innerHTML = `
      <div class="note-box" style="margin-top:0;">
        <strong>No replies yet</strong>
        <p>Officer replies and status updates will appear here.</p>
      </div>
    `;
    return;
  }

  complaintThread.innerHTML = threadEntries
    .map((entry) => {
      const rawAuthor = safeText(entry.by, "System");
      const displayAuthor = rawAuthor === "Student" ? "Anonymous Student" : rawAuthor;
      const msgClass =
        rawAuthor === "Officer"
          ? "officer"
          : rawAuthor === "Student"
            ? "student"
            : "system";

      return `
        <div class="msg ${msgClass}">
          <div class="msg-head">
            <strong>${escapeHtml(displayAuthor)}</strong>
            <small>${escapeHtml(formatDate(entry.at))}</small>
          </div>
          <div class="msg-body">${escapeHtml(safeText(entry.message, ""))}</div>
        </div>
      `;
    })
    .join("");
}



async function renderAttachmentPreview(selected) {
  if (!detailAttachmentPreview) return;
  const token = ++attachmentPreviewToken;
  if (attachmentPreviewUrl) {
    URL.revokeObjectURL(attachmentPreviewUrl);
    attachmentPreviewUrl = "";
  }

  const meta = complaintAttachmentMeta(selected);
  if (!meta.path && !meta.directUrl && !safeText(selected?.attachmentName || selected?.fileName)) {
    detailAttachmentPreview.innerHTML = '<div class="attachment-empty">No attachment submitted.</div>';
    return;
  }

  detailAttachmentPreview.innerHTML = `<div class="attachment-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading ${escapeHtml(meta.name)}…</div>`;
  try {
    const loaded = await loadComplaintAttachmentBlob({ ...selected, id: selected.id });
    if (token !== attachmentPreviewToken) return;
    attachmentPreviewUrl = URL.createObjectURL(loaded.blob);

    if (isImageAttachment(loaded.meta)) {
      detailAttachmentPreview.innerHTML = `
        <figure class="admin-attachment-card admin-image-display">
          <img src="${attachmentPreviewUrl}" alt="Complaint attachment: ${escapeHtml(loaded.meta.name)}">
          <figcaption>
            <strong>${escapeHtml(loaded.meta.name)}</strong>
            <small>${escapeHtml(loaded.meta.type || "Image attachment")}</small>
            <button type="button" class="mini-btn light" data-download-complaint-attachment>Download image</button>
          </figcaption>
        </figure>`;
    } else {
      detailAttachmentPreview.innerHTML = `
        <div class="admin-attachment-card">
          <i class="fa-solid fa-file-arrow-down"></i>
          <div>
            <strong>${escapeHtml(loaded.meta.name)}</strong>
            <small>${escapeHtml(loaded.meta.type || "Document attachment")}</small>
            <div class="attachment-actions">
              <a class="mini-btn light" href="${attachmentPreviewUrl}" target="_blank" rel="noopener noreferrer">Open document</a>
              <button type="button" class="mini-btn light" data-download-complaint-attachment>Download</button>
            </div>
          </div>
        </div>`;
    }

    detailAttachmentPreview.querySelector('[data-download-complaint-attachment]')?.addEventListener('click', () => {
      downloadBlob(loaded.blob, loaded.meta.name);
    });
  } catch (error) {
    if (token !== attachmentPreviewToken) return;
    console.error("Complaint attachment preview failed:", error);
    const legacy = meta.bucket && meta.bucket !== "firestore-chunks";
    detailAttachmentPreview.innerHTML = `
      <div class="admin-attachment-card attachment-unavailable">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <div>
          <strong>${escapeHtml(meta.name)}</strong>
          <small>${legacy
            ? "This older attachment uses the previous private-backend storage format. New complaint attachments open directly in this browser-only capstone version."
            : "The attachment could not be reconstructed. Ask the student to submit the file again if necessary."}
          </small>
        </div>
      </div>`;
  }
}


function renderDetails() {
  const selected = getSelectedComplaint();

  if (!selected) {
    if (emptyState) emptyState.style.display = "block";
    if (detailPanel) detailPanel.style.display = "none";
    if (deleteComplaintBtn) deleteComplaintBtn.hidden = true;
    updateStatusFlow("Submitted");
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  if (detailPanel) detailPanel.style.display = "block";

  if (detailReference) detailReference.value = safeText(selected.complaintRef, selected.id);
  if (detailStatus) detailStatus.value = safeText(selected.status, "Submitted");
  if (detailCategory) detailCategory.value = safeText(selected.category);
  if (detailStudent) detailStudent.value = getAnonymousComplainantLabel();
  if (detailSubject) detailSubject.value = safeText(selected.subject);
  if (detailComplaintText) detailComplaintText.value = safeText(selected.details);

  void renderAttachmentPreview(selected);
  renderThread(selected);
  updateStatusFlow(selected.status);

  if (deleteComplaintBtn) {
    const deletable = ["Resolved", "Closed"].includes(safeText(selected.status));
    deleteComplaintBtn.hidden = !deletable;
    deleteComplaintBtn.textContent = safeText(selected.status) === "Closed" ? "Delete Closed Case" : "Delete Resolved Case";
  }
}

const complaintsQuery = query(
  collection(db, "complaints"),
  orderBy("createdAt", "desc"),
  limit(LIVE_PAGE_SIZE)
);

onSnapshot(
  complaintsQuery,
  (snapshot) => {
    liveComplaints = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    if (!olderComplaints.length) {
      paginationCursor = snapshot.docs.at(-1) || null;
      hasMoreOlderComplaints = snapshot.docs.length === LIVE_PAGE_SIZE;
    }
    mergeComplaintPages();

    if (!selectedComplaintId && complaintsCache.length) {
      selectedComplaintId = complaintsCache[0].id;
    } else if (selectedComplaintId && !complaintsCache.some((item) => item.id === selectedComplaintId)) {
      selectedComplaintId = complaintsCache.length ? complaintsCache[0].id : null;
    }

    renderInbox();
    renderDetails();
    scheduleCountRefresh();
    if (loadOlderComplaintsBtn) {
      loadOlderComplaintsBtn.disabled = !hasMoreOlderComplaints;
      loadOlderComplaintsBtn.textContent = hasMoreOlderComplaints ? "Load Older" : "All Loaded";
    }
  },
  (error) => {
    console.error("Complaint listener error:", error);
  }
);

loadOlderComplaintsBtn?.addEventListener("click", async () => {
  if (!paginationCursor || !hasMoreOlderComplaints || loadOlderComplaintsBtn.disabled) return;
  loadOlderComplaintsBtn.disabled = true;
  loadOlderComplaintsBtn.textContent = "Loading…";
  try {
    const olderQuery = query(
      collection(db, "complaints"),
      orderBy("createdAt", "desc"),
      startAfter(paginationCursor),
      limit(LIVE_PAGE_SIZE)
    );
    const snapshot = await getDocs(olderQuery);
    const page = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    olderComplaints.push(...page);
    paginationCursor = snapshot.docs.at(-1) || paginationCursor;
    hasMoreOlderComplaints = snapshot.docs.length === LIVE_PAGE_SIZE;
    mergeComplaintPages();
    renderInbox();
    renderDetails();
  } catch (error) {
    console.error("Unable to load older complaints:", error);
    alert("Unable to load older complaints right now. Please try again.");
  } finally {
    loadOlderComplaintsBtn.disabled = !hasMoreOlderComplaints;
    loadOlderComplaintsBtn.textContent = hasMoreOlderComplaints ? "Load Older" : "All Loaded";
  }
});

refreshComplaintCounts();
setInterval(refreshComplaintCounts, 30000);

if (detailStatus) {
  detailStatus.addEventListener("change", () => {
    updateStatusFlow(detailStatus.value);
  });
}

if (updateStatusBtn) {
  updateStatusBtn.addEventListener("click", async () => {
    const selected = getSelectedComplaint();
    if (!selected || !detailStatus) return;

    const nextStatus = safeText(detailStatus.value, "Submitted");
    const previousStatus = safeText(selected.status, "Submitted");

    if (nextStatus === previousStatus) {
      alert("That complaint is already in the selected status.");
      return;
    }

    setButtonLoading(updateStatusBtn, true, "Saving...", "Update Status");

    try {
      await callSecure("updateComplaintCase", { complaintId: selected.id, status: nextStatus });

      alert("Complaint status updated.");
    } catch (error) {
      console.error("Error updating status:", error);
      alert("Failed to update complaint status.");
      updateStatusFlow(previousStatus);
    } finally {
      setButtonLoading(updateStatusBtn, false, "Saving...", "Update Status");
    }
  });
}

if (deleteComplaintBtn) {
  deleteComplaintBtn.addEventListener("click", async () => {
    const selected = getSelectedComplaint();
    if (!selected) return;

    const status = safeText(selected.status, "Submitted");
    if (!["Resolved", "Closed"].includes(status)) {
      alert("Only complaints that are already Resolved or Closed can be deleted.");
      return;
    }

    const complaintRef = safeText(selected.complaintRef, selected.id);
    const confirmed = confirm(`Permanently delete complaint ${complaintRef}?\n\nThis will remove the complaint record and its stored attachment. This action cannot be undone.`);
    if (!confirmed) return;

    setButtonLoading(deleteComplaintBtn, true, "Deleting...", status === "Closed" ? "Delete Closed Case" : "Delete Resolved Case");

    try {
      await callSecure("deleteComplaintCase", { complaintId: selected.id });

      selectedComplaintId = null;
      liveComplaints = liveComplaints.filter((item) => item.id !== selected.id);
      olderComplaints = olderComplaints.filter((item) => item.id !== selected.id);
      mergeComplaintPages();
      if (complaintsCache.length) selectedComplaintId = complaintsCache[0].id;
      renderInbox();
      renderDetails();
      scheduleCountRefresh();
      alert("Complaint deleted permanently.");
    } catch (error) {
      console.error("Error deleting complaint:", error);
      alert(error?.message || "Failed to delete the complaint.");
    } finally {
      setButtonLoading(deleteComplaintBtn, false, "Deleting...", status === "Closed" ? "Delete Closed Case" : "Delete Resolved Case");
    }
  });
}

if (sendReplyBtn) {
  sendReplyBtn.addEventListener("click", async () => {
    const selected = getSelectedComplaint();
    if (!selected || !detailReply || !detailStatus) return;

    const replyText = detailReply.value.trim();

    if (!replyText) {
      alert("Please type a reply first.");
      return;
    }

    const nextStatus = safeText(detailStatus.value, selected.status || "Under Review");
    setButtonLoading(sendReplyBtn, true, "Sending...", "Send Reply");

    try {
      await callSecure("updateComplaintCase", { complaintId: selected.id, status: nextStatus, reply: replyText });

      detailReply.value = "";
      alert("Reply sent.");
    } catch (error) {
      console.error("Error sending reply:", error);
      alert("Failed to send reply.");
    } finally {
      setButtonLoading(sendReplyBtn, false, "Sending...", "Send Reply");
    }
  });
}
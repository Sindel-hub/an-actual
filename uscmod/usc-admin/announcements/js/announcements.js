import { db, auth } from "../../../firebase/firebase-config.js";
import { secureUpload, hydrateMediaImages, resolveMediaUrl } from "../../../shared/security-client.js";
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


const announcementForm = document.getElementById("announcementForm");
const announcementTitleInput = document.getElementById("announcementTitle");
const announcementCategoryInput = document.getElementById("announcementCategory");
const announcementAudienceInput = document.getElementById("announcementAudience");
const announcementContentInput = document.getElementById("announcementContent");
const announcementImageInput = document.getElementById("announcementImage");
const imagePickerBtn = document.getElementById("imagePickerBtn");
const imageFileName = document.getElementById("imageFileName");
const draftImagePreview = document.getElementById("draftImagePreview");
const clearAnnouncementBtn = document.getElementById("clearAnnouncementBtn");
const publishAnnouncementBtn = document.getElementById("publishAnnouncementBtn");
const scrollToFormBtn = document.getElementById("scrollToFormBtn");

const previewCategoryBadge = document.getElementById("previewCategoryBadge");
const previewDateText = document.getElementById("previewDateText");
const previewTitle = document.getElementById("previewTitle");
const previewAudience = document.getElementById("previewAudience");
const previewContent = document.getElementById("previewContent");
const announcementPreviewImageWrap = document.getElementById("announcementPreviewImageWrap");
const announcementPreviewImage = document.getElementById("announcementPreviewImage");
const announcementPreviewPlaceholder = document.getElementById("announcementPreviewPlaceholder");

const publishedCountEl = document.getElementById("publishedCount");
const imageCountEl = document.getElementById("imageCount");
const categoryCountEl = document.getElementById("categoryCount");
const latestPublishEl = document.getElementById("latestPublish");

const recentAnnouncementsList = document.getElementById("recentAnnouncementsList");

const announcementModal = document.getElementById("announcementModal");
const announcementModalBackdrop = document.getElementById("announcementModalBackdrop");
const announcementModalClose = document.getElementById("announcementModalClose");
const modalAnnouncementImage = document.getElementById("modalAnnouncementImage");
const modalAnnouncementCategory = document.getElementById("modalAnnouncementCategory");
const modalAnnouncementDate = document.getElementById("modalAnnouncementDate");
const modalAnnouncementTitle = document.getElementById("modalAnnouncementTitle");
const modalAnnouncementAudience = document.getElementById("modalAnnouncementAudience");
const modalAnnouncementContent = document.getElementById("modalAnnouncementContent");

const announcementsCollection = collection(db, "announcements");

let selectedImageFile = null;
let selectedImageObjectUrl = "";
let liveAnnouncements = [];

function safeText(value, fallback = "") {
    return String(value || fallback).trim();
}

function truncateText(value, maxLength = 120) {
    const text = safeText(value);
    return text.length <= maxLength ? text : `${text.slice(0, maxLength).trim()}…`;
}

function escapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatAnnouncementDate(announcement) {
    if (announcement?.createdAt?.toDate) {
        return announcement.createdAt.toDate().toLocaleString();
    }

    if (typeof announcement?.createdAtMs === "number") {
        return new Date(announcement.createdAtMs).toLocaleString();
    }

    return "Just now";
}

function setDraftPreviewImage(source) {
    if (!announcementPreviewImage || !announcementPreviewImageWrap || !announcementPreviewPlaceholder) {
        return;
    }

    if (source) {
        announcementPreviewImage.src = source;
        announcementPreviewImage.alt = safeText(announcementTitleInput?.value, "Announcement image");
        announcementPreviewImage.hidden = false;
        announcementPreviewImageWrap.hidden = false;
        announcementPreviewPlaceholder.hidden = true;
        return;
    }

    announcementPreviewImage.removeAttribute("src");
    announcementPreviewImage.hidden = true;
    announcementPreviewImageWrap.hidden = true;
    announcementPreviewPlaceholder.hidden = false;
}

function releaseDraftObjectUrl() {
    if (selectedImageObjectUrl) {
        URL.revokeObjectURL(selectedImageObjectUrl);
        selectedImageObjectUrl = "";
    }
}

function syncPreviewCard() {
    if (previewCategoryBadge) {
        previewCategoryBadge.textContent = safeText(announcementCategoryInput?.value, "Official Notice");
    }

    if (previewDateText) {
        previewDateText.textContent = new Date().toLocaleDateString([], {
            month: "long",
            day: "numeric",
            year: "numeric"
        });
    }

    if (previewTitle) {
        previewTitle.textContent = safeText(announcementTitleInput?.value, "Your announcement title will appear here");
    }

    if (previewAudience) {
        previewAudience.textContent = `Audience: ${safeText(announcementAudienceInput?.value, "All Students")}`;
    }

    if (previewContent) {
        previewContent.textContent = safeText(
            announcementContentInput?.value,
            "Write your announcement content to preview how students will see it."
        );
    }

    if (selectedImageObjectUrl) {
        setDraftPreviewImage(selectedImageObjectUrl);
    } else {
        setDraftPreviewImage("");
    }
}

function setImageFileLabel(fileName = "No image selected") {
    if (imageFileName) {
        imageFileName.textContent = fileName;
    }
}

function resetAnnouncementForm() {
    announcementForm?.reset();
    selectedImageFile = null;
    releaseDraftObjectUrl();
    setImageFileLabel();
    setDraftPreviewImage("");
    syncPreviewCard();
}

function openAnnouncementModal(announcement) {
    if (!announcementModal) return;

    if (modalAnnouncementImage) {
        if (safeText(announcement.imageUrl)) {
            modalAnnouncementImage.src = announcement.imageUrl;
            resolveMediaUrl(announcement.imageUrl).then((url) => { modalAnnouncementImage.src = url; }).catch(() => {});
            modalAnnouncementImage.alt = safeText(announcement.title, "Announcement image");
            modalAnnouncementImage.hidden = false;
        } else {
            modalAnnouncementImage.removeAttribute("src");
            modalAnnouncementImage.hidden = true;
        }
    }

    if (modalAnnouncementCategory) modalAnnouncementCategory.textContent = safeText(announcement.category, "Official Notice");
    if (modalAnnouncementDate) modalAnnouncementDate.textContent = formatAnnouncementDate(announcement);
    if (modalAnnouncementTitle) modalAnnouncementTitle.textContent = safeText(announcement.title, "Announcement");
    if (modalAnnouncementAudience) modalAnnouncementAudience.textContent = safeText(announcement.audience, "All Students");
    if (modalAnnouncementContent) modalAnnouncementContent.textContent = safeText(announcement.content, "");

    announcementModal.hidden = false;
    document.body.classList.add("modal-open");
}

function closeAnnouncementModal() {
    if (!announcementModal) return;
    announcementModal.hidden = true;
    document.body.classList.remove("modal-open");
}

function renderAnnouncementStats(announcements) {
    if (publishedCountEl) publishedCountEl.textContent = String(announcements.length);

    if (imageCountEl) {
        const withImages = announcements.filter((announcement) => safeText(announcement.imageUrl)).length;
        imageCountEl.textContent = String(withImages);
    }

    if (categoryCountEl) {
        const categories = new Set(
            announcements.map((announcement) => safeText(announcement.category)).filter(Boolean)
        );
        categoryCountEl.textContent = String(categories.size);
    }

    if (latestPublishEl) {
        latestPublishEl.textContent = announcements.length ? formatAnnouncementDate(announcements[0]) : "No announcements yet";
    }
}

function renderRecentAnnouncements(announcements) {
    if (!recentAnnouncementsList) return;

    if (!announcements.length) {
        recentAnnouncementsList.innerHTML = `
            <div class="empty-state">
                <h4>No announcements yet</h4>
                <p>Published announcements will appear here in real time.</p>
            </div>
        `;
        return;
    }

    recentAnnouncementsList.innerHTML = announcements
        .map((announcement, index) => {
            const hasImage = !!safeText(announcement.imageUrl);
            const imageMarkup = hasImage
                ? `<img class="recent-announcement-image" src="${escapeHtml(announcement.imageUrl)}" alt="${escapeHtml(
                    safeText(announcement.title, "Announcement image")
                )}">`
                : `<div class="recent-announcement-placeholder">No image uploaded</div>`;

            return `
                <article class="recent-announcement-card" data-announcement-index="${index}">
                    <div class="recent-announcement-media ${hasImage ? "has-image" : "no-image"}">${imageMarkup}</div>
                    <div class="recent-announcement-copy">
                        <div class="recent-announcement-topline">
                            <span class="recent-announcement-chip">${escapeHtml(safeText(announcement.category, "Official Notice"))}</span>
                            <span class="recent-announcement-date">${escapeHtml(formatAnnouncementDate(announcement))}</span>
                        </div>
                        <h4>${escapeHtml(safeText(announcement.title, "Untitled announcement"))}</h4>
                        <p class="recent-announcement-excerpt">${escapeHtml(truncateText(announcement.content, 180))}</p>
                        <div class="recent-announcement-footer">
                            <span class="recent-announcement-audience">${escapeHtml(safeText(announcement.audience, "All Students"))}</span>
                            <div class="recent-announcement-actions">
                                <button class="mini-btn light" type="button" data-open-announcement="${index}">Open full post</button>
                                <button class="mini-btn danger" type="button" data-delete-announcement="${escapeHtml(announcement.id)}">Delete</button>
                            </div>
                        </div>
                    </div>
                </article>
            `;
        })
        .join("");
    hydrateMediaImages(recentAnnouncementsList).catch((error) => console.warn("Unable to load announcement media:", error));
}

async function uploadImage(file) {
    if (!file) return { imageUrl: "", imagePath: "" };
    const allowedTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
    const maxFileSize = 5 * 1024 * 1024;
    if (!allowedTypes.has(file.type)) throw new Error("Only JPG, PNG, and WEBP files are allowed.");
    if (file.size > maxFileSize) throw new Error("Image size must not exceed 5MB.");
    const ticket = await secureUpload(file, "announcement-media");
    return { imageUrl: ticket.publicUrl, imagePath: ticket.path };
}

announcementTitleInput?.addEventListener("input", syncPreviewCard);
announcementCategoryInput?.addEventListener("change", syncPreviewCard);
announcementAudienceInput?.addEventListener("change", syncPreviewCard);
announcementContentInput?.addEventListener("input", syncPreviewCard);

imagePickerBtn?.addEventListener("click", () => {
    announcementImageInput?.click();
});

announcementImageInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;

    selectedImageFile = file;
    releaseDraftObjectUrl();

    if (file) {
        selectedImageObjectUrl = URL.createObjectURL(file);
        setImageFileLabel(file.name);
        setDraftPreviewImage(selectedImageObjectUrl);
    } else {
        setImageFileLabel();
        setDraftPreviewImage("");
    }

    syncPreviewCard();
});

clearAnnouncementBtn?.addEventListener("click", () => {
    resetAnnouncementForm();
});

scrollToFormBtn?.addEventListener("click", () => {
    document.getElementById("announcementFormCard")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
});

announcementForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const title = safeText(announcementTitleInput?.value);
    const category = safeText(announcementCategoryInput?.value, "Official Notice");
    const audience = safeText(announcementAudienceInput?.value, "All Students");
    const content = safeText(announcementContentInput?.value);

    if (!title || !content) {
        alert("Please complete the announcement title and content.");
        return;
    }

    if (publishAnnouncementBtn) {
        publishAnnouncementBtn.disabled = true;
        publishAnnouncementBtn.textContent = "Publishing...";
    }

    try {
        const { imageUrl, imagePath } = await uploadImage(selectedImageFile);

        await addDoc(announcementsCollection, {
            title,
            category,
            audience,
            content,
            imageUrl,
            imagePath,
            createdByUid: auth.currentUser?.uid || "",
            createdByEmail: auth.currentUser?.email || "",
            createdAt: serverTimestamp(),
            createdAtMs: Date.now()
        });

        resetAnnouncementForm();
        alert("Announcement published successfully.");
    } catch (error) {
        console.error("Announcement publish error:", error);
        alert(error.message || "Failed to publish announcement.");
    } finally {
        if (publishAnnouncementBtn) {
            publishAnnouncementBtn.disabled = false;
            publishAnnouncementBtn.textContent = "Publish Announcement";
        }
    }
});

recentAnnouncementsList?.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-announcement]");
    if (deleteButton) {
        const announcementId = deleteButton.getAttribute("data-delete-announcement");
        const announcement = liveAnnouncements.find((item) => item.id === announcementId);
        if (!announcementId || !announcement) return;

        const confirmed = window.confirm(
            `Delete "${safeText(announcement.title, "this announcement")}"?\n\nThis will remove it from the officer dashboard and the student Bulletin Board.`
        );
        if (!confirmed) return;

        deleteButton.disabled = true;
        deleteButton.textContent = "Deleting...";

        try {
            await deleteDoc(doc(db, "announcements", announcementId));
            if (!announcementModal?.hidden) closeAnnouncementModal();
        } catch (error) {
            console.error("Unable to delete announcement:", error);
            alert("Failed to delete the announcement. Please try again.");
            deleteButton.disabled = false;
            deleteButton.textContent = "Delete";
        }
        return;
    }

    const openButton = event.target.closest("[data-open-announcement]");
    const card = event.target.closest("[data-announcement-index]");
    const source = openButton || card;
    if (!source) return;

    const index = Number(
        openButton?.getAttribute("data-open-announcement") ??
        card?.getAttribute("data-announcement-index")
    );
    const announcement = liveAnnouncements[index];

    if (announcement) {
        openAnnouncementModal(announcement);
    }
});

announcementModalClose?.addEventListener("click", closeAnnouncementModal);
announcementModalBackdrop?.addEventListener("click", closeAnnouncementModal);

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeAnnouncementModal();
    }
});

const liveQuery = query(announcementsCollection, orderBy("createdAtMs", "desc"));

onSnapshot(
    liveQuery,
    (snapshot) => {
        liveAnnouncements = snapshot.docs.map((docItem) => ({
            id: docItem.id,
            ...docItem.data()
        }));

        renderAnnouncementStats(liveAnnouncements);
        renderRecentAnnouncements(liveAnnouncements);
    },
    (error) => {
        console.error("Announcement listener error:", error);
        renderAnnouncementStats([]);
        renderRecentAnnouncements([]);
    }
);

syncPreviewCard();
setImageFileLabel();
window.addEventListener("beforeunload", releaseDraftObjectUrl);

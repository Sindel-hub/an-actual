import { auth, db } from "../../firebase/firebase-config.js";
import { collection, limit, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { hydrateMediaImages, resolveMediaUrl } from "../../shared/security-client.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const PROFILE_KEY = "studentProfile";
const SESSION_KEY = "activeSession";

let announcements = [];
let carouselIndex = 0;
let touchStartX = 0;

const feed = document.getElementById("bulletinFeed");
const viewport = document.getElementById("bulletinViewport");
const carousel = document.querySelector(".bulletin-carousel");
const prevButton = document.getElementById("bulletinPrev");
const nextButton = document.getElementById("bulletinNext");
const dotsHost = document.getElementById("bulletinDots");

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function escapeHtml(value) {
  return clean(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
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
    initialsEl.textContent = name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  return student;
}

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "Latest update";
  return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function visibleCards() {
  if (!carousel) return 1;
  const raw = getComputedStyle(carousel).getPropertyValue("--bulletin-visible");
  return Math.max(1, Number.parseInt(raw, 10) || 1);
}

function maxCarouselIndex() {
  return Math.max(0, announcements.length - visibleCards());
}

function renderDots() {
  if (!dotsHost) return;
  const pages = maxCarouselIndex() + 1;
  if (announcements.length <= visibleCards()) {
    dotsHost.innerHTML = "";
    return;
  }

  dotsHost.innerHTML = Array.from({ length: pages }, (_, index) => (
    `<button class="bulletin-carousel-dot${index === carouselIndex ? " active" : ""}" type="button" data-carousel-index="${index}" aria-label="Show announcement set ${index + 1}"></button>`
  )).join("");
}

function applyCarouselPosition({ animate = true } = {}) {
  if (!feed) return;

  const maxIndex = maxCarouselIndex();
  if (maxIndex <= 0) carouselIndex = 0;
  else if (carouselIndex < 0) carouselIndex = maxIndex;
  else if (carouselIndex > maxIndex) carouselIndex = 0;
  const card = feed.querySelector(".bulletin-page-card");
  const style = getComputedStyle(feed);
  const gap = Number.parseFloat(style.columnGap || style.gap || "0") || 0;
  const step = card ? card.getBoundingClientRect().width + gap : 0;

  if (!animate) feed.style.transition = "none";
  feed.style.transform = `translate3d(${-carouselIndex * step}px, 0, 0)`;
  if (!animate) {
    requestAnimationFrame(() => {
      feed.style.transition = "";
    });
  }

  if (prevButton) prevButton.disabled = announcements.length <= visibleCards();
  if (nextButton) nextButton.disabled = announcements.length <= visibleCards();
  renderDots();
}

function moveCarousel(direction) {
  const maxIndex = maxCarouselIndex();
  if (maxIndex <= 0) return;
  carouselIndex = direction > 0
    ? (carouselIndex >= maxIndex ? 0 : carouselIndex + 1)
    : (carouselIndex <= 0 ? maxIndex : carouselIndex - 1);
  applyCarouselPosition();
}

function renderAnnouncements() {
  if (!feed) return;

  if (!announcements.length) {
    feed.innerHTML = '<div class="bulletin-empty">No announcements have been posted yet.</div>';
    carouselIndex = 0;
    applyCarouselPosition({ animate: false });
    return;
  }

  feed.innerHTML = announcements.map((announcement) => {
    const content = clean(announcement.content);
    const excerpt = content.length > 210 ? `${content.slice(0, 210)}…` : content;
    const image = announcement.imageUrl
      ? `<img src="${escapeHtml(announcement.imageUrl)}" alt="${escapeHtml(announcement.title || "USC announcement")}">`
      : '<div class="bulletin-page-placeholder"><i class="fa-regular fa-image"></i></div>';

    return `
      <article class="bulletin-page-card">
        <div class="bulletin-page-image">${image}</div>
        <div class="bulletin-page-body">
          <div class="bulletin-page-date">${escapeHtml(formatDate(announcement.createdAt || announcement.createdAtMs))}</div>
          <h2>${escapeHtml(announcement.title || "USC Announcement")}</h2>
          <p>${escapeHtml(excerpt)}</p>
          <button type="button" data-id="${announcement.id}">Read More</button>
        </div>
      </article>`;
  }).join("");
  hydrateMediaImages(feed).catch(() => {});

  carouselIndex = Math.min(Math.max(carouselIndex, 0), maxCarouselIndex());
  requestAnimationFrame(() => applyCarouselPosition({ animate: false }));
}

function openAnnouncement(announcement) {
  if (!announcement) return;

  const modal = document.getElementById("bulletinModal");
  const image = document.getElementById("bulletinModalImage");
  if (!modal || !image) return;

  document.getElementById("bulletinModalTitle").textContent = clean(announcement.title);
  document.getElementById("bulletinModalCategory").textContent = clean(announcement.category, "Official Notice");
  document.getElementById("bulletinModalDate").textContent = formatDate(announcement.createdAt || announcement.createdAtMs);
  document.getElementById("bulletinModalAudience").textContent = `Audience: ${clean(announcement.audience, "All students")}`;
  document.getElementById("bulletinModalContent").textContent = clean(announcement.content);

  if (announcement.imageUrl) {
    image.src = announcement.imageUrl;
    resolveMediaUrl(announcement.imageUrl).then((url) => { image.src = url; }).catch(() => {});
    image.classList.remove("hidden");
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
  }

  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeModal() {
  document.getElementById("bulletinModal")?.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

guardStudent();

onSnapshot(
  query(collection(db, "announcements"), orderBy("createdAtMs", "desc"), limit(30)),
  (snapshot) => {
    announcements = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderAnnouncements();
  },
  () => renderAnnouncements()
);

feed?.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-id]");
  if (!button) return;
  openAnnouncement(announcements.find((item) => item.id === button.dataset.id));
});

prevButton?.addEventListener("click", () => moveCarousel(-1));
nextButton?.addEventListener("click", () => moveCarousel(1));

dotsHost?.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-carousel-index]");
  if (!button) return;
  carouselIndex = Number(button.dataset.carouselIndex) || 0;
  applyCarouselPosition();
});

viewport?.addEventListener("touchstart", (event) => {
  touchStartX = event.changedTouches[0]?.clientX || 0;
}, { passive: true });

viewport?.addEventListener("touchend", (event) => {
  const endX = event.changedTouches[0]?.clientX || touchStartX;
  const distance = endX - touchStartX;
  if (Math.abs(distance) < 45) return;
  moveCarousel(distance < 0 ? 1 : -1);
}, { passive: true });

if (typeof ResizeObserver !== "undefined" && viewport) {
  new ResizeObserver(() => applyCarouselPosition({ animate: false })).observe(viewport);
} else {
  window.addEventListener("resize", () => applyCarouselPosition({ animate: false }));
}

document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", closeModal));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

document.getElementById("studentLogout")?.addEventListener("click", async () => {
  sessionStorage.clear();
  try {
    await signOut(auth);
  } catch {}
  location.replace("../index/index.html");
});

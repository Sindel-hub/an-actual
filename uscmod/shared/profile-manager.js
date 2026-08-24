import { auth, db } from "../firebase/firebase-config.js";
import { signOut, updatePassword } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const SESSION_PROFILE_KEY = "studentProfile";
const SESSION_FLAG_KEY = "activeSession";
const SESSION_EXPIRES_AT_KEY = "sessionExpiresAt";
const LAST_ACTIVITY_AT_KEY = "lastActivityAt";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const OUTPUT_SIZE = 320;
const VALID_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

let currentProfile = null;
let pendingPhoto = null;
let drawerOpen = false;
let saving = false;
let backgroundScrollState = null;

function lockBackgroundScroll() {
  if (backgroundScrollState) return;
  const body = document.body;
  const root = document.documentElement;
  const scrollY = window.scrollY || root.scrollTop || 0;
  backgroundScrollState = {
    scrollY,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width,
    bodyOverflow: body.style.overflow,
    rootOverflow: root.style.overflow
  };

  root.classList.add("usc-profile-scroll-locked");
  body.classList.add("usc-profile-scroll-locked", "usc-profile-drawer-open");
  root.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
}

function unlockBackgroundScroll() {
  if (!backgroundScrollState) {
    document.documentElement.classList.remove("usc-profile-scroll-locked");
    document.body.classList.remove("usc-profile-scroll-locked", "usc-profile-drawer-open");
    return;
  }

  const state = backgroundScrollState;
  backgroundScrollState = null;
  const body = document.body;
  const root = document.documentElement;
  root.classList.remove("usc-profile-scroll-locked");
  body.classList.remove("usc-profile-scroll-locked", "usc-profile-drawer-open");
  root.style.overflow = state.rootOverflow;
  body.style.position = state.bodyPosition;
  body.style.top = state.bodyTop;
  body.style.left = state.bodyLeft;
  body.style.right = state.bodyRight;
  body.style.width = state.bodyWidth;
  body.style.overflow = state.bodyOverflow;
  window.scrollTo(0, state.scrollY);
}

function readStoredProfile() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_PROFILE_KEY) || "null");
  } catch {
    return null;
  }
}

function normalizeProfile(raw = {}) {
  const email = String(raw?.email || "").trim();
  const role = String(raw?.role || "student").trim().toLowerCase() || "student";
  const profilePhoto = String(
    raw?.profilePhoto || raw?.profilePhotoUrl || raw?.photoURL || raw?.avatarUrl || ""
  ).trim();

  return {
    ...raw,
    uid: String(raw?.uid || "").trim(),
    fullName: String(raw?.fullName || raw?.name || "").trim(),
    email,
    studentId: String(raw?.studentId || "").trim(),
    role,
    officePosition: String(raw?.officePosition || "").trim(),
    accountStatus: String(raw?.accountStatus || (raw?.isActive === false ? "suspended" : "approved")).trim().toLowerCase(),
    isActive: raw?.isActive !== false,
    profilePhoto
  };
}

function saveStoredProfile(profile) {
  const existing = readStoredProfile() || {};
  const merged = { ...existing, ...profile };
  sessionStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify(merged));
  currentProfile = normalizeProfile(merged);
}

function safePhotoSource(value) {
  const source = String(value || "").trim();
  if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(source)) return source;
  if (/^https:\/\//i.test(source)) return source;
  return "";
}

function initials(name, fallback = "US") {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || fallback;
}

function roleLabel(profile) {
  if (profile.role === "admin") return "System Administrator";
  if (profile.role === "officer") return profile.officePosition || "USC Officer";
  return "Student";
}

function welcomeRoleLabel(profile) {
  if (profile.role === "admin") return "System Administrator";
  if (profile.role === "officer") return profile.officePosition || "USC Officer";
  return "Student";
}

function titleLabel(profile) {
  if (profile.role === "admin") return "Administrator Profile";
  if (profile.role === "officer") return "Officer Profile";
  return "Student Profile";
}

function setAvatarImage(element, profile) {
  if (!element) return;
  const fallback = profile.role === "student" ? "ST" : profile.role === "admin" ? "UA" : "US";
  element.textContent = initials(profile.fullName || profile.email, fallback);
  element.classList.add("usc-profile-avatar-host");

  const photo = safePhotoSource(profile.profilePhoto);
  if (!photo) {
    element.classList.remove("usc-profile-has-photo");
    return;
  }

  const image = document.createElement("img");
  image.className = "usc-profile-avatar-image";
  image.alt = "";
  image.src = photo;
  image.addEventListener("error", () => {
    image.remove();
    element.classList.remove("usc-profile-has-photo");
  }, { once: true });
  element.appendChild(image);
  element.classList.add("usc-profile-has-photo");
}

function applyProfileToPage(profile) {
  if (!profile) return;
  const name = profile.fullName || profile.email || (profile.role === "student" ? "Student" : "USC Officer");

  document.querySelectorAll("#dashboardUserName, [data-admin-name], #adminName, .admin-name").forEach((element) => {
    element.textContent = name;
  });

  document.querySelectorAll("[data-admin-role], #adminRole, .admin-role").forEach((element) => {
    element.textContent = roleLabel(profile);
  });

  document.querySelectorAll("[data-usc-welcome-role]").forEach((element) => {
    element.textContent = welcomeRoleLabel(profile);
  });

  document.querySelectorAll("[data-usc-welcome-name]").forEach((element) => {
    element.textContent = name;
  });

  document.querySelectorAll("#dashboardUserInitials, .avatar, [data-admin-initials]").forEach((element) => {
    setAvatarImage(element, profile);
  });

  const sidebarGreeting = document.getElementById("sidebarGreeting");
  if (sidebarGreeting && profile.role === "student") {
    sidebarGreeting.innerHTML = `HELLO,<br>${name.toUpperCase()}`;
  }
  const sidebarStudentId = document.getElementById("sidebarStudentId");
  if (sidebarStudentId && profile.role === "student") {
    sidebarStudentId.textContent = profile.studentId || "Student";
  }
  const heroName = document.getElementById("heroWelcomeName");
  if (heroName && profile.role === "student") {
    heroName.textContent = name;
  }
  const heroRole = document.getElementById("heroWelcomeRole");
  if (heroRole && profile.role === "student") {
    heroRole.textContent = "Student";
  }
}

function createProfileTrigger() {
  const existing = document.getElementById("officerProfileTrigger") || document.querySelector("[data-usc-profile-trigger]");
  if (existing) {
    existing.dataset.uscProfileTrigger = "true";
    existing.classList.add("usc-profile-trigger");
    existing.setAttribute("aria-controls", "uscProfileDrawer");
    existing.setAttribute("aria-expanded", "false");
    return existing;
  }

  const studentAvatar = document.getElementById("dashboardUserInitials");
  const studentName = document.getElementById("dashboardUserName");
  if (studentAvatar && studentName && studentAvatar.parentElement === studentName.parentElement) {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "usc-profile-trigger usc-student-profile-trigger";
    trigger.dataset.uscProfileTrigger = "true";
    trigger.setAttribute("aria-label", "Open profile");
    trigger.setAttribute("aria-controls", "uscProfileDrawer");
    trigger.setAttribute("aria-expanded", "false");
    studentAvatar.parentElement.insertBefore(trigger, studentAvatar);
    trigger.append(studentAvatar, studentName);
    const chevron = document.createElement("i");
    chevron.className = "fa-solid fa-chevron-down usc-profile-trigger-chevron";
    chevron.setAttribute("aria-hidden", "true");
    trigger.appendChild(chevron);
    return trigger;
  }

  const navRight = document.querySelector(".nav-right");
  if (!navRight) return null;
  const avatar = navRight.querySelector(":scope > .avatar, :scope > [data-admin-initials]");
  if (!avatar) return null;
  const adminHeadline = navRight.querySelector(":scope > .admin-headline");
  const directName = navRight.querySelector(":scope > [data-admin-name]");
  const copy = adminHeadline || directName;
  if (!copy) return null;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "usc-profile-trigger usc-top-profile-trigger";
  trigger.dataset.uscProfileTrigger = "true";
  trigger.setAttribute("aria-label", "Open profile");
  trigger.setAttribute("aria-controls", "uscProfileDrawer");
  trigger.setAttribute("aria-expanded", "false");
  navRight.insertBefore(trigger, avatar);
  trigger.append(avatar, copy);
  const chevron = document.createElement("i");
  chevron.className = "fa-solid fa-chevron-down usc-profile-trigger-chevron";
  chevron.setAttribute("aria-hidden", "true");
  trigger.appendChild(chevron);
  return trigger;
}

function createDrawer() {
  document.getElementById("uscProfileOverlay")?.remove();
  document.getElementById("uscProfileDrawer")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "uscProfileOverlay";
  overlay.className = "usc-profile-overlay";
  overlay.hidden = true;

  const drawer = document.createElement("aside");
  drawer.id = "uscProfileDrawer";
  drawer.className = "usc-profile-drawer";
  drawer.setAttribute("aria-hidden", "true");
  drawer.setAttribute("aria-label", "Profile settings");
  drawer.innerHTML = `
    <div class="usc-profile-drawer-head">
      <div><span>ACCOUNT</span><h2 id="uscProfileTitle">Profile</h2></div>
      <button id="uscProfileClose" type="button" aria-label="Close profile"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="usc-profile-photo-section">
      <div class="usc-profile-photo-preview" id="uscProfilePhotoPreview"><span>US</span></div>
      <div class="usc-profile-photo-actions">
        <strong id="uscProfileDisplayName">User</strong>
        <small id="uscProfileDisplayRole">Account</small>
        <div class="usc-profile-photo-buttons">
          <button type="button" id="uscProfileChoosePhoto"><i class="fa-regular fa-image"></i> Change photo</button>
          <button type="button" id="uscProfileRemovePhoto" class="danger-text"><i class="fa-solid fa-trash-can"></i> Remove</button>
        </div>
        <input id="uscProfilePhotoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden />
        <p class="usc-profile-photo-help">JPG, PNG or WebP. Maximum 5 MB.</p>
      </div>
    </div>
    <form id="uscProfileForm" class="usc-profile-form">
      <label>Full Name<input id="uscProfileFullName" type="text" maxlength="80" autocomplete="name" /></label>
      <label>Email Address<input id="uscProfileEmail" type="text" readonly /></label>
      <label id="uscProfileStudentIdRow">Student ID<input id="uscProfileStudentId" type="text" readonly /></label>
      <label>Account Role<input id="uscProfileRole" type="text" readonly /></label>
      <label id="uscProfilePositionRow">USC Position<input id="uscProfilePosition" type="text" readonly /></label>
      <div class="usc-profile-account-status"><span>Account Status</span><strong id="uscProfileStatus">Approved</strong></div>
      <p class="usc-profile-message" id="uscProfileMessage" role="status"></p>
      <button type="submit" class="usc-profile-save" id="uscProfileSave"><i class="fa-solid fa-floppy-disk"></i> Save Profile</button>
    </form>
    <div class="usc-profile-password-card">
      <div class="usc-profile-password-head"><strong>Change Password</strong><small>Optional</small></div>
      <p>Replace the school-issued password whenever you want. Use at least 10 characters with uppercase, lowercase, a number and a special character.</p>
      <label>New Password<input id="uscProfileNewPassword" type="password" minlength="10" maxlength="64" autocomplete="new-password" /></label>
      <label>Confirm New Password<input id="uscProfileConfirmPassword" type="password" minlength="10" maxlength="64" autocomplete="new-password" /></label>
      <p class="usc-profile-password-message" id="uscProfilePasswordMessage" role="status"></p>
      <button type="button" class="usc-profile-save" id="uscProfileChangePassword"><i class="fa-solid fa-key"></i> Change Password</button>
    </div>
    <button type="button" class="usc-profile-logout" id="uscProfileLogout"><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
  `;

  document.body.append(overlay, drawer);
  return { overlay, drawer };
}

function setPreviewPhoto(photo, profile) {
  const preview = document.getElementById("uscProfilePhotoPreview");
  if (!preview) return;
  preview.replaceChildren();
  const safe = safePhotoSource(photo);
  if (safe) {
    const img = document.createElement("img");
    img.src = safe;
    img.alt = "Profile preview";
    preview.appendChild(img);
  } else {
    const span = document.createElement("span");
    span.textContent = initials(profile.fullName || profile.email, profile.role === "student" ? "ST" : "US");
    preview.appendChild(span);
  }
}

function fillDrawer(profile) {
  const name = profile.fullName || profile.email || "User";
  const role = profile.role === "admin" ? "Administrator" : profile.role === "officer" ? "Officer" : "Student";
  document.getElementById("uscProfileTitle").textContent = titleLabel(profile);
  document.getElementById("uscProfileDisplayName").textContent = name;
  document.getElementById("uscProfileDisplayRole").textContent = roleLabel(profile);
  document.getElementById("uscProfileFullName").value = profile.fullName || "";
  document.getElementById("uscProfileEmail").value = profile.email || "Not available";
  document.getElementById("uscProfileStudentId").value = profile.studentId || "Not available";
  document.getElementById("uscProfileRole").value = role;
  document.getElementById("uscProfilePosition").value = profile.officePosition || (profile.role === "admin" ? "System Administrator" : "Not applicable");
  document.getElementById("uscProfileStudentIdRow").hidden = !profile.studentId;
  document.getElementById("uscProfilePositionRow").hidden = profile.role === "student";

  const status = document.getElementById("uscProfileStatus");
  status.textContent = profile.isActive === false ? "Restricted" : (profile.accountStatus || "approved").replace(/^./, (c) => c.toUpperCase());
  status.dataset.status = profile.isActive === false ? "suspended" : profile.accountStatus;

  pendingPhoto = profile.profilePhoto || "";
  setPreviewPhoto(pendingPhoto, profile);
  setMessage("");
}

function setMessage(message, kind = "") {
  const element = document.getElementById("uscProfileMessage");
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
}

function openDrawer(trigger) {
  if (!currentProfile) return;
  const drawer = document.getElementById("uscProfileDrawer");
  const overlay = document.getElementById("uscProfileOverlay");
  if (!drawer || !overlay) return;
  fillDrawer(currentProfile);
  overlay.hidden = false;
  requestAnimationFrame(() => {
    overlay.classList.add("is-open");
    drawer.classList.add("is-open");
  });
  drawer.setAttribute("aria-hidden", "false");
  trigger?.setAttribute("aria-expanded", "true");
  lockBackgroundScroll();
  drawerOpen = true;
}

function closeDrawer(trigger) {
  const drawer = document.getElementById("uscProfileDrawer");
  const overlay = document.getElementById("uscProfileOverlay");
  if (!drawer || !overlay) return;
  drawer.classList.remove("is-open");
  overlay.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  trigger?.setAttribute("aria-expanded", "false");
  unlockBackgroundScroll();
  drawerOpen = false;
  window.setTimeout(() => {
    if (!drawerOpen) overlay.hidden = true;
  }, 220);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be opened."));
    image.src = source;
  });
}

async function compressProfilePhoto(file) {
  if (!VALID_IMAGE_TYPES.has(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Profile photo must be 5 MB or smaller.");
  }

  const raw = await readFileAsDataUrl(file);
  const image = await loadImage(raw);
  const crop = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - crop) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - crop) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Your browser could not process that image.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  context.drawImage(image, sourceX, sourceY, crop, crop, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function saveProfile(event) {
  event.preventDefault();
  if (saving || !currentProfile?.uid) return;

  const nameInput = document.getElementById("uscProfileFullName");
  const saveButton = document.getElementById("uscProfileSave");
  const fullName = String(nameInput?.value || "").trim().replace(/\s+/g, " ");
  if (fullName.length < 2) {
    setMessage("Please enter your full name.", "error");
    nameInput?.focus();
    return;
  }
  if (fullName.length > 80) {
    setMessage("Full name must be 80 characters or fewer.", "error");
    return;
  }

  const activeUid = auth.currentUser?.uid || currentProfile.uid;
  if (auth.currentUser?.uid && auth.currentUser.uid !== currentProfile.uid) {
    setMessage("Your session changed. Please sign in again.", "error");
    return;
  }

  saving = true;
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }
  setMessage("Saving your profile…");

  try {
    await updateDoc(doc(db, "users", activeUid), {
      fullName,
      profilePhoto: safePhotoSource(pendingPhoto),
      profileUpdatedAt: serverTimestamp()
    });

    currentProfile = normalizeProfile({
      ...currentProfile,
      fullName,
      profilePhoto: safePhotoSource(pendingPhoto)
    });
    saveStoredProfile(currentProfile);
    applyProfileToPage(currentProfile);
    fillDrawer(currentProfile);
    setMessage("Profile updated successfully.", "success");
    window.dispatchEvent(new CustomEvent("usc-profile-updated", { detail: currentProfile }));
  } catch (error) {
    console.error("Profile update error:", error);
    setMessage("Unable to save your profile. Check your connection or account permissions.", "error");
  } finally {
    saving = false;
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Profile';
    }
  }
}


function strongPassword(value) {
  const password = String(value || "");
  return password.length >= 10
    && password.length <= 64
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9\s]/.test(password);
}

async function changeOwnPassword() {
  const user = auth.currentUser;
  const newPassword = document.getElementById("uscProfileNewPassword")?.value || "";
  const confirmPassword = document.getElementById("uscProfileConfirmPassword")?.value || "";
  const message = document.getElementById("uscProfilePasswordMessage");
  const button = document.getElementById("uscProfileChangePassword");
  const setPasswordMessage = (text, kind = "") => {
    if (!message) return;
    message.textContent = text;
    message.dataset.kind = kind;
  };
  if (!user) return setPasswordMessage("Your session is no longer active. Sign in again.", "error");
  if (!strongPassword(newPassword)) return setPasswordMessage("Use 10–64 characters with uppercase, lowercase, number and special character.", "error");
  if (newPassword !== confirmPassword) return setPasswordMessage("The new passwords do not match.", "error");
  if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...'; }
  setPasswordMessage("Updating your password…");
  try {
    await updatePassword(user, newPassword);
    document.getElementById("uscProfileNewPassword").value = "";
    document.getElementById("uscProfileConfirmPassword").value = "";
    setPasswordMessage("Password changed successfully.", "success");
  } catch (error) {
    console.error("Password change error:", error);
    if (error?.code === "auth/requires-recent-login") {
      setPasswordMessage("For security, sign out and sign in again, then change the password immediately.", "error");
    } else if (error?.code === "auth/weak-password") {
      setPasswordMessage("Choose a stronger password.", "error");
    } else {
      setPasswordMessage("Unable to change the password right now. Try again.", "error");
    }
  } finally {
    if (button) { button.disabled = false; button.innerHTML = '<i class="fa-solid fa-key"></i> Change Password'; }
  }
}

async function logoutFromProfile() {
  sessionStorage.removeItem(SESSION_FLAG_KEY);
  sessionStorage.removeItem(SESSION_PROFILE_KEY);
  sessionStorage.removeItem(SESSION_EXPIRES_AT_KEY);
  sessionStorage.removeItem(LAST_ACTIVITY_AT_KEY);
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Profile logout error:", error);
  }
  window.location.replace(new URL("../index/index.html", import.meta.url).href);
}

async function refreshProfileFromFirestore() {
  const stored = readStoredProfile();
  if (!stored?.uid) return;
  try {
    const snapshot = await getDoc(doc(db, "users", stored.uid));
    if (!snapshot.exists()) return;
    const fresh = normalizeProfile({ ...stored, ...snapshot.data(), uid: stored.uid });
    saveStoredProfile(fresh);
    applyProfileToPage(fresh);
    if (drawerOpen) fillDrawer(fresh);
  } catch (error) {
    console.warn("Unable to refresh profile details:", error);
  }
}

function bindDrawer(trigger, overlay, drawer) {
  trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    if (drawerOpen) closeDrawer(trigger);
    else openDrawer(trigger);
  });
  document.getElementById("uscProfileClose")?.addEventListener("click", () => closeDrawer(trigger));
  overlay.addEventListener("click", () => closeDrawer(trigger));
  document.getElementById("uscProfileForm")?.addEventListener("submit", saveProfile);
  document.getElementById("uscProfileChoosePhoto")?.addEventListener("click", () => document.getElementById("uscProfilePhotoInput")?.click());
  document.getElementById("uscProfileRemovePhoto")?.addEventListener("click", () => {
    pendingPhoto = "";
    setPreviewPhoto("", currentProfile);
    setMessage("Photo removed from the preview. Select Save Profile to apply.");
  });
  document.getElementById("uscProfilePhotoInput")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("Preparing photo…");
    try {
      pendingPhoto = await compressProfilePhoto(file);
      setPreviewPhoto(pendingPhoto, currentProfile);
      setMessage("Photo ready. Select Save Profile to apply.", "success");
    } catch (error) {
      setMessage(error.message || "Unable to use that image.", "error");
    } finally {
      event.target.value = "";
    }
  });
  document.getElementById("uscProfileChangePassword")?.addEventListener("click", changeOwnPassword);
  document.getElementById("uscProfileLogout")?.addEventListener("click", logoutFromProfile);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawerOpen) closeDrawer(trigger);
  });

  // Keep keyboard focus inside the open panel for normal Tab navigation entry.
  drawer.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...drawer.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"])')].filter((el) => !el.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

window.addEventListener("pagehide", unlockBackgroundScroll, { once: true });

function initialize() {
  if (sessionStorage.getItem(SESSION_FLAG_KEY) !== "true") return;
  const stored = readStoredProfile();
  if (!stored?.uid) return;
  currentProfile = normalizeProfile(stored);
  applyProfileToPage(currentProfile);
  const trigger = createProfileTrigger();
  if (!trigger) return;
  const { overlay, drawer } = createDrawer();
  bindDrawer(trigger, overlay, drawer);
  refreshProfileFromFirestore();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
  initialize();
}

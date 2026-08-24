
import { auth } from "../../firebase/firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const SESSION_FLAG_KEY = "activeSession";
const SESSION_PROFILE_KEY = "studentProfile";
const SESSION_EXPIRES_AT_KEY = "sessionExpiresAt";
const LAST_ACTIVITY_AT_KEY = "lastActivityAt";

function profile() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_PROFILE_KEY) || "null"); }
  catch { return null; }
}
function initials(name = "Student") {
  return String(name).trim().split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0].toUpperCase()).join("") || "ST";
}
function clearSession() {
  sessionStorage.removeItem(SESSION_FLAG_KEY);
  sessionStorage.removeItem(SESSION_PROFILE_KEY);
  sessionStorage.removeItem(SESSION_EXPIRES_AT_KEY);
  sessionStorage.removeItem(LAST_ACTIVITY_AT_KEY);
}
async function logout() {
  clearSession();
  try { await signOut(auth); } catch {}
  window.location.replace("../index/index.html");
}
function ensureSession() {
  if (sessionStorage.getItem(SESSION_FLAG_KEY) !== "true") {
    window.location.replace("../index/index.html");
    return null;
  }
  const p = profile();
  if (!p) {
    clearSession();
    window.location.replace("../index/index.html");
    return null;
  }
  return p;
}
function applyIdentity(p) {
  const fullName = String(p.fullName || "Student").trim() || "Student";
  const tag = String(p.studentId || p.email || "Student").trim() || "Student";
  const short = initials(fullName);
  const nameEl = document.getElementById("dashboardUserName");
  const initEl = document.getElementById("dashboardUserInitials");
  const greetEl = document.getElementById("sidebarGreeting");
  const studentIdEl = document.getElementById("sidebarStudentId");
  if (nameEl) nameEl.textContent = fullName;
  if (initEl) initEl.textContent = short;
  if (greetEl) greetEl.innerHTML = `HELLO,<br>${fullName.toUpperCase()}`;
  if (studentIdEl) studentIdEl.textContent = tag;
}
const p = ensureSession();
if (p) {
  applyIdentity(p);
  document.getElementById("studentLogout")?.addEventListener("click", logout);
  window.logout = logout;
}

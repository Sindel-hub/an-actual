import { auth, db } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { isActiveStudentStanding, studentStandingLabel } from "./student-standing.js";

const SESSION_MS = 15 * 60 * 1000;
const LOGIN_URL = new URL("../index/index.html", import.meta.url).href;
let lastTouch = 0;
let settled = false;
let profileWatcherBound = false;

function settle(allowed) {
  if (settled) return allowed;
  settled = true;
  try { globalThis.USC_RESOLVE_AUTH_READY?.(Boolean(allowed)); } catch {}
  try { delete globalThis.USC_RESOLVE_AUTH_READY; } catch {}
  return allowed;
}

function expectedRoles() {
  const path = location.pathname.toLowerCase();
  if (path.includes("/usc-admin/admin-dashboard/") || path.includes("/usc-admin/student-registration/")) return ["admin"];
  if (path.includes("/usc-admin/")) return ["officer", "admin"];
  if (path.includes("/dashboard/") || path.includes("/complaint/") || path.includes("/voting/")) return ["student"];
  return [];
}

function isElectionProtectedPath() {
  const path = location.pathname.toLowerCase();
  return path.includes("/dashboard/election") || path.includes("/voting/");
}

function clearLocalSession() {
  ["activeSession", "studentProfile", "sessionExpiresAt", "lastActivityAt"].forEach((key) => sessionStorage.removeItem(key));
}

async function fail(message) {
  clearLocalSession();
  settle(false);
  try { await signOut(auth); } catch {}
  if (message) sessionStorage.setItem("authGuardMessage", message);
  location.replace(LOGIN_URL);
  return false;
}

function activeEnrollment(value) {
  return ["enrolled", "active", "currently enrolled", "graduating"].includes(String(value || "").trim().toLowerCase());
}

async function currentElectionEligibility(profile) {
  if (!profile?.studentId) return { configured: false, eligible: false, electionId: "" };
  try {
    const pointer = await getDoc(doc(db, "election_config", "current"));
    if (!pointer.exists() || !pointer.data()?.electionId) return { configured: false, eligible: false, electionId: "" };
    const electionId = String(pointer.data().electionId);
    const roster = await getDoc(doc(db, "elections", electionId, "voterRoster", String(profile.studentId)));
    const data = roster.exists() ? roster.data() : null;
    return {
      configured: true,
      electionId,
      eligible: Boolean(data?.eligible === true && activeEnrollment(data?.enrollmentStatus))
    };
  } catch (error) {
    console.warn("Current election eligibility check failed:", error);
    return { configured: true, electionId: "", eligible: false, unavailable: true };
  }
}

function refreshSession(profile, claims = {}, electionEligibility = null, resolvedRole = "") {
  const now = Date.now();
  const role = String(resolvedRole || claims.role || profile.role || "student").toLowerCase();
  const session = {
    uid: auth.currentUser?.uid || profile.uid || "",
    fullName: profile.fullName || "",
    email: profile.institutionalEmail || profile.email || auth.currentUser?.email || "",
    studentId: profile.studentId || "",
    profilePhoto: profile.profilePhoto || "",
    role,
    isActive: profile.isActive !== false,
    accountStatus: profile.accountStatus || "pending",
    isVerifiedStudent: profile.isVerifiedStudent === true,
    officePosition: profile.officePosition || (role === "admin" ? "System Administrator" : ""),
    college: profile.college || "",
    program: profile.program || "",
    enrollmentStatus: profile.enrollmentStatus || "",
    yearLevel: profile.yearLevel || "",
    studentStanding: profile.studentStanding || "active",
    currentElectionId: electionEligibility?.electionId || "",
    electionEligible: electionEligibility?.eligible === true
  };
  sessionStorage.setItem("activeSession", "true");
  sessionStorage.setItem("studentProfile", JSON.stringify(session));
  sessionStorage.setItem("lastActivityAt", String(now));
  sessionStorage.setItem("sessionExpiresAt", String(now + SESSION_MS));
}

function bindIdleExpiry() {
  const touch = () => {
    const now = Date.now();
    if (now - lastTouch < 30000) return;
    lastTouch = now;
    sessionStorage.setItem("lastActivityAt", String(now));
    sessionStorage.setItem("sessionExpiresAt", String(now + SESSION_MS));
  };
  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => addEventListener(eventName, touch, { passive: true }));
  setInterval(() => {
    const expiresAt = Number(sessionStorage.getItem("sessionExpiresAt") || 0);
    if (expiresAt && Date.now() > expiresAt) fail("Your session expired. Please sign in again.");
  }, 30000);
}

function bindProfileAccessWatcher(userId, role) {
  if (profileWatcherBound || !userId) return;
  profileWatcherBound = true;
  onSnapshot(doc(db, "users", userId), async (snap) => {
    if (!snap.exists()) { await fail("Your school account profile is no longer available."); return; }
    const profile = snap.data();
    const status = String(profile.accountStatus || "pending").toLowerCase();
    if (profile.isActive === false || status === "suspended") {
      await fail("Your school account is no longer active. Contact the System Administrator.");
      return;
    }
    if ((role === "student" || role === "officer") && !isActiveStudentStanding(profile.studentStanding, profile.enrollmentStatus)) {
      await fail(`Portal access was disabled because your student standing changed to ${studentStandingLabel(profile.studentStanding)}.`);
    }
  }, (error) => console.warn("Account access watcher stopped:", error));
}

async function verifyProtectedPage() {
  const roles = expectedRoles();
  if (!roles.length) return settle(true);

  const expiresAt = Number(sessionStorage.getItem("sessionExpiresAt") || 0);
  if (expiresAt && Date.now() > expiresAt) return fail("Your session expired. Please sign in again.");

  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (!user) { resolve(await fail("Please sign in to continue.")); return; }
      try {
        const token = await user.getIdTokenResult(true);
        const tokenRole = String(token.claims.role || "").toLowerCase();

        const profileSnap = await getDoc(doc(db, "users", user.uid));
        if (!profileSnap.exists()) { resolve(await fail("Your account profile is unavailable.")); return; }
        const profile = profileSnap.data();
        const profileRole = String(profile.role || "").toLowerCase();
        // Admin authority still requires the trusted Firebase custom claim. Student and
        // officer routing can use the administrator-controlled Firestore profile, which
        // lets the browser provisioning build create school accounts without an Admin SDK.
        const role = tokenRole === "admin" ? "admin" : (profileRole || tokenRole || "student");

        if (!roles.includes(role)) { resolve(await fail("Your account role does not permit access to this dashboard.")); return; }
        if (role === "admin" && tokenRole !== "admin") { resolve(await fail("This account is not a trusted System Administrator.")); return; }
        // Do not block school-provisioned officer/admin access on Firebase emailVerified.
        // The school-controlled profile is the source of truth for account approval, while
        // System Administrator authority still requires the trusted Firebase admin claim.

        const status = String(profile.accountStatus || "pending").toLowerCase();
        if (profile.isActive === false || status === "suspended") { resolve(await fail("This account is suspended or inactive.")); return; }
        if ((role === "student" || role === "officer") && !isActiveStudentStanding(profile.studentStanding, profile.enrollmentStatus)) {
          resolve(await fail(`Portal access is disabled because your student standing is ${studentStandingLabel(profile.studentStanding)}. Contact the System Administrator if this record is incorrect.`)); return;
        }
        if (profileRole !== role) { resolve(await fail("Your account role is being updated. Sign in again after the administrator completes the change.")); return; }

        if (role === "student") {
          if (status !== "approved" || profile.schoolProvisioned !== true) {
            resolve(await fail("This is not an active school-provisioned student account. Contact the system administrator.")); return;
          }
          const electionEligibility = await currentElectionEligibility(profile);
          if (isElectionProtectedPath()) {
            if (profile.isVerifiedStudent !== true || !activeEnrollment(profile.enrollmentStatus) || !isActiveStudentStanding(profile.studentStanding, profile.enrollmentStatus)) {
              resolve(await fail("Your school account is valid, but you are not currently verified as an eligible voter for this election.")); return;
            }
            if (electionEligibility.unavailable || (electionEligibility.configured && !electionEligibility.eligible)) {
              resolve(await fail(electionEligibility.unavailable
                ? "Election eligibility could not be verified. Please try again."
                : "Your current voter-roster record is not eligible for this election."));
              return;
            }
          }
          refreshSession(profile, token.claims, electionEligibility, role);
        } else {
          if (status !== "approved") { resolve(await fail("This privileged account is not approved for dashboard access.")); return; }
          refreshSession(profile, token.claims, null, role);
        }

        bindIdleExpiry();
        bindProfileAccessWatcher(user.uid, role);
        settle(true);
        resolve(true);
      } catch (error) {
        console.error("Authentication guard error:", error);
        resolve(await fail("Your account could not be verified. Please sign in again."));
      }
    });
  });
}

await verifyProtectedPage();

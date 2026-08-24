import { auth, db } from "../../firebase/firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { isActiveStudentStanding, studentStandingLabel } from "../../shared/student-standing.js";

const dom = {
  signinForm: document.getElementById("signinForm"),
  signinIdentifierInput: document.getElementById("signinIdentifier"),
  signinPasswordInput: document.getElementById("signinPassword"),
  forgotPasswordBtn: document.getElementById("forgotPasswordBtn")
};
const signinSubmitButton = dom.signinForm?.querySelector('button[type="submit"]');
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const STUDENT_ID_REGEX = /^\d{6}$/;
const SESSION_DURATION_MS = 15 * 60 * 1000;

function clean(value) { return String(value || "").trim(); }
function normalizeEmail(value) { return clean(value).toLowerCase(); }
function normalizeStudentId(value) { return clean(value).replace(/\D/g, "").slice(0, 6); }
function isEmail(value) { return EMAIL_REGEX.test(clean(value)); }
function isStudentId(value) { return STUDENT_ID_REGEX.test(clean(value)); }

function clearSession() {
  ["activeSession","studentProfile","sessionExpiresAt","lastActivityAt"].forEach((key) => sessionStorage.removeItem(key));
}

function buildSession(profile, claims) {
  const now = Date.now();
  const role = String(claims?.role || profile?.role || "student").toLowerCase();
  const sessionProfile = {
    uid: auth.currentUser?.uid || profile?.uid || "",
    fullName: profile?.fullName || "",
    email: profile?.institutionalEmail || profile?.email || auth.currentUser?.email || "",
    authEmail: auth.currentUser?.email || "",
    studentId: profile?.studentId || "",
    profilePhoto: profile?.profilePhoto || "",
    role,
    isActive: profile?.isActive !== false,
    accountStatus: profile?.accountStatus || "pending",
    isVerifiedStudent: profile?.isVerifiedStudent === true,
    officePosition: profile?.officePosition || (role === "admin" ? "System Administrator" : ""),
    college: profile?.college || "",
    program: profile?.program || "",
    enrollmentStatus: profile?.enrollmentStatus || "",
    yearLevel: profile?.yearLevel || "",
    studentStanding: profile?.studentStanding || "active",
    schoolProvisioned: profile?.schoolProvisioned === true
  };
  sessionStorage.setItem("activeSession", "true");
  sessionStorage.setItem("studentProfile", JSON.stringify(sessionProfile));
  sessionStorage.setItem("lastActivityAt", String(now));
  sessionStorage.setItem("sessionExpiresAt", String(now + SESSION_DURATION_MS));
  return sessionProfile;
}

function redirectByRole(role) {
  if (role === "admin") location.href = "../usc-admin/admin-dashboard/admin-dashboard.html";
  else if (role === "officer") location.href = "../usc-admin/overview/overview.html";
  else location.href = "../dashboard/dashboard.html";
}

async function cleanupAndAlert(message) {
  clearSession();
  try { await signOut(auth); } catch {}
  alert(message);
}

function buttonState(loading) {
  if (!signinSubmitButton) return;
  signinSubmitButton.disabled = loading;
  signinSubmitButton.textContent = loading ? "SIGNING IN..." : "SIGN IN";
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function schoolAuthAliasForEmail(email) {
  const key = `email_${await sha256Hex(normalizeEmail(email))}`;
  try {
    const snap = await getDoc(doc(db, "login_aliases", key));
    return snap.exists() ? normalizeEmail(snap.data()?.authEmail) : "";
  } catch (error) {
    console.warn("School login alias lookup failed:", error);
    return "";
  }
}


async function schoolAuthAliasForStudentId(studentId) {
  const key = `id_${normalizeStudentId(studentId)}`;
  try {
    const snap = await getDoc(doc(db, "login_aliases", key));
    return snap.exists() ? normalizeEmail(snap.data()?.authEmail) : "";
  } catch (error) {
    console.warn("Student ID login alias lookup failed:", error);
    return "";
  }
}

async function resolveLoginCandidates(identifier) {
  const value = clean(identifier);
  if (isStudentId(value)) {
    const id = normalizeStudentId(value);
    const alias = await schoolAuthAliasForStudentId(id);
    // The synthetic address is retained only as a compatibility fallback for
    // accounts created by an older project revision.
    return [...new Set([alias, `${id}@student.ssu-usc.local`].filter(Boolean))];
  }
  if (!isEmail(value)) throw new Error("Enter your institutional email address or your 6-digit Student ID.");
  const direct = normalizeEmail(value);
  const alias = await schoolAuthAliasForEmail(direct);
  return [...new Set([direct, alias].filter(Boolean))];
}

async function signInByIdentifier(identifier, password) {
  const candidates = await resolveLoginCandidates(identifier);
  let lastError = null;
  for (const email of candidates) {
    try { return await signInSecurely(email, password); }
    catch (error) {
      lastError = error;
      if (!["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(error?.code)) throw error;
    }
  }
  throw lastError || Object.assign(new Error("Invalid school account or password."), { code: "auth/invalid-credential" });
}

async function signInSecurely(email, password) {
  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    if (error?.code === "auth/multi-factor-auth-required") {
      const wrapped = new Error("This account still has a legacy MFA factor enrolled. Ask the system administrator to remove the old factor before signing in.");
      wrapped.code = "auth/legacy-mfa-enrolled";
      throw wrapped;
    }
    throw error;
  }
}

function bindSignin() {
  dom.signinForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const identifier = clean(dom.signinIdentifierInput?.value);
    const password = dom.signinPasswordInput?.value || "";
    if (!identifier) return alert("Enter your institutional email or Student ID.");
    if (!password) return alert("Enter your school-issued password.");

    buttonState(true);
    try {
      const credential = await signInByIdentifier(identifier, password);
      const user = credential.user;

      const token = await user.getIdTokenResult(true);
      const tokenRole = String(token.claims.role || "").toLowerCase();

      const profileSnap = await getDoc(doc(db, "users", user.uid));
      if (!profileSnap.exists()) {
        await cleanupAndAlert("Your school account profile was not found. Contact the system administrator.");
        return;
      }
      const profile = profileSnap.data();
      const profileRole = String(profile.role || "student").toLowerCase();
      const role = tokenRole === "admin" ? "admin" : profileRole;

      if (!["student","officer","admin"].includes(role)) {
        await cleanupAndAlert("This account does not have a valid system role.");
        return;
      }
      if (role === "admin" && tokenRole !== "admin") {
        await cleanupAndAlert("This account is not a trusted System Administrator.");
        return;
      }
      // School-provisioned privileged accounts are authorized by the administrator-controlled
      // profile plus the trusted admin claim for System Administrators. Firebase's optional
      // emailVerified flag is not used as a second, conflicting "school verification" switch.
      if (profile.isActive === false || String(profile.accountStatus || "").toLowerCase() === "suspended") {
        await cleanupAndAlert("This school account is suspended or inactive.");
        return;
      }
      if ((role === "student" || role === "officer") && !isActiveStudentStanding(profile.studentStanding, profile.enrollmentStatus)) {
        await cleanupAndAlert(`Portal access is disabled because your student standing is ${studentStandingLabel(profile.studentStanding)}. Contact the System Administrator if this record is incorrect.`);
        return;
      }

      const session = buildSession({ ...profile, role }, token.claims);
      dom.signinForm.reset();
      redirectByRole(session.role);
    } catch (error) {
      console.error("Sign-in error:", error);
      if (["auth/invalid-credential","auth/wrong-password","auth/user-not-found"].includes(error.code)) {
        alert("Invalid school account or password.");
      } else if (error.code === "auth/too-many-requests") {
        alert("Too many failed sign-in attempts. Wait before trying again or use password reset.");
      } else if (error.code === "auth/user-disabled") {
        alert("This account has been disabled. Contact the system administrator.");
      } else if (error.code === "auth/network-request-failed") {
        alert("Network error. Check your connection and try again.");
      } else {
        alert(error.message || "Sign in failed.");
      }
    } finally {
      buttonState(false);
    }
  });
}

function bindRecovery() {
  dom.forgotPasswordBtn?.addEventListener("click", async () => {
    const identifier = clean(dom.signinIdentifierInput?.value) || clean(prompt("Enter your institutional email or Student ID:"));
    if (!identifier) return;
    try {
      let email = "";
      if (isStudentId(identifier)) {
        email = await schoolAuthAliasForStudentId(identifier);
        if (!email) throw new Error("No school account was found for that Student ID.");
      } else {
        email = normalizeEmail(identifier);
        if (!isEmail(email)) throw new Error("Enter a valid institutional email or 6-digit Student ID.");
        const studentAlias = await schoolAuthAliasForEmail(email);
        if (studentAlias) email = studentAlias;
      }
      if (email.endsWith("@student.ssu-usc.local")) {
        throw new Error("This is a legacy school account. Ask the System Administrator to migrate it to an institutional-email login.");
      }
      await sendPasswordResetEmail(auth, email);
      alert("A password-reset link was sent to the institutional email, if the account exists.");
    } catch (error) {
      console.error("Password reset error:", error);
      alert(error.message || "Unable to start password reset. Contact the system administrator if needed.");
    }
  });
}

dom.signinIdentifierInput?.addEventListener("input", () => {
  const value = clean(dom.signinIdentifierInput.value);
  if (/^\d+$/.test(value)) dom.signinIdentifierInput.value = value.slice(0, 6);
});

const guardMessage = sessionStorage.getItem("authGuardMessage");
if (guardMessage) {
  sessionStorage.removeItem("authGuardMessage");
  setTimeout(() => alert(guardMessage), 0);
}

bindSignin();
bindRecovery();

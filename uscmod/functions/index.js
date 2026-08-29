"use strict";

const crypto = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { createClient } = require("@supabase/supabase-js");
const { lifecycleFromSchedule } = require("./election-lifecycle");

initializeApp();
const db = getFirestore();
// Prevent audit/log payloads from crashing a callable function when an older
// user profile is missing an optional field such as officePosition.
db.settings({ ignoreUndefinedProperties: true });
const adminAuth = getAuth();

const REGION = "asia-southeast1";
const SUPABASE_URL = defineSecret("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = defineSecret("SUPABASE_SERVICE_ROLE_KEY");
const PUBLIC_BUCKET = "usc-public-media";
const PRIVATE_BUCKET = "usc-private-documents";

const POSITIONS = [
  "President",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Auditor",
  "Public Relations Officer (PRO)",
  "Business Manager",
  "Sgt. at Arms",
  "Department Representative"
];

const SCHEDULE_FIELDS = [
  "registrationStart", "registrationEnd",
  "applicationReviewStart", "applicationReviewEnd",
  "candidatePublicationStart", "candidatePublicationEnd",
  "votingStart", "votingEnd",
  "resultPublicationStart", "resultPublicationEnd"
];

function callableOptions(extra = {}) {
  // Local/development deployments can temporarily disable App Check while the
  // reCAPTCHA Enterprise key is not configured. Set USC_ENFORCE_APP_CHECK=true
  // in the Functions environment before production deployment.
  const enforceAppCheck = String(process.env.USC_ENFORCE_APP_CHECK || "false").trim().toLowerCase() === "true";
  return { region: REGION, enforceAppCheck, ...extra };
}

function requireAuth(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  return request.auth;
}

function roleOf(request) {
  return String(request.auth?.token?.role || "").toLowerCase();
}

function requireRole(request, roles) {
  requireAuth(request);
  if (!roles.includes(roleOf(request))) {
    throw new HttpsError("permission-denied", "You are not authorized to perform this action.");
  }
}

function requireCanvasser(request) {
  requireAuth(request);
  if (roleOf(request) === "admin") return;
  if (roleOf(request) === "officer" && request.auth?.token?.canvasser === true) return;
  throw new HttpsError("permission-denied", "Canvassing authorization is required.");
}

async function requireActiveRole(request, roles) {
  requireRole(request, roles);
  if (roleOf(request) === "admin") requireVerifiedAdminEmail(request);
  const snap = await db.doc(`users/${request.auth.uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "Trusted account profile not found.");
  const profile = snap.data();
  const profileRole = cleanText(profile.role, 20).toLowerCase();
  if (!roles.includes(profileRole) || String(profile.accountStatus || "pending").toLowerCase() !== "approved" || profile.isActive === false) {
    throw new HttpsError("permission-denied", "This privileged account is not approved, active, or no longer has the required role.");
  }
  return profile;
}

async function requireActiveCanvasser(request) {
  requireCanvasser(request);
  if (roleOf(request) === "admin") requireVerifiedAdminEmail(request);
  const snap = await db.doc(`users/${request.auth.uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "Trusted account profile not found.");
  const profile = snap.data();
  if (String(profile.accountStatus || "pending").toLowerCase() !== "approved" || profile.isActive === false) throw new HttpsError("permission-denied", "This canvassing account is not approved or active.");
  if (roleOf(request) === "admin" && cleanText(profile.role, 20).toLowerCase() !== "admin") throw new HttpsError("permission-denied", "Administrator role was revoked.");
  if (roleOf(request) === "officer" && cleanText(profile.role, 20).toLowerCase() !== "officer") throw new HttpsError("permission-denied", "Officer role was revoked.");
  return profile;
}

function requireRecentAuth(request, maxAgeSeconds = 30 * 60) {
  const authTime = Number(request.auth?.token?.auth_time || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authTime || now - authTime > maxAgeSeconds) {
    throw new HttpsError("failed-precondition", "Please sign in again before performing this sensitive action.");
  }
}

function requireVerifiedAdminEmail(request) {
  if (roleOf(request) !== "admin") return;
  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError("failed-precondition", "System Administrator email verification is required before privileged operations are allowed.");
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStudentId(value) {
  const id = String(value || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(id)) throw new HttpsError("invalid-argument", "Student ID must contain exactly six digits.");
  return id;
}

function cleanText(value, max = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function bool(value) {
  return value === true || String(value).toLowerCase() === "true" || String(value) === "1";
}

function toDate(value, fieldName) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") return value.toDate();
  if (typeof value === "number") return new Date(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new HttpsError("invalid-argument", `${fieldName} is not a valid date/time.`);
  return parsed;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

function validateSchedule(raw = {}) {
  const dates = {};

  for (const field of SCHEDULE_FIELDS) {
    dates[field] = toDate(raw[field], field);
  }

  const pairs = [
    ["registrationStart", "registrationEnd", "Candidate Registration"],
    ["applicationReviewStart", "applicationReviewEnd", "Application Review"],
    ["candidatePublicationStart", "candidatePublicationEnd", "Candidate Publication"],
    ["votingStart", "votingEnd", "Voting"],
    ["resultPublicationStart", "resultPublicationEnd", "Result Publication"]
  ];

  /*
   * Validate each individual schedule window.
   */
  for (const [start, end, label] of pairs) {
    if (dates[end] <= dates[start]) {
      throw new HttpsError(
        "invalid-argument",
        `${label} must close after it opens.`
      );
    }
  }

  /*
   * Candidate Registration -> Application Review
   */
  if (dates.applicationReviewStart < dates.registrationEnd) {
    throw new HttpsError(
      "invalid-argument",
      "Application Review cannot begin before Candidate Registration closes."
    );
  }

  /*
   * Application Review -> Candidate Publication
   */
  if (dates.candidatePublicationStart < dates.applicationReviewEnd) {
    throw new HttpsError(
      "invalid-argument",
      "Candidate Publication cannot begin before Application Review closes."
    );
  }

  /*
   * Application Review -> Voting
   *
   * NO Candidate Publication End -> Voting Start dependency.
   */
  if (dates.votingStart < dates.applicationReviewEnd) {
    throw new HttpsError(
      "invalid-argument",
      "Voting cannot begin before Application Review closes. Candidate Publication may overlap with Voting."
    );
  }

  /*
   * Voting -> Result Publication
   */
  if (dates.resultPublicationStart < dates.votingEnd) {
    throw new HttpsError(
      "invalid-argument",
      "Result Publication cannot begin before Voting closes."
    );
  }

  return Object.fromEntries(
    Object.entries(dates).map(([key, value]) => [
      key,
      Timestamp.fromDate(value)
    ])
  );
}
function electionLifecycle(election, nowMs = Date.now()) { return lifecycleFromSchedule(election, nowMs); }

function inWindow(election, startField, endField, nowMs = Date.now()) {
  return nowMs >= toMillis(election[startField]) && nowMs < toMillis(election[endField]);
}

async function currentElectionId() {
  const snap = await db.doc("election_config/current").get();
  if (!snap.exists || !snap.get("electionId")) {
    throw new HttpsError("failed-precondition", "No active election has been configured.");
  }
  return String(snap.get("electionId"));
}

async function currentElection() {
  const electionId = await currentElectionId();
  const ref = db.doc(`elections/${electionId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "The active election record is unavailable.");
  return { electionId, ref, data: snap.data() };
}

function auditSafe(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  // Preserve Firestore Timestamp-like values instead of expanding their private
  // implementation fields into the audit document.
  if (typeof value.toDate === "function" || typeof value.toMillis === "function") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(auditSafe);
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, auditSafe(nested)])
  );
}

function auditData(request, action, target, before = null, after = null, extra = {}) {
  const safeExtra = auditSafe(extra) || {};
  return {
    actorUid: request.auth?.uid || "system",
    actorRole: roleOf(request) || "system",
    actorEmail: normalizeEmail(request.auth?.token?.email),
    action,
    target,
    before: auditSafe(before),
    after: auditSafe(after),
    ...safeExtra,
    createdAt: FieldValue.serverTimestamp()
  };
}

async function audit(request, action, target, before = null, after = null, extra = {}) {
  await db.collection("audit_logs").add(auditData(request, action, target, before, after, extra));
}

async function setTrustedClaims(uid, patch) {
  const user = await adminAuth.getUser(uid);
  const existing = user.customClaims || {};
  await adminAuth.setCustomUserClaims(uid, { ...existing, ...patch });
}

function verifiedStudentClaim(request) {
  return request.auth?.token?.role === "student" && request.auth?.token?.verifiedStudent === true;
}

function requireVerifiedStudent(request) {
  requireAuth(request);
  if (!verifiedStudentClaim(request)) {
    throw new HttpsError("permission-denied", "A verified, eligible student account is required.");
  }
}

async function requireActiveVerifiedStudent(request) {
  requireVerifiedStudent(request);
  const snap = await db.doc(`users/${request.auth.uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "Verified student profile not found.");
  const profile = snap.data();
  if (profile.role !== "student" || profile.accountStatus !== "approved" || profile.isVerifiedStudent !== true || profile.isActive === false) {
    throw new HttpsError("permission-denied", "This verified student account is not active.");
  }
  return profile;
}

function enrollmentIsActive(value) {
  const status = cleanText(value, 50).toLowerCase();
  return ["enrolled", "active", "currently enrolled", "graduating"].includes(status);
}

function rosterIsEligible(data) {
  return Boolean(data && data.eligible === true && enrollmentIsActive(data.enrollmentStatus));
}

function sanitizeMasterRow(row) {
  const studentId = normalizeStudentId(row.studentId);
  const email = normalizeEmail(row.institutionalEmail || row.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpsError("invalid-argument", `A valid institutional email is required for student ${studentId}.`);
  const fullName = cleanText(row.fullName, 120);
  if (!fullName) throw new HttpsError("invalid-argument", `Full name is required for student ${studentId}.`);
  return {
    studentId,
    fullName,
    email,
    institutionalEmail: email,
    program: cleanText(row.program, 160),
    college: cleanText(row.college, 160),
    enrollmentStatus: cleanText(row.enrollmentStatus || "Enrolled", 50),
    eligible: bool(row.eligible) && enrollmentIsActive(row.enrollmentStatus || "Enrolled"),
    updatedAt: FieldValue.serverTimestamp()
  };
}

function generateTemporaryPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%";
  const all = upper + lower + digits + special;
  const pick = (chars) => chars[crypto.randomInt(0, chars.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}


exports.getOfficerDashboardMetrics = onCall(callableOptions(), async (request) => {
  await requireActiveRole(request, ["officer", "admin"]);
  const snap = await db.collection("users").where("role", "==", "officer").get();
  const activeOfficerCount = snap.docs.reduce((count, docSnap) => {
    const profile = docSnap.data() || {};
    return count + (profile.accountStatus === "approved" && profile.isActive !== false ? 1 : 0);
  }, 0);
  return { activeOfficerCount };
});

exports.getElectionContext = onCall(callableOptions(), async (request) => {
  requireAuth(request);
  const { electionId, data: election } = await currentElection();
  const nowMs = Date.now();
  const scheduleComplete = SCHEDULE_FIELDS.every((field) => toMillis(election[field]) > 0);
  const lifecycle = scheduleComplete ? electionLifecycle(election, nowMs) : "Draft";
  const context = {
    electionId,
    title: election.title || "USC Election",
    lifecycle,
    scheduleComplete,
    serverNowMs: nowMs,
    registrationOpen: scheduleComplete && lifecycle === "Registration" && inWindow(election, "registrationStart", "registrationEnd", nowMs),
    reviewOpen: scheduleComplete && lifecycle === "Review" && inWindow(election, "applicationReviewStart", "applicationReviewEnd", nowMs),
    candidateVisible:
  scheduleComplete &&
  inWindow(
    election,
    "candidatePublicationStart",
    "candidatePublicationEnd",
    nowMs
  ),
    votingOpen:
  scheduleComplete &&
  election.candidateReviewComplete === true &&
  lifecycle === "Voting" &&
  inWindow(
    election,
    "votingStart",
    "votingEnd",
    nowMs
  ),
    resultsVisible: scheduleComplete && election.resultsPublished === true && nowMs >= toMillis(election.resultPublicationStart),
    finalized: election.finalized === true,
    resultsPublished: election.resultsPublished === true,
    archived: election.archived === true,
    eligibleVoterCount: Number(election.eligibleVoterCount || 0)
  };
  for (const field of SCHEDULE_FIELDS) context[field] = toMillis(election[field]) || null;
  return context;
});

exports.registerStudentProfile = onCall(callableOptions(), async () => {
  throw new HttpsError(
    "permission-denied",
    "Public account registration is disabled. Student accounts are provisioned by the school administrator."
  );
});

exports.resolveSchoolLoginIdentifier = onCall(callableOptions(), async (request) => {
  const studentId = normalizeStudentId(request.data?.studentId);
  const accountSnap = await db.doc(`school_accounts/${studentId}`).get();
  if (!accountSnap.exists || accountSnap.get("isActive") === false) {
    // Keep the failure intentionally generic so the endpoint does not become a
    // detailed account-directory oracle.
    throw new HttpsError("not-found", "School account not found.");
  }
  const loginEmail = normalizeEmail(accountSnap.get("institutionalEmail") || accountSnap.get("loginEmail"));
  if (!loginEmail) throw new HttpsError("not-found", "School account not found.");
  return { loginEmail };
});

exports.provisionSchoolAccounts = onCall(callableOptions({ timeoutSeconds: 540, memory: "512MiB" }), async (request) => {
  await requireActiveRole(request, ["admin"]);
  requireRecentAuth(request);
  const rows = Array.isArray(request.data?.rows) ? request.data.rows : [];
  if (!rows.length || rows.length > 100) throw new HttpsError("invalid-argument", "Provision 1 to 100 school accounts per request.");

  const cleanRows = rows.map(sanitizeMasterRow);
  const credentials = [];
  const results = [];

  for (const row of cleanRows) {
    const accountRef = db.doc(`school_accounts/${row.studentId}`);
    const claimRef = db.doc(`student_id_claims/${row.studentId}`);
    const [existingAccountSnap, existingClaimSnap] = await Promise.all([accountRef.get(), claimRef.get()]);
    const accountUid = existingAccountSnap.exists ? cleanText(existingAccountSnap.get("uid"), 160) : "";
    const claimedUid = existingClaimSnap.exists ? cleanText(existingClaimSnap.get("uid"), 160) : "";
    if (accountUid && claimedUid && accountUid !== claimedUid) {
      throw new HttpsError("already-exists", `Student ID ${row.studentId} has conflicting account ownership records. Resolve it before provisioning.`);
    }
    const linkedUid = accountUid || claimedUid;

    let authUser = null;
    let temporaryPassword = "";
    let issuedPassword = false;
    let created = false;
    let migrated = false;

    if (linkedUid) {
      try {
        authUser = await adminAuth.getUser(linkedUid);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") throw error;
      }
    }

    if (!authUser) {
      try {
        authUser = await adminAuth.getUserByEmail(row.email);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") throw error;
      }
    }

    if (!authUser) {
      temporaryPassword = generateTemporaryPassword();
      authUser = await adminAuth.createUser({
        email: row.email,
        emailVerified: true,
        password: temporaryPassword,
        displayName: row.fullName,
        disabled: false
      });
      created = true;
      issuedPassword = true;
    } else if (normalizeEmail(authUser.email) !== row.email) {
      // Migrate an older self-registered/Gmail account linked to the same
      // Student ID into the school's institutional-email login model.
      temporaryPassword = generateTemporaryPassword();
      try {
        authUser = await adminAuth.updateUser(authUser.uid, {
          email: row.email,
          emailVerified: true,
          password: temporaryPassword,
          displayName: row.fullName,
          disabled: false
        });
      } catch (error) {
        if (error?.code === "auth/email-already-exists") {
          throw new HttpsError("already-exists", `Institutional email ${row.email} is already linked to another Firebase account.`);
        }
        throw error;
      }
      migrated = true;
      issuedPassword = true;
    }

    if (linkedUid && authUser.uid !== linkedUid) {
      throw new HttpsError("already-exists", `Student ID ${row.studentId} is already linked to another Firebase account.`);
    }

    const existingClaims = authUser.customClaims || {};
    await adminAuth.setCustomUserClaims(authUser.uid, {
      ...existingClaims,
      role: "student",
      verifiedStudent: row.eligible === true
    });
    authUser = await adminAuth.updateUser(authUser.uid, {
      displayName: row.fullName,
      emailVerified: true,
      disabled: false
    });

    const userRef = db.doc(`users/${authUser.uid}`);
    const existingProfile = await userRef.get();
    const batch = db.batch();
    batch.set(accountRef, {
      uid: authUser.uid,
      studentId: row.studentId,
      institutionalEmail: row.email,
      loginEmail: row.email,
      fullName: row.fullName,
      program: row.program,
      college: row.college,
      enrollmentStatus: row.enrollmentStatus,
      isActive: true,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existingAccountSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() })
    }, { merge: true });
    batch.set(claimRef, {
      uid: authUser.uid,
      email: row.email,
      claimedAt: existingClaimSnap.exists ? existingClaimSnap.get("claimedAt") || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    batch.set(userRef, {
      uid: authUser.uid,
      studentId: row.studentId,
      fullName: row.fullName,
      email: row.email,
      institutionalEmail: row.email,
      program: row.program,
      college: row.college,
      enrollmentStatus: row.enrollmentStatus,
      role: "student",
      accountStatus: "approved",
      isActive: true,
      schoolProvisioned: true,
      isVerifiedStudent: row.eligible === true,
      verificationState: row.eligible === true ? "school_provisioned_eligible" : "school_provisioned_not_voter_eligible",
      updatedAt: FieldValue.serverTimestamp(),
      ...(existingProfile.exists ? {} : { createdAt: FieldValue.serverTimestamp() })
    }, { merge: true });
    batch.set(db.collection("audit_logs").doc(), auditData(request,
      created ? "SCHOOL_ACCOUNT_PROVISIONED" : migrated ? "SCHOOL_ACCOUNT_MIGRATED" : "SCHOOL_ACCOUNT_SYNCED",
      userRef.path,
      null,
      { studentId: row.studentId, institutionalEmail: row.email, voterEligible: row.eligible === true }
    ));
    await syncCandidateReviewCompletion(
  electionId,
  request.auth.uid
);
    await batch.commit();

    if (issuedPassword) credentials.push({
      studentId: row.studentId,
      fullName: row.fullName,
      institutionalEmail: row.email,
      temporaryPassword
    });
    results.push({ studentId: row.studentId, uid: authUser.uid, created, migrated, institutionalEmail: row.email });
  }

  return { processed: results.length, created: credentials.length, credentials, results };
});

exports.activateVerifiedStudent = onCall(callableOptions(), async (request) => {
  const auth = requireAuth(request);
  if (auth.token?.email_verified !== true) throw new HttpsError("failed-precondition", "Verify your email address first.");
  const userRef = db.doc(`users/${auth.uid}`);
  const initialUser = await userRef.get();
  if (!initialUser.exists) throw new HttpsError("failed-precondition", "Student profile not found. Please register again.");
  const initialProfile = initialUser.data();
  const studentId = normalizeStudentId(initialProfile.studentId || initialProfile.requestedStudentId);
  const electionId = await currentElectionId();
  const rosterRef = db.doc(`elections/${electionId}/voterRoster/${studentId}`);
  const claimRef = db.doc(`student_id_claims/${studentId}`);

  await db.runTransaction(async (tx) => {
    const [rosterSnap, claimSnap, userSnap] = await Promise.all([tx.get(rosterRef), tx.get(claimRef), tx.get(userRef)]);
    if (!rosterSnap.exists || !userSnap.exists) throw new HttpsError("permission-denied", "The active official voter roster does not contain this Student ID.");
    const roster = rosterSnap.data();
    if (normalizeEmail(roster.email) !== normalizeEmail(auth.token?.email) || !rosterIsEligible(roster)) {
      throw new HttpsError("permission-denied", "The active voter roster does not mark this account as actively enrolled and voting-eligible.");
    }
    if (claimSnap.exists && claimSnap.get("uid") !== auth.uid) {
      throw new HttpsError("already-exists", "That Student ID is already linked to another account.");
    }
    tx.set(claimRef, {
      uid: auth.uid,
      email: normalizeEmail(auth.token?.email),
      claimedAt: claimSnap.exists ? claimSnap.get("claimedAt") : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(userRef, {
      accountStatus: "approved",
      isActive: true,
      isVerifiedStudent: true,
      verificationState: "verified",
      verifiedAgainstElectionId: electionId,
      fullName: cleanText(roster.fullName, 120),
      email: normalizeEmail(auth.token?.email),
      college: cleanText(roster.college, 160),
      program: cleanText(roster.program, 160),
      enrollmentStatus: cleanText(roster.enrollmentStatus, 50),
      studentId,
      role: "student",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  await setTrustedClaims(auth.uid, { role: "student", verifiedStudent: true });
  return { approved: true, studentId, electionId };
});

function ensureRosterImportWindow(election) {
  if (election.finalized === true || election.archived === true) throw new HttpsError("failed-precondition", "The voter roster is locked for a finalized or archived election.");
  const registrationStart = toMillis(election.registrationStart);
  if (!registrationStart) throw new HttpsError("failed-precondition", "Save a complete election schedule before importing the voter roster.");
  if (Date.now() >= registrationStart) throw new HttpsError("failed-precondition", "The official voter roster is frozen when candidate registration begins.");
}

exports.startVoterRosterImport = onCall(callableOptions(), async (request) => {
  await requireActiveRole(request, ["admin"]);
  requireRecentAuth(request);
  const electionId = cleanText(request.data?.electionId, 80) || await currentElectionId();
  const electionRef = db.doc(`elections/${electionId}`);
  const electionSnap = await electionRef.get();
  if (!electionSnap.exists) throw new HttpsError("not-found", "Election does not exist.");
  ensureRosterImportWindow(electionSnap.data());
  const importId = `roster-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const importRef = db.doc(`elections/${electionId}/rosterImports/${importId}`);
  await importRef.set({
    importId,
    status: "active",
    startedAt: FieldValue.serverTimestamp(),
    startedByUid: request.auth.uid,
    rowsProcessed: 0
  });
  await audit(request, "MASTERLIST_IMPORT_START", importRef.path, null, { electionId, importId });
  return { electionId, importId };
});

exports.importVoterMasterlist = onCall(callableOptions(), async (request) => {
  await requireActiveRole(request, ["admin"]);
  requireRecentAuth(request);
  const rows = Array.isArray(request.data?.rows) ? request.data.rows : [];
  if (!rows.length || rows.length > 200) throw new HttpsError("invalid-argument", "Import 1 to 200 rows per request.");
  const electionId = cleanText(request.data?.electionId, 80) || await currentElectionId();
  const importId = cleanText(request.data?.importId, 120);
  if (!importId) throw new HttpsError("invalid-argument", "Start a voter roster import session first.");
  const electionRef = db.doc(`elections/${electionId}`);
  const importRef = db.doc(`elections/${electionId}/rosterImports/${importId}`);
  const [electionSnap, importSnap] = await Promise.all([electionRef.get(), importRef.get()]);
  if (!electionSnap.exists) throw new HttpsError("not-found", "Election does not exist.");
  ensureRosterImportWindow(electionSnap.data());
  if (!importSnap.exists || importSnap.get("status") !== "active") throw new HttpsError("failed-precondition", "This voter roster import session is not active.");
  if (importSnap.get("startedByUid") !== request.auth.uid) throw new HttpsError("permission-denied", "Only the administrator who started this import may upload its chunks.");

  const cleanRows = rows.map(sanitizeMasterRow);
  const seen = new Set();
  for (const row of cleanRows) {
    if (seen.has(row.studentId)) throw new HttpsError("invalid-argument", `Duplicate Student ID ${row.studentId} exists in this CSV chunk.`);
    seen.add(row.studentId);
  }
  const batch = db.batch();
  for (const row of cleanRows) {
    batch.set(db.doc(`student_masterlist/${row.studentId}`), { ...row, lastElectionId: electionId, lastRosterImportId: importId }, { merge: true });
    batch.set(db.doc(`elections/${electionId}/voterRoster/${row.studentId}`), {
      studentId: row.studentId,
      fullName: row.fullName,
      email: row.email,
      program: row.program,
      college: row.college,
      enrollmentStatus: row.enrollmentStatus,
      eligible: row.eligible,
      importId,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }
  batch.set(importRef, { rowsProcessed: FieldValue.increment(cleanRows.length), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  return { imported: cleanRows.length, importId };
});

exports.finalizeVoterRosterImport = onCall(callableOptions(), async (request) => {
  await requireActiveRole(request, ["admin"]);
  requireRecentAuth(request);
  const electionId = cleanText(request.data?.electionId, 80) || await currentElectionId();
  const importId = cleanText(request.data?.importId, 120);
  if (!importId) throw new HttpsError("invalid-argument", "Voter roster import ID is required.");
  const electionRef = db.doc(`elections/${electionId}`);
  const importRef = db.doc(`elections/${electionId}/rosterImports/${importId}`);
  const [electionSnap, importSnap] = await Promise.all([electionRef.get(), importRef.get()]);
  if (!electionSnap.exists) throw new HttpsError("not-found", "Election does not exist.");
  ensureRosterImportWindow(electionSnap.data());
  if (!importSnap.exists || importSnap.get("status") !== "active") throw new HttpsError("failed-precondition", "This voter roster import session is not active.");
  if (importSnap.get("startedByUid") !== request.auth.uid) throw new HttpsError("permission-denied", "Only the administrator who started this import may finalize it.");

  const rosterSnap = await db.collection(`elections/${electionId}/voterRoster`).get();
  const writer = db.bulkWriter();
  let eligibleVoterCount = 0;
  let currentRows = 0;
  let removedRows = 0;
  for (const rosterDoc of rosterSnap.docs) {
    const data = rosterDoc.data() || {};
    if (data.importId !== importId) {
      writer.delete(rosterDoc.ref);
      removedRows += 1;
      continue;
    }
    currentRows += 1;
    if (rosterIsEligible(data)) eligibleVoterCount += 1;
  }
  await writer.close();
  const batch = db.batch();
  batch.set(electionRef, {
    eligibleVoterCount,
    voterRosterVersion: importId,
    voterRosterRows: currentRows,
    voterRosterFinalizedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  batch.set(db.doc(`elections/${electionId}/turnout/public`), {
    eligibleVoters: eligibleVoterCount,
    ballotsCast: 0,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  batch.set(importRef, {
    status: "completed",
    completedAt: FieldValue.serverTimestamp(),
    eligibleVoterCount,
    currentRows,
    removedStaleRows: removedRows
  }, { merge: true });
  batch.set(db.collection("audit_logs").doc(), auditData(request, "MASTERLIST_IMPORT_FINALIZE", `elections/${electionId}/voterRoster`, null, { importId, currentRows, eligibleVoterCount, removedStaleRows: removedRows }));
  await batch.commit();
  return { electionId, importId, rows: currentRows, eligibleVoterCount, removedStaleRows: removedRows };
});

exports.saveElectionSchedule = onCall(callableOptions(), async (request) => {
  await requireActiveRole(request, ["officer", "admin"]);
  requireRecentAuth(request);
  const schedule = validateSchedule(request.data?.schedule || {});
  const title = cleanText(request.data?.title || "USC General Election", 120);
  const electionId = cleanText(request.data?.electionId, 80).toLowerCase();
  if (!electionId) throw new HttpsError("invalid-argument", "A permanent Election ID is required. Use a unique value for each election, such as usc-yyyy-general.");
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(electionId)) throw new HttpsError("invalid-argument", "Election ID may contain lowercase letters, numbers, and hyphens only.");
  const electionRef = db.doc(`elections/${electionId}`);
  const pointerRef = db.doc("election_config/current");
  const pointerSnap = await pointerRef.get();
  const previousElectionId = pointerSnap.exists ? cleanText(pointerSnap.get("electionId"), 80) : "";
  if (previousElectionId && previousElectionId !== electionId) {
    const previousSnap = await db.doc(`elections/${previousElectionId}`).get();
    if (previousSnap.exists && previousSnap.get("archived") !== true) {
      throw new HttpsError("failed-precondition", `Archive the current election (${previousElectionId}) before switching the active pointer to a new Election ID.`);
    }
  }
  const beforeSnap = await electionRef.get();
  const before = beforeSnap.exists ? beforeSnap.data() : null;
  if (before?.finalized === true || before?.archived === true) throw new HttpsError("failed-precondition", "A finalized or archived election schedule is immutable.");
  if (before && toMillis(before.registrationStart) && Date.now() >= toMillis(before.registrationStart)) {
    throw new HttpsError("failed-precondition", "Normal schedule editing is locked once candidate registration begins. An administrator must use the documented emergency schedule procedure with a reason.");
  }
  const next = {
  electionId,
  title,
  ...schedule,

  candidateReviewComplete:
    before?.candidateReviewComplete === true,

  finalized: false,
  resultsPublished: false,
  archived: false,

  lifecycle: electionLifecycle({
    ...before,
    ...schedule,
    finalized: false,
    resultsPublished: false,
    archived: false
  }),

  scheduleVersion: 5,

  updatedAt:
    FieldValue.serverTimestamp(),

  ...(beforeSnap.exists
    ? {}
    : {
        createdAt:
          FieldValue.serverTimestamp()
      })
};
  const batch = db.batch();
  batch.set(electionRef, next, { merge: true });
  batch.set(pointerRef, { electionId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const auditAfter = Object.fromEntries(Object.entries(next).filter(([key]) => !["createdAt", "updatedAt"].includes(key)));
  batch.set(db.collection("audit_logs").doc(), auditData(request, before ? "ELECTION_SCHEDULE_UPDATE" : "ELECTION_CREATE", `elections/${electionId}`, before, auditAfter));
  await batch.commit();
  return { electionId, lifecycle: next.lifecycle };
});

exports.emergencyUpdateElectionSchedule = onCall(callableOptions(), async (request) => {
  await requireActiveRole(request, ["admin"]);
  requireRecentAuth(request);
  const reason = cleanText(request.data?.reason, 500);
  if (reason.length < 15) throw new HttpsError("invalid-argument", "A specific emergency-change reason of at least 15 characters is required.");
  const electionId = cleanText(request.data?.electionId, 80).toLowerCase() || await currentElectionId();
  const schedule = validateSchedule(request.data?.schedule || {});
  const electionRef = db.doc(`elections/${electionId}`);
  const beforeSnap = await electionRef.get();
  if (!beforeSnap.exists) throw new HttpsError("not-found", "Election does not exist.");
  const before = beforeSnap.data();
  if (before.finalized === true || before.archived === true || before.resultsPublished === true) {
    throw new HttpsError("failed-precondition", "Finalized, published-result, and archived elections cannot be rescheduled.");
  }
  const currentLifecycle = electionLifecycle(before, Date.now());
  if (["Voting Closed", "Canvassing", "Results Published", "Archived"].includes(currentLifecycle)) {
    throw new HttpsError("failed-precondition", "The election has already reached a closeout state and cannot be rescheduled.");
  }
  const after = {
    ...schedule,
    title: cleanText(request.data?.title || before.title || "USC Election", 120),
    lifecycle: electionLifecycle({ ...before, ...schedule }, Date.now()),
    scheduleVersion: Number(before.scheduleVersion || 0) + 1,
    emergencyChangeAt: FieldValue.serverTimestamp(),
    emergencyChangeByUid: request.auth.uid,
    updatedAt: FieldValue.serverTimestamp()
  };
  const auditAfter = Object.fromEntries(Object.entries(after).filter(([key]) => !["emergencyChangeAt", "updatedAt"].includes(key)));
  const batch = db.batch();
  batch.set(electionRef, after, { merge: true });
  batch.set(db.collection("audit_logs").doc(), auditData(request, "ELECTION_EMERGENCY_SCHEDULE_UPDATE", electionRef.path,
    Object.fromEntries(SCHEDULE_FIELDS.map((field) => [field, before[field] || null])),
    auditAfter,
    { reason }));
  await batch.commit();
  return { electionId, lifecycle: after.lifecycle, emergencyChangeRecorded: true };
});

exports.submitCandidateApplication = onCall(callableOptions(), async (request) => {
  requireVerifiedStudent(request);
  const { electionId, data: election } = await currentElection();
  const nowMs = Date.now();
  if (!inWindow(election, "registrationStart", "registrationEnd", nowMs) || electionLifecycle(election, nowMs) !== "Registration") {
    throw new HttpsError("failed-precondition", "Candidate registration is not open according to server time.");
  }
  const uid = request.auth.uid;
  const userSnap = await db.doc(`users/${uid}`).get();
  const user = userSnap.data() || {};
  if (!userSnap.exists || user.accountStatus !== "approved" || user.isVerifiedStudent !== true || user.isActive === false) {
    throw new HttpsError("permission-denied", "Your verified student account is not active for candidate registration.");
  }
  const studentId = normalizeStudentId(user.studentId);
  const rosterSnap = await db.doc(`elections/${electionId}/voterRoster/${studentId}`).get();
  if (!rosterSnap.exists || !rosterIsEligible(rosterSnap.data())) throw new HttpsError("permission-denied", "You are not on the active eligible voter roster for this election.");
  const roster = rosterSnap.data();
  const position = cleanText(request.data?.position, 80);
  if (!POSITIONS.includes(position)) throw new HttpsError("invalid-argument", "Invalid candidate position.");
  const department = position === "Department Representative" ? cleanText(roster.college, 160) : "";
  const photoPath = cleanText(request.data?.campaignPhotoPath, 500);
  const supportingDocumentPaths = Array.isArray(request.data?.supportingDocumentPaths) ? request.data.supportingDocumentPaths.map((v) => cleanText(v, 500)).filter(Boolean).slice(0, 8) : [];
  const requiredPrefix = `candidacy/${electionId}/${uid}/`;
  if (!photoPath.startsWith(requiredPrefix)) throw new HttpsError("invalid-argument", "Campaign photo upload is missing or invalid.");
  if (supportingDocumentPaths.some((path) => !path.startsWith(requiredPrefix))) throw new HttpsError("invalid-argument", "A supporting document path is invalid.");

  const appRef = db.doc(`elections/${electionId}/applications/${uid}`);
  const application = {
    applicantUid: uid,
    studentId,
    fullName: cleanText(roster.fullName || user.fullName, 120),
    email: normalizeEmail(user.email || request.auth.token?.email),
    program: cleanText(roster.program, 160),
    college: cleanText(roster.college, 160),
    position,
    department,
    partylist: cleanText(request.data?.partylist, 100),
    platform: cleanText(request.data?.platform, 4000),
    campaignPhotoPath: photoPath,
    supportingDocumentPaths,
    status: "Under Review",
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(appRef);
    if (existing.exists) throw new HttpsError("already-exists", "You already submitted a candidate application for this election.");
    tx.create(appRef, application);
  });
  await audit(request, "CANDIDACY_SUBMIT", appRef.path, null, { position, department });
  return { applicationId: uid, status: "Under Review", electionId };
});

function supabaseAdmin() {
  return createClient(SUPABASE_URL.value(), SUPABASE_SERVICE_ROLE_KEY.value(), { auth: { persistSession: false, autoRefreshToken: false } });
}

async function publishCandidatePhoto(electionId, candidateId, privatePath) {
  if (!privatePath) return { url: "", path: "" };
  const client = supabaseAdmin();
  const { data: blob, error: downloadError } = await client.storage.from(PRIVATE_BUCKET).download(privatePath);
  if (downloadError) throw new HttpsError("internal", `Unable to publish candidate photo: ${downloadError.message}`);
  const arrayBuffer = await blob.arrayBuffer();
  const ext = privatePath.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "jpg";
  const publicPath = `candidates/${electionId}/${candidateId}/campaign.${ext}`;
  const { error: uploadError } = await client.storage.from(PUBLIC_BUCKET).upload(publicPath, Buffer.from(arrayBuffer), {
    contentType: blob.type || "image/jpeg",
    upsert: false,
    cacheControl: "3600"
  });
  if (uploadError) throw new HttpsError("internal", `Unable to publish candidate photo: ${uploadError.message}`);
  return { url: client.storage.from(PUBLIC_BUCKET).getPublicUrl(publicPath).data.publicUrl, path: publicPath };
}

async function removePublicFile(path) {
  if (!path) return;
  try { await supabaseAdmin().storage.from(PUBLIC_BUCKET).remove([path]); } catch (error) { console.warn("Unable to remove orphaned public media:", error); }
}

async function syncCandidateReviewCompletion(electionId, actorUid = "") {
  const pending = await db
    .collection(`elections/${electionId}/applications`)
    .where("status", "==", "Under Review")
    .limit(1)
    .get();

  const applications = await db
    .collection(`elections/${electionId}/applications`)
    .limit(1)
    .get();

  /*
   * There must be at least one application,
   * and no application may remain Under Review.
   */
  const complete =
    pending.empty;

  await db.doc(`elections/${electionId}`).set(
    {
      candidateReviewComplete: complete,

      candidateReviewCompletedAt:
        complete
          ? FieldValue.serverTimestamp()
          : null,

      candidateReviewCompletedByUid:
        complete
          ? actorUid
          : "",

      updatedAt:
        FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return complete;
}

exports.reviewCandidateApplication = onCall(callableOptions({ secrets: [SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY] }), async (request) => {
  await requireActiveRole(request, ["officer", "admin"]);
  requireRecentAuth(request);
  const { electionId, data: election } = await currentElection();
  const nowMs = Date.now();
  if (!inWindow(election, "applicationReviewStart", "applicationReviewEnd", nowMs) || electionLifecycle(election, nowMs) !== "Review") {
    throw new HttpsError("failed-precondition", "Application review is not open according to server time.");
  }
  const uid = cleanText(request.data?.applicantUid, 128);
  const decision = cleanText(request.data?.decision, 20).toLowerCase();
  const reviewNote = cleanText(request.data?.reviewNote, 500);
  if (!uid || !["approve", "reject"].includes(decision)) throw new HttpsError("invalid-argument", "Applicant UID and approve/reject decision are required.");
  const appRef = db.doc(`elections/${electionId}/applications/${uid}`);
  const initialSnap = await appRef.get();
  if (!initialSnap.exists) throw new HttpsError("not-found", "Candidate application not found.");
  const initialApp = initialSnap.data();
  if (cleanText(initialApp.status, 40).toLowerCase() !== "under review") throw new HttpsError("failed-precondition", "This application already has a final review decision.");

  const status = decision === "approve" ? "Approved" : "Rejected";
  const candidateId = decision === "approve" ? `cand-${crypto.randomBytes(12).toString("hex")}` : "";
  let publicPhoto = { url: "", path: "" };
  try {
    if (decision === "approve") publicPhoto = await publishCandidatePhoto(electionId, candidateId, initialApp.campaignPhotoPath);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(appRef);
      if (!snap.exists) throw new HttpsError("not-found", "Candidate application not found.");
      const app = snap.data();
      if (cleanText(app.status, 40).toLowerCase() !== "under review") {
        throw new HttpsError("aborted", "Another authorized reviewer already completed this application.");
      }
      tx.update(appRef, {
        status,
        candidateId: candidateId || FieldValue.delete(),
        reviewNote,
        reviewedByUid: request.auth.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      if (decision === "approve") {
        const candidateRef = db.doc(`elections/${electionId}/candidates/${candidateId}`);
        tx.create(candidateRef, {
          candidateId,
          fullName: cleanText(app.fullName, 120),
          position: cleanText(app.position, 80),
          department: cleanText(app.department, 160),
          college: cleanText(app.college, 160),
          program: cleanText(app.program, 160),
          partylist: cleanText(app.partylist, 100),
          platform: cleanText(app.platform, 4000),
          campaignPhotoUrl: publicPhoto.url,
          approved: true,
          published: true,
          approvedAt: FieldValue.serverTimestamp()
        });
      }
      tx.set(db.collection("audit_logs").doc(), auditData(request, `CANDIDACY_${decision.toUpperCase()}`, appRef.path, { status: app.status }, { status, candidateId: candidateId || null }));
    });

    await syncCandidateReviewCompletion(
  electionId,
  request.auth.uid
);
    
    return { status, candidateId: candidateId || null };
  } catch (error) {
    if (publicPhoto.path) await removePublicFile(publicPhoto.path);
    throw error;
  }
});

function validateSelectionsShape(selections) {
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) throw new HttpsError("invalid-argument", "Ballot selections are invalid.");
  const keys = Object.keys(selections);
  if (keys.length !== POSITIONS.length || !POSITIONS.every((position) => keys.includes(position))) {
    throw new HttpsError("invalid-argument", "A selection is required for every ballot position.");
  }
  for (const [position, id] of Object.entries(selections)) {
    if (!POSITIONS.includes(position) || typeof id !== "string" || !id.trim() || id.length > 128) throw new HttpsError("invalid-argument", "A ballot selection is malformed.");
  }
}

exports.submitAnonymousBallot = onCall(callableOptions(), async (request) => {
  requireVerifiedStudent(request);
  const electionId = cleanText(request.data?.electionId, 80);
  if (!electionId) throw new HttpsError("invalid-argument", "Election ID is required.");
  const selections = request.data?.selections;
  validateSelectionsShape(selections);
  const uid = request.auth.uid;
  const electionRef = db.doc(`elections/${electionId}`);
  const userRef = db.doc(`users/${uid}`);
  const receiptRef = `USC-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
  const ballotRef = db.collection(`elections/${electionId}/ballots`).doc();

  await db.runTransaction(async (tx) => {
    const [electionSnap, userSnap] = await Promise.all([tx.get(electionRef), tx.get(userRef)]);
    if (!electionSnap.exists) throw new HttpsError("not-found", "Election not found.");
    if (!userSnap.exists) throw new HttpsError("permission-denied", "Verified user profile not found.");
    const election = electionSnap.data();
    const nowMs = Date.now();
    if (election.candidateReviewComplete !== true) {
  throw new HttpsError(
    "failed-precondition",
    "Voting is blocked because candidate review is not complete. All candidate applications must receive a final approval or rejection decision before ballots can be submitted."
  );
}
    if (election.finalized === true || election.archived === true || electionLifecycle(election, nowMs) !== "Voting" || !inWindow(election, "votingStart", "votingEnd", nowMs)) {
      throw new HttpsError("failed-precondition", "Voting is not open according to server time.");
    }
    const user = userSnap.data();
    if (user.accountStatus !== "approved" || user.isVerifiedStudent !== true || user.isActive === false) throw new HttpsError("permission-denied", "Your account is not eligible to vote.");
    const studentId = normalizeStudentId(user.studentId);
    const rosterRef = db.doc(`elections/${electionId}/voterRoster/${studentId}`);
    const statusRef = db.doc(`elections/${electionId}/voterStatus/${uid}`);
    const [rosterSnap, statusSnap] = await Promise.all([tx.get(rosterRef), tx.get(statusRef)]);
    if (!rosterSnap.exists || !rosterIsEligible(rosterSnap.data())) throw new HttpsError("permission-denied", "You are not an active eligible voter in this election.");
    if (statusSnap.exists && statusSnap.get("hasVoted") === true) throw new HttpsError("already-exists", "Your voter record already shows a submitted ballot.");
    const roster = rosterSnap.data();

    const candidatePairs = await Promise.all(POSITIONS.map(async (position) => {
      const id = String(selections[position]);
      const ref = db.doc(`elections/${electionId}/candidates/${id}`);
      return [position, ref, await tx.get(ref)];
    }));
    for (const [position, , snap] of candidatePairs) {
      if (!snap.exists || snap.get("approved") !== true || snap.get("position") !== position) throw new HttpsError("invalid-argument", `The selected ${position} candidate is not valid for this election.`);
      if (position === "Department Representative" && cleanText(snap.get("department"), 160) !== cleanText(roster.college, 160)) {
        throw new HttpsError("permission-denied", "You may only vote for the Department Representative assigned to your verified college.");
      }
    }

    // Anonymous ballot: no UID, Student ID, name, email, department, or receipt is stored here.
    tx.create(ballotRef, {
      selections: Object.fromEntries(POSITIONS.map((position) => [position, String(selections[position])])),
      schemaVersion: 2
    });
    tx.set(statusRef, {
      hasVoted: true,
      studentId,
      college: cleanText(roster.college, 160),
      votedAt: FieldValue.serverTimestamp(),
      receiptReference: receiptRef
    }, { merge: true });
    tx.set(db.doc(`elections/${electionId}/turnout/public`), {
      ballotsCast: FieldValue.increment(1),
      eligibleVoters: Number(election.eligibleVoterCount || 0),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    for (const [position, , snap] of candidatePairs) {
      const candidateId = String(selections[position]);
      tx.set(db.doc(`elections/${electionId}/privateTallies/${candidateId}`), {
        candidateId,
        fullName: cleanText(snap.get("fullName"), 120),
        position,
        department: cleanText(snap.get("department"), 160),
        votes: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
  });

  return { recorded: true, receiptReference: receiptRef, message: "Your anonymous ballot was recorded. Keep this participation receipt for your records." };
});

exports.finalizeElection = onCall(callableOptions(), async (request) => {
  await requireActiveCanvasser(request);
  requireRecentAuth(request);
  const { electionId, ref } = await currentElection();
  let alreadyFinalized = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Election not found.");
    const election = snap.data();
    if (Date.now() < toMillis(election.votingEnd)) throw new HttpsError("failed-precondition", "Voting must be closed by server time before finalization.");
    if (election.finalized === true) { alreadyFinalized = true; return; }
    if (election.archived === true || election.resultsPublished === true) throw new HttpsError("failed-precondition", "This election has already passed finalization.");
    tx.set(ref, { finalized: true, lifecycle: "Canvassing", finalizedAt: FieldValue.serverTimestamp(), finalizedByUid: request.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection("audit_logs").doc(), auditData(request, "ELECTION_FINALIZE", ref.path, { finalized: false }, { finalized: true, lifecycle: "Canvassing" }));
  });
  return { electionId, lifecycle: "Canvassing", alreadyFinalized };
});

exports.publishElectionResults = onCall(callableOptions(), async (request) => {
  await requireActiveCanvasser(request);
  requireRecentAuth(request);
  const { electionId, ref, data: election } = await currentElection();
  if (election.archived === true) throw new HttpsError("failed-precondition", "Archived elections are immutable.");
  if (election.resultsPublished === true) return { electionId, published: true, alreadyPublished: true };
  if (election.finalized !== true) throw new HttpsError("failed-precondition", "Finalize the election before publishing results.");
  if (Date.now() < toMillis(election.resultPublicationStart)) throw new HttpsError("failed-precondition", "The result-publication schedule has not started according to server time.");
  const [talliesSnap, candidatesSnap, turnoutSnap] = await Promise.all([
    db.collection(`elections/${electionId}/privateTallies`).get(),
    db.collection(`elections/${electionId}/candidates`).where("approved", "==", true).get(),
    db.doc(`elections/${electionId}/turnout/public`).get()
  ]);
  const tallyMap = new Map(talliesSnap.docs.map((d) => [d.id, d.data()]));
  // Publish every approved candidate, including candidates who received zero votes.
  const results = candidatesSnap.docs.map((d) => {
    const candidate = d.data();
    const tally = tallyMap.get(d.id) || {};
    return {
      id: d.id,
      candidateId: d.id,
      fullName: cleanText(candidate.fullName, 120),
      position: cleanText(candidate.position, 80),
      department: cleanText(candidate.department, 160),
      partylist: cleanText(candidate.partylist, 100),
      campaignPhotoUrl: cleanText(candidate.campaignPhotoUrl, 1000),
      votes: Number(tally.votes || 0)
    };
  }).sort((a, b) => String(a.position).localeCompare(String(b.position)) || Number(b.votes || 0) - Number(a.votes || 0) || String(a.fullName).localeCompare(String(b.fullName)));
  const officialRef = db.doc(`elections/${electionId}/results/official`);
  let alreadyPublished = false;
  await db.runTransaction(async (tx) => {
    const latestSnap = await tx.get(ref);
    if (!latestSnap.exists) throw new HttpsError("not-found", "Election not found.");
    const latest = latestSnap.data();
    if (latest.resultsPublished === true) { alreadyPublished = true; return; }
    if (latest.finalized !== true || latest.archived === true || Date.now() < toMillis(latest.resultPublicationStart)) {
      throw new HttpsError("failed-precondition", "The election is not eligible for result publication according to server state and server time.");
    }
    tx.set(officialRef, {
      electionId,
      title: latest.title || "USC Election",
      results,
      turnout: turnoutSnap.exists ? turnoutSnap.data() : { ballotsCast: 0, eligibleVoters: Number(latest.eligibleVoterCount || 0) },
      publishedAt: FieldValue.serverTimestamp(),
      publishedByUid: request.auth.uid
    });
    tx.set(ref, { resultsPublished: true, lifecycle: "Results Published", resultsPublishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection("audit_logs").doc(), auditData(request, "RESULTS_PUBLISH", officialRef.path, null, { resultRows: results.length }));
  });
  return { electionId, published: true, resultRows: results.length, alreadyPublished };
});

exports.recordAdminAuditAction = onCall(callableOptions(), async (request) => {
  const action = cleanText(request.data?.action, 80).toUpperCase();
  const allowed = new Set(["ADMIN_EXPORT", "EMERGENCY_NOTE", "BACKUP_REQUEST"]);
  if (!allowed.has(action)) throw new HttpsError("invalid-argument", "Unsupported audit action.");
  if (action === "ADMIN_EXPORT") await requireActiveRole(request, ["officer", "admin"]);
  else await requireActiveRole(request, ["admin"]);
  const target = cleanText(request.data?.target || "administration", 240);
  const rawDetails = request.data?.details && typeof request.data.details === "object" ? request.data.details : {};
  const details = Object.fromEntries(Object.entries(rawDetails).slice(0, 20).map(([key, value]) => [cleanText(key, 80), cleanText(value, 500)]));
  await audit(request, action, target, null, null, { details });
  return { recorded: true };
});

exports.archiveElection = onCall(callableOptions(), async (request) => {
  await requireActiveRole(request, ["admin"]);
  requireRecentAuth(request);
  const { electionId, ref } = await currentElection();
  let alreadyArchived = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Election not found.");
    const election = snap.data();
    if (election.archived === true) { alreadyArchived = true; return; }
    if (election.resultsPublished !== true) throw new HttpsError("failed-precondition", "Publish results before archiving the election.");
    tx.set(ref, { archived: true, lifecycle: "Archived", archivedAt: FieldValue.serverTimestamp(), archivedByUid: request.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection("audit_logs").doc(), auditData(request, "ELECTION_ARCHIVE", ref.path, { archived: false }, { archived: true, lifecycle: "Archived" }));
  });
  return { electionId, lifecycle: "Archived", alreadyArchived };
});

exports.syncAdminAccess = onCall(callableOptions(), async (request) => {
  requireRole(request, ["admin"]);
  requireVerifiedAdminEmail(request);
  requireRecentAuth(request);
  const profileSnap = await db.doc(`users/${request.auth.uid}`).get();
  if (!profileSnap.exists || profileSnap.get("role") !== "admin" || profileSnap.get("accountStatus") !== "approved" || profileSnap.get("isActive") === false) {
    throw new HttpsError("permission-denied", "The administrator profile is not approved and active.");
  }
  await setTrustedClaims(request.auth.uid, { role: "admin", adminAuthMode: "verified_email", mfaEnrolled: false });
  return { synced: true, authMode: "verified_email" };
});

exports.adminUpdateUser = onCall(callableOptions(), async (request) => {
  await requireActiveRole(request, ["admin"]);
  requireRecentAuth(request);
  const uid = cleanText(request.data?.uid, 128);
  if (!uid) throw new HttpsError("invalid-argument", "User UID is required.");
  const userRef = db.doc(`users/${uid}`);
  const beforeSnap = await userRef.get();
  if (!beforeSnap.exists) throw new HttpsError("not-found", "User profile not found.");
  const before = beforeSnap.data();
  const role = cleanText(request.data?.role || before.role, 20).toLowerCase();
  if (!["student", "officer", "admin"].includes(role)) throw new HttpsError("invalid-argument", "Invalid role.");
  if (uid === request.auth.uid && role !== "admin") throw new HttpsError("failed-precondition", "You cannot remove your own administrator role while signed in.");
  const accountStatus = cleanText(request.data?.accountStatus || before.accountStatus, 20).toLowerCase();
  if (!["approved", "pending", "suspended"].includes(accountStatus)) throw new HttpsError("invalid-argument", "Invalid account status.");
  const officePosition = role === "officer" ? cleanText(request.data?.officePosition || before.officePosition, 100) : (role === "admin" ? "System Administrator" : "");
  const requestedVerifiedStudent = role === "student"
    ? (typeof request.data?.isVerifiedStudent === "boolean" ? request.data.isVerifiedStudent : before.isVerifiedStudent === true)
    : false;
  let targetAuth;
  try {
    targetAuth = await adminAuth.getUser(uid);
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      throw new HttpsError("failed-precondition", "This Firestore profile has no matching Firebase Authentication account. The student must create/sign in to their account before verification can be changed.");
    }
    console.error("adminUpdateUser getUser failed", { uid, code: error?.code, message: error?.message });
    throw new HttpsError("internal", "The authentication record could not be loaded. Check Cloud Functions logs for details.");
  }
  const existingClaims = targetAuth.customClaims || {};
  const canvasser = typeof request.data?.canvasser === "boolean" ? (role === "officer" && request.data.canvasser) : (role === "officer" && existingClaims.canvasser === true);
  const roleEffectiveDate = cleanText(request.data?.roleEffectiveDate || before.roleEffectiveDate, 20);
  const adminNotes = cleanText(request.data?.adminNotes ?? before.adminNotes, 1000);
  const changeReason = cleanText(request.data?.changeReason, 500);
  const nowMs = Date.now();
  const patch = {
    role,
    accountStatus,
    isActive: accountStatus !== "suspended",
    officePosition,
    adminNotes,
    roleEffectiveDate,
    roleEffectiveAtMs: roleEffectiveDate ? new Date(`${roleEffectiveDate}T00:00:00`).getTime() : 0,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
    lastRoleUpdatedBy: normalizeEmail(request.auth?.token?.email) || request.auth.uid,
    lastRoleUpdateNote: changeReason,
    isVerifiedStudent: requestedVerifiedStudent,
    verificationState: requestedVerifiedStudent ? "manual_admin_verified" : (role === "student" ? "unverified" : before.verificationState || "not_applicable"),
    verifiedByUid: requestedVerifiedStudent ? request.auth.uid : FieldValue.delete(),
    verifiedAt: requestedVerifiedStudent ? FieldValue.serverTimestamp() : FieldValue.delete()
  };
  try {
    await userRef.set(patch, { merge: true });
  } catch (error) {
    console.error("adminUpdateUser profile write failed", { uid, code: error?.code, message: error?.message });
    throw new HttpsError("internal", "The user profile could not be updated on the server.");
  }

  const nextClaims = {
    ...existingClaims,
    role,
    canvasser,
    verifiedStudent: requestedVerifiedStudent,
    mfaEnrolled: false
  };
  if (role === "admin") nextClaims.adminAuthMode = "verified_email";
  else delete nextClaims.adminAuthMode;

  try {
    await adminAuth.setCustomUserClaims(uid, nextClaims);
  } catch (error) {
    console.error("adminUpdateUser claim sync failed", { uid, code: error?.code, message: error?.message });
    throw new HttpsError("internal", "The profile was updated, but trusted login claims could not be synchronized. Retry once after refreshing the page.");
  }

  try {
    await audit(request, "USER_ACCESS_UPDATE", userRef.path,
    { role: before.role, accountStatus: before.accountStatus, officePosition: before.officePosition, adminNotes: before.adminNotes || "", isVerifiedStudent: before.isVerifiedStudent === true },
    { role, accountStatus, officePosition, canvasser, adminNotes, roleEffectiveDate, isVerifiedStudent: requestedVerifiedStudent },
    { reason: changeReason });
    if ((before.isVerifiedStudent === true) !== requestedVerifiedStudent) {
      await audit(request, "STUDENT_VERIFICATION_CHANGE", userRef.path,
        { isVerifiedStudent: before.isVerifiedStudent === true },
        { isVerifiedStudent: requestedVerifiedStudent },
        { reason: changeReason || "Administrator verification update." });
    }
  } catch (error) {
    console.error("adminUpdateUser audit write failed", { uid, code: error?.code, message: error?.message });
    // Verification and trusted claims have already been updated. Do not turn a
    // successful access change into a misleading INTERNAL popup because an
    // optional legacy field was absent from the audit payload.
    return {
      updated: true,
      role,
      accountStatus,
      officePosition,
      canvasser,
      isVerifiedStudent: requestedVerifiedStudent,
      warning: "Verification succeeded, but the audit entry could not be recorded. Check Functions logs."
    };
  }
  return { updated: true, role, accountStatus, officePosition, canvasser, isVerifiedStudent: requestedVerifiedStudent };
});

exports.updateComplaintCase = onCall(callableOptions(), async (request) => {
  await requireActiveRole(request, ["officer", "admin"]);
  const complaintId = cleanText(request.data?.complaintId, 160);
  const nextStatus = cleanText(request.data?.status, 40);
  const reply = cleanText(request.data?.reply, 4000);
  const allowedStatuses = new Set(["Submitted", "Under Review", "In Progress", "Resolved", "Closed"]);
  if (!complaintId) throw new HttpsError("invalid-argument", "Complaint ID is required.");
  if (nextStatus && !allowedStatuses.has(nextStatus)) throw new HttpsError("invalid-argument", "Unsupported complaint status.");
  if (!nextStatus && !reply) throw new HttpsError("invalid-argument", "Provide a status change or reply.");
  const ref = db.doc(`complaints/${complaintId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Complaint not found.");
    const before = snap.data();
    const previousStatus = cleanText(before.status || "Submitted", 40);
    const effectiveStatus = nextStatus || previousStatus;
    const threadEntries = [];
    if (nextStatus && nextStatus !== previousStatus) {
      threadEntries.push({ by: "Officer", message: `Status updated from ${previousStatus} to ${nextStatus}.`, at: Timestamp.now() });
    }
    if (reply) threadEntries.push({ by: "Officer", message: reply, at: Timestamp.now() });
    const patch = { status: effectiveStatus, updatedAt: FieldValue.serverTimestamp() };
    if (threadEntries.length) patch.thread = FieldValue.arrayUnion(...threadEntries);
    tx.update(ref, patch);
    tx.set(db.collection("audit_logs").doc(), auditData(request, "COMPLAINT_CASE_UPDATE", ref.path,
      { status: previousStatus },
      { status: effectiveStatus, replyAdded: Boolean(reply) }));
  });
  return { updated: true, status: nextStatus || null, replyAdded: Boolean(reply) };
});

exports.createUploadTicket = onCall(callableOptions({ secrets: [SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY] }), async (request) => {
  const auth = requireAuth(request);
  const kind = cleanText(request.data?.kind, 40);
  const filename = cleanText(request.data?.filename, 180).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!filename) throw new HttpsError("invalid-argument", "Filename is required.");
  const fileSize = Number(request.data?.size || 0);
  const contentType = cleanText(request.data?.contentType, 120).toLowerCase();
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > 10 * 1024 * 1024) throw new HttpsError("invalid-argument", "Uploads must be between 1 byte and 10 MB.");
  const ext = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "bin";
  const mimeExtensions = {
    "image/jpeg": new Set(["jpg", "jpeg"]),
    "image/png": new Set(["png"]),
    "image/webp": new Set(["webp"]),
    "application/pdf": new Set(["pdf"])
  };
  if (!mimeExtensions[contentType]?.has(ext)) throw new HttpsError("invalid-argument", "File extension does not match the declared file type.");
  const random = crypto.randomBytes(10).toString("hex");
  let bucket = PRIVATE_BUCKET;
  let path;

  if (["candidate-photo", "candidate-document"].includes(kind)) {
    await requireActiveVerifiedStudent(request);
    if (kind === "candidate-photo" && !["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new HttpsError("invalid-argument", "Candidate photo must be JPEG, PNG, or WebP.");
    if (kind === "candidate-document" && !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new HttpsError("invalid-argument", "Candidate documents must be PDF, JPEG, PNG, or WebP.");
    const { electionId, data: election } = await currentElection();
    if (electionLifecycle(election) !== "Registration" || !inWindow(election, "registrationStart", "registrationEnd")) throw new HttpsError("failed-precondition", "Candidate uploads are allowed only during registration.");
    path = `candidacy/${electionId}/${auth.uid}/${kind}-${random}.${ext}`;
  } else if (kind === "complaint") {
    await requireActiveVerifiedStudent(request);
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new HttpsError("invalid-argument", "Complaint attachments must be PDF or supported image files.");
    path = `complaints/${auth.uid}/${Date.now()}-${random}.${ext}`;
  } else if (["announcement-media", "event-media"].includes(kind)) {
    await requireActiveRole(request, ["officer", "admin"]);
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new HttpsError("invalid-argument", "Public media uploads must be JPEG, PNG, or WebP.");
    bucket = PUBLIC_BUCKET;
    const folder = kind === "announcement-media" ? "announcements" : "events";
    path = `${folder}/${Date.now()}-${random}.${ext}`;
  } else {
    throw new HttpsError("invalid-argument", "Unsupported upload type.");
  }

  const client = supabaseAdmin();
  const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data?.token) throw new HttpsError("internal", error?.message || "Unable to create secure upload URL.");
  const publicUrl = bucket === PUBLIC_BUCKET ? client.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl : "";
  return { bucket, path, token: data.token, publicUrl };
});

exports.createPrivateDownloadUrl = onCall(callableOptions({ secrets: [SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY] }), async (request) => {
  const auth = requireAuth(request);
  const path = cleanText(request.data?.path, 600);
  if (!path) throw new HttpsError("invalid-argument", "Storage path is required.");
  const allowedPrivatePrefix = path.startsWith("complaints/") || path.startsWith("candidacy/");
  if (!allowedPrivatePrefix) throw new HttpsError("permission-denied", "Unsupported private storage path.");
  const ownComplaint = path.startsWith(`complaints/${auth.uid}/`);
  const ownCandidacy = path.includes(`/` + auth.uid + `/`) && path.startsWith("candidacy/");
  const privileged = ["officer", "admin"].includes(roleOf(request));
  if (privileged) await requireActiveRole(request, [roleOf(request)]);
  if (!ownComplaint && !ownCandidacy && !privileged) throw new HttpsError("permission-denied", "You do not have access to this private file.");
  const client = supabaseAdmin();
  const { data, error } = await client.storage.from(PRIVATE_BUCKET).createSignedUrl(path, 60 * 5);
  if (error || !data?.signedUrl) throw new HttpsError("internal", error?.message || "Unable to create private download link.");
  return { url: data.signedUrl, expiresInSeconds: 300 };
});

exports.syncElectionLifecycle = onSchedule({ region: REGION, schedule: "every 5 minutes", timeZone: "Asia/Manila" }, async () => {
  const pointer = await db.doc("election_config/current").get();
  if (!pointer.exists || !pointer.get("electionId")) return;
  const electionId = String(pointer.get("electionId"));
  const ref = db.doc(`elections/${electionId}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  const election = snap.data();
  const next = electionLifecycle(election);
  if (next !== election.lifecycle) {
    await ref.set({ lifecycle: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection("audit_logs").add({ actorUid: "system", actorRole: "system", action: "LIFECYCLE_TRANSITION", target: ref.path, before: { lifecycle: election.lifecycle || null }, after: { lifecycle: next }, createdAt: FieldValue.serverTimestamp() });
  }
});

// Exported only for unit tests that run without Firebase deployment.
exports.__test = { electionLifecycle, validateSchedule };

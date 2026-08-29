import { auth, db, functions } from "../firebase/firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-functions.js";
import {
  doc, getDoc, updateDoc, addDoc, collection, serverTimestamp,
  query, where, getDocs, writeBatch, setDoc, deleteDoc, runTransaction,
  Timestamp, increment, arrayUnion
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { supabase } from "../supabase/supabase-config.js";
import { provisionStudentAccounts } from "./browser-provisioning.js";
import { enrollmentStatusForStanding, isActiveStudentStanding, normalizeStudentStanding } from "./student-standing.js";

function callable(name) {
  return httpsCallable(functions, name);
}

function cleanError(error, fallback = "The request could not be completed.") {
  const code = String(error?.code || "").replace(/^functions\//, "");
  const raw = String(error?.details || error?.message || "").trim();
  const cleaned = raw.replace(/^FirebaseError:\s*/i, "").replace(/^functions\/[\w-]+:\s*/i, "").trim();
  if (cleaned && cleaned.toLowerCase() !== "internal") return cleaned;
  if (code === "unauthenticated") return "Your session could not be verified. Sign in again and retry.";
  if (code === "permission-denied") return "You do not have permission to perform this action.";
  if (code === "failed-precondition") return cleaned || "This action cannot be completed in the current account state.";
  if (code === "internal" || cleaned.toLowerCase() === "internal") {
    return "This action is not available in the current browser configuration. Refresh the project files and publish the included Firestore Rules.";
  }
  return cleaned || fallback;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const n = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}

function lifecycleFromSchedule(election = {}, nowMs = Date.now()) {
  if (election.archived === true) return "Archived";
  if (election.resultsPublished === true) return "Results Published";
  if (election.finalized === true) return "Canvassing";
  const regStart = toMillis(election.registrationStart);
  const regEnd = toMillis(election.registrationEnd);
  const reviewStart = toMillis(election.applicationReviewStart);
  const reviewEnd = toMillis(election.applicationReviewEnd);
  const pubStart = toMillis(election.candidatePublicationStart);
  const voteStart = toMillis(election.votingStart);
  const voteEnd = toMillis(election.votingEnd);
  if (!regStart || !voteEnd) return "Draft";
  if (nowMs < regStart) return "Draft";
  if (nowMs < regEnd) return "Registration";
  if (nowMs >= reviewStart && nowMs < reviewEnd) return "Review";
  if (nowMs >= pubStart && nowMs < voteStart) return "Published";
  if (nowMs >= voteStart && nowMs < voteEnd) return "Voting";
  if (nowMs >= voteEnd) return "Voting Closed";
  return "Draft";
}

async function browserElectionContext() {
  const pointer = await getDoc(doc(db, "election_config", "current"));
  if (!pointer.exists() || !pointer.data()?.electionId) {
    return {
      electionId: "", title: "USC Election", lifecycle: "Draft", scheduleComplete: false,
      serverNowMs: Date.now(), registrationOpen: false, reviewOpen: false,
      candidateVisible: false, votingOpen: false, resultsVisible: false,
      finalized: false, resultsPublished: false, archived: false, eligibleVoterCount: 0
    };
  }
  const electionId = String(pointer.data().electionId);
  const snap = await getDoc(doc(db, "elections", electionId));
  if (!snap.exists()) throw new Error("The active election record could not be loaded.");
  const e = snap.data();
  const now = Date.now();
  const fields = [
    "registrationStart","registrationEnd","applicationReviewStart","applicationReviewEnd",
    "candidatePublicationStart","candidatePublicationEnd","votingStart","votingEnd",
    "resultPublicationStart","resultPublicationEnd"
  ];
  const scheduleComplete = fields.every((f) => toMillis(e[f]) > 0);
  const lifecycle = scheduleComplete ? lifecycleFromSchedule(e, now) : "Draft";
  const out = {
    electionId,
    title: e.title || "USC Election",
    lifecycle,
    scheduleComplete,
    serverNowMs: now,
    registrationOpen: scheduleComplete && lifecycle === "Registration" && now >= toMillis(e.registrationStart) && now < toMillis(e.registrationEnd),
    reviewOpen: scheduleComplete && lifecycle === "Review" && now >= toMillis(e.applicationReviewStart) && now < toMillis(e.applicationReviewEnd),
    candidateVisible:
  scheduleComplete &&
  now >= toMillis(e.candidatePublicationStart) &&
  now < toMillis(e.candidatePublicationEnd),
    votingOpen:
  scheduleComplete &&
  e.candidateReviewComplete === true &&
  lifecycle === "Voting" &&
  now >= toMillis(e.votingStart) &&
  now < toMillis(e.votingEnd),
    resultsVisible: scheduleComplete && e.resultsPublished === true && now >= toMillis(e.resultPublicationStart),
    finalized: e.finalized === true,
    resultsPublished: e.resultsPublished === true,
    archived: e.archived === true,
    eligibleVoterCount: Number(e.eligibleVoterCount || 0)
  };
  fields.forEach((f) => { out[f] = toMillis(e[f]) || null; });
  return out;
}

async function browserAdminUpdateUser(data = {}) {
  const admin = auth.currentUser;
  if (!admin) throw new Error("Sign in as System Administrator first.");
  const token = await admin.getIdTokenResult(true);
  if (String(token.claims.role || "").toLowerCase() !== "admin") throw new Error("System Administrator access is required.");

  const uid = String(data.uid || "").trim();
  if (!uid) throw new Error("Target user UID is required.");
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("User profile not found.");
  const old = snap.data();
  if (String(old.role || "").toLowerCase() === "admin" && uid !== admin.uid) {
    throw new Error("Another System Administrator account is protected from this editor.");
  }

  const role = ["student","officer"].includes(String(data.role || "").toLowerCase())
    ? String(data.role).toLowerCase() : String(old.role || "student").toLowerCase();
  const accountStatus = ["approved","pending","suspended"].includes(String(data.accountStatus || "").toLowerCase())
    ? String(data.accountStatus).toLowerCase() : String(old.accountStatus || "approved").toLowerCase();
  const yearLevel = String(data.yearLevel ?? old.yearLevel ?? "").trim().slice(0, 40);
  const studentStanding = normalizeStudentStanding(data.studentStanding ?? old.studentStanding, old.enrollmentStatus);
  const enrollmentStatus = enrollmentStatusForStanding(studentStanding);
  const standingActive = role === "admin" ? true : isActiveStudentStanding(studentStanding, enrollmentStatus);
  const requestedVerified = typeof data.isVerifiedStudent === "boolean" ? data.isVerifiedStudent : old.isVerifiedStudent === true;
  const isVerifiedStudent = standingActive ? requestedVerified : false;
  const isActive = accountStatus !== "suspended" && standingActive;
  const officePosition = String(data.officePosition ?? old.officePosition ?? "").trim().slice(0,120);
  const adminNotes = String(data.adminNotes ?? old.adminNotes ?? "").trim().slice(0,1000);
  const roleEffectiveDate = String(data.roleEffectiveDate ?? old.roleEffectiveDate ?? "").trim().slice(0,40);
  const now = serverTimestamp();
  const batch = writeBatch(db);

  batch.update(ref, {
    role,
    accountStatus,
    isVerifiedStudent,
    isActive,
    yearLevel,
    studentStanding,
    enrollmentStatus,
    officePosition,
    adminNotes,
    roleEffectiveDate,
    lastRoleUpdatedBy: admin.email || admin.uid,
    updatedAt: now,
    updatedAtMs: Date.now()
  });

  const studentId = String(old.studentId || "").trim();
  if (studentId) {
    batch.set(doc(db, "school_accounts", studentId), {
      studentId,
      uid,
      institutionalEmail: old.institutionalEmail || old.email || "",
      authEmail: old.authEmail || old.institutionalEmail || old.email || "",
      role,
      active: isActive,
      studentStanding,
      updatedAt: now
    }, { merge: true });

    batch.set(doc(db, "student_masterlist", studentId), {
      studentId,
      fullName: old.fullName || "",
      institutionalEmail: old.institutionalEmail || old.email || "",
      program: old.program || "",
      college: old.college || "",
      yearLevel,
      studentStanding,
      enrollmentStatus,
      eligible: isActive && isVerifiedStudent,
      systemRole: role,
      officePosition: role === "officer" ? officePosition : "",
      verificationMethod: "school_admin_browser",
      verifiedBy: admin.uid,
      verifiedAt: now,
      updatedAt: now
    }, { merge: true });

    try {
      const pointer = await getDoc(doc(db, "election_config", "current"));
      const electionId = pointer.exists() ? String(pointer.data()?.electionId || "").trim() : "";
      if (electionId) {
        batch.set(doc(db, "elections", electionId, "voterRoster", studentId), {
          studentId,
          fullName: old.fullName || "",
          institutionalEmail: old.institutionalEmail || old.email || "",
          program: old.program || "",
          college: old.college || "",
          yearLevel,
          studentStanding,
          enrollmentStatus,
          eligible: isActive && isVerifiedStudent,
          verificationMethod: "school_admin_browser",
          verifiedBy: admin.uid,
          verifiedAt: now
        }, { merge: true });
      }
    } catch (error) {
      console.warn("Current election roster could not be synchronized:", error);
    }
  }

  batch.set(doc(collection(db, "audit_logs")), {
    actorUid: admin.uid,
    actorEmail: admin.email || "",
    action: "ADMIN_USER_UPDATED",
    targetUid: uid,
    targetStudentId: studentId,
    studentStanding,
    yearLevel,
    reason: String(data.changeReason || "").trim().slice(0,500),
    source: "browser-admin-runtime",
    createdAt: now
  });

  try {
    await batch.commit();
  } catch (error) {
    if (error?.code === "permission-denied") {
      throw new Error("Firestore blocked this update. Publish the firestore.rules included with this project in Firebase Console, then sign out and sign back in as System Administrator.");
    }
    throw error;
  }
  return { ok: true, message: standingActive ? "User account updated." : "User account updated and portal/voting access disabled by student standing." };
}

async function browserUpdateComplaintStatus(data = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in as an authorized USC officer first.");
  if (String(data.reply || "").trim()) return null;

  const complaintId = String(data.complaintId || "").trim();
  const nextStatus = String(data.status || "").trim();
  const allowedStatuses = ["Submitted", "Under Review", "In Progress", "Resolved", "Closed"];
  if (!complaintId) throw new Error("Complaint ID is required.");
  if (!allowedStatuses.includes(nextStatus)) throw new Error("Invalid complaint status.");

  const complaintRef = doc(db, "complaints", complaintId);
  const snap = await getDoc(complaintRef);
  if (!snap.exists()) throw new Error("Complaint record not found.");
  const current = snap.data();
  const previousStatus = String(current.status || "Submitted");
  if (previousStatus === nextStatus) return { ok: true, unchanged: true };

  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.update(complaintRef, { status: nextStatus, updatedAt: now });
  batch.set(doc(collection(db, "complaint_case_logs")), {
    actorUid: user.uid,
    actorEmail: user.email || "",
    action: "COMPLAINT_STATUS_UPDATED",
    complaintId,
    complaintRef: String(current.complaintRef || complaintId),
    statusBefore: previousStatus,
    statusAfter: nextStatus,
    source: "browser-officer-runtime",
    createdAt: now
  });
  await batch.commit();
  return { ok: true, previousStatus, status: nextStatus };
}

async function browserDeleteComplaintCase(data = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in as an authorized USC officer first.");

  const complaintId = String(data.complaintId || "").trim();
  if (!complaintId) throw new Error("Complaint ID is required.");
  const complaintRef = doc(db, "complaints", complaintId);
  const snap = await getDoc(complaintRef);
  if (!snap.exists()) return { ok: true, alreadyDeleted: true };

  const complaint = snap.data();
  const finalStatus = String(complaint.status || "Submitted");
  if (!["Resolved", "Closed"].includes(finalStatus)) {
    throw new Error("Only complaints that are already Resolved or Closed can be deleted.");
  }

  const chunks = await getDocs(collection(db, "complaints", complaintId, "attachmentChunks"));
  if (chunks.size > 450) throw new Error("This complaint contains too many attachment records to delete safely in one operation.");

  const batch = writeBatch(db);
  chunks.forEach((chunk) => batch.delete(chunk.ref));
  batch.delete(complaintRef);
  const now = serverTimestamp();
  batch.set(doc(collection(db, "complaint_case_logs")), {
    actorUid: user.uid,
    actorEmail: user.email || "",
    action: "COMPLAINT_DELETED",
    complaintId,
    complaintRef: String(complaint.complaintRef || complaintId),
    statusBefore: finalStatus,
    statusAfter: "Deleted",
    source: "browser-officer-runtime",
    createdAt: now
  });
  await batch.commit();
  return { ok: true, deletedChunks: chunks.size };
}

async function browserRecordAudit(data = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in as System Administrator first.");
  await addDoc(collection(db, "audit_logs"), {
    actorUid: user.uid,
    actorEmail: user.email || "",
    action: String(data.action || "ADMIN_ACTION").trim().slice(0,120),
    target: String(data.target || "").trim().slice(0,200),
    details: data.details && typeof data.details === "object" ? data.details : {},
    source: "browser-admin-runtime",
    createdAt: serverTimestamp()
  });
  return { ok: true };
}

async function browserOfficerMetrics() {
  const snap = await getDocs(query(collection(db, "users"), where("role", "==", "officer")));
  let activeOfficerCount = 0;
  snap.forEach((d) => {
    const p = d.data();
    if (String(p.accountStatus || "").toLowerCase() === "approved" && p.isActive !== false) activeOfficerCount += 1;
  });
  return { activeOfficerCount };
}


const BROWSER_FILE_SCHEME = "firestore-media://";
const browserMediaUrlCache = new Map();
const ELECTION_POSITIONS = ["President", "Vice President", "Secretary", "Treasurer", "Auditor", "Public Relations Officer", "Business Manager", "Sgt. at Arms", "Department Representative"];
const ELECTION_SCHEDULE_FIELDS = [
  "registrationStart", "registrationEnd", "applicationReviewStart", "applicationReviewEnd",
  "candidatePublicationStart", "candidatePublicationEnd", "votingStart", "votingEnd",
  "resultPublicationStart", "resultPublicationEnd"
];

function randomId(prefix = "id") {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`.replace(/[^A-Za-z0-9_-]/g, "");
}

async function requireBrowserRole(roles = []) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again and retry.");
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) throw new Error("Your school account profile could not be loaded.");
  const profile = snap.data();
  const role = String(profile.role || "").toLowerCase();
  if (!roles.includes(role) || profile.accountStatus !== "approved" || profile.isActive === false) {
    throw new Error("You do not have permission to perform this action.");
  }
  return { user, profile, role };
}

function timestampFromInput(value) {
  const ms = toMillis(value);
  if (!ms) throw new Error("Complete all election schedule date/time fields.");
  return Timestamp.fromMillis(ms);
}

function normalizedSchedule(raw = {}) {
  const out = Object.fromEntries(
    ELECTION_SCHEDULE_FIELDS.map((field) => [
      field,
      timestampFromInput(raw[field])
    ])
  );

  const ms = (field) => out[field].toMillis();

  /* Each phase must have a valid individual window. */
  const pairs = [
    ["registrationStart", "registrationEnd", "Candidate Registration"],
    ["applicationReviewStart", "applicationReviewEnd", "Application Review"],
    ["candidatePublicationStart", "candidatePublicationEnd", "Candidate Publication"],
    ["votingStart", "votingEnd", "Voting"],
    ["resultPublicationStart", "resultPublicationEnd", "Result Publication"]
  ];

  for (const [start, end, label] of pairs) {
    if (ms(end) <= ms(start)) {
      throw new Error(`${label} must close after it opens.`);
    }
  }

  /*
   * Registration must finish before formal application review begins.
   */
  if (ms("applicationReviewStart") < ms("registrationEnd")) {
    throw new Error(
      "Application Review cannot begin before Candidate Registration closes."
    );
  }

  /*
   * Candidate Publication begins after the scheduled review phase.
   *
   * IMPORTANT:
   * Candidate Publication END has absolutely no dependency
   * on Voting START.
   */
  if (ms("candidatePublicationStart") < ms("applicationReviewEnd")) {
    throw new Error(
      "Candidate Publication cannot begin before Application Review closes."
    );
  }

  /*
   * Voting only needs the review phase to have completed.
   *
   * Candidate Publication may still be active while Voting is active.
   */
  if (ms("votingStart") < ms("applicationReviewEnd")) {
    throw new Error(
      "Voting cannot begin before Application Review closes. Candidate Publication may overlap with Voting."
    );
  }

  /*
   * Results remain dependent on voting having closed.
   */
  if (ms("resultPublicationStart") < ms("votingEnd")) {
    throw new Error(
      "Result Publication cannot begin before Voting closes."
    );
  }

  return out;
}

function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function browserStoreFile(file, kind) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before uploading files.");
  const allowedKinds = new Set(["event-media", "announcement-media", "candidate-photo", "candidate-document"]);
  if (!allowedKinds.has(kind)) throw new Error("Unsupported browser upload type.");
  if (!(file instanceof File) || file.size <= 0) throw new Error("Please choose a valid file.");
  if (file.size > 6 * 1024 * 1024) throw new Error("Files must not exceed 6 MB in browser-only mode.");
  const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (["event-media", "announcement-media", "candidate-photo"].includes(kind) && !isImage) {
    throw new Error("This upload must be a JPG, PNG, or WEBP image.");
  }
  if (kind === "candidate-document" && !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Candidate documents must be PDF, JPG, PNG, or WEBP.");
  }
  const fileId = randomId("media");
  const ref = doc(db, "browser_files", fileId);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = bytesToBase64(bytes);
  const chunkSize = 700000;
  const chunks = [];
  for (let i = 0; i < base64.length; i += chunkSize) chunks.push(base64.slice(i, i + chunkSize));
  if (chunks.length > 24) throw new Error("This file is too large for the browser-only storage mode.");
  const visibility = ["event-media", "announcement-media"].includes(kind) ? "public" : "private";
  const batch = writeBatch(db);
  batch.set(ref, {
    ownerUid: user.uid, ownerEmail: user.email || "", kind, visibility,
    name: String(file.name || "upload").slice(0,180), type: file.type || "application/octet-stream",
    size: file.size, chunkCount: chunks.length, createdAt: serverTimestamp()
  });
  chunks.forEach((payload, index) => batch.set(doc(db, "browser_files", fileId, "chunks", String(index).padStart(3,"0")), { index, payload }));
  await batch.commit();
  const path = `${BROWSER_FILE_SCHEME}${fileId}`;
  return { bucket: "firestore-browser-files", path, publicUrl: path, token: "", browserMode: true };
}

export async function resolveMediaUrl(source = "") {
  const value = String(source || "").trim();
  if (!value.startsWith(BROWSER_FILE_SCHEME)) return value;
  if (browserMediaUrlCache.has(value)) return browserMediaUrlCache.get(value);
  const fileId = value.slice(BROWSER_FILE_SCHEME.length);
  const metaSnap = await getDoc(doc(db, "browser_files", fileId));
  if (!metaSnap.exists()) throw new Error("Stored media file was not found.");
  const meta = metaSnap.data();
  const chunkSnap = await getDocs(collection(db, "browser_files", fileId, "chunks"));
  const rows = chunkSnap.docs.map((d) => d.data()).sort((a,b) => Number(a.index||0)-Number(b.index||0));
  if (Number(meta.chunkCount || 0) !== rows.length) throw new Error("Stored media file is incomplete.");
  const bytes = base64ToBytes(rows.map((row) => String(row.payload || "")).join(""));
  const url = URL.createObjectURL(new Blob([bytes], { type: meta.type || "application/octet-stream" }));
  browserMediaUrlCache.set(value, url);
  return url;
}

export async function hydrateMediaImages(root = document) {
  const images = [...root.querySelectorAll?.('img[src^="firestore-media://"], img[data-media-ref^="firestore-media://"]') || []];
  await Promise.all(images.map(async (img) => {
    const ref = img.dataset.mediaRef || img.getAttribute("src") || "";
    try { img.src = await resolveMediaUrl(ref); } catch (error) { console.warn("Unable to hydrate browser media:", error); }
  }));
}

async function browserComplaintReply(data = {}) {
  const { user } = await requireBrowserRole(["officer", "admin"]);
  const complaintId = String(data.complaintId || "").trim();
  const reply = String(data.reply || "").trim().slice(0,4000);
  const nextStatus = String(data.status || "").trim();
  if (!complaintId || !reply) throw new Error("Complaint ID and reply are required.");
  const ref = doc(db, "complaints", complaintId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Complaint not found.");
  const previousStatus = String(snap.data().status || "Submitted");
  const effectiveStatus = ["Submitted","Under Review","In Progress","Resolved","Closed"].includes(nextStatus) ? nextStatus : previousStatus;
  await updateDoc(ref, {
    status: effectiveStatus, updatedAt: serverTimestamp(),
    thread: arrayUnion({ by: "Officer", actorUid: user.uid, message: reply, at: Timestamp.now() })
  });
  return { updated: true, status: effectiveStatus, replyAdded: true };
}

async function browserSaveElectionSchedule(data = {}, emergency = false) {
  const { user, role } = await requireBrowserRole(emergency ? ["admin"] : ["officer", "admin"]);
  const electionId = String(data.electionId || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(electionId)) throw new Error("Use a permanent Election ID containing lowercase letters, numbers, and hyphens.");
  const schedule = normalizedSchedule(data.schedule || {});
  const electionRef = doc(db, "elections", electionId);
  const pointerRef = doc(db, "election_config", "current");
  const existing = await getDoc(electionRef);
  if (existing.exists() && (existing.data().finalized === true || existing.data().archived === true)) throw new Error("A finalized or archived election cannot be rescheduled.");
  const current = await getDoc(pointerRef);
  const previousId = current.exists() ? String(current.data().electionId || "") : "";
  if (previousId && previousId !== electionId) {
    const previous = await getDoc(doc(db, "elections", previousId));
    if (previous.exists() && previous.data().archived !== true) throw new Error(`Archive the current election (${previousId}) before switching to a new Election ID.`);
  }
  const reason = String(data.reason || "").trim().slice(0,500);
  if (emergency && !reason) throw new Error("An emergency schedule reason is required.");
  const patch = {
    ...schedule, title: String(data.title || existing.data?.()?.title || "USC General Election").trim().slice(0,120),
    lifecycle: lifecycleFromSchedule({ ...(existing.exists() ? existing.data() : {}), ...schedule }, Date.now()),
    finalized: existing.exists() ? existing.data().finalized === true : false,
    resultsPublished: existing.exists() ? existing.data().resultsPublished === true : false,
    archived: existing.exists() ? existing.data().archived === true : false,
    updatedAt: serverTimestamp(), updatedByUid: user.uid, browserManaged: true
  };
  const batch = writeBatch(db);
  batch.set(electionRef, patch, { merge: true });
  batch.set(pointerRef, { electionId, updatedAt: serverTimestamp(), updatedByUid: user.uid }, { merge: true });
  batch.set(doc(collection(db, "audit_logs")), { actorUid: user.uid, actorEmail: user.email || "", action: emergency ? "ELECTION_EMERGENCY_SCHEDULE_UPDATE" : "ELECTION_SCHEDULE_SAVE", target: `elections/${electionId}`, details: emergency ? { reason } : {}, source: "browser-election-runtime", createdAt: serverTimestamp() });
  await batch.commit();
  return { electionId, lifecycle: patch.lifecycle, emergencyChangeRecorded: emergency };
}

async function browserStartRosterImport(data = {}) {
  const { user } = await requireBrowserRole(["admin"]);
  const electionId = String(data.electionId || (await browserElectionContext()).electionId || "").trim();
  if (!electionId) throw new Error("Create an election schedule before importing the voter masterlist.");
  const electionSnap = await getDoc(doc(db, "elections", electionId));
  if (!electionSnap.exists()) throw new Error("Election does not exist.");
  if (Date.now() >= toMillis(electionSnap.data().registrationStart)) throw new Error("The voter roster is frozen when candidate registration begins.");
  const importId = randomId("roster");
  await setDoc(doc(db, "elections", electionId, "rosterImports", importId), { importId, status: "active", startedAt: serverTimestamp(), startedByUid: user.uid, rowsProcessed: 0 });
  return { electionId, importId };
}

function cleanRosterRow(raw = {}) {
  const studentId = String(raw.studentId || "").replace(/\D/g, "").slice(0,6);
  if (!/^\d{6}$/.test(studentId)) throw new Error(`Invalid Student ID: ${raw.studentId || "blank"}`);
  const email = String(raw.institutionalEmail || raw.email || "").trim().toLowerCase();
  const studentStanding = normalizeStudentStanding(raw.studentStanding, raw.enrollmentStatus);
  const eligible = isActiveStudentStanding(studentStanding, raw.enrollmentStatus) && ![false,"false","no","0"].includes(typeof raw.eligible === "string" ? raw.eligible.trim().toLowerCase() : raw.eligible);
  return { studentId, fullName: String(raw.fullName || "").trim().slice(0,120), email, institutionalEmail: email, program: String(raw.program || "").trim().slice(0,160), college: String(raw.college || "").trim().slice(0,160), yearLevel: String(raw.yearLevel || "").trim().slice(0,40), studentStanding, enrollmentStatus: enrollmentStatusForStanding(studentStanding), eligible };
}

async function browserImportRoster(data = {}) {
  const { user } = await requireBrowserRole(["admin"]);
  const electionId = String(data.electionId || "").trim();
  const importId = String(data.importId || "").trim();
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!electionId || !importId || !rows.length) throw new Error("Start the voter roster import first.");
  const cleanRows = rows.map(cleanRosterRow);
  const batch = writeBatch(db);
  cleanRows.forEach((row) => {
    batch.set(doc(db, "student_masterlist", row.studentId), { ...row, lastElectionId: electionId, lastRosterImportId: importId, updatedAt: serverTimestamp() }, { merge: true });
    batch.set(doc(db, "elections", electionId, "voterRoster", row.studentId), { ...row, importId, updatedAt: serverTimestamp() }, { merge: true });
  });
  batch.set(doc(db, "elections", electionId, "rosterImports", importId), { rowsProcessed: increment(cleanRows.length), updatedAt: serverTimestamp(), lastUpdatedByUid: user.uid }, { merge: true });
  await batch.commit();
  return { imported: cleanRows.length, importId };
}

async function browserFinalizeRosterImport(data = {}) {
  await requireBrowserRole(["admin"]);
  const electionId = String(data.electionId || "").trim();
  const importId = String(data.importId || "").trim();
  const roster = await getDocs(collection(db, "elections", electionId, "voterRoster"));
  let eligibleVoterCount = 0;
  const stale = [];
  roster.forEach((d) => { const row=d.data(); if (row.importId !== importId) stale.push(d.ref); else if (row.eligible === true && normalizeStudentStanding(row.studentStanding,row.enrollmentStatus)==="active") eligibleVoterCount += 1; });
  for (let i=0;i<stale.length;i+=400) { const batch=writeBatch(db); stale.slice(i,i+400).forEach((r)=>batch.delete(r)); await batch.commit(); }
  const batch=writeBatch(db);
  batch.set(doc(db,"elections",electionId), { eligibleVoterCount, voterRosterVersion: importId, voterRosterRows: roster.size-stale.length, voterRosterFinalizedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge:true });
  batch.set(doc(db,"elections",electionId,"turnout","public"), { eligibleVoters: eligibleVoterCount, ballotsCast: 0, updatedAt: serverTimestamp() }, { merge:true });
  batch.set(doc(db,"elections",electionId,"rosterImports",importId), { status:"completed", completedAt:serverTimestamp(), eligibleVoterCount, currentRows:roster.size-stale.length, removedStaleRows:stale.length }, { merge:true });
  await batch.commit();
  return { electionId, importId, rows: roster.size-stale.length, eligibleVoterCount, removedStaleRows: stale.length };
}

async function browserSubmitCandidateApplication(data = {}) {
  const { user, profile } = await requireBrowserRole(["student"]);
  if (profile.isVerifiedStudent !== true || profile.schoolProvisioned !== true) throw new Error("Your verified school account is required for candidate registration.");
  const context = await browserElectionContext();
  if (!context.registrationOpen) throw new Error("Candidate registration is not open.");
  const studentId = String(profile.studentId || "").trim();
  const rosterSnap = await getDoc(doc(db,"elections",context.electionId,"voterRoster",studentId));
  if (!rosterSnap.exists() || rosterSnap.data().eligible !== true) throw new Error("You are not on the active eligible voter roster.");
  const roster = rosterSnap.data();
  const position = String(data.position || "").trim();
  if (!ELECTION_POSITIONS.includes(position)) throw new Error("Invalid candidate position.");
  const appRef = doc(db,"elections",context.electionId,"applications",user.uid);
  const existing = await getDoc(appRef);
  if (existing.exists()) throw new Error("You already submitted a candidate application for this election.");
  const photoPath = String(data.campaignPhotoPath || "").trim();
  if (!photoPath.startsWith(BROWSER_FILE_SCHEME)) throw new Error("Campaign photo upload is missing.");
  const supportingDocumentPaths = Array.isArray(data.supportingDocumentPaths) ? data.supportingDocumentPaths.filter((p)=>String(p).startsWith(BROWSER_FILE_SCHEME)).slice(0,8) : [];
  await setDoc(appRef, { applicantUid:user.uid, studentId, fullName:String(roster.fullName||profile.fullName||"").slice(0,120), email:user.email||profile.email||"", program:String(roster.program||profile.program||"").slice(0,160), college:String(roster.college||profile.college||"").slice(0,160), position, department:position==="Department Representative"?String(roster.college||profile.college||"").slice(0,160):"", partylist:String(data.partylist||"").trim().slice(0,100), platform:String(data.platform||"").trim().slice(0,4000), campaignPhotoPath:photoPath, supportingDocumentPaths, status:"Under Review", submittedAt:serverTimestamp(), updatedAt:serverTimestamp() });
  return { applicationId:user.uid, status:"Under Review", electionId:context.electionId };
}

async function browserReviewCandidate(data = {}) {
  const { user } = await requireBrowserRole(["officer","admin"]);
  const context = await browserElectionContext();
  if (!context.reviewOpen) throw new Error("Application review is not open.");
  const applicantUid = String(data.applicantUid||"").trim();
  const decision = String(data.decision||"").toLowerCase();
  if (!applicantUid || !["approve","reject"].includes(decision)) throw new Error("Choose Approve or Reject.");
  const appRef = doc(db,"elections",context.electionId,"applications",applicantUid);
  const appSnap = await getDoc(appRef);
  if (!appSnap.exists()) throw new Error("Candidate application not found.");
  if (String(appSnap.data().status||"").toLowerCase() !== "under review") throw new Error("This application already has a final decision.");
  const app = appSnap.data();
  const status = decision === "approve" ? "Approved" : "Rejected";
  const candidateId = decision === "approve" ? randomId("cand") : "";
  const batch=writeBatch(db);
  batch.update(appRef,{ status, candidateId: candidateId || "", reviewNote:String(data.reviewNote||"").slice(0,500), reviewedByUid:user.uid, reviewedAt:serverTimestamp(), updatedAt:serverTimestamp() });
  if (candidateId) batch.set(doc(db,"elections",context.electionId,"candidates",candidateId), { candidateId, fullName:app.fullName||"", position:app.position||"", department:app.department||"", college:app.college||"", program:app.program||"", partylist:app.partylist||"", platform:app.platform||"", campaignPhotoUrl:app.campaignPhotoPath||"", approved:true, published:true, approvedAt:serverTimestamp() });
  await batch.commit();
  return { status, candidateId: candidateId || null };
}

async function browserSubmitBallot(data = {}) {
  const { user, profile } = await requireBrowserRole(["student"]);
  if (profile.isVerifiedStudent !== true) throw new Error("Your account is not eligible to vote.");
  const context = await browserElectionContext();
  if (!context.votingOpen || context.electionId !== String(data.electionId||context.electionId)) throw new Error("Voting is not open.");
  const selections = data.selections && typeof data.selections === "object" ? data.selections : {};
  if (!ELECTION_POSITIONS.every((p)=>typeof selections[p] === "string" && selections[p])) throw new Error("Select one candidate for every ballot position.");
  const studentId = String(profile.studentId||"").trim();
  const rosterSnap = await getDoc(doc(db,"elections",context.electionId,"voterRoster",studentId));
  if (!rosterSnap.exists() || rosterSnap.data().eligible !== true) throw new Error("You are not an eligible voter in this election.");
  const roster = rosterSnap.data();
  for (const position of ELECTION_POSITIONS) {
    const candidate = await getDoc(doc(db,"elections",context.electionId,"candidates",String(selections[position])));
    if (!candidate.exists() || candidate.data().approved !== true || candidate.data().position !== position) throw new Error(`Invalid ${position} candidate selection.`);
    if (position === "Department Representative" && String(candidate.data().department||"") !== String(roster.college||"")) throw new Error("You may only vote for your verified college representative.");
  }
  const receiptReference = `USC-${randomId("R").slice(-16).toUpperCase()}`;
  const ballotRef = doc(collection(db,"elections",context.electionId,"ballots"));
  const statusRef = doc(db,"elections",context.electionId,"voterStatus",user.uid);
  await runTransaction(db, async (tx) => {
    const statusSnap = await tx.get(statusRef);
    if (statusSnap.exists() && statusSnap.data().hasVoted === true) throw new Error("Your voter record already shows a submitted ballot.");
    tx.set(ballotRef,{ selections:Object.fromEntries(ELECTION_POSITIONS.map((p)=>[p,String(selections[p])])), schemaVersion:2, recordedAt:serverTimestamp() });
    tx.set(statusRef,{ hasVoted:true, studentId, college:String(roster.college||""), votedAt:serverTimestamp(), receiptReference });
    tx.set(doc(db,"elections",context.electionId,"turnout","public"), { ballotsCast:increment(1), eligibleVoters:Number(context.eligibleVoterCount||0), updatedAt:serverTimestamp() }, { merge:true });
  });
  return { recorded:true, receiptReference };
}

async function browserFinalizeElection() {
  const { user, profile, role } = await requireBrowserRole(["officer","admin"]);
  if (role !== "admin" && profile.canvasser !== true) throw new Error("Authorized canvassing access is required to finalize the election.");
  const context = await browserElectionContext();
  if (!context.electionId) throw new Error("No active election is configured.");
  if (Date.now() < Number(context.votingEnd||0)) throw new Error("Voting must be closed before finalization.");
  await updateDoc(doc(db,"elections",context.electionId), { finalized:true, lifecycle:"Canvassing", finalizedAt:serverTimestamp(), finalizedByUid:user.uid, updatedAt:serverTimestamp() });
  return { electionId:context.electionId, lifecycle:"Canvassing" };
}

async function browserPublishResults() {
  const { user, profile, role } = await requireBrowserRole(["officer","admin"]);
  if (role !== "admin" && profile.canvasser !== true) throw new Error("Authorized canvassing access is required to publish results.");
  const context = await browserElectionContext();
  if (!context.finalized) throw new Error("Finalize the election before publishing results.");
  if (Date.now() < Number(context.resultPublicationStart||0)) throw new Error("The result publication schedule has not started.");
  const [candidateSnap, ballotSnap, turnoutSnap] = await Promise.all([getDocs(collection(db,"elections",context.electionId,"candidates")), getDocs(collection(db,"elections",context.electionId,"ballots")), getDoc(doc(db,"elections",context.electionId,"turnout","public"))]);
  const counts = new Map();
  ballotSnap.forEach((d)=>Object.values(d.data().selections||{}).forEach((id)=>counts.set(String(id),(counts.get(String(id))||0)+1)));
  const results = candidateSnap.docs.filter((d)=>d.data().approved===true).map((d)=>({ id:d.id, candidateId:d.id, fullName:d.data().fullName||"", position:d.data().position||"", department:d.data().department||"", partylist:d.data().partylist||"", campaignPhotoUrl:d.data().campaignPhotoUrl||"", votes:counts.get(d.id)||0 })).sort((a,b)=>String(a.position).localeCompare(String(b.position))||b.votes-a.votes);
  const batch=writeBatch(db);
  batch.set(doc(db,"elections",context.electionId,"results","official"), { electionId:context.electionId, title:context.title||"USC Election", results, turnout:turnoutSnap.exists()?turnoutSnap.data():{ballotsCast:ballotSnap.size,eligibleVoters:context.eligibleVoterCount||0}, publishedAt:serverTimestamp(), publishedByUid:user.uid });
  batch.update(doc(db,"elections",context.electionId), { resultsPublished:true, lifecycle:"Results Published", resultsPublishedAt:serverTimestamp(), updatedAt:serverTimestamp() });
  await batch.commit();
  return { electionId:context.electionId, published:true, resultRows:results.length };
}

async function browserArchiveElection() {
  const { user } = await requireBrowserRole(["admin"]);
  const context = await browserElectionContext();
  if (!context.resultsPublished) throw new Error("Publish the official results before archiving the election.");
  await updateDoc(doc(db,"elections",context.electionId), { archived:true, lifecycle:"Archived", archivedAt:serverTimestamp(), archivedByUid:user.uid, updatedAt:serverTimestamp() });
  return { electionId:context.electionId, archived:true };
}

async function callBrowserMode(name, data) {
  if (name === "getElectionContext") return browserElectionContext();
  if (name === "getOfficerDashboardMetrics") return browserOfficerMetrics();
  if (name === "adminUpdateUser") return browserAdminUpdateUser(data);
  if (name === "updateComplaintCase" && String(data?.reply || "").trim()) return browserComplaintReply(data);
  if (name === "updateComplaintCase") return browserUpdateComplaintStatus(data);
  if (name === "deleteComplaintCase") return browserDeleteComplaintCase(data);
  if (name === "recordAdminAuditAction") return browserRecordAudit(data);
  if (name === "provisionSchoolAccounts") return provisionStudentAccounts(Array.isArray(data?.rows) ? data.rows : []);
  if (name === "activateVerifiedStudent") return { ok: true, browserMode: true };
  if (name === "saveElectionSchedule") return browserSaveElectionSchedule(data, false);
  if (name === "emergencyUpdateElectionSchedule") return browserSaveElectionSchedule(data, true);
  if (name === "startVoterRosterImport") return browserStartRosterImport(data);
  if (name === "importVoterMasterlist") return browserImportRoster(data);
  if (name === "finalizeVoterRosterImport") return browserFinalizeRosterImport(data);
  if (name === "submitCandidateApplication") return browserSubmitCandidateApplication(data);
  if (name === "reviewCandidateApplication") return browserReviewCandidate(data);
  if (name === "submitAnonymousBallot") return browserSubmitBallot(data);
  if (name === "finalizeElection") return browserFinalizeElection();
  if (name === "publishElectionResults") return browserPublishResults();
  if (name === "archiveElection") return browserArchiveElection();
  if (name === "createUploadTicket") throw new Error("Browser upload adapter was not initialized.");
  if (name === "createPrivateDownloadUrl") throw new Error("Browser file adapter was not initialized.");
  return null;
}

export async function callSecure(name, data = {}) {
  try {
    if (globalThis.USC_FREE_SPARK_MODE === true) {
      const local = await callBrowserMode(name, data);
      if (local !== null) return local;
    }
    const result = await callable(name)(data);
    return result.data;
  } catch (error) {
    const wrapped = new Error(cleanError(error));
    wrapped.code = error?.code || "unknown";
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function loadCurrentElection() {
  const pointer = await getDoc(doc(db, "election_config", "current"));
  if (!pointer.exists() || !pointer.data()?.electionId) {
    throw new Error("Election services are temporarily unavailable. No active election is configured.");
  }
  const electionId = String(pointer.data().electionId);
  const electionSnap = await getDoc(doc(db, "elections", electionId));
  if (!electionSnap.exists()) {
    throw new Error("Election services are temporarily unavailable. The active election record could not be loaded.");
  }
  return { electionId, ...electionSnap.data() };
}

export async function secureUpload(file, kind) {
  if (!(file instanceof File)) throw new Error("Please choose a file to upload.");
  if (globalThis.USC_FREE_SPARK_MODE === true) return browserStoreFile(file, kind);
  const ticket = await callSecure("createUploadTicket", { kind, filename: file.name, contentType: file.type, size: file.size });
  const { error } = await supabase.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false
  });
  if (error) throw new Error(error.message || "Secure file upload failed.");
  return ticket;
}

export async function openPrivateFile(path) {
  if (globalThis.USC_FREE_SPARK_MODE === true && String(path || "").startsWith(BROWSER_FILE_SCHEME)) {
    const url = await resolveMediaUrl(path);
    window.open(url, "_blank", "noopener,noreferrer");
    return url;
  }
  const { url } = await callSecure("createPrivateDownloadUrl", { path });
  window.open(url, "_blank", "noopener,noreferrer");
  return url;
}

export async function refreshTrustedClaims() {
  const user = auth.currentUser;
  if (!user) return null;
  await user.getIdToken(true);
  return user.getIdTokenResult();
}

export { auth, db };


import { db } from "../../../firebase/firebase-config.js";
import { callSecure } from "../../../shared/security-client.js";
import { isActiveStudentStanding, normalizeStudentStanding, studentStandingLabel } from "../../../shared/student-standing.js";
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const BULK_NO_CHANGE = "__no_change__";

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}


export function normalizeRoleValue(role) {
  const value = String(role || "student").trim().toLowerCase();
  if (value === "admin") return "admin";
  if (value === "officer") return "officer";
  return "student";
}

export function canonicalRole(_email, role) { return normalizeRoleValue(role); }

export function normalizeStatus(status, isActive = true) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "pending" || value === "approved" || value === "suspended") {
    return value;
  }
  return isActive === false ? "suspended" : "approved";
}

export function normalizeDateInputValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function parseStoredProfile() {
  try {
    return JSON.parse(sessionStorage.getItem("studentProfile") || "null");
  } catch {
    return null;
  }
}

export function getCurrentAdminProfile() {
  const stored = parseStoredProfile();
  return {
    uid: String(stored?.uid || "").trim(),
    fullName: String(stored?.fullName || "").trim(),
    email: String(stored?.email || "").trim(),
    role: canonicalRole(stored?.email, stored?.role)
  };
}

export function normalizeUser(docSnap) {
  const data = docSnap.data() || {};
  const email = String(data.email || "").trim();
  const role = canonicalRole(email, data.role);
  const status = normalizeStatus(data.accountStatus, data.isActive !== false);
  return {
    uid: docSnap.id,
    fullName: String(data.fullName || "").trim(),
    email,
    studentId: String(data.studentId || "").trim(),
    role,
    isActive: data.isActive !== false,
    accountStatus: status,
    isVerifiedStudent: Boolean(data.isVerifiedStudent),
    yearLevel: String(data.yearLevel || "").trim(),
    studentStanding: normalizeStudentStanding(data.studentStanding, data.enrollmentStatus),
    studentStandingLabel: studentStandingLabel(data.studentStanding || "active"),
    enrollmentStatus: String(data.enrollmentStatus || "").trim(),
    officePosition: role === "admin"
      ? (String(data.officePosition || "").trim() || "System Administrator")
      : String(data.officePosition || "").trim(),
    adminNotes: String(data.adminNotes || "").trim(),
    createdAtMs: Number(data.createdAtMs || 0),
    updatedAtMs: Number(data.updatedAtMs || 0),
    roleEffectiveDate: normalizeDateInputValue(data.roleEffectiveDate),
    roleEffectiveAtMs: Number(data.roleEffectiveAtMs || 0),
    lastLoginAtMs: Number(data.lastLoginAtMs || 0),
    lastActivityAtMs: Number(data.lastActivityAtMs || 0),
    lastRoleUpdatedBy: String(data.lastRoleUpdatedBy || "").trim(),
    lastRoleUpdateNote: String(data.lastRoleUpdateNote || "").trim(),
    accountStatusRaw: String(data.accountStatus || "").trim()
  };
}

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getInitials(name, email) {
  const source = String(name || email || "").trim();
  if (!source) return "--";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function roleClass(role) {
  return `role-${normalizeRoleValue(role)}`;
}

export function statusClass(status) {
  return `status-${normalizeStatus(status)}`;
}

export function routeLabel(role) {
  const normalized = normalizeRoleValue(role);
  if (normalized === "admin") return "Admin access module";
  if (normalized === "officer") return "Officer dashboard";
  return "Student dashboard";
}

export function formatDateTime(ms) {
  const value = Number(ms || 0);
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

export function formatDateOnly(value) {
  const normalized = normalizeDateInputValue(value);
  if (!normalized) return "—";
  const date = new Date(`${normalized}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function isNewWithinDays(user, days) {
  const ms = Number(user?.createdAtMs || 0);
  if (!ms || !days) return false;
  return Date.now() - ms <= days * 24 * 60 * 60 * 1000;
}

export function isProtectedAdmin(user) {
  return Boolean(user && normalizeRoleValue(user.role) === "admin");
}

export function normalizeComplaintStatus(status) {
  const value = String(status || "submitted")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/\s+/g, "-");
  if (value === "submitted") return "submitted";
  if (value === "under-review" || value === "in-review") return "under-review";
  if (value === "in-progress") return "in-progress";
  if (value === "resolved") return "resolved";
  if (value === "closed") return "closed";
  return value || "submitted";
}

export function buildComplaintSummary(snapshot) {
  const summary = new Map();
  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const uid = String(data.studentUid || "").trim();
    if (!uid) return;
    const status = normalizeComplaintStatus(data.status);
    const updatedAtMs = Number(data.updatedAtMs || data.createdAtMs || 0);
    const current = summary.get(uid) || { total: 0, statuses: new Map(), latestMs: 0 };
    current.total += 1;
    current.statuses.set(status, (current.statuses.get(status) || 0) + 1);
    current.latestMs = Math.max(current.latestMs, updatedAtMs);
    summary.set(uid, current);
  });
  return summary;
}

export function buildVoteSummary(snapshot) {
  const summary = new Map();
  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const studentId = String(data.studentId || "").trim();
    if (!studentId || data.hasVoted !== true) return;
    const votedAtMs = data.votedAt?.toMillis?.() || Number(data.votedAtMs || 0);
    summary.set(studentId, {
      submittedAtMs: votedAtMs,
      receiptReference: String(data.receiptReference || "Recorded").trim(),
      college: String(data.college || "").trim()
    });
  });
  return summary;
}

export function complaintSummaryFor(user, complaintSummaryByUid) {
  return complaintSummaryByUid.get(user.uid) || { total: 0, statuses: new Map(), latestMs: 0 };
}

export function voteSummaryFor(user, voteSummaryByStudentId) {
  return voteSummaryByStudentId.get(user.studentId) || null;
}

export function computeUserStats(users) {
  return users.reduce((accumulator, user) => {
    accumulator.total += 1;
    if (user.accountStatus === "approved") accumulator.approved += 1;
    if (user.accountStatus === "pending") accumulator.pending += 1;
    if (user.accountStatus === "suspended") accumulator.suspended += 1;
    if (user.role === "officer") accumulator.officers += 1;
    if (user.isVerifiedStudent) accumulator.verified += 1;
    if (isNewWithinDays(user, 7)) accumulator.newThisWeek += 1;
    if (!user.lastLoginAtMs) accumulator.neverLoggedIn += 1;
    return accumulator;
  }, {
    total: 0,
    approved: 0,
    pending: 0,
    suspended: 0,
    officers: 0,
    verified: 0,
    newThisWeek: 0,
    neverLoggedIn: 0
  });
}

export function buildAdminWarnings(users, complaintSummaryByUid) {
  const warnings = [];
  const duplicateStudentIds = new Map();
  users.forEach((user) => {
    const key = String(user.studentId || "").trim();
    if (!key) return;
    duplicateStudentIds.set(key, (duplicateStudentIds.get(key) || 0) + 1);
  });

  const duplicateCount = [...duplicateStudentIds.values()].filter((count) => count > 1).length;
  if (duplicateCount) {
    warnings.push({
      tone: "red",
      title: "Duplicate student IDs detected",
      detail: `${duplicateCount} student ID value${duplicateCount === 1 ? " is" : "s are"} assigned to more than one account.`
    });
  }

  const officersMissingPosition = users.filter((user) => user.role === "officer" && !String(user.officePosition || "").trim()).length;
  if (officersMissingPosition) {
    warnings.push({
      tone: "amber",
      title: "Officers missing assignments",
      detail: `${officersMissingPosition} officer account${officersMissingPosition === 1 ? " is" : "s are"} missing an office position.`
    });
  }

  const unverifiedOfficers = users.filter((user) => user.role === "officer" && !user.isVerifiedStudent).length;
  if (unverifiedOfficers) {
    warnings.push({
      tone: "amber",
      title: "Unverified officers found",
      detail: `${unverifiedOfficers} officer account${unverifiedOfficers === 1 ? " has" : "s have"} not been marked as verified.`
    });
  }

  const suspendedButActive = users.filter((user) => user.accountStatus === "suspended" && user.isActive).length;
  if (suspendedButActive) {
    warnings.push({
      tone: "red",
      title: "Suspended accounts still active",
      detail: `${suspendedButActive} account${suspendedButActive === 1 ? " is" : "s are"} suspended but still flagged active.`
    });
  }

  const usersWithManyComplaints = users.filter((user) => complaintSummaryFor(user, complaintSummaryByUid).total >= 3).length;
  if (usersWithManyComplaints) {
    warnings.push({
      tone: "blue",
      title: "Frequent complaint subjects",
      detail: `${usersWithManyComplaints} student account${usersWithManyComplaints === 1 ? " has" : "s have"} three or more complaints on file.`
    });
  }

  return warnings;
}

export function getFilteredUsers(users, filters = {}) {
  const queryText = String(filters.queryText || "").trim().toLowerCase();
  const roleFilter = String(filters.role || "all").trim().toLowerCase();
  const statusFilter = String(filters.status || "all").trim().toLowerCase();
  const verifiedFilter = String(filters.verified || "all").trim().toLowerCase();
  const activeFilter = String(filters.active || "all").trim().toLowerCase();
  const recentFilter = String(filters.recent || "all").trim().toLowerCase();
  const sortValue = String(filters.sort || "name").trim().toLowerCase();

  const filtered = users.filter((user) => {
    if (roleFilter !== "all" && user.role !== roleFilter) return false;
    if (statusFilter !== "all" && user.accountStatus !== statusFilter) return false;
    if (verifiedFilter === "verified" && !user.isVerifiedStudent) return false;
    if (verifiedFilter === "unverified" && user.isVerifiedStudent) return false;
    if (activeFilter === "active" && !user.isActive) return false;
    if (activeFilter === "inactive" && user.isActive) return false;
    if (recentFilter !== "all") {
      const days = Number(recentFilter || 0);
      if (days > 0 && !isNewWithinDays(user, days)) return false;
    }
    if (!queryText) return true;
    const haystack = [
      user.fullName,
      user.email,
      user.studentId,
      user.role,
      user.accountStatus,
      user.officePosition,
      user.adminNotes,
      user.lastRoleUpdateNote
    ].join(" ").toLowerCase();
    return haystack.includes(queryText);
  });

  return filtered.sort((left, right) => {
    if (sortValue === "newest") return (right.createdAtMs || 0) - (left.createdAtMs || 0);
    if (sortValue === "oldest") return (left.createdAtMs || 0) - (right.createdAtMs || 0);
    if (sortValue === "recent-login") return (right.lastLoginAtMs || 0) - (left.lastLoginAtMs || 0);
    if (sortValue === "role") {
      const roleRank = { admin: 0, officer: 1, student: 2 };
      return (roleRank[left.role] ?? 9) - (roleRank[right.role] ?? 9) || (left.fullName || left.email).localeCompare(right.fullName || right.email);
    }
    return (left.fullName || left.email || left.studentId).localeCompare(right.fullName || right.email || right.studentId);
  });
}

export function buildQueueUsers(users) {
  return [...users]
    .sort((left, right) => {
      const leftRank = left.accountStatus === "pending" ? 0 : 1;
      const rightRank = right.accountStatus === "pending" ? 0 : 1;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (right.createdAtMs || 0) - (left.createdAtMs || 0);
    });
}

export function getQueueTag(user) {
  if (user.accountStatus === "pending") return "Pending review";
  if (isNewWithinDays(user, 7)) return "New this week";
  return "Recent registration";
}

export function summarizeComplaintStates(summary) {
  const parts = [];
  const submitted = summary.statuses.get("submitted") || 0;
  const underReview = summary.statuses.get("under-review") || 0;
  const inProgress = summary.statuses.get("in-progress") || 0;
  const resolved = summary.statuses.get("resolved") || 0;
  const closed = summary.statuses.get("closed") || 0;
  if (submitted) parts.push(`${submitted} submitted`);
  if (underReview) parts.push(`${underReview} under review`);
  if (inProgress) parts.push(`${inProgress} in progress`);
  if (resolved) parts.push(`${resolved} resolved`);
  if (closed) parts.push(`${closed} closed`);
  return parts.length ? parts.join(" • ") : "No complaints";
}

function buildUserUpdatePayload(user, source = {}) {
  const protectedAdmin = isProtectedAdmin(user);
  const nextRole = protectedAdmin ? "admin" : canonicalRole(user.email, source.role ?? user.role);
  const nextStatus = normalizeStatus(source.accountStatus ?? user.accountStatus, source.isActive ?? user.isActive);
  const nextActive = protectedAdmin ? true : (typeof source.isActive === "boolean" ? source.isActive : user.isActive);
  const nextYearLevel = protectedAdmin ? (user.yearLevel || "") : String(source.yearLevel ?? user.yearLevel ?? "").trim().slice(0, 40);
  const nextStanding = protectedAdmin ? "active" : normalizeStudentStanding(source.studentStanding ?? user.studentStanding, user.enrollmentStatus);
  const standingActive = protectedAdmin ? true : isActiveStudentStanding(nextStanding, user.enrollmentStatus);
  const requestedVerified = protectedAdmin ? true : (typeof source.isVerifiedStudent === "boolean" ? source.isVerifiedStudent : user.isVerifiedStudent);
  const nextVerified = standingActive ? requestedVerified : false;
  const nextOfficeRaw = String(source.officePosition ?? user.officePosition ?? "").trim();
  const nextOfficePosition = nextRole === "officer"
    ? (nextOfficeRaw || "USC Officer")
    : nextRole === "admin"
      ? "System Administrator"
      : "";
  const nextEffectiveDate = protectedAdmin
    ? (user.roleEffectiveDate || normalizeDateInputValue(new Date().toISOString()))
    : normalizeDateInputValue(source.roleEffectiveDate ?? user.roleEffectiveDate ?? new Date().toISOString());
  const nextNotes = String(source.adminNotes ?? user.adminNotes ?? "").trim();
  const changeReason = String(source.changeReason || "").trim();
  const sanitizedStatus = nextStatus === "suspended" ? "suspended" : nextStatus;
  const normalizedActive = sanitizedStatus === "suspended" || !standingActive ? false : nextActive;
  return {
    protectedAdmin,
    nextRole,
    nextStatus: sanitizedStatus,
    nextActive: normalizedActive,
    nextVerified,
    nextYearLevel,
    nextStanding,
    standingActive,
    nextOfficePosition,
    nextEffectiveDate,
    nextNotes,
    changeReason
  };
}

function summarizeChanges(user, payload) {
  const parts = [];
  if (user.role !== payload.nextRole) parts.push(`role ${user.role} → ${payload.nextRole}`);
  if (user.accountStatus !== payload.nextStatus) parts.push(`status ${user.accountStatus} → ${payload.nextStatus}`);
  if (user.isVerifiedStudent !== payload.nextVerified) parts.push(`verification ${user.isVerifiedStudent ? "verified" : "unverified"} → ${payload.nextVerified ? "verified" : "unverified"}`);
  if (user.isActive !== payload.nextActive) parts.push(`active ${user.isActive ? "yes" : "no"} → ${payload.nextActive ? "yes" : "no"}`);
  if ((user.yearLevel || "") !== payload.nextYearLevel) parts.push(`year level → ${payload.nextYearLevel || "not set"}`);
  if (normalizeStudentStanding(user.studentStanding, user.enrollmentStatus) !== payload.nextStanding) parts.push(`standing → ${studentStandingLabel(payload.nextStanding)}`);
  if ((user.officePosition || "") !== payload.nextOfficePosition) parts.push(`office → ${payload.nextOfficePosition || "none"}`);
  if ((user.adminNotes || "") !== payload.nextNotes) parts.push("notes updated");
  return parts;
}

function requiresReason(changeParts) {
  return changeParts.some((part) => part.startsWith("role") || part.startsWith("status") || part.startsWith("active") || part.startsWith("standing"));
}


export async function updateSingleUser(user, source = {}) {
  const payload = buildUserUpdatePayload(user, source);
  const changeParts = summarizeChanges(user, payload);
  if (!changeParts.length) return { changed: false, message: "No changes detected." };
  if (requiresReason(changeParts) && !payload.changeReason) throw new Error("Please enter a reason for this role or access change.");
  await callSecure("adminUpdateUser", {
    uid: user.uid,
    role: payload.nextRole,
    officePosition: payload.nextOfficePosition,
    accountStatus: payload.nextStatus,
    isVerifiedStudent: payload.nextVerified,
    yearLevel: payload.nextYearLevel,
    studentStanding: payload.nextStanding,
    adminNotes: payload.nextNotes,
    roleEffectiveDate: payload.nextEffectiveDate,
    changeReason: payload.changeReason
  });
  return { changed: true, message: `${user.fullName || user.email}: ${changeParts.join(" • ")}` };
}

export async function applyBulkUpdates(users, options = {}) {
  const targetUsers = users.filter((user) => !isProtectedAdmin(user));
  if (!targetUsers.length) throw new Error("Select at least one non-admin user first.");
  const prepared = targetUsers.map((user) => ({
    user,
    payload: buildUserUpdatePayload(user, {
      role: options.role,
      officePosition: options.officePosition,
      accountStatus: options.accountStatus,
      roleEffectiveDate: options.roleEffectiveDate,
      adminNotes: options.adminNotes,
      changeReason: options.changeReason
    })
  })).map((entry) => ({ ...entry, changeParts: summarizeChanges(entry.user, entry.payload) })).filter((entry) => entry.changeParts.length);
  if (!prepared.length) return { changed: 0, message: "No bulk changes detected." };
  const sharedReason = String(options.changeReason || "").trim();
  if (prepared.some((entry) => requiresReason(entry.changeParts)) && !sharedReason) throw new Error("Please enter a reason for this bulk update.");
  let changed = 0;
  for (const { user, payload } of prepared) {
    await callSecure("adminUpdateUser", {
      uid: user.uid,
      role: payload.nextRole,
      officePosition: payload.nextOfficePosition,
      accountStatus: payload.nextStatus,
      adminNotes: payload.nextNotes,
      roleEffectiveDate: payload.nextEffectiveDate,
      changeReason: sharedReason
    });
    changed += 1;
  }
  return { changed, message: `Bulk update applied to ${changed} users through trusted server authorization.` };
}

export function exportUsersCsv(users, complaintSummaryByUid, voteSummaryByStudentId, filename) {
  if (!users.length) {
    throw new Error("No users available for export.");
  }
  // Audit metadata only. The audit event never contains ballot selections.
  callSecure("recordAdminAuditAction", { action: "ADMIN_EXPORT", target: filename, details: { exportedUsers: users.length } })
    .catch((error) => console.warn("Unable to record export audit event:", error));
  const headers = [
    "Full Name",
    "Email",
    "Student ID",
    "Year Level",
    "Student Standing",
    "Role",
    "Account Status",
    "Active",
    "Verified",
    "Office Position",
    "Registered At",
    "Last Login",
    "Last Activity",
    "Complaint Count",
    "Vote Submitted",
    "Role Effective Date",
    "Admin Notes"
  ];
  const toCsvValue = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = users.map((user) => {
    const complaintSummary = complaintSummaryFor(user, complaintSummaryByUid);
    const voteSummary = voteSummaryFor(user, voteSummaryByStudentId);
    return [
      user.fullName || "",
      user.email || "",
      user.studentId || "",
      user.yearLevel || "",
      user.studentStandingLabel || user.studentStanding || "",
      user.role,
      user.accountStatus,
      user.isActive ? "Yes" : "No",
      user.isVerifiedStudent ? "Yes" : "No",
      user.officePosition || "",
      formatDateTime(user.createdAtMs),
      formatDateTime(user.lastLoginAtMs),
      formatDateTime(user.lastActivityAtMs),
      String(complaintSummary.total),
      voteSummary ? "Yes" : "No",
      formatDateOnly(user.roleEffectiveDate),
      user.adminNotes || ""
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(toCsvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function setActiveAdminNav() {
  const current = window.location.pathname.split("/").pop();
  document.querySelectorAll("[data-admin-nav]").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href")?.endsWith(current));
  });
}

export function renderAdminIdentity() {
  const profile = getCurrentAdminProfile();
  const displayName = profile.fullName || profile.email || "USC Admin";
  document.querySelectorAll("[data-admin-name], #adminName, .admin-name").forEach((element) => {
    element.textContent = displayName;
  });
  document.querySelectorAll("[data-admin-role], #adminRole, .admin-role").forEach((element) => {
    element.textContent = "System Administrator";
  });
  document.querySelectorAll("[data-usc-welcome-role]").forEach((element) => {
    element.textContent = "System Administrator";
  });
  document.querySelectorAll("[data-usc-welcome-name]").forEach((element) => {
    element.textContent = displayName;
  });
  document.querySelectorAll("[data-admin-initials]").forEach((element) => {
    if (!element.querySelector(".usc-profile-avatar-image")) {
      element.textContent = getInitials(displayName, profile.email);
    }
  });
}

export function subscribeUsers(callback) {
  return onSnapshot(collection(db, "users"), (snapshot) => callback(snapshot.docs.map(normalizeUser)), (error) => callback([], error));
}

export function subscribeComplaints(callback) {
  return onSnapshot(collection(db, "complaints"), (snapshot) => callback(buildComplaintSummary(snapshot)), (error) => callback(new Map(), error));
}

export function subscribeVotes(callback) {
  let unsubscribe = () => {};
  let active = true;
  callSecure("getElectionContext").then((context) => {
    if (!active) return;
    unsubscribe = onSnapshot(collection(db, "elections", context.electionId, "voterStatus"), (snapshot) => callback(buildVoteSummary(snapshot)), (error) => callback(new Map(), error));
  }).catch((error) => callback(new Map(), error));
  return () => { active = false; unsubscribe(); };
}

export function subscribeRoleLogs(callback, maxItems = 30) {
  return onSnapshot(query(collection(db, "audit_logs"), orderBy("createdAt", "desc"), limit(maxItems)), (snapshot) => {
    const logs = snapshot.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      const before = data.before || {};
      const after = data.after || {};
      const action = String(data.action || "update");
      const parts = [];
      if (before.role !== undefined || after.role !== undefined) parts.push(`Role: ${before.role || "—"} → ${after.role || "—"}`);
      if (before.accountStatus !== undefined || after.accountStatus !== undefined) parts.push(`Status: ${before.accountStatus || "—"} → ${after.accountStatus || "—"}`);
      if (before.officePosition !== undefined || after.officePosition !== undefined) parts.push(`Position: ${before.officePosition || "—"} → ${after.officePosition || "—"}`);
      return {
        id: docSnap.id,
        targetName: String(data.target || "System record"),
        targetEmail: "",
        actorName: String(data.actorEmail || data.actorUid || "System"),
        actorEmail: String(data.actorEmail || ""),
        note: String(data.reason || data.note || action.replaceAll("_", " ")),
        changeParts: parts,
        type: action === "USER_ACCESS_UPDATE" && before.role !== after.role ? "role_change" : action.toLowerCase(),
        nextStatus: after.accountStatus || "",
        createdAtMs: data.createdAt?.toMillis?.() || 0
      };
    });
    callback(logs);
  }, (error) => callback([], error));
}

export function getBulkNoChangeValue() {
  return BULK_NO_CHANGE;
}

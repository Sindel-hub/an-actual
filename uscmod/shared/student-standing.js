export const STUDENT_STANDINGS = Object.freeze([
  { value: "active", label: "Active / Enrolled", enrollmentStatus: "Enrolled", canAccess: true },
  { value: "leave", label: "Leave of Absence", enrollmentStatus: "Leave", canAccess: false },
  { value: "inactive", label: "Inactive / Not Enrolled", enrollmentStatus: "Not Enrolled", canAccess: false },
  { value: "graduated", label: "Graduated", enrollmentStatus: "Not Enrolled", canAccess: false },
  { value: "transferred", label: "Transferred / Changed School", enrollmentStatus: "Not Enrolled", canAccess: false },
  { value: "withdrawn", label: "Withdrawn", enrollmentStatus: "Not Enrolled", canAccess: false },
  { value: "eliminated", label: "Eliminated / Dismissed", enrollmentStatus: "Not Enrolled", canAccess: false }
]);

const ACTIVE_VALUES = new Set(["active", "enrolled", "currently enrolled", "graduating"]);

export function normalizeStudentStanding(value, enrollmentStatus = "") {
  const standing = String(value || "").trim().toLowerCase();
  if (STUDENT_STANDINGS.some((item) => item.value === standing)) return standing;
  return ACTIVE_VALUES.has(String(enrollmentStatus || "").trim().toLowerCase()) ? "active" : "inactive";
}

export function isActiveStudentStanding(value, enrollmentStatus = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw) return raw === "active";
  return ACTIVE_VALUES.has(String(enrollmentStatus || "").trim().toLowerCase());
}

export function enrollmentStatusForStanding(value) {
  const normalized = normalizeStudentStanding(value);
  return STUDENT_STANDINGS.find((item) => item.value === normalized)?.enrollmentStatus || "Not Enrolled";
}

export function studentStandingLabel(value) {
  const normalized = normalizeStudentStanding(value);
  return STUDENT_STANDINGS.find((item) => item.value === normalized)?.label || "Active / Enrolled";
}

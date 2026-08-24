import { callSecure, auth } from "../../../shared/security-client.js";

import {
  complaintSummaryFor,
  escapeHtml,
  exportUsersCsv,
  formatDateOnly,
  formatDateTime,
  getBulkNoChangeValue,
  getCurrentAdminProfile,
  getFilteredUsers,
  getInitials,
  isProtectedAdmin,
  renderAdminIdentity,
  roleClass,
  routeLabel,
  setActiveAdminNav,
  statusClass,
  subscribeComplaints,
  subscribeUsers,
  subscribeVotes,
  summarizeComplaintStates,
  updateSingleUser,
  applyBulkUpdates,
  voteSummaryFor
} from "./admin-core.js";


const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const BULK_NO_CHANGE = getBulkNoChangeValue();
const dom = {
  userSearchInput: document.getElementById("userSearchInput"),
  roleFilterSelect: document.getElementById("roleFilterSelect"),
  statusFilterSelect: document.getElementById("statusFilterSelect"),
  verifiedFilterSelect: document.getElementById("verifiedFilterSelect"),
  activeFilterSelect: document.getElementById("activeFilterSelect"),
  recentFilterSelect: document.getElementById("recentFilterSelect"),
  sortSelect: document.getElementById("sortSelect"),
  directoryCountBadge: document.getElementById("directoryCountBadge"),
  selectedCountBadge: document.getElementById("selectedCountBadge"),
  listStatusText: document.getElementById("listStatusText"),
  exportFilteredButton: document.getElementById("exportFilteredButton"),
  exportSelectedButton: document.getElementById("exportSelectedButton"),
  toggleAllUsers: document.getElementById("toggleAllUsers"),
  usersTableBody: document.getElementById("usersTableBody"),
  bulkRoleSelect: document.getElementById("bulkRoleSelect"),
  bulkStatusSelect: document.getElementById("bulkStatusSelect"),
  bulkVerificationSelect: document.getElementById("bulkVerificationSelect"),
  bulkActiveSelect: document.getElementById("bulkActiveSelect"),
  bulkOfficePositionInput: document.getElementById("bulkOfficePositionInput"),
  bulkEffectiveDateInput: document.getElementById("bulkEffectiveDateInput"),
  bulkReasonInput: document.getElementById("bulkReasonInput"),
  applyBulkButton: document.getElementById("applyBulkButton"),
  approveSelectedButton: document.getElementById("approveSelectedButton"),
  suspendSelectedButton: document.getElementById("suspendSelectedButton"),
  clearSelectionButton: document.getElementById("clearSelectionButton"),
  editorEmptyState: document.getElementById("editorEmptyState"),
  editorPanel: document.getElementById("editorPanel"),
  rolePreviewBadge: document.getElementById("rolePreviewBadge"),
  selectedUserRestrictionBanner: document.getElementById("selectedUserRestrictionBanner"),
  selectedUserInitials: document.getElementById("selectedUserInitials"),
  selectedUserName: document.getElementById("selectedUserName"),
  selectedUserEmail: document.getElementById("selectedUserEmail"),
  selectedUserId: document.getElementById("selectedUserId"),
  selectedUserRole: document.getElementById("selectedUserRole"),
  selectedUserStatus: document.getElementById("selectedUserStatus"),
  selectedUserRoute: document.getElementById("selectedUserRoute"),
  selectedUserOfficePosition: document.getElementById("selectedUserOfficePosition"),
  selectedUserRegisteredAt: document.getElementById("selectedUserRegisteredAt"),
  selectedUserLastLogin: document.getElementById("selectedUserLastLogin"),
  selectedUserLastActivity: document.getElementById("selectedUserLastActivity"),
  selectedUserEffectiveDate: document.getElementById("selectedUserEffectiveDate"),
  selectedUserYearLevel: document.getElementById("selectedUserYearLevel"),
  selectedUserStanding: document.getElementById("selectedUserStanding"),
  selectedUserVerified: document.getElementById("selectedUserVerified"),
  selectedUserActive: document.getElementById("selectedUserActive"),
  selectedUserComplaintCount: document.getElementById("selectedUserComplaintCount"),
  selectedUserComplaintStatus: document.getElementById("selectedUserComplaintStatus"),
  selectedUserVoteStatus: document.getElementById("selectedUserVoteStatus"),
  selectedUserLastUpdate: document.getElementById("selectedUserLastUpdate"),
  roleEditorForm: document.getElementById("roleEditorForm"),
  targetRoleSelect: document.getElementById("targetRoleSelect"),
  officePositionInput: document.getElementById("officePositionInput"),
  accountStatusSelect: document.getElementById("accountStatusSelect"),
  effectiveDateInput: document.getElementById("effectiveDateInput"),
  yearLevelSelect: document.getElementById("yearLevelSelect"),
  studentStandingSelect: document.getElementById("studentStandingSelect"),
  standingAccessNote: document.getElementById("standingAccessNote"),
  verifiedToggle: document.getElementById("verifiedToggle"),
  activeToggle: document.getElementById("activeToggle"),
  adminNotesInput: document.getElementById("adminNotesInput"),
  roleChangeNote: document.getElementById("roleChangeNote"),
  roleRoutePreview: document.getElementById("roleRoutePreview"),
  saveRoleButton: document.getElementById("saveRoleButton"),
  approveUserButton: document.getElementById("approveUserButton"),
  suspendUserButton: document.getElementById("suspendUserButton"),
  reactivateUserButton: document.getElementById("reactivateUserButton"),
  demoteToStudentButton: document.getElementById("demoteToStudentButton"),
  saveFeedbackText: document.getElementById("saveFeedbackText"),
  lastActionSummary: document.getElementById("lastActionSummary"),
  provisionStudentId: document.getElementById("provisionStudentId"),
  provisionInstitutionalEmail: document.getElementById("provisionInstitutionalEmail"),
  provisionFullName: document.getElementById("provisionFullName"),
  provisionProgram: document.getElementById("provisionProgram"),
  provisionCollege: document.getElementById("provisionCollege"),
  provisionEnrollmentStatus: document.getElementById("provisionEnrollmentStatus"),
  provisionVoterEligible: document.getElementById("provisionVoterEligible"),
  provisionSchoolAccountButton: document.getElementById("provisionSchoolAccountButton"),
  provisionCredentialResult: document.getElementById("provisionCredentialResult")
};

let users = [];
let complaintSummaryByUid = new Map();
let voteSummaryByStudentId = new Map();
let selectedUserId = "";
const selectedUserIds = new Set();
let isSaving = false;

function getFilters() {
  return {
    queryText: dom.userSearchInput.value,
    role: dom.roleFilterSelect.value,
    status: dom.statusFilterSelect.value,
    verified: dom.verifiedFilterSelect.value,
    active: dom.activeFilterSelect.value,
    recent: dom.recentFilterSelect.value,
    sort: dom.sortSelect.value
  };
}

function getFilteredDirectory() {
  return getFilteredUsers(users, getFilters());
}

function setFeedback(message, tone = "neutral") {
  dom.lastActionSummary.textContent = message;
  dom.saveFeedbackText.textContent = tone === "success"
    ? "Saved to Firestore."
    : tone === "error"
      ? "Update failed."
      : "Ready for admin updates.";
}

function updateSelectionCounters() {
  dom.selectedCountBadge.textContent = `${selectedUserIds.size} selected`;
}

function updateRolePreview(role) {
  const normalized = role === "officer" ? "officer" : "student";
  dom.rolePreviewBadge.textContent = normalized === "officer" ? "Officer access" : "Student access";
  dom.rolePreviewBadge.className = `quick-badge ${normalized === 'officer' ? 'role-officer' : 'role-student'}`;
  dom.roleRoutePreview.textContent = `Route after next login: ${routeLabel(normalized)}`;
}

function getSelectedUser() {
  return users.find((user) => user.uid === selectedUserId) || null;
}

function renderTable() {
  const visibleUsers = getFilteredDirectory();
  dom.directoryCountBadge.textContent = `${visibleUsers.length} account${visibleUsers.length === 1 ? '' : 's'}`;
  if (!visibleUsers.length) {
    dom.usersTableBody.innerHTML = '<tr><td colspan="10"><div class="empty-state"><strong>No matching accounts</strong><span>Adjust the current filters and search terms.</span></div></td></tr>';
    dom.toggleAllUsers.checked = false;
    updateSelectionCounters();
    return;
  }

  dom.usersTableBody.innerHTML = visibleUsers.map((user) => {
    const selected = selectedUserIds.has(user.uid);
    const complaintSummary = complaintSummaryFor(user, complaintSummaryByUid);
    return `
      <tr>
        <td><input type="checkbox" class="row-selector" data-user-id="${escapeHtml(user.uid)}" ${selected ? 'checked' : ''} ${isProtectedAdmin(user) ? 'disabled' : ''} /></td>
        <td><div class="table-name"><strong>${escapeHtml(user.fullName || 'Unnamed user')}</strong><small>${escapeHtml(user.email || 'No email')}</small></div></td>
        <td class="mono">${escapeHtml(user.studentId || 'N/A')}</td>
        <td><span class="role-badge ${roleClass(user.role)}">${escapeHtml(user.role)}</span></td>
        <td><span class="status-badge ${statusClass(user.accountStatus)}">${escapeHtml(user.accountStatus)}</span></td>
        <td><span class="verify-badge ${user.isVerifiedStudent ? 'verify-yes' : 'verify-no'}">${user.isVerifiedStudent ? 'Verified' : 'Unverified'}</span></td>
        <td><span class="active-badge ${user.isActive ? 'active-yes' : 'active-no'}">${user.isActive ? 'Active' : 'Inactive'}</span></td>
        <td>${escapeHtml(user.officePosition || '—')}</td>
        <td>${escapeHtml(formatDateTime(user.lastLoginAtMs))}</td>
        <td><div class="table-actions"><button type="button" class="open-btn ${selectedUserId === user.uid ? 'selected' : ''}" data-open-user="${escapeHtml(user.uid)}">Open</button><span class="mono">${complaintSummary.total} complaints</span></div></td>
      </tr>
    `;
  }).join("");

  const visibleSelectable = visibleUsers.filter((user) => !isProtectedAdmin(user));
  dom.toggleAllUsers.checked = Boolean(visibleSelectable.length) && visibleSelectable.every((user) => selectedUserIds.has(user.uid));

  dom.usersTableBody.querySelectorAll('.row-selector').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const userId = checkbox.getAttribute('data-user-id') || '';
      if (!userId) return;
      if (checkbox.checked) selectedUserIds.add(userId);
      else selectedUserIds.delete(userId);
      updateSelectionCounters();
    });
  });

  dom.usersTableBody.querySelectorAll('[data-open-user]').forEach((button) => {
    button.addEventListener('click', () => openUser(button.getAttribute('data-open-user') || ''));
  });

  updateSelectionCounters();
}

function toggleEditor(hasSelection) {
  dom.editorEmptyState.classList.toggle('hidden', hasSelection);
  dom.editorPanel.classList.toggle('hidden', !hasSelection);
}

function fillEditor(user) {
  if (!user) {
    toggleEditor(false);
    dom.rolePreviewBadge.textContent = 'No user selected';
    dom.rolePreviewBadge.className = 'quick-badge';
    return;
  }
  toggleEditor(true);
  const complaintSummary = complaintSummaryFor(user, complaintSummaryByUid);
  const voteSummary = voteSummaryFor(user, voteSummaryByStudentId);
  const protectedAdmin = isProtectedAdmin(user);
  dom.selectedUserRestrictionBanner.classList.toggle('hidden', !protectedAdmin);
  dom.selectedUserInitials.textContent = getInitials(user.fullName, user.email);
  dom.selectedUserName.textContent = user.fullName || 'Unnamed user';
  dom.selectedUserEmail.textContent = user.email || 'No email saved';
  dom.selectedUserId.textContent = `Student ID: ${user.studentId || 'N/A'}`;
  dom.selectedUserRole.textContent = `Role: ${user.role}`;
  dom.selectedUserRole.className = `role-badge ${roleClass(user.role)}`;
  dom.selectedUserStatus.textContent = `Status: ${user.accountStatus}`;
  dom.selectedUserStatus.className = `status-badge ${statusClass(user.accountStatus)}`;
  dom.selectedUserRoute.textContent = routeLabel(user.role);
  dom.selectedUserOfficePosition.textContent = user.officePosition || '—';
  dom.selectedUserRegisteredAt.textContent = formatDateTime(user.createdAtMs);
  dom.selectedUserLastLogin.textContent = formatDateTime(user.lastLoginAtMs);
  dom.selectedUserLastActivity.textContent = formatDateTime(user.lastActivityAtMs);
  dom.selectedUserEffectiveDate.textContent = formatDateOnly(user.roleEffectiveDate);
  dom.selectedUserYearLevel.textContent = user.yearLevel || '—';
  dom.selectedUserStanding.textContent = user.studentStandingLabel || user.studentStanding || 'Active / Enrolled';
  dom.selectedUserVerified.textContent = user.isVerifiedStudent ? 'Verified' : 'Unverified';
  dom.selectedUserActive.textContent = user.isActive ? 'Active' : 'Inactive';
  dom.selectedUserComplaintCount.textContent = `${complaintSummary.total} total`;
  dom.selectedUserComplaintStatus.textContent = summarizeComplaintStates(complaintSummary);
  dom.selectedUserVoteStatus.textContent = voteSummary ? `Submitted (${formatDateTime(voteSummary.submittedAtMs)})` : 'Not submitted';
  dom.selectedUserLastUpdate.textContent = user.updatedAtMs ? `${formatDateTime(user.updatedAtMs)}${user.lastRoleUpdatedBy ? ` • by ${user.lastRoleUpdatedBy}` : ''}` : '—';
  dom.targetRoleSelect.value = protectedAdmin ? 'student' : user.role;
  dom.officePositionInput.value = user.officePosition || '';
  dom.accountStatusSelect.value = user.accountStatus;
  dom.effectiveDateInput.value = user.roleEffectiveDate || '';
  dom.yearLevelSelect.value = user.yearLevel || '';
  dom.studentStandingSelect.value = user.studentStanding || 'active';
  dom.verifiedToggle.checked = user.isVerifiedStudent;
  dom.activeToggle.checked = user.isActive;
  const inactiveStanding = (user.studentStanding || 'active') !== 'active';
  dom.activeToggle.disabled = protectedAdmin || inactiveStanding;
  dom.reactivateUserButton.title = inactiveStanding ? 'Set Student Standing to Active / Enrolled and save before reactivating access.' : '';
  dom.adminNotesInput.value = user.adminNotes || '';
  dom.roleChangeNote.value = '';
  dom.targetRoleSelect.disabled = protectedAdmin;
  dom.officePositionInput.disabled = protectedAdmin;
  dom.approveUserButton.disabled = protectedAdmin;
  dom.suspendUserButton.disabled = protectedAdmin;
  dom.reactivateUserButton.disabled = protectedAdmin || inactiveStanding;
  dom.demoteToStudentButton.disabled = protectedAdmin;
  updateRolePreview(protectedAdmin ? 'student' : user.role);
}

function openUser(userId) {
  selectedUserId = userId;
  fillEditor(getSelectedUser());
  renderTable();
}

async function saveSelectedUser(overrides = null) {
  const user = getSelectedUser();
  if (!user) {
    alert('Select a user first.');
    return;
  }
  isSaving = true;
  dom.saveRoleButton.disabled = true;
  dom.saveRoleButton.textContent = 'Saving...';
  try {
    const result = await updateSingleUser(user, {
      role: overrides?.role ?? dom.targetRoleSelect.value,
      officePosition: overrides?.officePosition ?? dom.officePositionInput.value,
      accountStatus: overrides?.accountStatus ?? dom.accountStatusSelect.value,
      roleEffectiveDate: overrides?.roleEffectiveDate ?? dom.effectiveDateInput.value,
      yearLevel: overrides?.yearLevel ?? dom.yearLevelSelect.value,
      studentStanding: overrides?.studentStanding ?? dom.studentStandingSelect.value,
      isVerifiedStudent: typeof overrides?.isVerifiedStudent === 'boolean' ? overrides.isVerifiedStudent : dom.verifiedToggle.checked,
      isActive: typeof overrides?.isActive === 'boolean' ? overrides.isActive : dom.activeToggle.checked,
      adminNotes: overrides?.adminNotes ?? dom.adminNotesInput.value,
      changeReason: overrides?.changeReason ?? dom.roleChangeNote.value
    });
    setFeedback(result.message, 'success');
  } catch (error) {
    console.error(error);
    alert(error.message || 'Failed to save user changes.');
    setFeedback('Failed to save the selected user changes.', 'error');
  } finally {
    isSaving = false;
    dom.saveRoleButton.disabled = false;
    dom.saveRoleButton.textContent = 'Save user updates';
  }
}

async function handleBulk(overrides = {}) {
  const targets = users.filter((user) => selectedUserIds.has(user.uid));
  try {
    const result = await applyBulkUpdates(targets, {
      role: overrides.role ?? dom.bulkRoleSelect.value || undefined,
      accountStatus: overrides.accountStatus ?? dom.bulkStatusSelect.value || undefined,
      verification: overrides.verification ?? dom.bulkVerificationSelect.value ?? BULK_NO_CHANGE,
      activeState: overrides.activeState ?? dom.bulkActiveSelect.value ?? BULK_NO_CHANGE,
      officePosition: overrides.officePosition ?? dom.bulkOfficePositionInput.value,
      roleEffectiveDate: overrides.roleEffectiveDate ?? dom.bulkEffectiveDateInput.value,
      adminNotes: overrides.adminNotes,
      changeReason: overrides.changeReason ?? dom.bulkReasonInput.value
    });
    setFeedback(result.message, 'success');
  } catch (error) {
    console.error(error);
    alert(error.message || 'Failed to apply bulk changes.');
    setFeedback('Bulk update failed.', 'error');
  }
}



function bind() {
  [dom.userSearchInput, dom.roleFilterSelect, dom.statusFilterSelect, dom.verifiedFilterSelect, dom.activeFilterSelect, dom.recentFilterSelect, dom.sortSelect]
    .forEach((element) => {
      element?.addEventListener('input', renderTable);
      element?.addEventListener('change', renderTable);
    });

  dom.toggleAllUsers.addEventListener('change', () => {
    const visibleUsers = getFilteredDirectory().filter((user) => !isProtectedAdmin(user));
    if (dom.toggleAllUsers.checked) visibleUsers.forEach((user) => selectedUserIds.add(user.uid));
    else visibleUsers.forEach((user) => selectedUserIds.delete(user.uid));
    renderTable();
  });

  dom.targetRoleSelect.addEventListener('change', () => {
    const nextRole = dom.targetRoleSelect.value === 'officer' ? 'officer' : 'student';
    if (nextRole === 'student') dom.officePositionInput.value = '';
    if (nextRole === 'officer' && !dom.officePositionInput.value.trim()) dom.officePositionInput.value = 'USC Officer';
    updateRolePreview(nextRole);
  });

  dom.accountStatusSelect.addEventListener('change', () => {
    if (dom.accountStatusSelect.value === 'suspended') dom.activeToggle.checked = false;
  });

  dom.studentStandingSelect?.addEventListener('change', () => {
    const inactive = dom.studentStandingSelect.value !== 'active';
    dom.activeToggle.disabled = inactive;
    dom.reactivateUserButton.disabled = inactive;
    if (inactive) {
      dom.activeToggle.checked = false;
      dom.verifiedToggle.checked = false;
      dom.reactivateUserButton.title = 'Set Student Standing to Active / Enrolled and save before reactivating access.';
    } else if (dom.accountStatusSelect.value !== 'suspended') {
      dom.activeToggle.checked = true;
      dom.reactivateUserButton.title = '';
    }
    if (dom.standingAccessNote) {
      dom.standingAccessNote.textContent = inactive
        ? 'This standing disables portal access and election eligibility as soon as you save.'
        : 'Active / Enrolled students may access the portal; election eligibility follows the verified-voter setting.';
    }
  });

  dom.roleEditorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isSaving) await saveSelectedUser();
  });

  dom.approveUserButton.addEventListener('click', async () => saveSelectedUser({ accountStatus: 'approved', isActive: true, changeReason: dom.roleChangeNote.value.trim() || 'Approved by admin.' }));
  dom.suspendUserButton.addEventListener('click', async () => {
    const user = getSelectedUser();
    if (!user || isProtectedAdmin(user)) return;
    if (window.confirm(`Suspend ${user.fullName || user.email || 'this user'}?`)) {
      await saveSelectedUser({ accountStatus: 'suspended', isActive: false, changeReason: dom.roleChangeNote.value.trim() || 'Suspended by admin.' });
    }
  });
  dom.reactivateUserButton.addEventListener('click', async () => saveSelectedUser({ accountStatus: 'approved', isActive: true, changeReason: dom.roleChangeNote.value.trim() || 'Reactivated by admin.' }));
  dom.demoteToStudentButton.addEventListener('click', async () => {
    const user = getSelectedUser();
    if (!user || isProtectedAdmin(user)) return;
    if (window.confirm(`Return ${user.fullName || user.email || 'this user'} to student access?`)) {
      await saveSelectedUser({ role: 'student', officePosition: '', roleEffectiveDate: new Date().toISOString(), changeReason: dom.roleChangeNote.value.trim() || 'Returned to student access by admin.' });
    }
  });

  dom.applyBulkButton.addEventListener('click', async () => handleBulk());
  dom.approveSelectedButton.addEventListener('click', async () => handleBulk({ accountStatus: 'approved', activeState: 'active', changeReason: dom.bulkReasonInput.value.trim() || 'Approved in bulk by admin.' }));
  dom.suspendSelectedButton.addEventListener('click', async () => {
    if (!selectedUserIds.size) {
      alert('Select users first.');
      return;
    }
    if (window.confirm(`Suspend ${selectedUserIds.size} selected user${selectedUserIds.size === 1 ? '' : 's'}?`)) {
      await handleBulk({ accountStatus: 'suspended', activeState: 'inactive', changeReason: dom.bulkReasonInput.value.trim() || 'Suspended in bulk by admin.' });
    }
  });
  dom.clearSelectionButton.addEventListener('click', () => {
    selectedUserIds.clear();
    renderTable();
  });

  dom.exportFilteredButton.addEventListener('click', () => {
    try {
      exportUsersCsv(getFilteredDirectory(), complaintSummaryByUid, voteSummaryByStudentId, 'usc-users-filtered.csv');
    } catch (error) {
      alert(error.message || 'Nothing to export.');
    }
  });
  dom.exportSelectedButton.addEventListener('click', () => {
    try {
      exportUsersCsv(users.filter((user) => selectedUserIds.has(user.uid)), complaintSummaryByUid, voteSummaryByStudentId, 'usc-users-selected.csv');
    } catch (error) {
      alert(error.message || 'Nothing to export.');
    }
  });
}

setActiveAdminNav();
renderAdminIdentity();
bind();
subscribeUsers((value, error) => {
  users = value;
  dom.listStatusText.textContent = error ? 'Unable to load accounts' : 'Live from Firestore';
  renderTable();
  if (selectedUserId) fillEditor(getSelectedUser());
});
subscribeComplaints((value) => { complaintSummaryByUid = value; renderTable(); if (selectedUserId) fillEditor(getSelectedUser()); });
subscribeVotes((value) => { voteSummaryByStudentId = value; if (selectedUserId) fillEditor(getSelectedUser()); });

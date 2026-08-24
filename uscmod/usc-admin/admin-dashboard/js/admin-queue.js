
import {
  buildQueueUsers,
  complaintSummaryFor,
  escapeHtml,
  formatDateTime,
  getInitials,
  getQueueTag,
  isNewWithinDays,
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
  voteSummaryFor
} from "./admin-core.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const dom = {
  queueStatusBadge: document.getElementById('queueStatusBadge'),
  refreshQueueButton: document.getElementById('refreshQueueButton'),
  queuePendingCount: document.getElementById('queuePendingCount'),
  queueNewWeekCount: document.getElementById('queueNewWeekCount'),
  queueUnverifiedCount: document.getElementById('queueUnverifiedCount'),
  queueCandidateCount: document.getElementById('queueCandidateCount'),
  queueList: document.getElementById('queueList'),
  queueVisibleCount: document.getElementById('queueVisibleCount'),
  queueSearchInput: document.getElementById('queueSearchInput'),
  queueFilterSelect: document.getElementById('queueFilterSelect'),
  queueEmptyState: document.getElementById('queueEmptyState'),
  queueDetailPanel: document.getElementById('queueDetailPanel'),
  queueProtectedBanner: document.getElementById('queueProtectedBanner'),
  queueUserInitials: document.getElementById('queueUserInitials'),
  queueUserName: document.getElementById('queueUserName'),
  queueUserRole: document.getElementById('queueUserRole'),
  queueUserStatus: document.getElementById('queueUserStatus'),
  queueUserEmail: document.getElementById('queueUserEmail'),
  queueUserStudentId: document.getElementById('queueUserStudentId'),
  queueRegisteredAt: document.getElementById('queueRegisteredAt'),
  queueLastLogin: document.getElementById('queueLastLogin'),
  queueVerifiedState: document.getElementById('queueVerifiedState'),
  queueVoteState: document.getElementById('queueVoteState'),
  queueComplaintState: document.getElementById('queueComplaintState'),
  queueCurrentRoute: document.getElementById('queueCurrentRoute'),
  queueOfficePosition: document.getElementById('queueOfficePosition'),
  queueReason: document.getElementById('queueReason'),
  queueApproveButton: document.getElementById('queueApproveButton'),
  queuePromoteButton: document.getElementById('queuePromoteButton'),
  queueSuspendButton: document.getElementById('queueSuspendButton'),
  queueVerifyButton: document.getElementById('queueVerifyButton'),
  queueFeedbackText: document.getElementById('queueFeedbackText')
};

let users = [];
let complaintSummaryByUid = new Map();
let voteSummaryByStudentId = new Map();
let selectedUserId = '';

function getSelectedUser() {
  return users.find((user) => user.uid === selectedUserId) || null;
}

function setFeedback(message, tone = 'neutral') {
  dom.queueFeedbackText.textContent = tone === 'error' ? `Update failed: ${message}` : message;
}

function renderMetrics(queueUsers) {
  dom.queuePendingCount.textContent = String(queueUsers.filter((user) => user.accountStatus === 'pending').length);
  dom.queueNewWeekCount.textContent = String(queueUsers.filter((user) => isNewWithinDays(user, 7)).length);
  dom.queueUnverifiedCount.textContent = String(queueUsers.filter((user) => !user.isVerifiedStudent).length);
  dom.queueCandidateCount.textContent = String(queueUsers.filter((user) => user.role === 'officer').length);
}

function filteredQueueUsers() {
  const queryText = String(dom.queueSearchInput?.value || '').trim().toLowerCase();
  const filter = String(dom.queueFilterSelect?.value || 'all');
  return buildQueueUsers(users).filter((user) => {
    if (filter === 'pending' && user.accountStatus !== 'pending') return false;
    if (filter === 'new' && !isNewWithinDays(user, 7)) return false;
    if (filter === 'unverified' && user.isVerifiedStudent) return false;
    if (filter === 'officers' && user.role !== 'officer') return false;
    if (!queryText) return true;
    return [user.fullName, user.email, user.studentId, user.officePosition, user.role, user.accountStatus]
      .join(' ').toLowerCase().includes(queryText);
  });
}

function renderList() {
  const allQueueUsers = buildQueueUsers(users);
  renderMetrics(allQueueUsers);
  const queueUsers = filteredQueueUsers().slice(0, 40);
  if (dom.queueVisibleCount) dom.queueVisibleCount.textContent = `${queueUsers.length} shown`;
  if (!queueUsers.length) {
    dom.queueList.innerHTML = '<div class="empty-state"><strong>No matching registrations</strong><span>Try another search or queue filter.</span></div>';
    return;
  }
  dom.queueList.innerHTML = queueUsers.map((user) => {
    const complaintSummary = complaintSummaryFor(user, complaintSummaryByUid);
    const voteSummary = voteSummaryFor(user, voteSummaryByStudentId);
    const protectedBadge = isProtectedAdmin(user) ? '<span class="quick-badge role-admin">Protected admin</span>' : '';
    const selected = selectedUserId === user.uid ? ' selected' : '';
    return `
      <div class="queue-item${selected}" data-queue-user-card="${escapeHtml(user.uid)}">
        <div class="queue-copy">
          <div class="queue-title-row">
            <span class="queue-title">${escapeHtml(user.fullName || user.email || 'Unnamed user')}</span>
            <span class="role-badge ${roleClass(user.role)}">${escapeHtml(user.role)}</span>
            <span class="status-badge ${statusClass(user.accountStatus)}">${escapeHtml(user.accountStatus)}</span>
            ${protectedBadge}
            <span class="quick-badge">${escapeHtml(getQueueTag(user))}</span>
          </div>
          <div class="queue-meta-grid">
            <span><strong>Email</strong>${escapeHtml(user.email || 'No email')}</span>
            <span><strong>Student ID</strong>${escapeHtml(user.studentId || 'N/A')}</span>
            <span><strong>Registered</strong>${escapeHtml(formatDateTime(user.createdAtMs))}</span>
            <span><strong>Activity</strong>${complaintSummary.total} complaint${complaintSummary.total === 1 ? '' : 's'} · ${voteSummary ? 'Vote recorded' : 'No vote'}</span>
          </div>
        </div>
        <div class="stack-actions queue-open-action">
          <button type="button" class="open-btn${selected}" data-open-queue-user="${escapeHtml(user.uid)}">${selected ? 'Selected' : 'Review'}</button>
        </div>
      </div>
    `;
  }).join('');

  dom.queueList.querySelectorAll('[data-open-queue-user]').forEach((button) => {
    button.addEventListener('click', () => openUser(button.getAttribute('data-open-queue-user') || ''));
  });
}

function fillPanel(user) {
  if (!user) {
    dom.queueEmptyState.classList.remove('hidden');
    dom.queueDetailPanel.classList.add('hidden');
    return;
  }
  const complaintSummary = complaintSummaryFor(user, complaintSummaryByUid);
  const voteSummary = voteSummaryFor(user, voteSummaryByStudentId);
  const protectedAdmin = isProtectedAdmin(user);
  dom.queueEmptyState.classList.add('hidden');
  dom.queueDetailPanel.classList.remove('hidden');
  dom.queueProtectedBanner.classList.toggle('hidden', !protectedAdmin);
  dom.queueUserInitials.textContent = getInitials(user.fullName, user.email);
  dom.queueUserName.textContent = user.fullName || 'Unnamed user';
  dom.queueUserRole.textContent = user.role;
  dom.queueUserRole.className = `role-badge ${roleClass(user.role)}`;
  dom.queueUserStatus.textContent = user.accountStatus;
  dom.queueUserStatus.className = `status-badge ${statusClass(user.accountStatus)}`;
  dom.queueUserEmail.textContent = user.email || 'No email saved';
  dom.queueUserStudentId.textContent = `Student ID: ${user.studentId || 'N/A'}`;
  dom.queueRegisteredAt.textContent = formatDateTime(user.createdAtMs);
  dom.queueLastLogin.textContent = formatDateTime(user.lastLoginAtMs);
  dom.queueVerifiedState.textContent = user.isVerifiedStudent ? 'Verified' : 'Unverified';
  dom.queueVoteState.textContent = voteSummary ? `Submitted (${formatDateTime(voteSummary.submittedAtMs)})` : 'Not submitted';
  dom.queueComplaintState.textContent = summarizeComplaintStates(complaintSummary);
  dom.queueCurrentRoute.textContent = routeLabel(user.role);
  dom.queueOfficePosition.value = user.officePosition || '';
  dom.queuePromoteButton.textContent = user.role === 'officer' ? 'Update officer position' : 'Promote to officer';
  dom.queueReason.value = '';
  dom.queueApproveButton.disabled = protectedAdmin;
  dom.queuePromoteButton.disabled = protectedAdmin;
  dom.queueSuspendButton.disabled = protectedAdmin;
  dom.queueVerifyButton.disabled = protectedAdmin;
}

function openUser(userId) {
  selectedUserId = userId;
  fillPanel(getSelectedUser());
  renderList();
  if (window.matchMedia('(max-width: 1100px)').matches) dom.queueDetailPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleAction(type) {
  const user = getSelectedUser();
  if (!user) {
    alert('Select a user from the queue first.');
    return;
  }
  try {
    if (type === 'approve') {
      const result = await updateSingleUser(user, {
        accountStatus: 'approved',
        isActive: true,
        changeReason: dom.queueReason.value.trim() || 'Approved from registration queue.'
      });
      setFeedback(result.message, 'success');
      return;
    }
    if (type === 'promote') {
      const officePosition = dom.queueOfficePosition.value.trim();
      if (!officePosition) throw new Error('Select a USC officer position first.');
      const result = await updateSingleUser(user, {
        role: 'officer',
        officePosition,
        accountStatus: 'approved',
        isActive: true,
        roleEffectiveDate: new Date().toISOString(),
        changeReason: dom.queueReason.value.trim() || 'Promoted to officer from registration queue.'
      });
      setFeedback(result.message, 'success');
      return;
    }
    if (type === 'suspend') {
      if (!window.confirm(`Suspend ${user.fullName || user.email || 'this user'}?`)) return;
      const result = await updateSingleUser(user, {
        accountStatus: 'suspended',
        isActive: false,
        changeReason: dom.queueReason.value.trim() || 'Suspended from registration queue.'
      });
      setFeedback(result.message, 'success');
      return;
    }
    if (type === 'verify') {
      const result = await updateSingleUser(user, {
        isVerifiedStudent: !user.isVerifiedStudent,
        changeReason: dom.queueReason.value.trim() || `${user.isVerifiedStudent ? 'Verification removed' : 'Marked verified'} from registration queue.`
      });
      setFeedback(result.message, 'success');
    }
  } catch (error) {
    console.error(error);
    alert(error.message || 'Queue action failed.');
    setFeedback(error.message || 'Queue action failed.', 'error');
  }
}

setActiveAdminNav();
renderAdminIdentity();
subscribeUsers((value, error) => {
  users = value;
  dom.queueStatusBadge.textContent = error ? 'Unable to load queue' : 'Live from Firestore';
  renderList();
  if (selectedUserId) fillPanel(getSelectedUser());
});
subscribeComplaints((value) => { complaintSummaryByUid = value; renderList(); if (selectedUserId) fillPanel(getSelectedUser()); });
subscribeVotes((value) => { voteSummaryByStudentId = value; renderList(); if (selectedUserId) fillPanel(getSelectedUser()); });

dom.refreshQueueButton.addEventListener('click', () => {
  renderList();
  if (selectedUserId) fillPanel(getSelectedUser());
});
dom.queueSearchInput?.addEventListener('input', renderList);
dom.queueFilterSelect?.addEventListener('change', renderList);
dom.queueApproveButton.addEventListener('click', () => handleAction('approve'));
dom.queuePromoteButton.addEventListener('click', () => handleAction('promote'));
dom.queueSuspendButton.addEventListener('click', () => handleAction('suspend'));
dom.queueVerifyButton.addEventListener('click', () => handleAction('verify'));

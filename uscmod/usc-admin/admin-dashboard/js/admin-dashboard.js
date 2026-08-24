
import {
  buildAdminWarnings,
  buildQueueUsers,
  complaintSummaryFor,
  computeUserStats,
  escapeHtml,
  formatDateTime,
  getQueueTag,
  getInitials,
  isProtectedAdmin,
  renderAdminIdentity,
  roleClass,
  statusClass,
  subscribeComplaints,
  subscribeUsers,
  subscribeVotes,
  voteSummaryFor,
  setActiveAdminNav
} from "./admin-core.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const dom = {
  statTotal: document.getElementById("statTotal"),
  statApproved: document.getElementById("statApproved"),
  statPending: document.getElementById("statPending"),
  statSuspended: document.getElementById("statSuspended"),
  statOfficers: document.getElementById("statOfficers"),
  statVerified: document.getElementById("statVerified"),
  statNewWeek: document.getElementById("statNewWeek"),
  statNeverLogin: document.getElementById("statNeverLogin"),
  warningsList: document.getElementById("warningsList"),
  recentQueueList: document.getElementById("recentQueueList")
};

let users = [];
let complaintSummaryByUid = new Map();
let voteSummaryByStudentId = new Map();

function renderStats() {
  const stats = computeUserStats(users);
  dom.statTotal.textContent = String(stats.total);
  dom.statApproved.textContent = String(stats.approved);
  dom.statPending.textContent = String(stats.pending);
  dom.statSuspended.textContent = String(stats.suspended);
  dom.statOfficers.textContent = String(stats.officers);
  dom.statVerified.textContent = String(stats.verified);
  dom.statNewWeek.textContent = String(stats.newThisWeek);
  dom.statNeverLogin.textContent = String(stats.neverLoggedIn);
}

function renderWarnings() {
  const warnings = buildAdminWarnings(users, complaintSummaryByUid);
  if (!warnings.length) {
    dom.warningsList.innerHTML = '<div class="empty-state"><strong>No major warnings</strong><span>The current user data does not show major admin issues.</span></div>';
    return;
  }
  dom.warningsList.innerHTML = warnings.map((warning) => `
    <article class="warning-card warning-tone-${escapeHtml(warning.tone)}">
      <h4>${escapeHtml(warning.title)}</h4>
      <p>${escapeHtml(warning.detail)}</p>
    </article>
  `).join("");
}

function renderQueue() {
  const queueUsers = buildQueueUsers(users).slice(0, 6);
  if (!queueUsers.length) {
    dom.recentQueueList.innerHTML = '<div class="empty-state"><strong>No registered users yet</strong><span>The queue will appear here once accounts are created.</span></div>';
    return;
  }
  dom.recentQueueList.innerHTML = queueUsers.map((user) => {
    const complaintSummary = complaintSummaryFor(user, complaintSummaryByUid);
    const voteSummary = voteSummaryFor(user, voteSummaryByStudentId);
    const protectedBadge = isProtectedAdmin(user) ? '<span class="quick-badge role-admin">Protected admin</span>' : '';
    return `
      <div class="queue-item compact">
        <div class="queue-copy">
          <div class="queue-title-row">
            <span class="queue-title">${escapeHtml(user.fullName || user.email || 'Unnamed user')}</span>
            <span class="role-badge ${roleClass(user.role)}">${escapeHtml(user.role)}</span>
            <span class="status-badge ${statusClass(user.accountStatus)}">${escapeHtml(user.accountStatus)}</span>
            ${protectedBadge}
            <span class="quick-badge">${escapeHtml(getQueueTag(user))}</span>
          </div>
          <div class="queue-meta">
            <span>${escapeHtml(user.email || 'No email')}</span>
            <span>•</span>
            <span>ID ${escapeHtml(user.studentId || 'N/A')}</span>
            <span>•</span>
            <span>${escapeHtml(formatDateTime(user.createdAtMs))}</span>
            <span>•</span>
            <span>${complaintSummary.total} complaints</span>
            <span>•</span>
            <span>${voteSummary ? 'Vote submitted' : 'No vote yet'}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function refresh() {
  renderStats();
  renderWarnings();
  renderQueue();
}

setActiveAdminNav();
renderAdminIdentity();
subscribeUsers((value) => { users = value; refresh(); });
subscribeComplaints((value) => { complaintSummaryByUid = value; refresh(); });
subscribeVotes((value) => { voteSummaryByStudentId = value; refresh(); });

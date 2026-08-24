
import {
  buildAdminWarnings,
  computeUserStats,
  complaintSummaryFor,
  escapeHtml,
  exportUsersCsv,
  formatDateTime,
  renderAdminIdentity,
  setActiveAdminNav,
  subscribeComplaints,
  subscribeRoleLogs,
  subscribeUsers,
  subscribeVotes
} from "./admin-core.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const dom = {
  exportAllUsersButton: document.getElementById('exportAllUsersButton'),
  exportOfficersButton: document.getElementById('exportOfficersButton'),
  exportPendingButton: document.getElementById('exportPendingButton'),
  exportSuspendedButton: document.getElementById('exportSuspendedButton'),
  auditRecentChanges: document.getElementById('auditRecentChanges'),
  auditRoleChanges: document.getElementById('auditRoleChanges'),
  auditSuspensions: document.getElementById('auditSuspensions'),
  auditVerifications: document.getElementById('auditVerifications'),
  auditStatusBadge: document.getElementById('auditStatusBadge'),
  auditSearchInput: document.getElementById('auditSearchInput'),
  auditLogList: document.getElementById('auditLogList'),
  auditWarningsList: document.getElementById('auditWarningsList')
};

let users = [];
let complaintSummaryByUid = new Map();
let voteSummaryByStudentId = new Map();
let logs = [];

function renderMetrics() {
  const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recent = logs.filter((log) => Number(log.createdAtMs || 0) >= cutoff);
  dom.auditRecentChanges.textContent = String(recent.length);
  dom.auditRoleChanges.textContent = String(logs.filter((log) => String(log.type || '') === 'role_change').length);
  dom.auditSuspensions.textContent = String(logs.filter((log) => String(log.nextStatus || '') === 'suspended').length);
  dom.auditVerifications.textContent = String(logs.filter((log) => String(log.type || '') === 'verification_change').length);
}

function renderWarnings() {
  const warnings = buildAdminWarnings(users, complaintSummaryByUid);
  if (!warnings.length) {
    dom.auditWarningsList.innerHTML = '<div class="empty-state"><strong>No admin warnings</strong><span>The current records look consistent.</span></div>';
    return;
  }
  dom.auditWarningsList.innerHTML = warnings.map((warning) => `
    <article class="warning-card warning-tone-${escapeHtml(warning.tone)}">
      <h4>${escapeHtml(warning.title)}</h4>
      <p>${escapeHtml(warning.detail)}</p>
    </article>
  `).join('');
}

function getFilteredLogs() {
  const query = String(dom.auditSearchInput.value || '').trim().toLowerCase();
  if (!query) return logs;
  return logs.filter((log) => [
    log.targetName,
    log.targetEmail,
    log.actorName,
    log.actorEmail,
    log.note,
    ...(Array.isArray(log.changeParts) ? log.changeParts : [])
  ].join(' ').toLowerCase().includes(query));
}

function renderLogs() {
  const filteredLogs = getFilteredLogs();
  if (!filteredLogs.length) {
    dom.auditLogList.innerHTML = '<div class="empty-state"><strong>No matching audit entries</strong><span>Try a different search term.</span></div>';
    return;
  }
  dom.auditLogList.innerHTML = filteredLogs.map((log) => {
    const target = log.targetName || log.targetEmail || 'Unknown user';
    const note = log.note ? `<p>${escapeHtml(log.note)}</p>` : '';
    const parts = Array.isArray(log.changeParts) && log.changeParts.length ? `<small>${escapeHtml(log.changeParts.join(' • '))}</small>` : '';
    return `
      <div class="log-item">
        <div class="log-item-copy">
          <strong>${escapeHtml(target)}</strong>
          <span class="log-type">${escapeHtml(String(log.type || 'update').replaceAll('_', ' '))}</span>
          ${note}
          ${parts}
        </div>
        <div class="log-meta-side">
          <div>${escapeHtml(formatDateTime(log.createdAtMs))}</div>
          <div>${escapeHtml(log.actorName || log.actorEmail || 'Admin')}</div>
        </div>
      </div>
    `;
  }).join('');
}

function exportGroup(name, predicate) {
  try {
    exportUsersCsv(users.filter(predicate), complaintSummaryByUid, voteSummaryByStudentId, name);
  } catch (error) {
    alert(error.message || 'Nothing to export.');
  }
}

setActiveAdminNav();
renderAdminIdentity();
subscribeUsers((value) => { users = value; renderWarnings(); });
subscribeComplaints((value) => { complaintSummaryByUid = value; renderWarnings(); });
subscribeVotes((value) => { voteSummaryByStudentId = value; });
subscribeRoleLogs((value, error) => {
  logs = value;
  dom.auditStatusBadge.textContent = error ? 'Unable to load logs' : 'Live from Firestore';
  renderMetrics();
  renderLogs();
}, 100);

dom.auditSearchInput.addEventListener('input', renderLogs);
dom.exportAllUsersButton.addEventListener('click', () => exportGroup('usc-users-all.csv', () => true));
dom.exportOfficersButton.addEventListener('click', () => exportGroup('usc-users-officers.csv', (user) => user.role === 'officer'));
dom.exportPendingButton.addEventListener('click', () => exportGroup('usc-users-pending.csv', (user) => user.accountStatus === 'pending'));
dom.exportSuspendedButton.addEventListener('click', () => exportGroup('usc-users-suspended.csv', (user) => user.accountStatus === 'suspended'));

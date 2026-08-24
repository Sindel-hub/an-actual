
import { db } from "../../firebase/firebase-config.js";
import { collection, doc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { callSecure } from "../../shared/security-client.js";
import { complaintAttachmentMeta, downloadBlob, loadComplaintAttachmentBlob } from "../../shared/complaint-attachments.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const PROFILE_KEY = "studentProfile";
function profile() { try { return JSON.parse(sessionStorage.getItem(PROFILE_KEY) || "null"); } catch { return null; } }
function clean(v, f="") { return String(v ?? f).trim(); }
function toDate(v) { if (!v) return null; const d = v?.toDate ? v.toDate() : new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
function formatDate(v) { const d = toDate(v) || (clean(v) ? new Date(v) : null); return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString([], { month: "short", day: "2-digit", year: "numeric" }) : "—"; }
function formatDateTime(v) { const d = toDate(v) || (clean(v) ? new Date(v) : null); return d && !Number.isNaN(d.getTime()) ? d.toLocaleString([], { month: "short", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"; }
function escapeHtml(v) { return clean(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

const state = { complaints: [], participation: [], selectedComplaintId: '' };
const statusClassMap = { Submitted: 'info', 'Under Review': 'warning', 'In Review': 'warning', 'In Progress': 'progress', Resolved: 'success', Closed: 'muted' };

function getStatusClass(status) { return statusClassMap[clean(status, 'Submitted')] || 'info'; }
function latestComplaint() { return state.complaints[0] || null; }
function latestParticipation() { return state.participation[0] || null; }

function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }

function renderOverview() {
  const total = state.complaints.length;
  const active = state.complaints.filter(item => ['Submitted', 'Under Review', 'In Review', 'In Progress'].includes(clean(item.status))).length;
  const resolved = state.complaints.filter(item => ['Resolved', 'Closed'].includes(clean(item.status))).length;
  setText('overviewTotalComplaints', String(total).padStart(2,'0'));
  setText('overviewActiveComplaints', String(active).padStart(2,'0'));
  setText('overviewResolvedComplaints', String(resolved).padStart(2,'0'));
  setText('overviewElectionRecords', String(state.participation.length).padStart(2,'0'));
}

function renderComplaintPreview() {
  const host = document.getElementById('complaintPreviewHost');
  const item = latestComplaint();
  if (!host) return;
  if (!item) {
    host.innerHTML = `<div class="track-empty-card"><p>No complaints yet.</p><button class="modal-btn primary" onclick="window.location.href='../complaint/complaint.html'">Submit a Complaint</button></div>`;
    return;
  }
  const status = clean(item.status, 'Submitted');
  host.innerHTML = `
    <div class="complaint-preview-box">
      <h3>${escapeHtml(clean(item.subject, 'Untitled Complaint'))}</h3>
      <div class="preview-meta">Ticket: ${escapeHtml(clean(item.complaintRef, item.id))}<br/>Date submitted: ${escapeHtml(formatDate(item.createdAt))}<br/>Category: ${escapeHtml(clean(item.category, 'General Concern'))}</div>
      <div class="progress-strip">
        <div class="progress-point ${['Submitted','Under Review','In Review','In Progress','Resolved','Closed'].includes(status) ? 'done' : ''}"><span></span><small>Submitted</small></div>
        <div class="progress-point ${['Under Review','In Review','In Progress','Resolved','Closed'].includes(status) ? 'done' : ''}"><span></span><small>In Review</small></div>
        <div class="progress-point ${['In Progress','Resolved','Closed'].includes(status) ? 'done' : ''}"><span></span><small>In Progress</small></div>
        <div class="progress-point ${['Resolved','Closed'].includes(status) ? 'done' : ''}"><span></span><small>Resolved</small></div>
        <div class="progress-point ${['Closed'].includes(status) ? 'done' : ''}"><span></span><small>Closed</small></div>
      </div>
      <div class="preview-actions"><button class="modal-btn primary" data-open-modal="trackComplaintsModal" type="button">View Details</button></div>
    </div>`;
}

function renderRecentActivity() {
  const host = document.getElementById('recentActivityHost');
  if (!host) return;
  const items = [];
  state.complaints.slice(0,3).forEach(item => {
    items.push({title: 'Complaint Updated', text: `Your complaint has been moved to ${clean(item.status,'Submitted')}.`, when: formatDateTime(item.updatedAt || item.createdAt)});
  });
  state.participation.slice(0,1).forEach(item => {
    items.push({title: 'Vote Recorded', text: 'Your submission for the USC General Election was successfully saved.', when: formatDateTime(item.votedAt)});
  });
  if (!items.length) {
    host.innerHTML = '<div class="track-empty-card"><p>No recent activity yet.</p></div>';
    return;
  }
  host.innerHTML = items.map(item => `<article class="activity-item"><span class="activity-bullet"></span><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.text)}</p><small>${escapeHtml(item.when)}</small></div></article>`).join('');
}

function buildVoteRows(vote) {
  const receipt = clean(vote.receiptReference, 'Recorded');
  const college = clean(vote.college, 'Verified voter record');
  return `<tr><td>Anonymous Ballot</td><td>Selections confidential</td><td>${escapeHtml(college)}</td><td>${escapeHtml(receipt)}</td></tr>`;
}

function renderVotePreview() {
  const host = document.getElementById('votePreviewHost');
  const vote = latestParticipation();
  if (!host) return;
  if (!vote) {
    host.innerHTML = `<div class="track-empty-card"><h3>No election submission yet</h3><p>Your submitted vote will appear here after voting.</p><button class="modal-btn primary" onclick="window.location.href='election.html'">Go to Election</button></div>`;
    return;
  }
  const electionName = clean(vote.electionName, 'USC Election');
  host.innerHTML = `
    <div class="vote-preview-box">
      <div class="vote-preview-top"><h3>${escapeHtml(electionName)}</h3><span class="status-pill success">Vote Recorded</span></div>
      <div class="preview-meta">Vote submitted: ${escapeHtml(formatDateTime(vote.votedAt))}</div>
      <p>Your vote has been successfully recorded. No further action is needed for this election.</p>
      <div class="preview-actions"><button class="modal-btn primary" data-open-modal="trackElectionModal" type="button">View Details</button></div>
    </div>`;

  const voteDate = toDate(vote.votedAt);
  document.getElementById('voteElectionName').textContent = electionName;
  document.getElementById('voteElectionDate').textContent = voteDate ? voteDate.toLocaleDateString([], { month:'long', day:'2-digit', year:'numeric' }) : '—';
  document.getElementById('voteElectionTime').textContent = voteDate ? voteDate.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : '—';
  document.getElementById('voteTableBody').innerHTML = buildVoteRows(vote);
}

function renderComplaintTable() {
  const body = document.getElementById('complaintTableBody');
  const meta = document.getElementById('complaintTableMeta');
  if (!body) return;
  if (!state.complaints.length) {
    body.innerHTML = '<tr><td colspan="7">No complaints submitted yet.</td></tr>';
    if (meta) meta.textContent = 'Showing 0 to 0 of 0 entries';
    return;
  }
  body.innerHTML = state.complaints.map(item => `
    <tr>
      <td>${escapeHtml(clean(item.complaintRef, item.id))}</td>
      <td>${escapeHtml(clean(item.subject, 'Untitled Complaint'))}</td>
      <td>${escapeHtml(clean(item.category, 'General Concern'))}</td>
      <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
      <td><span class="status-pill ${getStatusClass(item.status)}">${escapeHtml(clean(item.status,'Submitted'))}</span></td>
      <td>${escapeHtml(formatDateTime(item.updatedAt || item.createdAt))}</td>
      <td><button class="table-action-btn" type="button" data-view-complaint="${escapeHtml(item.id)}" title="View Details">View Details</button></td>
    </tr>`).join('');
  if (meta) meta.textContent = `Showing 1 to ${state.complaints.length} of ${state.complaints.length} entries`;
}


function getComplaintById(id) {
  return state.complaints.find(item => clean(item.id) === clean(id)) || null;
}

function getInitials(name = 'Student') {
  return clean(name, 'Student').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || 'ST';
}

function parseStatusFromMessage(message = '') {
  const text = clean(message);
  const patterns = [
    /status updated from .+? to (Submitted|Under Review|In Review|In Progress|Resolved|Closed)\.?$/i,
    /status (?:was )?(?:updated|changed|moved) (?:to|into) (Submitted|Under Review|In Review|In Progress|Resolved|Closed)/i,
    /(?:is now|now in) (Submitted|Under Review|In Review|In Progress|Resolved|Closed)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function normalizeStatus(status = '') {
  const value = clean(status, 'Submitted');
  if (value === 'In Review') return 'Under Review';
  return value;
}

function statusTimelineItems(complaint) {
  const items = [];
  const seen = new Set();
  const push = (status, at, message) => {
    const normalized = normalizeStatus(status);
    const key = `${normalized}|${formatDateTime(at)}|${clean(message)}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ status: normalized, at, message: clean(message) });
  };

  push('Submitted', complaint.createdAt, 'Your complaint has been successfully submitted.');

  const thread = Array.isArray(complaint.thread) ? complaint.thread : [];
  thread.forEach(entry => {
    const message = clean(entry?.message);
    const by = clean(entry?.by, 'System');
    const detectedStatus = parseStatusFromMessage(message);
    if (detectedStatus) {
      push(detectedStatus, entry?.at || complaint.updatedAt, message);
    }
  });

  const current = normalizeStatus(complaint.status);
  const hasCurrent = items.some(item => item.status === current);
  if (!hasCurrent && current !== 'Submitted') {
    push(current, complaint.updatedAt || complaint.createdAt, `Your complaint is currently ${current.toLowerCase()}.`);
  }

  return items.sort((a, b) => (toDate(b.at)?.getTime() || 0) - (toDate(a.at)?.getTime() || 0));
}

function statusTimelineDescription(status, originalMessage = '') {
  if (originalMessage && !/^Status updated from/i.test(originalMessage)) return originalMessage;
  const descriptions = {
    Submitted: 'Your complaint has been successfully submitted.',
    'Under Review': 'Your complaint has been received and is now being reviewed.',
    'In Progress': 'Your complaint is now in progress. Our team is currently working on it.',
    Resolved: 'Your complaint has been marked as resolved.',
    Closed: 'Your complaint has been closed.'
  };
  return descriptions[normalizeStatus(status)] || originalMessage || 'Complaint status updated.';
}

function statusTimelineIcon(status) {
  const normalized = normalizeStatus(status);
  if (normalized === 'Resolved' || normalized === 'Closed') return 'fa-check';
  if (normalized === 'Under Review') return 'fa-clock';
  if (normalized === 'In Progress') return 'fa-spinner';
  return 'fa-lock';
}

function renderComplaintStatusTimeline(complaint) {
  const host = document.getElementById('detailStatusTimeline');
  if (!host) return;
  const items = statusTimelineItems(complaint);
  host.innerHTML = items.map(item => {
    const statusClass = getStatusClass(item.status);
    return `
      <article class="status-history-item ${statusClass}">
        <div class="status-history-marker"><i class="fa-solid ${statusTimelineIcon(item.status)}"></i></div>
        <div class="status-history-copy">
          <strong>${escapeHtml(item.status)}</strong>
          <small>${escapeHtml(formatDateTime(item.at))}</small>
          <p>${escapeHtml(statusTimelineDescription(item.status, item.message))}</p>
        </div>
      </article>`;
  }).join('') || '<div class="detail-empty">No status history available.</div>';
}


function renderComplaintAttachment(complaint) {
  const host = document.getElementById('detailAttachmentHost');
  if (!host) return;
  const meta = complaintAttachmentMeta(complaint);
  if (!meta.name && !meta.path && !meta.directUrl) {
    host.innerHTML = '<div class="detail-empty">No attachment was submitted with this complaint.</div>';
    return;
  }
  host.innerHTML = `<div class="attachment-detail-card"><div class="attachment-file-icon"><i class="fa-solid fa-paperclip"></i></div><div class="attachment-detail-copy"><strong>${escapeHtml(meta.name || 'Complaint attachment')}</strong><span>Private complaint attachment</span><div class="attachment-actions"><button class="attachment-open-link" type="button" data-open-complaint-attachment>Open attachment</button><button class="attachment-open-link" type="button" data-download-complaint-attachment>Download</button></div></div></div>`;

  const load = async () => loadComplaintAttachmentBlob({ ...complaint, id: complaint.id });
  host.querySelector('[data-open-complaint-attachment]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Opening…';
    try {
      const loaded = await load();
      const url = URL.createObjectURL(loaded.blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      alert(error.message || 'Unable to open attachment.');
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  });
  host.querySelector('[data-download-complaint-attachment]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing…';
    try {
      const loaded = await load();
      downloadBlob(loaded.blob, loaded.meta.name);
    } catch (error) {
      alert(error.message || 'Unable to download attachment.');
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  });
}


function renderOfficerReplies(complaint) {
  const host = document.getElementById('detailOfficerReplies');
  if (!host) return;

  const thread = Array.isArray(complaint?.thread) ? complaint.thread : [];
  const officerEntries = thread
    .filter(entry => clean(entry?.by).toLowerCase() === 'officer')
    .filter(entry => !parseStatusFromMessage(entry?.message))
    .sort((a, b) => (toDate(a?.at)?.getTime() || 0) - (toDate(b?.at)?.getTime() || 0));

  if (!officerEntries.length) {
    host.innerHTML = `
      <div class="officer-reply-empty">
        <i class="fa-regular fa-comments"></i>
        <div><strong>No officer reply yet</strong><span>When a USC officer sends a reply, it will appear here automatically.</span></div>
      </div>`;
    return;
  }

  host.innerHTML = officerEntries.map((entry, index) => `
    <article class="officer-reply-message">
      <div class="officer-reply-avatar"><i class="fa-solid fa-user-shield"></i></div>
      <div class="officer-reply-content">
        <div class="officer-reply-meta"><strong>USC Officer${officerEntries.length > 1 ? ` Reply ${index + 1}` : ''}</strong><time>${escapeHtml(formatDateTime(entry?.at))}</time></div>
        <p>${escapeHtml(clean(entry?.message, ''))}</p>
      </div>
    </article>`).join('');
}

function openComplaintDetails(complaintId) {
  const complaint = getComplaintById(complaintId);
  if (!complaint) return;
  state.selectedComplaintId = complaint.id;

  setText('detailComplaintId', clean(complaint.complaintRef, complaint.id));
  setText('detailComplaintSubject', clean(complaint.subject, 'Untitled Complaint'));
  setText('detailComplaintCategory', clean(complaint.category, 'General Concern'));
  setText('detailComplaintDate', formatDateTime(complaint.createdAt));
  setText('detailSubmittedName', clean(complaint.studentName, 'Student'));
  setText('detailSubmittedId', clean(complaint.studentId, 'Student ID not available'));
  setText('detailSubmittedEmail', clean(complaint.studentEmail, 'Email not available'));
  setText('detailSubmittedInitials', getInitials(complaint.studentName));
  setText('detailComplaintDescription', clean(complaint.details, 'No complaint description available.'));

  renderComplaintAttachment(complaint);
  renderOfficerReplies(complaint);
  renderComplaintStatusTimeline(complaint);

  document.getElementById('complaintDetailModal')?.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeComplaintDetails() {
  document.getElementById('complaintDetailModal')?.classList.add('hidden');
  if (!document.querySelector('.student-modal:not(.hidden)')) document.body.classList.remove('modal-open');
}

function bindComplaintDetails() {
  const body = document.getElementById('complaintTableBody');
  body?.addEventListener('click', event => {
    const button = event.target.closest?.('[data-view-complaint]');
    if (!button) return;
    openComplaintDetails(button.getAttribute('data-view-complaint'));
  });

  document.getElementById('complaintDetailClose')?.addEventListener('click', closeComplaintDetails);
  document.getElementById('complaintDetailCloseBottom')?.addEventListener('click', closeComplaintDetails);
  document.getElementById('complaintDetailBackdrop')?.addEventListener('click', closeComplaintDetails);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('complaintDetailModal')?.classList.contains('hidden')) closeComplaintDetails();
  });
}

function renderAll() {
  renderOverview();
  renderComplaintPreview();
  renderRecentActivity();
  renderVotePreview();
  renderComplaintTable();
  bindOpenButtons();
}

function bindOpenButtons() {
  document.querySelectorAll('[data-open-modal]').forEach(button => {
    button.onclick = () => document.getElementById(button.getAttribute('data-open-modal'))?.classList.remove('hidden');
  });
}

function bindModalClose() {
  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => document.getElementById(button.getAttribute('data-close-modal'))?.classList.add('hidden'));
  });
}

function listenComplaints() {
  const p = profile();
  if (!p?.uid) return renderAll();
  onSnapshot(query(collection(db, 'complaints'), where('studentUid', '==', p.uid)), snapshot => {
    state.complaints = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a,b) => (toDate(b.updatedAt || b.createdAt)?.getTime() || 0) - (toDate(a.updatedAt || a.createdAt)?.getTime() || 0));
    renderAll();
  }, () => renderAll());
}

async function listenVotes() {
  const p = profile();
  if (!p?.uid) return renderAll();
  try {
    const context = await callSecure('getElectionContext');
    const statusRef = doc(db, 'elections', context.electionId, 'voterStatus', p.uid);
    onSnapshot(statusRef, snapshot => {
      state.participation = snapshot.exists() && snapshot.data().hasVoted === true
        ? [{ id: snapshot.id, ...snapshot.data(), electionName: context.title, electionId: context.electionId }]
        : [];
      renderAll();
    }, () => { state.participation = []; renderAll(); });
  } catch (error) {
    console.warn('Election participation status unavailable:', error);
    state.participation = [];
    renderAll();
  }
}

bindModalClose();
bindComplaintDetails();
listenComplaints();
listenVotes();
renderAll();

import { auth, db } from "../../firebase/firebase-config.js";
import { callSecure, secureUpload, hydrateMediaImages } from "../../shared/security-client.js";
import {
  collection,
  doc,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const app = document.getElementById("electionApp");
const POSITION_ORDER = [
  "President", "Vice President", "Secretary", "Treasurer", "Auditor",
  "Public Relations Officer (PRO)", "Business Manager", "Sgt. at Arms", "Department Representative"
];
const PHASES = [
  ["Registration", "registrationStart", "registrationEnd"],
  ["Review", "applicationReviewStart", "applicationReviewEnd"],
  ["Candidates", "candidatePublicationStart", "candidatePublicationEnd"],
  ["Voting", "votingStart", "votingEnd"],
  ["Results", "resultPublicationStart", "resultPublicationEnd"]
];
let student = null;
let context = null;
let application = null;
let candidates = [];
let voterStatus = null;
let turnout = { ballotsCast: 0, eligibleVoters: 0 };
let currentView = "landing";

function clean(v, fallback = "") { return String(v ?? fallback).trim(); }
function esc(v) { return clean(v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
function sessionProfile() { try { return JSON.parse(sessionStorage.getItem("studentProfile") || "null"); } catch { return null; } }
function formatTime(ms) {
  if (!ms) return "Not set";
  const d = new Date(Number(ms));
  return d.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function phaseMessage() {
  if (!context) return "Election services temporarily unavailable.";
  const map = {
    Draft: "Election schedule configured. Sensitive actions remain locked.",
    Registration: "Candidate registration is open.",
    Review: "Candidate applications are being reviewed.",
    Published: "Approved candidates have been published.",
    Voting: "Official voting is open.",
    "Voting Closed": "Voting has closed. Ballots are awaiting finalization and canvassing.",
    Canvassing: "The election has been finalized and is under canvassing.",
    "Results Published": "Official election results have been published.",
    Archived: "This election is archived."
  };
  return map[context.lifecycle] || "Election information is available.";
}
function photo(candidate) { return clean(candidate.campaignPhotoUrl) || "assets/USClogo.webp"; }
function candidatesFor(position) {
  return candidates.filter((c) => c.position === position && c.approved !== false && (position !== "Department Representative" || clean(c.department) === clean(student.college)));
}

async function loadSecureState() {
  context = await callSecure("getElectionContext");
  const electionId = context.electionId;
  const [appSnap, statusSnap, turnoutSnap] = await Promise.all([
    getDoc(doc(db, "elections", electionId, "applications", student.uid)),
    getDoc(doc(db, "elections", electionId, "voterStatus", student.uid)),
    getDoc(doc(db, "elections", electionId, "turnout", "public"))
  ]);
  application = appSnap.exists() ? { id: appSnap.id, ...appSnap.data() } : null;
  voterStatus = statusSnap.exists() ? statusSnap.data() : null;
  turnout = turnoutSnap.exists() ? turnoutSnap.data() : { ballotsCast: 0, eligibleVoters: context.eligibleVoterCount || 0 };
  if (context.candidateVisible) {
    const snap = await getDocs(collection(db, "elections", electionId, "candidates"));
    candidates = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.approved !== false);
  } else {
    candidates = [];
  }
}

function timeline() {
  if (!context) return `<div class="election-phase-legacy"><strong>Election services unavailable</strong><span>Sensitive election actions are locked until the server can verify the active election.</span></div>`;
  return `<div class="election-phase-timeline">${PHASES.map(([label,start,end]) => `<div class="election-phase-step ${context.lifecycle.toLowerCase().includes(label.toLowerCase().split(" ")[0]) ? "active" : ""}"><span>${esc(label)}</span><small>${esc(formatTime(context[start]))}<br>to ${esc(formatTime(context[end]))}</small></div>`).join("")}</div>`;
}

function detailsCard() {
  return `<aside class="election-detail-card">
    <h3><i class="fa-regular fa-calendar"></i>&nbsp; Election Details</h3>
    <p><small>Election Name</small><br><strong>${esc(context?.title || "USC Election")}</strong></p>
    <p><small>Server-Verified Lifecycle</small><br><strong>${esc(context?.lifecycle || "Unavailable")}</strong></p>
    <p><small>Verified College</small><br><strong>${esc(student.college || "Not assigned")}</strong></p>
    <p><small>Turnout</small><br><strong>${Number(turnout.ballotsCast || 0)} of ${Number(turnout.eligibleVoters || context?.eligibleVoterCount || 0)} ballots cast</strong></p>
  </aside>`;
}

function failClosed(error) {
  console.error(error);
  context = null;
  currentView = "unavailable";
  app.innerHTML = `<section class="registration-card" style="max-width:860px;margin:35px auto"><div class="registration-tip"><i class="fa-solid fa-shield-halved"></i><div><strong>Election services temporarily unavailable</strong><span>The system could not verify the active election with the server. Registration, voting, and results remain locked. Please try again.</span></div></div><div class="registration-actions"><button class="btn-next" id="retryElection">Try Again</button></div></section>`;
  document.getElementById("retryElection")?.addEventListener("click", initialize);
}

function renderLanding() {
  currentView = "landing";
  const canViewCandidates = context?.candidateVisible === true;
  const canRegister = context?.registrationOpen === true && !application;
  const canVote = context?.votingOpen === true && !voterStatus?.hasVoted;
  app.innerHTML = `<section class="election-page-shell">
    <div class="election-hero">
      <div><small>UNIVERSITY STUDENT COUNCIL</small><h1>${esc(context?.title || "USC Election")}</h1><p>${esc(phaseMessage())}</p></div>
      <span class="candidate-status">${esc(context?.lifecycle || "Unavailable")}</span>
    </div>
    ${timeline()}
    <div class="registration-layout">
      <section class="registration-card">
        <div class="registration-tip"><i class="fa-solid fa-shield-halved"></i><div><strong>Verified election access</strong><span>Your election eligibility, college, and sensitive actions are validated by the server. Your device clock does not authorize voting or registration.</span></div></div>
        <div class="registration-body">
          <h3>Election Actions</h3>
          <div class="review-grid">
            <div class="review-panel"><h4>Candidate Application</h4><p>${application ? `Status: <strong>${esc(application.status || "Under Review")}</strong>` : (context?.registrationOpen ? "Registration is currently open." : "Registration is not open.")}</p><button class="btn-next" id="applicationAction" ${!application && !canRegister ? "disabled" : ""}>${application ? "View Application Status" : "Register as Candidate"}</button></div>
            <div class="review-panel"><h4>Official Candidates</h4><p>${canViewCandidates ? `${candidates.length} approved candidate record(s) are available.` : "Candidates are hidden until the publication phase."}</p><button class="btn-next" id="candidatesAction" ${!canViewCandidates ? "disabled" : ""}>View Candidates</button></div>
            <div class="review-panel"><h4>Voting</h4><p>${voterStatus?.hasVoted ? `Ballot recorded. Receipt: <strong>${esc(voterStatus.receiptReference || "Recorded")}</strong>` : (context?.votingOpen ? "Voting is open according to server time." : "Voting is not open.")}</p><button class="btn-next" id="voteAction" ${!canVote ? "disabled" : ""}>${voterStatus?.hasVoted ? "Already Voted" : "Vote Now"}</button></div>
            <div class="review-panel"><h4>Official Results</h4><p>${context?.resultsVisible ? "Published official results are available." : "Candidate-level totals remain hidden until official result publication."}</p><button class="btn-next" id="resultsAction" ${!context?.resultsVisible ? "disabled" : ""}>View Official Results</button></div>
          </div>
        </div>
      </section>${detailsCard()}
    </div>
  </section>`;
  document.getElementById("applicationAction")?.addEventListener("click", () => application ? renderApplicationStatus() : renderRegistration());
  document.getElementById("candidatesAction")?.addEventListener("click", renderCandidates);
  document.getElementById("voteAction")?.addEventListener("click", renderBallot);
  document.getElementById("resultsAction")?.addEventListener("click", renderResults);
}

function renderRegistration() {
  if (!context?.registrationOpen) return renderLanding();
  currentView = "registration";
  app.innerHTML = `<section class="registration-card" style="max-width:980px;margin:30px auto">
    <div class="registration-tip"><i class="fa-solid fa-user-check"></i><div><strong>Candidate registration</strong><span>Identity, program, and college come from your verified voter record. Department Representative candidates are automatically locked to their verified college.</span></div></div>
    <form class="registration-body" id="secureCandidateForm">
      <h3>CANDIDACY APPLICATION</h3>
      <div class="form-grid">
        <div class="form-field"><label>Student ID</label><input class="read-only-field" value="${esc(student.studentId)}" readonly></div>
        <div class="form-field"><label>Full Name</label><input class="read-only-field" value="${esc(student.fullName)}" readonly></div>
        <div class="form-field"><label>Program</label><input class="read-only-field" value="${esc(student.program || "Verified masterlist record")}" readonly></div>
        <div class="form-field"><label>College</label><input class="read-only-field" value="${esc(student.college || "Verified masterlist record")}" readonly></div>
        <div class="form-field"><label>Position</label><select id="candidatePosition" required><option value="">Choose a position</option>${POSITION_ORDER.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("")}</select></div>
        <div class="form-field"><label>Party / Affiliation</label><input id="candidateParty" maxlength="100" placeholder="Independent or party name"></div>
        <div class="form-field full"><label>Platform</label><textarea id="candidatePlatform" maxlength="4000" rows="5" required placeholder="Describe your platform and priorities"></textarea></div>
        <div class="form-field"><label>Campaign Photo</label><input id="campaignPhoto" type="file" accept="image/jpeg,image/png,image/webp" required><small class="field-help">Stored privately during review. It becomes public only after approval.</small></div>
        <div class="form-field"><label>Supporting Documents</label><input id="supportingDocuments" type="file" multiple accept=".pdf,image/jpeg,image/png"><small class="field-help">Private files. Maximum 8 documents.</small></div>
      </div>
      <p id="candidateSubmitMessage" aria-live="polite"></p>
      <div class="registration-actions"><button class="btn-back" type="button" id="cancelCandidate">Back</button><button class="btn-next" type="submit">Submit Application</button></div>
    </form>
  </section>`;
  document.getElementById("cancelCandidate")?.addEventListener("click", renderLanding);
  document.getElementById("secureCandidateForm")?.addEventListener("submit", submitApplication);
}

async function submitApplication(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = document.getElementById("candidateSubmitMessage");
  button.disabled = true;
  message.textContent = "Server-verifying registration window and securely uploading files...";
  try {
    context = await callSecure("getElectionContext");
    if (!context.registrationOpen) throw new Error("Candidate registration is no longer open according to server time.");
    const photoFile = document.getElementById("campaignPhoto")?.files?.[0];
    if (!photoFile) throw new Error("Campaign photo is required.");
    const docs = [...(document.getElementById("supportingDocuments")?.files || [])].slice(0, 8);
    const photoTicket = await secureUpload(photoFile, "candidate-photo");
    const docTickets = [];
    for (const file of docs) docTickets.push(await secureUpload(file, "candidate-document"));
    const result = await callSecure("submitCandidateApplication", {
      position: document.getElementById("candidatePosition").value,
      partylist: document.getElementById("candidateParty").value,
      platform: document.getElementById("candidatePlatform").value,
      campaignPhotoPath: photoTicket.path,
      supportingDocumentPaths: docTickets.map((ticket) => ticket.path)
    });
    await loadSecureState();
    document.getElementById("applicationSuccess")?.classList.remove("hidden");
    message.textContent = `Application submitted: ${result.status}.`;
  } catch (error) {
    console.error(error);
    message.textContent = error.message || "Unable to submit the application.";
    button.disabled = false;
  }
}

function renderApplicationStatus() {
  if (!application) return renderLanding();
  currentView = "status";
  app.innerHTML = `<section class="registration-card" style="max-width:850px;margin:35px auto"><div class="registration-tip"><i class="fa-solid fa-circle-info"></i><div><strong>Application Status: ${esc(application.status || "Under Review")}</strong><span>Private supporting documents are not exposed on public candidate pages.</span></div></div><div class="registration-body"><div class="review-grid"><div class="review-panel"><h4>Candidate</h4><p><strong>${esc(application.fullName || student.fullName)}</strong><br>${esc(application.studentId || student.studentId)}<br>${esc(application.program || student.program || "")}</p></div><div class="review-panel"><h4>Position</h4><p>${esc(application.position)}</p>${application.department ? `<h4>Verified College</h4><p>${esc(application.department)}</p>` : ""}<h4>Party</h4><p>${esc(application.partylist || "Independent")}</p></div><div class="review-panel"><h4>Review</h4><p>${esc(application.reviewNote || "No review note has been posted.")}</p></div></div><div class="registration-actions"><button class="btn-back" id="backFromStatus">Back</button>${context?.candidateVisible ? '<button class="btn-next" id="viewCandidatesFromStatus">View Candidates</button>' : ""}</div></div></section>`;
  document.getElementById("backFromStatus")?.addEventListener("click", renderLanding);
  document.getElementById("viewCandidatesFromStatus")?.addEventListener("click", renderCandidates);
}

function renderCandidates() {
  if (!context?.candidateVisible) return renderLanding();
  currentView = "candidates";
  const grouped = POSITION_ORDER.map((position) => {
    const rows = candidatesFor(position);
    if (!rows.length) return "";
    return `<section class="candidate-position-section"><h2>${esc(position)}${position === "Department Representative" ? ` · ${esc(student.college)}` : ""}</h2><div class="candidate-card-grid">${rows.map((c) => `<article class="candidate-card"><img src="${esc(photo(c))}" alt="Campaign photo of ${esc(c.fullName)}" onerror="this.src='assets/USClogo.webp'"><div><h3>${esc(c.fullName)}</h3><p>${esc(c.partylist || "Independent")}</p><small>${esc(c.department || c.college || "")}</small><p>${esc(c.platform || "No platform statement provided.")}</p></div></article>`).join("")}</div></section>`;
  }).join("");
  const status = voterStatus?.hasVoted ? "Already Voted" : (context.votingOpen ? "Vote Now" : "Voting Not Open");
  app.innerHTML = `<section class="candidate-page-shell"><header class="election-results-header"><div><small>OFFICIAL APPROVED CANDIDATES</small><h1>${esc(context.title)}</h1><p>Only candidates approved through the election review workflow are shown.</p></div><button id="backCandidates" type="button"><i class="fa-solid fa-arrow-left"></i> Back</button></header>${grouped || '<div class="election-results-empty">No approved candidates are published.</div>'}<div class="candidate-vote-zone"><button class="official-vote-now" id="floatingVoteStatus" ${!context.votingOpen || voterStatus?.hasVoted ? "disabled" : ""}>${esc(status)}</button></div></section>`;
  hydrateMediaImages(app).catch(() => {});
  document.getElementById("backCandidates")?.addEventListener("click", renderLanding);
  document.getElementById("floatingVoteStatus")?.addEventListener("click", () => { if (context.votingOpen && !voterStatus?.hasVoted) renderBallot(); });
}

function renderBallot() {
  if (!context?.votingOpen || voterStatus?.hasVoted) return renderLanding();
  currentView = "ballot";
  const positionMarkup = POSITION_ORDER.map((position) => {
    const rows = candidatesFor(position);
    return `<div class="form-field full"><label>${esc(position)}${position === "Department Representative" ? ` · ${esc(student.college)}` : ""}</label><select class="ballot-select" data-position="${esc(position)}" required><option value="">Select candidate</option>${rows.map((c) => `<option value="${esc(c.id)}">${esc(c.fullName)}${c.partylist ? ` · ${esc(c.partylist)}` : ""}</option>`).join("")}</select>${!rows.length ? '<small class="field-help">No eligible approved candidate is available for this position.</small>' : ""}</div>`;
  }).join("");
  app.innerHTML = `<section class="registration-card" style="max-width:900px;margin:30px auto"><div class="registration-tip"><i class="fa-solid fa-lock"></i><div><strong>Secret ballot</strong><span>Your voter participation record is separate from the anonymous ballot document. The ballot stores candidate IDs only and does not store your UID, Student ID, name, email, college, or receipt.</span></div></div><form class="registration-body" id="secureBallotForm"><h3>OFFICIAL BALLOT</h3><div class="form-grid">${positionMarkup}</div><p id="ballotMessage" aria-live="polite"></p><div class="registration-actions"><button class="btn-back" type="button" id="cancelBallot">Cancel</button><button class="btn-next" type="submit">Submit Vote</button></div></form></section>`;
  document.getElementById("cancelBallot")?.addEventListener("click", renderCandidates);
  document.getElementById("secureBallotForm")?.addEventListener("submit", submitBallot);
}

async function submitBallot(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = document.getElementById("ballotMessage");
  const selections = {};
  form.querySelectorAll(".ballot-select").forEach((select) => { selections[select.dataset.position] = select.value; });
  if (Object.values(selections).some((id) => !id)) return message.textContent = "Select one candidate for every ballot position.";
  if (!confirm("Submit this ballot? You can vote only once. Your selections cannot be changed after the server records the ballot.")) return;
  button.disabled = true;
  message.textContent = "Server-validating eligibility, election time, candidates, and one-vote status...";
  try {
    const result = await callSecure("submitAnonymousBallot", { electionId: context.electionId, selections });
    await loadSecureState();
    app.innerHTML = `<section class="registration-card" style="max-width:760px;margin:45px auto;text-align:center"><div class="vote-success-check"><i class="fa-solid fa-check"></i></div><h2>Ballot Recorded</h2><p>Your anonymous ballot was accepted by the election server.</p><div class="success-note"><strong>Participation Receipt</strong><br><code style="font-size:1.05rem">${esc(result.receiptReference)}</code><br><small>This receipt proves the system recorded your participation. It does not reveal or identify your candidate selections.</small></div><div class="registration-actions" style="justify-content:center"><button class="btn-next" id="backAfterVote">Return to Election</button></div></section>`;
    document.getElementById("backAfterVote")?.addEventListener("click", renderLanding);
  } catch (error) {
    console.error(error);
    message.textContent = error.message || "The server rejected this ballot.";
    button.disabled = false;
  }
}

function resultRows(results) {
  const grouped = new Map(POSITION_ORDER.map((p) => [p, []]));
  for (const row of results || []) if (grouped.has(row.position)) grouped.get(row.position).push(row);
  return POSITION_ORDER.map((position) => {
    const rows = grouped.get(position).sort((a,b) => Number(b.votes||0)-Number(a.votes||0));
    if (!rows.length) return "";
    const top = Number(rows[0].votes || 0);
    return `<section class="election-result-position"><h3>${esc(position)}</h3><div class="election-result-list">${rows.map((row,index) => `<article class="election-result-row ${top > 0 && Number(row.votes||0) === top ? "leader" : ""}"><span class="result-rank">${index+1}</span><div><strong>${esc(row.fullName)}</strong><small>${esc(row.department || "")}</small></div><b>${Number(row.votes||0)} vote${Number(row.votes||0)===1?"":"s"}</b></article>`).join("")}</div></section>`;
  }).join("");
}

async function renderResults() {
  if (!context?.resultsVisible) return renderLanding();
  currentView = "results";
  app.innerHTML = `<div class="page-loading"><i class="fa-solid fa-spinner fa-spin"></i><br>Loading published official results...</div>`;
  try {
    const snap = await getDoc(doc(db, "elections", context.electionId, "results", "official"));
    if (!snap.exists()) throw new Error("Official results are not published.");
    const data = snap.data();
    const resultTurnout = data.turnout || turnout;
    app.innerHTML = `<section class="election-results-shell"><header class="election-results-header"><div><small>OFFICIAL ELECTION RESULTS</small><h1>${esc(data.title || context.title)}</h1><p>These candidate totals were released only after finalization and deliberate result publication.</p></div><button id="backResults" type="button"><i class="fa-solid fa-arrow-left"></i> Back</button></header><div class="election-results-summary"><strong>${Number(resultTurnout.ballotsCast || 0)}</strong><span>Total ballots recorded</span><b>${Number(resultTurnout.eligibleVoters || context.eligibleVoterCount || 0)} eligible voters</b></div>${resultRows(data.results)}</section>`;
    document.getElementById("backResults")?.addEventListener("click", renderLanding);
  } catch (error) { failClosed(error); }
}

async function initialize() {
  student = sessionProfile();
  if (!student) return location.replace("../index/index.html");
  document.getElementById("dashboardUserName").textContent = student.fullName || "Student";
  document.getElementById("dashboardUserInitials").textContent = (student.fullName || "ST").split(/\s+/).map((p) => p[0]).join("").slice(0,2).toUpperCase();
  app.innerHTML = `<div class="page-loading"><i class="fa-solid fa-spinner fa-spin"></i><br>Verifying election state with the server...</div>`;
  try { await loadSecureState(); renderLanding(); }
  catch (error) { failClosed(error); }
}

document.getElementById("closeSuccess")?.addEventListener("click", async () => { document.getElementById("applicationSuccess")?.classList.add("hidden"); await loadSecureState(); renderApplicationStatus(); });
document.getElementById("successX")?.addEventListener("click", () => document.getElementById("applicationSuccess")?.classList.add("hidden"));
document.getElementById("viewApplicationStatus")?.addEventListener("click", async () => { document.getElementById("applicationSuccess")?.classList.add("hidden"); await loadSecureState(); renderApplicationStatus(); });
document.getElementById("studentLogout")?.addEventListener("click", async () => { sessionStorage.clear(); try { await signOut(auth); } catch {} location.replace("../index/index.html"); });

await initialize();
setInterval(async () => {
  if (!context) return;
  try {
    const previousLifecycle = context.lifecycle;
    await loadSecureState();
    if (currentView === "landing" || previousLifecycle !== context.lifecycle) renderLanding();
    else if (currentView === "candidates") renderCandidates();
    else if (currentView === "registration" && !context.registrationOpen) renderLanding();
    else if (currentView === "ballot" && !context.votingOpen) renderLanding();
    else if (currentView === "results" && !context.resultsVisible) renderLanding();
  } catch (error) { failClosed(error); }
}, 15000);

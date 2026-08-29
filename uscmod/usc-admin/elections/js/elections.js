import { auth, db } from "../../../firebase/firebase-config.js";
import { callSecure, openPrivateFile } from "../../../shared/security-client.js";
import {
  collection, doc, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const $ = (id) => document.getElementById(id);
const els = {
  activeElectionCount: $("activeElectionCount"), candidateCount: $("candidateCount"), votesCastCount: $("votesCastCount"),
  turnoutPercent: $("turnoutPercent"), turnoutProgressLabel: $("turnoutProgressLabel"), turnoutBar: $("turnoutBar"),
  electionResultsBody: $("electionResultsBody"), presidentAnalytics: $("presidentAnalytics"), viceAnalytics: $("viceAnalytics"),
  electionTitleInput: $("electionTitleInput"), electionStatusInput: $("electionStatusInput"),
  registrationStartInput: $("registrationStartInput"), registrationEndInput: $("registrationEndInput"),
  applicationReviewStartInput: $("applicationReviewStartInput"), applicationReviewEndInput: $("applicationReviewEndInput"),
  candidatePublicationStartInput: $("candidatePublicationStartInput"), candidatePublicationEndInput: $("candidatePublicationEndInput"),
  votingStartInput: $("votingStartInput"), votingEndInput: $("votingEndInput"),
  resultPublicationStartInput: $("resultPublicationStartInput"), resultPublicationEndInput: $("resultPublicationEndInput"),
  saveElectionSettingsBtn: $("saveElectionSettingsBtn"), activePhaseBadge: $("activePhaseBadge"), electionStatusTitle: $("electionStatusTitle"),
  scheduleValidationMessage: $("scheduleValidationMessage"), candidateReviewPhaseBadge: $("candidateReviewPhaseBadge"),
  candidateReviewList: $("candidateReviewList"), candidateApplicationTotal: $("candidateApplicationTotal"), candidateApprovedTotal: $("candidateApprovedTotal"),
  candidatePendingTotal: $("candidatePendingTotal"), candidateRejectedTotal: $("candidateRejectedTotal"),
  exportSummaryBtn: $("exportSummaryBtn"), viewFullTallyBtn: $("viewFullTallyBtn")
};
const scheduleInputs = {
  registrationStart: els.registrationStartInput, registrationEnd: els.registrationEndInput,
  applicationReviewStart: els.applicationReviewStartInput, applicationReviewEnd: els.applicationReviewEndInput,
  candidatePublicationStart: els.candidatePublicationStartInput, candidatePublicationEnd: els.candidatePublicationEndInput,
  votingStart: els.votingStartInput, votingEnd: els.votingEndInput,
  resultPublicationStart: els.resultPublicationStartInput, resultPublicationEnd: els.resultPublicationEndInput
};
let context = null;
let electionId = "";
let applications = [];
let candidates = [];
let turnout = { ballotsCast: 0, eligibleVoters: 0 };
let trustedClaims = {};

let scheduleFormDirty = false;

function markScheduleDirty() {
  scheduleFormDirty = true;
}

function clean(v) { return String(v ?? "").trim(); }
function esc(v) { return clean(v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
function asLocalInput(ms) {
  if (!ms) return "";
  const d = new Date(Number(ms));
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function msg(text, type = "") {
  if (!els.scheduleValidationMessage) return;
  els.scheduleValidationMessage.textContent = text;
  els.scheduleValidationMessage.classList.toggle("is-error", type === "error");
  els.scheduleValidationMessage.classList.toggle("is-success", type === "success");
}
function lifecycleDescription() {
  if (!context) return "No active election is currently verified by the server.";
  const map = {
    Draft: "Draft: schedule exists, sensitive election actions remain locked.",
    Registration: "Registration: verified students may submit candidate applications.",
    Review: "Review: authorized officers may approve or reject candidate applications.",
    Published: "Published: approved candidates are visible to students.",
    Voting: "Voting: anonymous ballots are being accepted. Candidate totals are hidden.",
    "Voting Closed": "Voting Closed: no more ballots are accepted. Finalization is required before canvassing.",
    Canvassing: "Canvassing: the election is finalized and authorized canvassers may inspect tallies.",
    "Results Published": "Results Published: official candidate totals are now student-readable.",
    Archived: "Archived: schedule, candidate records, and election results are locked."
  };
  return map[context.lifecycle] || context.lifecycle;
}

function installHardeningPanels() {
  const scheduleCard = document.getElementById("scheduleManagementCard");
  const body = scheduleCard?.querySelector(".card-body");
  if (body && !$("electionIdInput")) {
    const titleField = els.electionTitleInput?.closest(".field");
    titleField?.insertAdjacentHTML("afterend", `<div class="field"><label>Election ID <small>(permanent archive key)</small></label><input id="electionIdInput" type="text" placeholder="usc-yyyy-general" pattern="[a-z0-9-]+"><small>Use a new ID for every election, for example <strong>usc-yyyy-general</strong>. Finalized elections cannot be overwritten.</small></div>`);
  }
  if (scheduleCard && !$("secureElectionLifecycle")) {
    scheduleCard.insertAdjacentHTML("afterend", `<article class="card" id="secureElectionLifecycle" style="margin-top:18px"><div class="card-head"><div><h3>Secure Election Lifecycle</h3><span>Deliberate closeout controls. Candidate-level tallies stay hidden from ordinary officers.</span></div><span class="phase-status-pill" id="secureLifecycleBadge">Checking...</span></div><div class="card-body"><div class="note-box"><strong>Lifecycle</strong><p id="secureLifecycleDescription">Loading server state...</p></div><div class="row-actions"><button class="mini-btn primary" id="finalizeElectionBtn" type="button">Finalize Election</button><button class="mini-btn primary" id="publishResultsBtn" type="button">Publish Official Results</button><button class="mini-btn light" id="archiveElectionBtn" type="button">Archive Election</button></div><div id="emergencyScheduleControls" hidden style="margin-top:18px"><div class="note-box"><strong>Emergency schedule procedure · Administrator only</strong><p>Normal schedule editing locks when registration starts. Emergency changes require a written reason and create an immutable audit entry.</p></div><div class="field"><label>Emergency reason</label><textarea id="emergencyScheduleReason" rows="3" maxlength="500" placeholder="Describe the operational reason, authorization, and scope of this emergency schedule change."></textarea></div><button class="mini-btn danger" id="emergencyScheduleBtn" type="button">Apply Emergency Schedule Change</button></div><p id="lifecycleActionMessage"></p></div></article>`);
  }
  const review = document.getElementById("candidateReviewCard");
  if (review && !$("masterlistImportCard")) {
    review.insertAdjacentHTML("beforebegin", `<section class="card" id="masterlistImportCard" style="margin-bottom:18px"><div class="card-head"><div><h3>School Student Accounts & Voter Masterlist</h3><span>Import the school-issued Student ID and institutional email. The same file securely provisions student login accounts and election eligibility.</span></div><span class="phase-status-pill">Admin only</span></div><div class="card-body"><div class="field"><label>Masterlist CSV</label><input id="masterlistCsvInput" type="file" accept=".csv,text/csv"><small>Required columns: studentId, fullName, institutionalEmail, program, college, yearLevel, studentStanding, eligible. Student standing may be active, leave, inactive, graduated, transferred, withdrawn, or eliminated. The legacy headers <strong>email</strong> and <strong>enrollmentStatus</strong> are still accepted.</small></div><div class="row-actions"><button class="mini-btn primary" id="importMasterlistBtn" type="button">Import & Provision School Accounts</button><a class="mini-btn light" href="../../data/voter-masterlist-template.csv" download>Download CSV Template</a></div><p id="masterlistImportMessage"></p></div></section>`);
  }
}

async function loadContext() {
  try {
    context = await callSecure("getElectionContext");
    electionId = context.electionId;
  } catch (error) {
    console.warn("No active election context:", error);
    context = null;
    const pointer = await getDoc(doc(db, "election_config", "current")).catch(() => null);
    electionId = pointer?.exists?.() ? clean(pointer.data().electionId) : "";
  }
}

async function loadData() {
  applications = [];
  candidates = [];
  turnout = { ballotsCast: 0, eligibleVoters: context?.eligibleVoterCount || 0 };
  if (!electionId) return;
  const [appSnap, candidateSnap, turnoutSnap] = await Promise.all([
    getDocs(collection(db, "elections", electionId, "applications")).catch(() => null),
    getDocs(collection(db, "elections", electionId, "candidates")).catch(() => null),
    getDoc(doc(db, "elections", electionId, "turnout", "public")).catch(() => null)
  ]);
  if (appSnap) applications = appSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (candidateSnap) candidates = candidateSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (turnoutSnap?.exists?.()) turnout = turnoutSnap.data();
}

function fillSchedule(force = false) {

  /*
   * IMPORTANT:
   * Do not overwrite dates the officer is currently editing.
   *
   * The dashboard refreshes automatically every 30 seconds.
   * Without this check, refreshAll() replaces unsaved input
   * values with the old Firebase schedule.
   */
  if (scheduleFormDirty && !force) {
    return;
  }

  if (els.electionTitleInput) {
    els.electionTitleInput.value =
      context?.title || "USC General Election";
  }

  const idInput = $("electionIdInput");

  if (idInput) {
    idInput.value =
      electionId ||
      `usc-${new Date().getFullYear()}-general`;
  }

  for (const [field, input] of Object.entries(scheduleInputs)) {

    if (!input) {
      continue;
    }

    input.value = asLocalInput(context?.[field]);
  }

  if (els.electionStatusInput) {
    els.electionStatusInput.value =
      context?.lifecycle || "Not configured";
  }

  if (els.electionStatusTitle) {
    els.electionStatusTitle.textContent =
      context?.title || "USC Election";
  }

  if (els.activePhaseBadge) {
    els.activePhaseBadge.textContent =
      context?.lifecycle || "Not configured";
  }

  if ($("secureLifecycleBadge")) {
    $("secureLifecycleBadge").textContent =
      context?.lifecycle || "Not configured";
  }

  if ($("secureLifecycleDescription")) {
    $("secureLifecycleDescription").textContent =
      lifecycleDescription();
  }

  if (els.candidateReviewPhaseBadge) {

    els.candidateReviewPhaseBadge.textContent =
      context?.reviewOpen
        ? "Review open · server verified"
        : "Review locked";

    els.candidateReviewPhaseBadge.classList.toggle(
      "is-active",
      context?.reviewOpen === true
    );
  }

  /*
   * We only reach this point when the server schedule is
   * intentionally allowed to populate the form.
   */
  scheduleFormDirty = false;
}

function renderStats() {
  const ballots = Number(turnout.ballotsCast || 0);
  const eligible = Number(turnout.eligibleVoters || context?.eligibleVoterCount || 0);
  const percent = eligible > 0 ? Math.min(100, ballots / eligible * 100) : 0;
  if (els.activeElectionCount) els.activeElectionCount.textContent = electionId ? "01" : "00";
  if (els.candidateCount) els.candidateCount.textContent = String(candidates.length);
  if (els.votesCastCount) els.votesCastCount.textContent = String(ballots);
  if (els.turnoutPercent) els.turnoutPercent.textContent = `${percent.toFixed(1)}%`;
  if (els.turnoutProgressLabel) els.turnoutProgressLabel.textContent = `${ballots} / ${eligible}`;
  if (els.turnoutBar) { els.turnoutBar.style.width = `${percent}%`; els.turnoutBar.textContent = `${percent.toFixed(1)}%`; }
  // Deliberately suppress live candidate totals for ordinary officers.
  if (els.presidentAnalytics) els.presidentAnalytics.innerHTML = `<div class="note-box"><strong>Candidate totals protected</strong><p>${context?.lifecycle === "Voting" ? "Voting is active. Only turnout and system health are shown." : "Candidate tallies are available only to an authorized canvasser after finalization."}</p></div>`;
  if (els.viceAnalytics) els.viceAnalytics.innerHTML = `<div class="note-box"><strong>Secret-ballot administration</strong><p>The officer dashboard never displays which student selected which candidate.</p></div>`;
  if (els.electionResultsBody) els.electionResultsBody.innerHTML = `<tr><td colspan="5">${context?.resultsVisible ? "Official published results are available through the secure results record." : "Candidate-level results are not published yet."}</td></tr>`;
}

function renderApplications() {
  const counts = { approved: 0, pending: 0, rejected: 0 };
  for (const item of applications) {
    const status = clean(item.status).toLowerCase();
    if (status === "approved") counts.approved += 1; else if (status === "rejected") counts.rejected += 1; else counts.pending += 1;
  }
  if (els.candidateApplicationTotal) els.candidateApplicationTotal.textContent = String(applications.length);
  if (els.candidateApprovedTotal) els.candidateApprovedTotal.textContent = String(counts.approved);
  if (els.candidatePendingTotal) els.candidatePendingTotal.textContent = String(counts.pending);
  if (els.candidateRejectedTotal) els.candidateRejectedTotal.textContent = String(counts.rejected);
  if (!els.candidateReviewList) return;
  if (!applications.length) { els.candidateReviewList.innerHTML = `<div class="review-empty-state">No candidate applications exist for this election ID.</div>`; return; }
  els.candidateReviewList.innerHTML = applications.map((a) => {
    const canReview = context?.reviewOpen && clean(a.status).toLowerCase() === "under review";
    return `<article class="candidate-review-item"><div class="candidate-review-info"><strong>${esc(a.fullName)}</strong><span>${esc(a.position)}${a.department ? ` · ${esc(a.department)}` : ""}</span><small>${esc(a.studentId)} · ${esc(a.program || "")}</small><b class="candidate-status">${esc(a.status || "Under Review")}</b></div><div class="candidate-review-actions">${a.campaignPhotoPath ? `<button class="mini-btn light" data-private-path="${esc(a.campaignPhotoPath)}">View Private Photo</button>` : ""}${(a.supportingDocumentPaths || []).map((path,index) => `<button class="mini-btn light" data-private-path="${esc(path)}">Document ${index+1}</button>`).join("")}${canReview ? `<button class="mini-btn primary" data-review="approve" data-uid="${esc(a.id)}">Approve</button><button class="mini-btn danger" data-review="reject" data-uid="${esc(a.id)}">Reject</button>` : ""}</div></article>`;
  }).join("");
  els.candidateReviewList.querySelectorAll("[data-private-path]").forEach((btn) => btn.addEventListener("click", () => openPrivateFile(btn.dataset.privatePath).catch((e) => alert(e.message))));
  els.candidateReviewList.querySelectorAll("[data-review]").forEach((btn) => btn.addEventListener("click", async () => {
    const decision = btn.dataset.review;
    const note = prompt(`${decision === "approve" ? "Approval" : "Rejection"} note (optional):`) || "";
    btn.disabled = true;
    try {
      await callSecure("reviewCandidateApplication", { applicantUid: btn.dataset.uid, decision, reviewNote: note });
      await refreshAll();
    } catch (error) { alert(error.message); btn.disabled = false; }
  }));
}

function schedulePayload() {
  const schedule = {};
  for (const [field,input] of Object.entries(scheduleInputs)) {
    if (!input?.value) throw new Error(`Please complete ${field}.`);
    schedule[field] = new Date(input.value).toISOString();
  }
  return schedule;
}

async function saveSchedule() {
  els.saveElectionSettingsBtn.disabled = true;
  msg("Saving through trusted server validation...");
  try {
    const id = clean($("electionIdInput")?.value).toLowerCase();
    const result = await callSecure("saveElectionSchedule", { electionId: id, title: clean(els.electionTitleInput?.value) || "USC General Election", schedule: schedulePayload() });
    electionId = result.electionId;

msg(
  `Election ${result.electionId} saved. Lifecycle: ${result.lifecycle}.`,
  "success"
);

/*
 * It is safe to reload Firebase values now because
 * the officer intentionally saved the form.
 */
scheduleFormDirty = false;

await refreshAll(true);
  } catch (error) { msg(error.message || "Unable to save schedule.", "error"); }
  finally { els.saveElectionSettingsBtn.disabled = Boolean(context && context.lifecycle !== "Draft"); }
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i=0;i<text.length;i++) {
    const c=text[i], n=text[i+1];
    if (c==='"' && quoted && n==='"') { cell+='"'; i++; continue; }
    if (c==='"') { quoted=!quoted; continue; }
    if (c===',' && !quoted) { row.push(cell); cell=""; continue; }
    if ((c==='\n' || c==='\r') && !quoted) { if (c==='\r' && n==='\n') i++; row.push(cell); cell=""; if (row.some((v)=>v.trim())) rows.push(row); row=[]; continue; }
    cell+=c;
  }
  if (cell || row.length) { row.push(cell); if (row.some((v)=>v.trim())) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h)=>h.trim());
  return rows.slice(1).map((values)=>Object.fromEntries(headers.map((h,i)=>[h,(values[i]||"").trim()])));
}


function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadIssuedCredentials(rows) {
  const header = ["studentId","fullName","institutionalEmail","temporaryPassword"];
  const csv = [header.join(","), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SSU_School_Account_Credentials_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importMasterlist() {
  const input = $("masterlistCsvInput"), message = $("masterlistImportMessage"), button = $("importMasterlistBtn");
  const file = input?.files?.[0];
  if (!file) return message.textContent = "Choose a CSV file first.";
  if (!electionId) return message.textContent = "Create/save the election schedule before importing its voter roster.";
  button.disabled = true;
  try {
    const rows = parseCsv(await file.text());
    if (!rows.length) throw new Error("CSV has no data rows.");
    const ids = rows.map((row) => clean(row.studentId));
    const duplicateIds = [...new Set(ids.filter((id, index) => id && ids.indexOf(id) !== index))];
    if (duplicateIds.length) throw new Error(`Duplicate Student ID(s) found in the CSV: ${duplicateIds.slice(0, 8).join(", ")}${duplicateIds.length > 8 ? "…" : ""}`);
    const started = await callSecure("startVoterRosterImport", { electionId });
    const importId = started.importId;
    let imported=0;
    for (let i=0;i<rows.length;i+=200) {
      const result = await callSecure("importVoterMasterlist", { electionId, importId, rows: rows.slice(i,i+200) });
      imported += result.imported;
      message.textContent = `Secure import ${importId}: ${imported} of ${rows.length} rows staged...`;
    }
    const finalized = await callSecure("finalizeVoterRosterImport", { electionId, importId });
    message.textContent = `Roster finalized. Provisioning school login accounts...`;
    const issuedCredentials = [];
    let provisioned = 0;
    let newlyIssued = 0;
    for (let i=0;i<rows.length;i+=100) {
      const provision = await callSecure("provisionSchoolAccounts", { rows: rows.slice(i,i+100) });
      provisioned += Number(provision.processed || 0);
      newlyIssued += Number(provision.created || 0);
      if (Array.isArray(provision.credentials)) issuedCredentials.push(...provision.credentials);
      message.textContent = `School accounts: ${provisioned} of ${rows.length} synchronized...`;
    }
    if (issuedCredentials.length) downloadIssuedCredentials(issuedCredentials);
    message.textContent = `Completed: ${finalized.rows} roster rows, ${finalized.eligibleVoterCount} eligible voters, ${provisioned} school accounts synchronized, ${newlyIssued} new/default passwords issued.${issuedCredentials.length ? " A private credential CSV was downloaded for distribution." : ""}`;
    await refreshAll();
  } catch (error) { message.textContent = error.message || "Masterlist import failed."; }
  finally { button.disabled = false; }
}

async function emergencyScheduleUpdate() {
  const reason = clean($("emergencyScheduleReason")?.value);
  if (reason.length < 15) return alert("Enter a specific emergency-change reason of at least 15 characters.");
  if (!confirm("Apply this emergency schedule change? The action will be permanently audited.")) return;
  const button = $("emergencyScheduleBtn");
  button.disabled = true;
  try {
    const result = await callSecure("emergencyUpdateElectionSchedule", {
      electionId,
      title: clean(els.electionTitleInput?.value) || context?.title || "USC Election",
      reason,
      schedule: schedulePayload()
    });
    $("lifecycleActionMessage").textContent = `Emergency schedule update recorded for ${result.electionId}. Lifecycle: ${result.lifecycle}.`;
    $("emergencyScheduleReason").value = "";
    await refreshAll();
  } catch (error) {
    $("lifecycleActionMessage").textContent = error.message || "Emergency schedule update failed.";
  } finally { button.disabled = false; }
}

async function lifecycleAction(name) {
  const el = $("lifecycleActionMessage");
  try {
    const result = await callSecure(name);
    el.textContent = `${name}: completed for ${result.electionId || electionId}.`;
    await refreshAll();
  } catch (error) { el.textContent = error.message || `${name} failed.`; }
}

async function showTallies() {
  if (!electionId) return;
  const canCanvass = trustedClaims.role === "admin" || trustedClaims.canvasser === true;
  if (!canCanvass || !["Canvassing","Results Published","Archived"].includes(context?.lifecycle)) return alert("Candidate-level tallies are restricted to authorized canvassing personnel after finalization.");
  try {
    const official = await getDoc(doc(db, "elections", electionId, "results", "official"));
    if (official.exists() && Array.isArray(official.data().results)) {
      const rows = official.data().results;
      return alert(rows.map((r)=>`${r.position}: ${r.fullName} — ${Number(r.votes||0)}`).join("\n") || "No tallies recorded.");
    }
    const [ballots, candidateSnap] = await Promise.all([
      getDocs(collection(db, "elections", electionId, "ballots")),
      getDocs(collection(db, "elections", electionId, "candidates"))
    ]);
    const counts = new Map();
    ballots.forEach((d)=>Object.values(d.data().selections||{}).forEach((id)=>counts.set(String(id),(counts.get(String(id))||0)+1)));
    const rows = candidateSnap.docs.filter((d)=>d.data().approved===true).map((d)=>({ ...d.data(), id:d.id, votes:counts.get(d.id)||0 })).sort((a,b)=>clean(a.position).localeCompare(clean(b.position)) || Number(b.votes||0)-Number(a.votes||0));
    alert(rows.map((r)=>`${r.position}: ${r.fullName} — ${Number(r.votes||0)}`).join("\n") || "No tallies recorded.");
  } catch (error) { alert(error.message || "Tallies are not available."); }
}

function exportSummary() {
  const safe = {
    electionId,
    title: context?.title || "USC Election",
    lifecycle: context?.lifecycle || "Unavailable",
    ballotsCast: Number(turnout.ballotsCast || 0),
    eligibleVoters: Number(turnout.eligibleVoters || context?.eligibleVoterCount || 0),
    candidateCount: candidates.length,
    generatedAt: new Date().toISOString(),
    note: "This administrative export intentionally excludes voter identities, ballot selections, and unpublished candidate tallies."
  };
  callSecure("recordAdminAuditAction", { action: "ADMIN_EXPORT", target: `${electionId || "usc-election"}-turnout-summary.json`, details: { electionId, lifecycle: context?.lifecycle || "Unavailable", exportType: "turnout-summary" } })
    .catch((error) => console.warn("Unable to record export audit event:", error));
  const blob = new Blob([JSON.stringify(safe,null,2)], {type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`${electionId || "usc-election"}-turnout-summary.json`; a.click(); URL.revokeObjectURL(a.href);
}

async function refreshAll(forceSchedule = false) {

  await loadContext();
  await loadData();

  const masterlistCard = $("masterlistImportCard");

  if (masterlistCard) {
    masterlistCard.hidden =
      trustedClaims.role !== "admin";
  }

  const emergencyControls =
    $("emergencyScheduleControls");

  if (emergencyControls) {

    emergencyControls.hidden =
      trustedClaims.role !== "admin" ||
      !context ||
      context.lifecycle === "Draft" ||
      [
        "Canvassing",
        "Results Published",
        "Archived"
      ].includes(context.lifecycle);
  }


  /*
   * Refresh the schedule from Firebase only when the officer
   * hasn't started editing, unless explicitly forced.
   */
  fillSchedule(forceSchedule);


  renderStats();
  renderApplications();


  if (els.saveElectionSettingsBtn) {

    els.saveElectionSettingsBtn.disabled =
      Boolean(
        context &&
        context.lifecycle !== "Draft"
      );
  }


  const finalize = $("finalizeElectionBtn");
  const publish = $("publishResultsBtn");
  const archive = $("archiveElectionBtn");

  const canCanvass =
    trustedClaims.role === "admin" ||
    trustedClaims.canvasser === true;


  if (finalize) {

    finalize.disabled =
      !canCanvass ||
      !context ||
      ![
        "Voting Closed",
        "Canvassing"
      ].includes(context.lifecycle);
  }


  if (publish) {

    publish.disabled =
      !canCanvass ||
      context?.lifecycle !== "Canvassing";
  }


  if (archive) {

    archive.disabled =
      trustedClaims.role !== "admin" ||
      context?.lifecycle !== "Results Published";
  }
}

installHardeningPanels();
/* =========================================================
   PROTECT UNSAVED ELECTION SCHEDULE
   ========================================================= */

[
  els.electionTitleInput,
  $("electionIdInput"),
  ...Object.values(scheduleInputs)
]
.filter(Boolean)
.forEach((input) => {

  input.addEventListener(
    "input",
    markScheduleDirty
  );

  input.addEventListener(
    "change",
    markScheduleDirty
  );

});
{
  const tokenClaims = (await auth.currentUser?.getIdTokenResult(true))?.claims || {};
  const profileSnap = auth.currentUser ? await getDoc(doc(db, "users", auth.currentUser.uid)).catch(() => null) : null;
  const profile = profileSnap?.exists?.() ? profileSnap.data() : {};
  trustedClaims = {
    ...tokenClaims,
    role: String(tokenClaims.role || profile.role || "").toLowerCase(),
    canvasser: tokenClaims.canvasser === true || profile.canvasser === true
  };
}
els.saveElectionSettingsBtn?.addEventListener("click", saveSchedule);
$("importMasterlistBtn")?.addEventListener("click", importMasterlist);
$("finalizeElectionBtn")?.addEventListener("click", () => lifecycleAction("finalizeElection"));
$("publishResultsBtn")?.addEventListener("click", () => lifecycleAction("publishElectionResults"));
$("archiveElectionBtn")?.addEventListener("click", () => lifecycleAction("archiveElection"));
$("emergencyScheduleBtn")?.addEventListener("click", emergencyScheduleUpdate);
els.viewFullTallyBtn?.addEventListener("click", showTallies);
els.exportSummaryBtn?.addEventListener("click", exportSummary);
$("openScheduleManagerBtn")?.addEventListener("click", () => document.getElementById("scheduleManagementCard")?.scrollIntoView({behavior:"smooth",block:"start"}));
$("scrollToCandidateReviewBtn")?.addEventListener("click", () => document.getElementById("candidateReviewCard")?.scrollIntoView({behavior:"smooth",block:"start"}));
await refreshAll();
setInterval(() => refreshAll().catch(console.error), 30000);

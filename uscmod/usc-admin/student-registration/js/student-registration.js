import { SSU_PROGRAMS, isValidSsuProgram } from "./ssu-programs.js";
import { provisionStudentAccount, sendStudentPasswordReset } from "../../../shared/browser-provisioning.js";
import { enrollmentStatusForStanding, isActiveStudentStanding, studentStandingLabel } from "../../../shared/student-standing.js";

const form = document.getElementById("studentForm");
const slipSection = document.getElementById("slipSection");
const slip = document.getElementById("slip");
const bridgeStatus = document.getElementById("bridgeStatus");
const createBtn = document.getElementById("createBtn");
const resetBtn = document.getElementById("resetBtn");
const resetIdentifier = document.getElementById("resetIdentifier");
const collegeSelect = document.getElementById("college");
const programSelect = document.getElementById("program");
const yearLevelSelect = document.getElementById("yearLevel");
const standingSelect = document.getElementById("studentStanding");
const standingHint = document.getElementById("standingHint");
const eligibilitySelect = document.getElementById("eligibility");
let currentCredential = null;
let currentSlipTitle = "STUDENT ACCOUNT INFORMATION";

function esc(v){return String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}

function populateColleges(){
  Object.keys(SSU_PROGRAMS).forEach(college=>{
    const option=document.createElement("option");
    option.value=college;
    option.textContent=college;
    collegeSelect.appendChild(option);
  });
}
function populatePrograms(){
  const college=collegeSelect.value;
  programSelect.innerHTML="";
  const first=document.createElement("option");
  first.value="";
  first.textContent=college?"Select program":"Select college/campus first";
  programSelect.appendChild(first);
  const programs=SSU_PROGRAMS[college]||[];
  programs.forEach(program=>{
    const option=document.createElement("option");
    option.value=program;
    option.textContent=program;
    programSelect.appendChild(option);
  });
  programSelect.disabled=!college;
}

function showRuntimeReady(){
  if (!bridgeStatus) return;
  bridgeStatus.textContent = "Student account provisioning is ready.";
  bridgeStatus.className = "status-box ok";
}
function syncStandingControls(){
  const standing = standingSelect?.value || "active";
  const active = isActiveStudentStanding(standing);
  if (eligibilitySelect) {
    if (!active) eligibilitySelect.value = "false";
    eligibilitySelect.disabled = !active;
  }
  if (standingHint) {
    standingHint.textContent = active
      ? "Active students may access the portal. Election eligibility is controlled separately below."
      : `${studentStandingLabel(standing)} accounts are inactive: portal access and voting are automatically disabled.`;
  }
}
function credentialRows(c){
  return `
    <span>Student Name</span><span class="credential-value">${esc(c.fullName||"")}</span>
    <span>Student ID</span><span class="credential-value">${esc(c.studentId||"")}</span>
    <span>Institutional Email</span><span class="credential-value">${esc(c.institutionalEmail||"")}</span>
    <span>College / Campus</span><span class="credential-value">${esc(c.college||"")}</span>
    <span>Program</span><span class="credential-value">${esc(c.program||"")}</span>
    <span>Year Level</span><span class="credential-value">${esc(c.yearLevel||"")}</span>
    <span>Student Standing</span><span class="credential-value">${esc(c.studentStandingLabel||c.studentStanding||"")}</span>
    <span>Login Username</span><span class="credential-value">${esc(c.studentId||c.institutionalEmail||"")}</span>
    <span>Temporary Password</span><span class="credential-value temp-password">${esc(c.temporaryPassword||"Existing password unchanged")}</span>`;
}
function renderSlip(c,title="STUDENT ACCOUNT INFORMATION"){
  currentCredential={...c};
  currentSlipTitle=title;
  slipSection.hidden=false;
  const active = isActiveStudentStanding(c.studentStanding);
  const notice = active
    ? "Keep this information private. The student may change the temporary password after signing in."
    : `This account is currently inactive because the recorded student standing is ${studentStandingLabel(c.studentStanding)}. Portal access and voting are disabled until an administrator restores Active / Enrolled standing.`;
  slip.innerHTML=`<article class="login-slip"><div class="header"><h2>SSU UNIVERSITY STUDENT COUNCIL</h2><strong>${esc(title)}</strong></div><div class="credential-grid">${credentialRows(c)}</div><div class="notice"><strong>Important:</strong> ${esc(notice)}</div></article>`;
}
function safeFilenamePart(value){
  return String(value||"").trim().replace(/[^a-z0-9_-]+/gi,"_").replace(/^_+|_+$/g,"").slice(0,60)||"student";
}
function buildDownloadableSlip(c,title){
  const active = isActiveStudentStanding(c.studentStanding);
  const accessNotice = active ? "Keep this information private. Change the password after signing in." : `This account is inactive because the recorded student standing is ${studentStandingLabel(c.studentStanding)}. Portal access and voting are disabled.`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
  body{font-family:Arial,sans-serif;background:#f4f6f9;color:#111;margin:0;padding:30px}.slip{max-width:720px;margin:auto;background:#fff;border:2px solid #122a50;padding:30px}.header{text-align:center;border-bottom:2px solid #122a50;padding-bottom:14px;margin-bottom:20px}.header h1{font-size:22px;margin:0 0 6px}.grid{display:grid;grid-template-columns:190px 1fr;gap:10px 14px}.value{font-weight:700;word-break:break-word}.password{font-family:Consolas,monospace;font-size:22px;letter-spacing:1px}.notice{margin-top:22px;padding:12px;border:1px dashed #666}.actions{text-align:center;margin:20px}.actions button{padding:10px 18px;font-weight:700}@media print{body{background:#fff;padding:0}.slip{max-width:none;min-height:88vh}.actions{display:none}}@media(max-width:600px){.grid{grid-template-columns:1fr}}
  </style></head><body><article class="slip"><div class="header"><h1>SSU UNIVERSITY STUDENT COUNCIL</h1><strong>${esc(title)}</strong></div><div class="grid">
  <span>Student Name</span><span class="value">${esc(c.fullName||"")}</span><span>Student ID</span><span class="value">${esc(c.studentId||"")}</span><span>Institutional Email</span><span class="value">${esc(c.institutionalEmail||"")}</span><span>College / Campus</span><span class="value">${esc(c.college||"")}</span><span>Program</span><span class="value">${esc(c.program||"")}</span><span>Year Level</span><span class="value">${esc(c.yearLevel||"")}</span><span>Student Standing</span><span class="value">${esc(c.studentStandingLabel||c.studentStanding||"")}</span><span>Login Username</span><span class="value">${esc(c.studentId||c.institutionalEmail||"")}</span><span>Temporary Password</span><span class="value password">${esc(c.temporaryPassword||"Existing password unchanged")}</span></div><div class="notice"><strong>Important:</strong> ${esc(accessNotice)} Use the institutional email password-reset flow if the password is forgotten.</div></article><div class="actions"><button onclick="window.print()">Print This Slip</button></div></body></html>`;
}
function downloadSlip(){
  if(!currentCredential)return alert("Create a student account first.");
  const html=buildDownloadableSlip(currentCredential,currentSlipTitle);
  const blob=new Blob([html],{type:"text/html;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`SSU_Login_${safeFilenamePart(currentCredential.studentId)}_${safeFilenamePart(currentCredential.fullName)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

form?.addEventListener("submit",async(e)=>{
  e.preventDefault();
  const college=collegeSelect.value;
  const program=programSelect.value;
  if(!isValidSsuProgram(college,program))return alert("Select a valid Samar State University college/campus and program.");
  const row={
    studentId:document.getElementById("studentId").value,
    fullName:document.getElementById("name").value,
    institutionalEmail:document.getElementById("email").value,
    program,
    college,
    yearLevel:yearLevelSelect.value,
    studentStanding:standingSelect.value,
    enrollmentStatus:enrollmentStatusForStanding(standingSelect.value),
    eligible:eligibilitySelect.value==="true"
  };
  createBtn.disabled=true;
  createBtn.textContent="Creating...";
  try{
    const result=await provisionStudentAccount(row);
    renderSlip(result.credential);
  }catch(err){
    console.error("Student account creation failed:", err);
    alert(err.message || "Student account creation failed.");
  }
  finally{createBtn.disabled=false;createBtn.textContent="Create Student Account";}
});
resetBtn?.addEventListener("click",async()=>{
  const identifier=resetIdentifier.value.trim();
  if(!identifier)return alert("Enter a Student ID or institutional email.");
  resetBtn.disabled=true;
  resetBtn.textContent="Sending...";
  try{
    const result=await sendStudentPasswordReset(identifier);
    alert(`A Firebase password-reset link was sent to ${result.email}. The student can choose a new password without administrator command-line tools.`);
  }catch(err){
    console.error("Student account creation failed:", err);
    alert(err.message || "Student account creation failed.");
  }
  finally{resetBtn.disabled=false;resetBtn.textContent="Send Password Reset Link";}
});
document.getElementById("printSlipBtn")?.addEventListener("click",()=>window.print());
document.getElementById("downloadSlipBtn")?.addEventListener("click",downloadSlip);
document.getElementById("clearSlipBtn")?.addEventListener("click",()=>{slipSection.hidden=true;slip.innerHTML="";currentCredential=null;});
document.getElementById("studentId")?.addEventListener("input",e=>{e.target.value=e.target.value.replace(/\D/g,"").slice(0,6);});
collegeSelect?.addEventListener("change",populatePrograms);
standingSelect?.addEventListener("change", syncStandingControls);
populateColleges();
populatePrograms();
syncStandingControls();
showRuntimeReady();

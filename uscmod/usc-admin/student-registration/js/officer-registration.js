import { SSU_PROGRAMS, isValidSsuProgram } from "./ssu-programs.js";
import { provisionOfficerAccount, sendSchoolPasswordReset } from "../../../shared/browser-provisioning.js";
import { enrollmentStatusForStanding, isActiveStudentStanding, studentStandingLabel } from "../../../shared/student-standing.js";

const form = document.getElementById("officerForm");
const collegeSelect = document.getElementById("officerCollege");
const programSelect = document.getElementById("officerProgram");
const effectiveDate = document.getElementById("officerEffectiveDate");
const yearLevelSelect = document.getElementById("officerYearLevel");
const standingSelect = document.getElementById("officerStudentStanding");
const eligibilitySelect = document.getElementById("officerEligibility");
const createBtn = document.getElementById("createOfficerBtn");
const slipSection = document.getElementById("officerSlipSection");
const slip = document.getElementById("officerSlip");
const resetBtn = document.getElementById("officerResetBtn");
const resetIdentifier = document.getElementById("officerResetIdentifier");
let currentCredential = null;

function esc(v){return String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
function safeFilenamePart(value){return String(value||"").trim().replace(/[^a-z0-9_-]+/gi,"_").replace(/^_+|_+$/g,"").slice(0,60)||"officer";}

function populateColleges(){
  Object.keys(SSU_PROGRAMS).forEach(college=>{
    const option=document.createElement("option"); option.value=college; option.textContent=college; collegeSelect.appendChild(option);
  });
}
function populatePrograms(){
  const college=collegeSelect.value;
  programSelect.innerHTML=`<option value="">${college?"Select program":"Select college/campus first"}</option>`;
  (SSU_PROGRAMS[college]||[]).forEach(program=>{
    const option=document.createElement("option"); option.value=program; option.textContent=program; programSelect.appendChild(option);
  });
  programSelect.disabled=!college;
}

function credentialRows(c){
  return `<span>Officer Name</span><span class="credential-value">${esc(c.fullName||"")}</span>
    <span>Student ID</span><span class="credential-value">${esc(c.studentId||"")}</span>
    <span>Institutional Email</span><span class="credential-value">${esc(c.institutionalEmail||"")}</span>
    <span>USC Position</span><span class="credential-value">${esc(c.officePosition||"")}</span>
    <span>College / Campus</span><span class="credential-value">${esc(c.college||"")}</span>
    <span>Program</span><span class="credential-value">${esc(c.program||"")}</span>
    <span>Year Level</span><span class="credential-value">${esc(c.yearLevel||"")}</span>
    <span>Student Standing</span><span class="credential-value">${esc(c.studentStandingLabel||c.studentStanding||"")}</span>
    <span>Effective Date</span><span class="credential-value">${esc(c.roleEffectiveDate||"")}</span>
    <span>Login Username</span><span class="credential-value">${esc(c.studentId||c.institutionalEmail||"")}</span>
    <span>Temporary Password</span><span class="credential-value temp-password">${esc(c.temporaryPassword||"")}</span>`;
}
function renderSlip(c){
  currentCredential={...c};
  slipSection.hidden=false;
  const active=isActiveStudentStanding(c.studentStanding);
  const emailNotice=!active
    ? `This officer account is inactive because the recorded student standing is ${studentStandingLabel(c.studentStanding)}. Portal access and voting are disabled.`
    : c.verificationEmailSent
      ? "A verification link was also sent to the institutional email for account recovery/contact verification. Officer dashboard access is controlled by the school-issued account status and assigned officer role."
      : "Officer dashboard access is controlled by the school-issued account status and assigned officer role. Email verification is optional and does not block login.";
  slip.innerHTML=`<article class="login-slip"><div class="header"><h2>SSU UNIVERSITY STUDENT COUNCIL</h2><strong>OFFICER ACCOUNT INFORMATION</strong></div><div class="credential-grid">${credentialRows(c)}</div><div class="notice"><strong>Important:</strong> Keep this information private. ${esc(emailNotice)} The officer may change the temporary password after signing in.</div></article>`;
}
function buildDownloadableSlip(c){
  const notice=c.verificationEmailSent?"A verification link was sent to the institutional email for recovery/contact verification. It is not required for officer dashboard access.":"Email verification is optional. Officer access is controlled by the school-issued account and assigned officer role.";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Officer Login Information</title><style>body{font-family:Arial,sans-serif;background:#f4f6f9;color:#111;margin:0;padding:30px}.slip{max-width:720px;margin:auto;background:#fff;border:2px solid #122a50;padding:30px}.header{text-align:center;border-bottom:2px solid #122a50;padding-bottom:14px;margin-bottom:20px}.header h1{font-size:22px;margin:0 0 6px}.grid{display:grid;grid-template-columns:190px 1fr;gap:10px 14px}.value{font-weight:700;word-break:break-word}.password{font-family:Consolas,monospace;font-size:22px;letter-spacing:1px}.notice{margin-top:22px;padding:12px;border:1px dashed #666}.actions{text-align:center;margin:20px}.actions button{padding:10px 18px;font-weight:700}@media print{body{background:#fff;padding:0}.slip{max-width:none;min-height:88vh}.actions{display:none}}@media(max-width:600px){.grid{grid-template-columns:1fr}}</style></head><body><article class="slip"><div class="header"><h1>SSU UNIVERSITY STUDENT COUNCIL</h1><strong>OFFICER ACCOUNT INFORMATION</strong></div><div class="grid"><span>Officer Name</span><span class="value">${esc(c.fullName||"")}</span><span>Student ID</span><span class="value">${esc(c.studentId||"")}</span><span>Institutional Email</span><span class="value">${esc(c.institutionalEmail||"")}</span><span>USC Position</span><span class="value">${esc(c.officePosition||"")}</span><span>College / Campus</span><span class="value">${esc(c.college||"")}</span><span>Program</span><span class="value">${esc(c.program||"")}</span><span>Year Level</span><span class="value">${esc(c.yearLevel||"")}</span><span>Student Standing</span><span class="value">${esc(c.studentStandingLabel||c.studentStanding||"")}</span><span>Effective Date</span><span class="value">${esc(c.roleEffectiveDate||"")}</span><span>Login Username</span><span class="value">${esc(c.studentId||c.institutionalEmail||"")}</span><span>Temporary Password</span><span class="value password">${esc(c.temporaryPassword||"")}</span></div><div class="notice"><strong>Important:</strong> ${esc(notice)} Keep the temporary password private and change it after first login.</div></article><div class="actions"><button onclick="window.print()">Print This Slip</button></div></body></html>`;
}
function downloadSlip(){
  if(!currentCredential)return alert("Create an officer account first.");
  const blob=new Blob([buildDownloadableSlip(currentCredential)],{type:"text/html;charset=utf-8"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url;
  a.download=`SSU_Officer_Login_${safeFilenamePart(currentCredential.studentId)}_${safeFilenamePart(currentCredential.fullName)}.html`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

form?.addEventListener("submit",async(e)=>{
  e.preventDefault();
  const college=collegeSelect.value, program=programSelect.value;
  if(!isValidSsuProgram(college,program))return alert("Select a valid Samar State University college/campus and program.");
  createBtn.disabled=true; createBtn.textContent="Creating Officer...";
  try{
    const result=await provisionOfficerAccount({
      studentId:document.getElementById("officerStudentId").value,
      fullName:document.getElementById("officerName").value,
      institutionalEmail:document.getElementById("officerEmail").value,
      officePosition:document.getElementById("officerPosition").value,
      college, program,
      yearLevel:yearLevelSelect.value,
      studentStanding:standingSelect.value,
      enrollmentStatus:enrollmentStatusForStanding(standingSelect.value),
      eligible:eligibilitySelect.value==="true",
      roleEffectiveDate:effectiveDate.value
    });
    renderSlip(result.credential);
    if(!result.verificationEmailSent) console.info("Officer account created. Optional email verification message was not sent.");
  }catch(err){alert(err.message||"Officer account creation failed.");}
  finally{createBtn.disabled=false;createBtn.textContent="Create Officer Account";}
});
resetBtn?.addEventListener("click",async()=>{
  const identifier=resetIdentifier.value.trim(); if(!identifier)return alert("Enter a Student ID or institutional email.");
  resetBtn.disabled=true; resetBtn.textContent="Sending...";
  try{const result=await sendSchoolPasswordReset(identifier);alert(`A password-reset link was sent to ${result.email}.`);}catch(err){alert(err.message||"Password reset failed.");}
  finally{resetBtn.disabled=false;resetBtn.textContent="Send Password Reset Link";}
});
document.getElementById("printOfficerSlipBtn")?.addEventListener("click",()=>window.print());
document.getElementById("downloadOfficerSlipBtn")?.addEventListener("click",downloadSlip);
document.getElementById("clearOfficerSlipBtn")?.addEventListener("click",()=>{slipSection.hidden=true;slip.innerHTML="";currentCredential=null;});
document.getElementById("officerStudentId")?.addEventListener("input",e=>{e.target.value=e.target.value.replace(/\D/g,"").slice(0,6);});
collegeSelect?.addEventListener("change",populatePrograms);
standingSelect?.addEventListener("change",()=>{
  const active=isActiveStudentStanding(standingSelect.value);
  if(!active) eligibilitySelect.value="false";
  eligibilitySelect.disabled=!active;
});
populateColleges(); populatePrograms(); effectiveDate.value=new Date().toISOString().slice(0,10);
standingSelect?.dispatchEvent(new Event("change"));

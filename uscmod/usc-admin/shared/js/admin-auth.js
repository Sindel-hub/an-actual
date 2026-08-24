import { auth, db } from "../../../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const LOGIN_PAGE = "../../index/index.html";
const ADMIN_DASHBOARD_PAGE = "../admin-dashboard/admin-dashboard.html";
let unsubscribe = null;
let redirecting = false;

function normalizeProfile(raw = {}, user = null, claims = {}) {
  const claimRole = String(claims.role || "").toLowerCase();
  const profileRole = String(raw.role || "").toLowerCase();
  const role = claimRole === "admin" ? "admin" : profileRole;
  return {
    uid: user?.uid || raw.uid || "",
    fullName: String(raw.fullName || "").trim(),
    email: user?.email || raw.email || "",
    studentId: String(raw.studentId || "").trim(),
    profilePhoto: String(raw.profilePhoto || "").trim(),
    role,
    isActive: raw.isActive !== false,
    accountStatus: String(raw.accountStatus || "pending").toLowerCase(),
    officePosition: role === "admin" ? (String(raw.officePosition || "").trim() || "System Administrator") : String(raw.officePosition || "").trim()
  };
}
function save(profile) { sessionStorage.setItem("activeSession","true"); sessionStorage.setItem("studentProfile",JSON.stringify(profile)); }
function clear() { ["activeSession","studentProfile","sessionExpiresAt","lastActivityAt"].forEach(k=>sessionStorage.removeItem(k)); }
function labels(profile) {
  const name=profile.fullName||profile.email||"USC Officer";
  document.querySelectorAll("[data-admin-name],#adminName,.admin-name").forEach(el=>el.textContent=name);
  document.querySelectorAll("[data-admin-role],#adminRole,.admin-role").forEach(el=>el.textContent=profile.officePosition||(profile.role==="admin"?"System Administrator":"USC Officer"));
  document.querySelectorAll("[data-usc-welcome-role]").forEach(el=>el.textContent=profile.officePosition||(profile.role==="admin"?"System Administrator":"USC Officer"));
  document.querySelectorAll("[data-usc-welcome-name]").forEach(el=>el.textContent=name);
}
async function fail(message) {
  if(redirecting)return; redirecting=true; unsubscribe?.(); clear();
  try{await signOut(auth);}catch{}
  if(message)alert(message); location.replace(LOGIN_PAGE);
}
async function verify(user) {
  const token=await user.getIdTokenResult(true);
  const claimRole=String(token.claims.role||"").toLowerCase();
  if(claimRole==="admin"){location.replace(ADMIN_DASHBOARD_PAGE);return;}
  const snap=await getDoc(doc(db,"users",user.uid));
  if(!snap.exists())return fail("Officer profile not found.");
  const profile=normalizeProfile(snap.data(),user,token.claims);
  if(profile.role!=="officer")return fail("This school account is not assigned an officer role.");
  if(profile.isActive===false||profile.accountStatus!=="approved")return fail("Officer access is not approved or is inactive.");
  save(profile); labels(profile);
  unsubscribe?.();
  unsubscribe=onSnapshot(doc(db,"users",user.uid),s=>{if(!s.exists())return fail("Officer profile removed.");const next=normalizeProfile(s.data(),user,token.claims);if(next.role!=="officer")return fail("This account is no longer assigned an officer role.");if(next.isActive===false||next.accountStatus!=="approved")return fail("Officer access is no longer approved or active.");save(next);labels(next);},()=>fail("Unable to verify officer access."));
}
onAuthStateChanged(auth,user=>{if(!user)fail("Please sign in as an authorized officer.");else verify(user).catch(error=>{console.error(error);fail("Unable to verify officer access.");});});
window.logoutOfficer=()=>fail("");

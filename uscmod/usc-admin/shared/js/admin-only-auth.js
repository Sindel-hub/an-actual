import { auth, db } from "../../../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const LOGIN_PAGE="../../index/index.html";
const OFFICER_PAGE="../overview/overview.html";
function clear(){["activeSession","studentProfile","sessionExpiresAt","lastActivityAt"].forEach(k=>sessionStorage.removeItem(k));}
function save(profile){sessionStorage.setItem("activeSession","true");sessionStorage.setItem("studentProfile",JSON.stringify(profile));}
function labels(profile){const name=profile.fullName||profile.email||"USC Administrator";document.querySelectorAll("[data-admin-name],#adminName,.admin-name").forEach(el=>el.textContent=name);document.querySelectorAll("[data-admin-role],#adminRole,.admin-role,[data-usc-welcome-role]").forEach(el=>el.textContent="System Administrator");document.querySelectorAll("[data-usc-welcome-name]").forEach(el=>el.textContent=name);}
async function redirect(message,path=LOGIN_PAGE,signout=true){if(signout){clear();try{await signOut(auth);}catch{}}if(message)alert(message);location.replace(path);}
onAuthStateChanged(auth,async user=>{
  if(!user)return redirect("Please sign in as an administrator.");
  // Trusted admin claim + approved admin profile authorize access; email verification is optional.
  try{
    const token=await user.getIdTokenResult(true); const role=String(token.claims.role||"").toLowerCase();
    if(role==="officer")return redirect("This page requires the trusted administrator role.",OFFICER_PAGE,false);
    if(role!=="admin")return redirect("This page requires the trusted administrator role.");
    const snap=await getDoc(doc(db,"users",user.uid)); if(!snap.exists())return redirect("Administrator profile not found.");
    const raw=snap.data(); if(raw.isActive===false||String(raw.accountStatus||"pending").toLowerCase()!=="approved")return redirect("Administrator access is not approved or is inactive.");
    const profile={uid:user.uid,fullName:String(raw.fullName||"").trim(),email:user.email||raw.email||"",profilePhoto:String(raw.profilePhoto||"").trim(),role:"admin",isActive:true,accountStatus:String(raw.accountStatus||"approved"),officePosition:"System Administrator"};
    save(profile);labels(profile);
  }catch(error){console.error(error);return redirect("Unable to verify administrator access.");}
});
window.logoutAdminOnly=()=>redirect("");

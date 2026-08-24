import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault() });
const [,, emailArg, roleArg, canvasserArg="false"] = process.argv;
if (!emailArg || !["admin","officer","student"].includes(String(roleArg).toLowerCase())) {
  console.error("Usage: node scripts/set-user-claims.mjs user@gmail.com admin|officer|student [canvasser=true|false]");
  process.exit(1);
}
const auth=getAuth(), db=getFirestore();
const user=await auth.getUserByEmail(emailArg.trim().toLowerCase());
const existing=user.customClaims||{};
const role=roleArg.toLowerCase();
const canvasser=role==="officer" && String(canvasserArg).toLowerCase()==="true";
await auth.setCustomUserClaims(user.uid,{...existing,role,canvasser,verifiedStudent:role==="student"?existing.verifiedStudent===true:false,adminAuthMode:role==="admin"?"verified_email":null,mfaEnrolled:false});
const profilePatch={role,updatedAt:FieldValue.serverTimestamp()};
if(role==="admin") profilePatch.officePosition="System Administrator";
await db.doc(`users/${user.uid}`).set(profilePatch,{merge:true});
console.log(`Updated trusted claims for ${emailArg}: role=${role}, canvasser=${canvasser}`);

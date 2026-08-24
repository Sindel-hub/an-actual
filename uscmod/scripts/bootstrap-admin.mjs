import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
initializeApp({ credential: applicationDefault() });
const email=String(process.argv[2]||"").trim().toLowerCase();
if(!email){console.error("Usage: node scripts/bootstrap-admin.mjs admin@example.com");process.exit(1);}
const auth=getAuth(), db=getFirestore();
const user=await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid,{...(user.customClaims||{}),role:"admin",canvasser:false,verifiedStudent:false,adminAuthMode:"school_managed",mfaEnrolled:false});
await db.doc(`users/${user.uid}`).set({uid:user.uid,email,role:"admin",officePosition:"System Administrator",accountStatus:"approved",isActive:true,schoolProvisioned:true,updatedAt:FieldValue.serverTimestamp()},{merge:true});
console.log(`Trusted administrator claim assigned to ${email}.`);

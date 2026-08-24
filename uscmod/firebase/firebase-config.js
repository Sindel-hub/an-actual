import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-functions.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app-check.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAVu7wu_1JnWQFNmwWMQHly0JEXjXxnzjA",
  authDomain: "universitystudentcouncil-856cc.firebaseapp.com",
  projectId: "universitystudentcouncil-856cc",
  storageBucket: "universitystudentcouncil-856cc.firebasestorage.app",
  messagingSenderId: "653983268515",
  appId: "1:653983268515:web:e219d9c7d74fdd5077c916"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app, "asia-southeast1");

// Configure this in your hosting page before firebase-config.js loads:
//   window.USC_APP_CHECK_SITE_KEY = "YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY";
// Sensitive Cloud Functions enforce App Check. During local emulator development,
// Firebase's App Check debug token can be enabled intentionally in the browser.
const appCheckSiteKey = String(globalThis.USC_APP_CHECK_SITE_KEY || "").trim();
let appCheck = null;
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN || true;
}
if (appCheckSiteKey && !appCheckSiteKey.includes("YOUR_")) {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}

export { app, db, auth, functions, appCheck };

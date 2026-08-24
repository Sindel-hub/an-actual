/*
 * USC runtime security configuration.
 *
 * Normal operation uses the deployed web application directly.
 *
 * The System Administrator remains protected by the trusted Firebase `admin`
 * custom claim and an approved/active Firestore admin profile. Student accounts
 * are provisioned from the browser by a SECONDARY Firebase Auth instance, so
 * creating a student does not sign the administrator out of the primary app.
 */
globalThis.USC_APP_CHECK_SITE_KEY = "YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY";

globalThis.USC_ADMIN_AUTH_MODE = "school-managed";
globalThis.USC_REQUIRE_ADMIN_TOTP = false;

if (!globalThis.USC_AUTH_READY) {
  let resolveAuthReady;
  globalThis.USC_AUTH_READY = new Promise((resolve) => { resolveAuthReady = resolve; });
  globalThis.USC_RESOLVE_AUTH_READY = resolveAuthReady;
}

// Browser provisioning runtime.
globalThis.USC_FREE_SPARK_MODE = true;

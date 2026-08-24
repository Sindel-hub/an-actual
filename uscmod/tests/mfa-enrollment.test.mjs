import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const login = fs.readFileSync(new URL('../index/js/index.js', import.meta.url), 'utf8');
const guard = fs.readFileSync(new URL('../shared/auth-guard.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../shared/app-config.js', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const adminOnly = fs.readFileSync(new URL('../usc-admin/shared/js/admin-only-auth.js', import.meta.url), 'utf8');
const officerAuth = fs.readFileSync(new URL('../usc-admin/shared/js/admin-auth.js', import.meta.url), 'utf8');

test('administrator mode uses the school-managed account model without authenticator enrollment', () => {
  assert.match(config, /USC_ADMIN_AUTH_MODE = "school-managed"/);
  assert.match(config, /USC_REQUIRE_ADMIN_TOTP = false/);
  assert.doesNotMatch(login, /ensureAdminTotp|generateSecret\(|assertionForEnrollment/);
  assert.doesNotMatch(guard, /mfaEnrolled !== true/);
});

test('privileged access no longer conflates Firebase emailVerified with school verification', () => {
  assert.doesNotMatch(login, /if \(!user\.emailVerified\)/);
  assert.doesNotMatch(guard, /if \(!user\.emailVerified\)/);
  assert.doesNotMatch(adminOnly, /user\.emailVerified/);
  assert.doesNotMatch(officerAuth, /user\?\.emailVerified|user\.emailVerified/);
  assert.doesNotMatch(rules, /request\.auth\.token\.email_verified/);
  assert.match(rules, /function isAdmin\(\).*role\(\) == "admin".*activeProfileRole\("admin"\)/s);
});

test('officer dashboard authorization uses the administrator-controlled Firestore role', () => {
  assert.match(officerAuth, /profile\.role!=="officer"/);
  assert.match(officerAuth, /accountStatus!=="approved"/);
  assert.doesNotMatch(officerAuth, /claimRole!=="officer"/);
});

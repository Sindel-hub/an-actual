import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('public signup is removed and school identifier login is present', () => {
  const html = read('index/index.html');
  const js = read('index/js/index.js');
  assert.doesNotMatch(html, /Create an account|signupForm|Valid Gmail Address/i);
  assert.match(html, /Institutional Email or Student ID/i);
  assert.match(js, /resolveLoginCandidates/);
});

test('trusted backend disables self-registration and provisions school accounts', () => {
  const fn = read('functions/index.js');
  assert.match(fn, /Public account registration is disabled/);
  assert.match(fn, /exports\.provisionSchoolAccounts/);
  assert.match(fn, /school_accounts\/\$\{row\.studentId\}/);
  assert.match(fn, /generateTemporaryPassword/);
});

test('normal portal access and election eligibility are separated', () => {
  const guard = read('shared/auth-guard.js');
  const rules = read('firestore.rules');
  assert.match(guard, /profile\.schoolProvisioned !== true/);
  assert.match(guard, /isElectionProtectedPath\(\)/);
  assert.match(rules, /function schoolStudent\(\)/);
  assert.match(rules, /function verifiedStudent\(\)/);
});

test('profile drawer allows optional password change', () => {
  const profile = read('shared/profile-manager.js');
  assert.match(profile, /updatePassword/);
  assert.match(profile, /uscProfileChangePassword/);
  assert.match(profile, /Change Password/);
});

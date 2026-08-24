import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full)); else out.push(full);
  }
  return out;
}

test('normal runtime has no command-line bridge dependency', () => {
  const files = walk(root);
  assert.equal(files.some((f) => f.toLowerCase().endsWith('.cmd')), false, 'CMD runtime launcher still exists');
  for (const file of files.filter((f) => /\.(js|html|md|json)$/i.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /127\.0\.0\.1:8787|START_FREE_ADMIN_TOOL|free-admin-bridge/i, path.relative(root, file));
  }
});

test('student and officer provisioning use a secondary Firebase Web Auth instance', () => {
  const source = read('shared/browser-provisioning.js');
  assert.match(source, /initializeApp\(firebaseConfig, appName\)/);
  assert.match(source, /getAuth\(provisioningApp\)/);
  assert.match(source, /createUserWithEmailAndPassword\(provisioningAuth/);
  assert.match(source, /writeBatch\(db\)/);
  assert.match(source, /login_aliases/);
  assert.match(source, /provisionOfficerAccount/);
  assert.match(source, /role: "officer"/);
  assert.match(source, /sendEmailVerification/);
});

test('admin authority remains custom-claim protected in Firestore rules', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /function isAdmin\(\).*role\(\) == "admin"/s);
  assert.doesNotMatch(rules, /request\.auth\.token\.email_verified/);
  assert.match(rules, /allow create: if isAdmin\(\)[\s\S]{0,500}?role in \["student", "officer"\]/);
});


test('registration queue uses repaired responsive workspace', () => {
  const html = read('usc-admin/admin-dashboard/queue.html');
  const css = read('usc-admin/admin-dashboard/css/admin-dashboard.css');
  const js = read('usc-admin/admin-dashboard/js/admin-queue.js');
  assert.match(html, /class="queue-workspace"/);
  assert.match(html, /id="queueSearchInput"/);
  assert.match(html, /id="queueFilterSelect"/);
  assert.match(css, /\.queue-workspace\{/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(js, /filteredQueueUsers/);
});

test('student year level and standing are enforced without capstone-mode UI text', () => {
  const studentHtml = read('usc-admin/student-registration/student-registration.html');
  const studentJs = read('usc-admin/student-registration/js/student-registration.js');
  const authGuard = read('shared/auth-guard.js');
  const loginJs = read('index/js/index.js');
  const rules = read('firestore.rules');
  const usersHtml = read('usc-admin/admin-dashboard/users.html');
  const visibleSources = [studentHtml, studentJs, usersHtml, read('usc-admin/student-registration/officer-registration.html')].join('\n');

  assert.doesNotMatch(visibleSources, /capstone browser mode|capstone-ready|no cmd|powershell/i);
  assert.match(studentHtml, /id="yearLevel"/);
  assert.match(studentHtml, /id="studentStanding"/);
  assert.match(studentHtml, /Transferred \/ Changed School/);
  assert.match(studentHtml, /Eliminated \/ Dismissed/);
  assert.match(studentJs, /eligibilitySelect\.disabled = !active/);
  assert.match(authGuard, /isActiveStudentStanding/);
  assert.match(authGuard, /bindProfileAccessWatcher/);
  assert.match(loginJs, /Portal access is disabled because your student standing/);
  assert.match(rules, /request\.resource\.data\.studentStanding in \["active", "leave", "inactive", "graduated", "transferred", "withdrawn", "eliminated"\]/);
  assert.match(rules, /request\.resource\.data\.isActive == \(request\.resource\.data\.studentStanding == "active"\)/);
});

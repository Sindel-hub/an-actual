import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (!ext || full.endsWith(ext)) out.push(full);
  }
  return out;
}

function rel(file) { return path.relative(root, file).replaceAll('\\', '/'); }

const protectedHtml = [
  'complaint/complaint.html',
  'dashboard/bulletin.html',
  'dashboard/dashboard.html',
  'dashboard/election.html',
  'dashboard/events.html',
  'dashboard/handbook.html',
  'dashboard/organizational-chart.html',
  'dashboard/tracklist.html',
  'usc-admin/admin-dashboard/admin-dashboard.html',
  'usc-admin/admin-dashboard/audit.html',
  'usc-admin/admin-dashboard/queue.html',
  'usc-admin/admin-dashboard/users.html',
  'usc-admin/student-registration/student-registration.html',
  'usc-admin/student-registration/officer-registration.html',
  'usc-admin/announcements/announcements.html',
  'usc-admin/complaints/complaints.html',
  'usc-admin/elections/elections.html',
  'usc-admin/events/events.html',
  'usc-admin/organizational-chart/organizational-chart.html',
  'usc-admin/overview/overview.html',
  'voting/voting.html'
];

test('protected pages load the shared fail-closed auth guard', () => {
  for (const file of protectedHtml) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /shared\/app-config\.js/, `${file}: app-config missing`);
    assert.match(html, /shared\/auth-guard\.js/, `${file}: auth guard missing`);
  }
});

test('HTML files contain no duplicate element IDs', () => {
  for (const file of walk(root, '.html')) {
    const html = fs.readFileSync(file, 'utf8');
    const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
    const seen = new Set();
    const dupes = new Set();
    for (const id of ids) seen.has(id) ? dupes.add(id) : seen.add(id);
    assert.deepEqual([...dupes], [], `${rel(file)} duplicate IDs: ${[...dupes].join(', ')}`);
  }
});

test('removed election integrity hazards do not return to application code', () => {
  const appFiles = walk(root).filter(f => /\.(js|html|md|json|sql|rules)$/i.test(f));
  const exclusions = new Set([
    'firestore.rules',
    'SECURITY_DEPLOYMENT_GUIDE.md',
    'tests/SECURITY_TEST_MATRIX.md',
    'tests/firestore.rules.test.mjs',
    'tests/static-project.test.mjs'
  ]);
  for (const file of appFiles) {
    const r = rel(file);
    if (exclusions.has(r)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\bELIGIBLE_VOTERS\s*=\s*1245\b/, `${r}: hard-coded electorate count`);
    assert.doesNotMatch(text, /usc\.admin@gmail\.com/i, `${r}: hard-coded administrator email`);
    assert.doesNotMatch(text, /electionId\s*:\s*["']current["']/, `${r}: legacy electionId current`);
  }
});

test('anonymous ballot payload contains no voter identity or timestamp linkage', () => {
  const source = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8');
  const start = source.indexOf('exports.submitAnonymousBallot');
  assert.ok(start >= 0, 'submitAnonymousBallot callable missing');
  const endCandidates = [
    source.indexOf('\nexports.', start + 10),
    source.indexOf('\nconst ', start + 10)
  ].filter(n => n > start);
  const end = endCandidates.length ? Math.min(...endCandidates) : source.length;
  const block = source.slice(start, end);
  const ballotSet = block.match(/tx\.(?:set|create)\(ballotRef,\s*\{([\s\S]{0,1200}?)\}\s*\)/);
  assert.ok(ballotSet, 'anonymous ballot write block not found');
  const payload = ballotSet[1];
  for (const forbidden of ['studentUid', 'studentId', 'studentName', 'studentEmail', 'college', 'receipt', 'createdAt', 'submittedAt', 'timestamp']) {
    assert.doesNotMatch(payload, new RegExp(`\\b${forbidden}\\b`, 'i'), `ballot payload leaks ${forbidden}`);
  }
  assert.match(payload, /selections\s*:/, 'candidate IDs/selections missing from ballot payload');
});

test('browser ballot rules keep ballot identity-free and legacy votes fail closed', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const match = rules.match(/match \/ballots\/\{ballotId\} \{([\s\S]*?)\n      \}/);
  assert.ok(match, 'browser ballot rule block missing');
  assert.match(match[1], /allow create: if verifiedStudent\(\)/);
  assert.match(match[1], /votingOpenByServer\(electionId\)/);
  assert.match(match[1], /keys\(\)\.hasOnly\(\["selections", "schemaVersion", "recordedAt"\]\)/);
  for (const forbidden of ['studentUid', 'studentEmail', 'studentName', 'receiptReference']) {
    assert.doesNotMatch(match[1], new RegExp(forbidden, 'i'));
  }
  assert.match(rules, /match \/votes\/\{docId\}[\s\S]{0,100}?allow read, write: if false;/);
});

test('Supabase storage separates public media and private student documents', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/storage.sql'), 'utf8');
  assert.match(sql, /usc-public-media/);
  assert.match(sql, /usc-private-documents/);
  assert.match(sql, /public\s*=\s*false/i);
});

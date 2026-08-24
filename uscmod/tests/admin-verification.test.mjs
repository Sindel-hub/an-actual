import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('admin Verify action sends verification state to the secure backend', () => {
  const source = read('usc-admin/admin-dashboard/js/admin-core.js');
  assert.match(source, /isVerifiedStudent:\s*payload\.nextVerified/);
});

test('admin backend writes verification state and trusted claim', () => {
  const source = read('functions/index.js');
  assert.match(source, /isVerifiedStudent:\s*requestedVerifiedStudent/);
  assert.match(source, /verifiedStudent:\s*requestedVerifiedStudent/);
  assert.match(source, /STUDENT_VERIFICATION_CHANGE/);
});

test('development App Check mode is explicit and production-switchable', () => {
  const source = read('functions/index.js');
  assert.match(source, /USC_ENFORCE_APP_CHECK/);
  assert.match(source, /enforceAppCheck/);
});

test('audit payloads tolerate missing optional legacy fields', () => {
  const source = read('functions/index.js');
  assert.match(source, /function auditSafe\(/);
  assert.match(source, /ignoreUndefinedProperties:\s*true/);
  assert.match(source, /adminUpdateUser audit write failed/);
});

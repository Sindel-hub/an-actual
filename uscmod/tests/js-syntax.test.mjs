import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectJs(dir) {
  const out=[];
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full=path.join(dir,entry.name);
    if (entry.isDirectory()) out.push(...collectJs(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('all project JavaScript parses successfully', () => {
  const failures=[];
  for (const file of collectJs(root)) {
    const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    if (result.status !== 0) failures.push(`${path.relative(root,file)}\n${result.stderr}`);
  }
  assert.deepEqual(failures, []);
});

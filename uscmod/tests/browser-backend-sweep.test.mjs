import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function walk(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>{
    const p=path.join(dir,entry.name);
    if (entry.name === "node_modules" || entry.name === "functions") return [];
    return entry.isDirectory()?walk(p):[p];
  });
}

test("browser/Spark runtime has adapters for every callSecure action", () => {
  const files=walk(root).filter((p)=>p.endsWith(".js"));
  const calls=new Set();
  for (const file of files) {
    const text=fs.readFileSync(file,"utf8");
    for (const m of text.matchAll(/callSecure\(["']([^"']+)/g)) calls.add(m[1]);
  }
  const client=fs.readFileSync(path.join(root,"shared/security-client.js"),"utf8");
  for (const name of calls) assert.match(client,new RegExp(`name === [\"']${name}[\"']`),`missing browser adapter for ${name}`);
  assert.doesNotMatch(client,/This feature requires a configured secure backend/i);
});

test("public content uploads bypass Cloud Functions in free mode", () => {
  const client=fs.readFileSync(path.join(root,"shared/security-client.js"),"utf8");
  assert.match(client,/USC_FREE_SPARK_MODE === true\) return browserStoreFile\(file, kind\)/);
  assert.match(client,/firestore-media:\/\//);
  const events=fs.readFileSync(path.join(root,"usc-admin/events/js/events.js"),"utf8");
  const announcements=fs.readFileSync(path.join(root,"usc-admin/announcements/js/announcements.js"),"utf8");
  assert.match(events,/hydrateMediaImages/);
  assert.match(announcements,/hydrateMediaImages/);
});

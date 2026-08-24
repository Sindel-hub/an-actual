import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Audit & Reports remains visible across every admin access module", () => {
  for (const page of [
    "usc-admin/admin-dashboard/admin-dashboard.html",
    "usc-admin/admin-dashboard/users.html",
    "usc-admin/admin-dashboard/queue.html",
    "usc-admin/admin-dashboard/audit.html"
  ]) {
    assert.match(read(page), /href="audit\.html"[^>]*>[\s\S]*?Audit & Reports/);
  }
});

test("shared profile drawer freezes the dashboard and restores its scroll position", () => {
  const js = read("shared/profile-manager.js");
  const css = read("shared/profile-manager.css");
  assert.match(js, /function lockBackgroundScroll\(\)/);
  assert.match(js, /body\.style\.position = "fixed"/);
  assert.match(js, /window\.scrollTo\(0, state\.scrollY\)/);
  assert.match(js, /lockBackgroundScroll\(\);[\s\S]*drawerOpen = true/);
  assert.match(js, /unlockBackgroundScroll\(\);[\s\S]*drawerOpen = false/);
  assert.match(css, /\.usc-profile-drawer\{[^}]*overflow-y:auto[^}]*overscroll-behavior:contain/);
  assert.match(css, /html\.usc-profile-scroll-locked,body\.usc-profile-scroll-locked/);
});

test("Audit System guardrails remains sticky on desktop", () => {
  const css = read("usc-admin/admin-dashboard/css/admin-dashboard.css");
  const audit = read("usc-admin/admin-dashboard/audit.html");
  assert.match(audit, /<h3>System guardrails<\/h3>/);
  assert.match(audit, /<article class="card sticky-card">/);
  assert.match(css, /\.sticky-card \{ position: sticky; top: 18px; align-self: start; \}/);
});

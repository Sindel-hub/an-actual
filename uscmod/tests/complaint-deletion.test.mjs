import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../usc-admin/complaints/complaints.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../usc-admin/complaints/js/complaints.js", import.meta.url), "utf8");
const security = fs.readFileSync(new URL("../shared/security-client.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("delete action is present and terminal-state gated", () => {
  assert.match(html, /id="deleteComplaintBtn"[^>]*hidden/);
  assert.match(js, /\["Resolved", "Closed"\]\.includes\(status\)/);
  assert.match(js, /callSecure\("deleteComplaintCase"/);
});

test("browser deletion removes attachment chunks and complaint together", () => {
  assert.match(security, /browserDeleteComplaintCase/);
  assert.match(security, /attachmentChunks/);
  assert.match(security, /batch\.delete\(chunk\.ref\)/);
  assert.match(security, /batch\.delete\(complaintRef\)/);
  assert.match(security, /COMPLAINT_DELETED/);
});

test("rules only allow terminal complaint deletion", () => {
  assert.match(rules, /allow delete: if isOfficerOrAdmin\(\) && resource\.data\.status in \["Resolved", "Closed"\]/);
  assert.match(rules, /match \/complaint_case_logs\/\{logId\}/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const complaintJs = fs.readFileSync(path.join(root, "complaint/js/complaints.js"), "utf8");
const complaintHtml = fs.readFileSync(path.join(root, "complaint/complaint.html"), "utf8");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const studentCss = fs.readFileSync(path.join(root, "dashboard/css/dashboard.css"), "utf8");
const officerCss = fs.readFileSync(path.join(root, "usc-admin/overview/css/overview.css"), "utf8");
const officerOverviewJs = fs.readFileSync(path.join(root, "usc-admin/overview/js/overview.js"), "utf8");
const officerComplaintsJs = fs.readFileSync(path.join(root, "usc-admin/complaints/js/complaints.js"), "utf8");

const complaintAttachmentJs = fs.readFileSync(path.join(root, "shared/complaint-attachments.js"), "utf8");

test("complaint submission uses atomic per-user burst protection", () => {
  assert.match(complaintJs, /runTransaction/);
  assert.match(complaintJs, /complaint_rate_limits/);
  assert.match(complaintJs, /SUBMISSION_COOLDOWN_MS\s*=\s*20_000/);
  assert.match(complaintJs, /submissionInFlight/);
  assert.match(complaintJs, /localStorage/);
  assert.match(complaintJs, /MAX_SUBMIT_ATTEMPTS\s*=\s*4/);
  assert.match(rules, /getAfter\(complaintRatePath\(\)\)/);
  assert.match(rules, /duration\.value\(20, "s"\)/);
});

test("attachment limits are enforced in UI and Firestore rules", () => {
  assert.match(complaintJs, /IMAGE_MAX_BYTES\s*=\s*3 \* 1024 \* 1024/);
  assert.match(complaintJs, /DOCUMENT_MAX_BYTES\s*=\s*5 \* 1024 \* 1024/);
  assert.match(rules, /attachmentSize <= 5242880/);
  assert.match(rules, /attachmentSize <= 3145728/);
  assert.match(complaintHtml, /Images: JPG, PNG or WEBP up to 3MB/);
  assert.match(complaintHtml, /id="attachmentError"/);
});

test("synthetic concurrent complaint references remain unique", () => {
  const refs = new Set();
  const year = 2026;
  for (let i = 0; i < 25000; i += 1) {
    const random = crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase();
    const ref = `SC-${year}-${random}`;
    assert.equal(refs.has(ref), false, `duplicate complaint reference: ${ref}`);
    refs.add(ref);
  }
  assert.equal(refs.size, 25000);
});

test("student and officer dashboards include dedicated mobile passes", () => {
  assert.match(studentCss, /mobile dashboard usability pass/);
  assert.match(studentCss, /@media \(max-width: 520px\)/);
  assert.match(officerCss, /Officer dashboard mobile usability pass/);
  assert.match(officerCss, /@media\(max-width:560px\)/);
});


test("officer complaint views avoid unbounded realtime collection listeners", () => {
  assert.match(officerOverviewJs, /limit\(4\)/);
  assert.match(officerOverviewJs, /getCountFromServer/);
  assert.match(officerComplaintsJs, /LIVE_PAGE_SIZE\s*=\s*100/);
  assert.match(officerComplaintsJs, /startAfter\(paginationCursor\)/);
  assert.match(officerComplaintsJs, /getCountFromServer/);
});


test("complaint attachments no longer require a secure Cloud Function in browser-only mode", () => {
  assert.doesNotMatch(complaintJs, /secureUpload\(/);
  assert.match(complaintJs, /FIRESTORE_ATTACHMENT_CHUNK_BYTES\s*=\s*600 \* 1024/);
  assert.match(complaintJs, /attachmentChunks/);
  assert.match(rules, /match \/attachmentChunks\/\{chunkId\}/);
  assert.match(rules, /getAfter\(\/databases\/\$\(database\)\/documents\/complaints\/\$\(complaintId\)\)/);
  assert.match(complaintAttachmentJs, /loadFirestoreChunks/);
  assert.match(officerComplaintsJs, /loadComplaintAttachmentBlob/);
  assert.match(officerComplaintsJs, /admin-image-display/);
  assert.doesNotMatch(officerComplaintsJs, /openPrivateFile/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { lifecycleFromSchedule } = require("../functions/election-lifecycle.js");

const base = Date.UTC(2026, 7, 1, 0, 0, 0);
const hour = 60 * 60 * 1000;
const election = {
  registrationStart: base + hour,
  registrationEnd: base + 2*hour,
  applicationReviewStart: base + 2*hour,
  applicationReviewEnd: base + 3*hour,
  candidatePublicationStart: base + 3*hour,
  candidatePublicationEnd: base + 4*hour,
  votingStart: base + 4*hour,
  votingEnd: base + 5*hour,
  resultPublicationStart: base + 6*hour,
  resultPublicationEnd: base + 7*hour
};

test("lifecycle transitions at exact server boundaries", () => {
  assert.equal(lifecycleFromSchedule(election, base), "Draft");
  assert.equal(lifecycleFromSchedule(election, base + hour), "Registration");
  assert.equal(lifecycleFromSchedule(election, base + 2*hour), "Review");
  assert.equal(lifecycleFromSchedule(election, base + 3*hour), "Published");
  assert.equal(lifecycleFromSchedule(election, base + 4*hour), "Voting");
  assert.equal(lifecycleFromSchedule(election, base + 5*hour), "Voting Closed");
});

test("manual finalization, publication, and archive override automatic windows", () => {
  assert.equal(lifecycleFromSchedule({ ...election, finalized: true }, base + 5*hour), "Canvassing");
  assert.equal(lifecycleFromSchedule({ ...election, finalized: true, resultsPublished: true }, base + 6*hour), "Results Published");
  assert.equal(lifecycleFromSchedule({ ...election, finalized: true, resultsPublished: true, archived: true }, base + 8*hour), "Archived");
});


test("voting gate is closed one millisecond before opening and at/after closing", () => {
  assert.notEqual(lifecycleFromSchedule(election, base + 4*hour - 1), "Voting");
  assert.equal(lifecycleFromSchedule(election, base + 4*hour), "Voting");
  assert.equal(lifecycleFromSchedule(election, base + 5*hour - 1), "Voting");
  assert.equal(lifecycleFromSchedule(election, base + 5*hour), "Voting Closed");
});

test("an incomplete schedule fails closed as Draft", () => {
  assert.equal(lifecycleFromSchedule({ registrationStart: base }, base + 99*hour), "Draft");
});

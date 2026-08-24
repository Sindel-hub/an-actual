"use strict";
function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const n = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}
function lifecycleFromSchedule(election = {}, nowMs = Date.now()) {
  if (election.archived === true) return "Archived";
  if (election.resultsPublished === true) return "Results Published";
  if (election.finalized === true) return "Canvassing";
  const regStart = toMillis(election.registrationStart);
  const regEnd = toMillis(election.registrationEnd);
  const reviewStart = toMillis(election.applicationReviewStart);
  const reviewEnd = toMillis(election.applicationReviewEnd);
  const pubStart = toMillis(election.candidatePublicationStart);
  const voteStart = toMillis(election.votingStart);
  const voteEnd = toMillis(election.votingEnd);
  if (!regStart || !voteEnd) return "Draft";
  if (nowMs < regStart) return "Draft";
  if (nowMs < regEnd) return "Registration";
  if (nowMs >= reviewStart && nowMs < reviewEnd) return "Review";
  if (nowMs >= pubStart && nowMs < voteStart) return "Published";
  if (nowMs >= voteStart && nowMs < voteEnd) return "Voting";
  if (nowMs >= voteEnd) return "Voting Closed";
  return "Draft";
}
module.exports = { toMillis, lifecycleFromSchedule };

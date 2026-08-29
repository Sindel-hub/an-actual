export const ELECTION_PHASES = [
  {
    id: "registration",
    label: "Candidate Registration",
    startField: "registrationStart",
    endField: "registrationEnd",
    shortLabel: "Registration"
  },
  {
    id: "review",
    label: "Application Review",
    startField: "applicationReviewStart",
    endField: "applicationReviewEnd",
    shortLabel: "Review"
  },
  {
    id: "publication",
    label: "Candidate Publication",
    startField: "candidatePublicationStart",
    endField: "candidatePublicationEnd",
    shortLabel: "Candidates"
  },
  {
    id: "voting",
    label: "Voting",
    startField: "votingStart",
    endField: "votingEnd",
    shortLabel: "Voting"
  },
  {
    id: "results",
    label: "Result Publication",
    startField: "resultPublicationStart",
    endField: "resultPublicationEnd",
    shortLabel: "Results"
  }
];

export function electionDate(value) {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatElectionDateTime(value, fallback = "Not set") {
  const date = electionDate(value);
  if (!date) return fallback;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function datetimeLocalValue(value) {
  const date = electionDate(value);
  if (!date) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function phaseWindows(settings = {}) {
  return ELECTION_PHASES.map((phase) => ({
    ...phase,
    start: electionDate(settings?.[phase.startField]),
    end: electionDate(settings?.[phase.endField])
  }));
}

export function hasCompleteElectionSchedule(settings = {}) {
  return phaseWindows(settings).every((phase) => phase.start && phase.end);
}

export function validateElectionSchedule(settings = {}) {
  const windows = phaseWindows(settings);

  const missing = windows.filter(
    (phase) => !phase.start || !phase.end
  );

  if (missing.length) {
    return {
      valid: false,
      message:
        `Please set both opening and closing date/time for ${missing
          .map((phase) => phase.label)
          .join(", ")}.`
    };
  }

  /*
   * Every phase only needs a valid individual
   * opening and closing time.
   */
  for (const phase of windows) {
    if (phase.end <= phase.start) {
      return {
        valid: false,
        message:
          `${phase.label} must close after it opens.`
      };
    }
  }

  const getWindow = (id) =>
    windows.find((phase) => phase.id === id);

  const registration =
    getWindow("registration");

  const review =
    getWindow("review");

  const publication =
    getWindow("publication");

  const voting =
    getWindow("voting");

  const results =
    getWindow("results");


  /*
   * Registration must finish before
   * Application Review begins.
   */
  if (review.start < registration.end) {
    return {
      valid: false,
      message:
        "Application Review cannot begin before Candidate Registration closes."
    };
  }


  /*
   * Candidate Publication may begin once
   * the scheduled Application Review period ends.
   */
  if (publication.start < review.end) {
    return {
      valid: false,
      message:
        "Candidate Publication cannot begin before Application Review closes."
    };
  }


  /*
   * IMPORTANT:
   *
   * Voting depends on Application Review,
   * NOT Candidate Publication closing.
   *
   * Candidate Publication and Voting may overlap.
   */
  if (voting.start < review.end) {
    return {
      valid: false,
      message:
        "Voting cannot begin before Application Review closes. Candidate Publication may overlap with Voting."
    };
  }


  /*
   * There is deliberately NO check like:
   *
   * voting.start >= publication.end
   *
   * Publication and Voting are independent.
   */


  /*
   * Results may only begin after Voting closes.
   */
  if (results.start < voting.end) {
    return {
      valid: false,
      message:
        "Result Publication cannot begin before Voting closes."
    };
  }


  return {
    valid: true,
    message: ""
  };
}
function legacyState(settings = {}, now = new Date()) {
  // Legacy/incomplete election data must fail closed. Device time is display-only;
  // sensitive writes are authorized by Cloud Functions / Firestore request.time.
  return {
    scheduleComplete: false,
    phaseId: "unavailable",
    phaseLabel: "Election Services Unavailable",
    activePhase: null,
    nextPhase: null,
    registrationOpen: false,
    reviewOpen: false,
    candidatePublicationOpen: false,
    candidateVisible: false,
    votingOpen: false,
    resultsOpen: false,
    resultsVisible: false,
    statusText: "Election services temporarily unavailable. Please try again."
  };
}

export function getElectionScheduleState(settings = {}, nowValue = new Date()) {
  const now = electionDate(nowValue) || new Date();
  const windows = phaseWindows(settings);
  if (!windows.every((phase) => phase.start && phase.end)) {
    return legacyState(settings, now);
  }

  const activePhase = windows.find((phase) => now >= phase.start && now < phase.end) || null;
  const nextPhase = windows.find((phase) => now < phase.start) || null;
  const first = windows[0];
  const last = windows[windows.length - 1];

  let phaseId;
  let phaseLabel;
  if (activePhase) {
    phaseId = activePhase.id;
    phaseLabel = activePhase.label;
  } else if (now < first.start) {
    phaseId = "upcoming";
    phaseLabel = "Election Schedule Upcoming";
  } else if (now >= last.end) {
    phaseId = "completed";
    phaseLabel = "Election Cycle Completed";
  } else {
    phaseId = "transition";
    phaseLabel = nextPhase ? `Waiting for ${nextPhase.label}` : "Election Information";
  }

  const getWindow = (id) => windows.find((phase) => phase.id === id);
  const registration = getWindow("registration");
  const review = getWindow("review");
  const publication = getWindow("publication");
  const voting = getWindow("voting");
  const results = getWindow("results");

  const within = (phase) => now >= phase.start && now < phase.end;

  return {
    scheduleComplete: true,
    phaseId,
    phaseLabel,
    activePhase,
    nextPhase,
    windows,
    registrationOpen: within(registration),
    reviewOpen: within(review),
    candidatePublicationOpen: within(publication),
    // Once candidates are officially published, their information remains available
    // throughout voting/results and after the cycle for transparency.
    candidateVisible: now >= publication.start,
    votingOpen: within(voting),
    resultsOpen: within(results),
    // Once official results are published, keep them viewable as election information.
    resultsVisible: now >= results.start,
    statusText: phaseLabel
  };
}

export function legacyStatusForState(state = {}) {
  switch (state.phaseId) {
    case "registration": return "Registration Open";
    case "review": return "Registration Closed";
    case "publication": return "Candidates Published";
    case "voting": return "Voting Open";
    case "results": return "Results Posted";
    case "completed": return "Closed";
    default: return "Scheduled";
  }
}

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

export function getElectionScheduleState(
  settings = {},
  nowValue = new Date()
) {
  const now =
    electionDate(nowValue) ||
    new Date();

  const windows =
    phaseWindows(settings);


  if (
    !windows.every(
      (phase) =>
        phase.start &&
        phase.end
    )
  ) {
    return legacyState(
      settings,
      now
    );
  }


  const getWindow = (id) =>
    windows.find(
      (phase) =>
        phase.id === id
    );


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


  const within = (phase) =>
    now >= phase.start &&
    now < phase.end;


  /*
   * Each phase has its OWN state.
   *
   * Candidate Publication and Voting are
   * intentionally independent.
   */
  const registrationOpen =
    within(registration);

  const reviewOpen =
    within(review);

  const candidatePublicationOpen =
    within(publication);

  const votingScheduleOpen =
    within(voting);

  const resultsOpen =
    within(results);


  /*
   * Actual review completion.
   */
  const candidateReviewComplete =
    settings?.candidateReviewComplete === true;


  /*
   * Voting requires BOTH:
   *
   * 1. Voting schedule currently open
   * 2. Candidate review actually completed
   *
   * Candidate Publication has no role here.
   */
  const votingOpen =
    votingScheduleOpen &&
    candidateReviewComplete;


  /*
   * Candidate visibility follows only the
   * Candidate Publication window.
   */
  const candidateVisible =
    candidatePublicationOpen;


  /*
   * There can now be overlapping phases.
   *
   * If Candidate Publication and Voting
   * are both active, Voting gets display
   * priority because it is the more
   * operationally important state.
   */
  let activePhase = null;

  if (votingScheduleOpen) {
    activePhase = voting;
  } else if (resultsOpen) {
    activePhase = results;
  } else if (reviewOpen) {
    activePhase = review;
  } else if (registrationOpen) {
    activePhase = registration;
  } else if (candidatePublicationOpen) {
    activePhase = publication;
  }


  /*
   * Determine the next phase based on
   * actual start time, not array order.
   *
   * Important now that phases may overlap.
   */
  const upcomingWindows =
    windows
      .filter(
        (phase) =>
          now < phase.start
      )
      .sort(
        (left, right) =>
          left.start.getTime() -
          right.start.getTime()
      );


  const nextPhase =
    upcomingWindows[0] ||
    null;


  const firstStart =
    Math.min(
      ...windows.map(
        (phase) =>
          phase.start.getTime()
      )
    );


  const lastEnd =
    Math.max(
      ...windows.map(
        (phase) =>
          phase.end.getTime()
      )
    );


  let phaseId;
  let phaseLabel;


  if (activePhase) {
    phaseId =
      activePhase.id;

    phaseLabel =
      activePhase.label;

  } else if (
    now.getTime() <
    firstStart
  ) {
    phaseId =
      "upcoming";

    phaseLabel =
      "Election Schedule Upcoming";

  } else if (
    now.getTime() >=
    lastEnd
  ) {
    phaseId =
      "completed";

    phaseLabel =
      "Election Cycle Completed";

  } else {
    phaseId =
      "transition";

    phaseLabel =
      nextPhase
        ? `Waiting for ${nextPhase.label}`
        : "Election Information";
  }


  /*
   * Give a useful status when Voting's
   * configured time has started but review
   * is still incomplete.
   */
  let statusText =
    phaseLabel;

  if (
    votingScheduleOpen &&
    !candidateReviewComplete
  ) {
    statusText =
      "Voting is scheduled, but candidate review must be completed before ballots can be submitted.";
  }


  return {
    scheduleComplete:
      true,

    phaseId,

    phaseLabel,

    activePhase,

    nextPhase,

    windows,


    registrationOpen,

    reviewOpen,


    candidatePublicationOpen,

    candidateVisible,


    candidateReviewComplete,


    /*
     * Useful distinction:
     *
     * votingScheduleOpen = configured time
     * votingOpen = actual permission to vote
     */
    votingScheduleOpen,

    votingOpen,


    resultsOpen,

    resultsVisible:
      now >= results.start,


    statusText
  };
}
export function legacyStatusForState(state = {}) {
  switch (state.phaseId) {
    case "registration": return "Registration Open";
    case "review": return "Registration Closed";
    case "publication": return "Candidates Published";
    case "voting":
  return state.votingOpen
    ? "Voting Open"
    : "Voting Locked";
    case "results": return "Results Posted";
    case "completed": return "Closed";
    default: return "Scheduled";
  }
}

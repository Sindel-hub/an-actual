# USC Election Integrity Architecture

The active election system no longer uses `election_settings/current`, `candidate_applications`, or `votes`. Those legacy collections are explicitly denied by `firestore.rules`.

## Election-specific storage

Each election gets a permanent archive key:

`elections/{electionId}`

`election_config/current` stores only the active `electionId`. A new active election cannot replace an unarchived current election.

Nested collections include:

- `voterRoster/{studentId}` — official election-specific eligibility record.
- `applications/{applicantUid}` — private candidacy application/review record.
- `candidates/{randomCandidateId}` — approved public candidate data only.
- `voterStatus/{uid}` — participation status and receipt, no selections.
- `ballots/{randomBallotId}` — anonymous candidate IDs only, no voter identity or receipt.
- `turnout/public` — aggregate ballots cast / eligible voters.
- `privateTallies/{candidateId}` — backend-generated candidate totals restricted to canvassers after finalization.
- `results/official` — deliberately published official results.

## Server-authoritative flow

1. Officer/admin creates a unique Election ID and complete schedule in `Draft`.
2. Admin imports/finalizes the official election voter roster.
3. Student account activation matches Student ID + email + enrollment/eligibility against the **current election voter roster**.
4. Backend time determines registration/review/voting/result gates. Firestore Rules use `request.time` for browser-readable time gates.
5. Candidate applications use verified roster identity/college. Department Representative department is assigned by the server, not chosen by the applicant.
6. Candidate approval creates a random public candidate ID and copies only the approved campaign image to public storage. Supporting documents remain private.
7. Voting uses `submitAnonymousBallot`; one Firestore transaction verifies eligibility, server time, prior participation, candidate position/approval, and Department Representative college, then writes anonymous ballot + voter participation + turnout + private tallies atomically.
8. Candidate-level results remain hidden while voting is active.
9. After voting closes, a designated canvasser/admin deliberately finalizes the election.
10. Results may be deliberately published only after the configured result-publication start.
11. Admin archives the election. A new Election ID may then become current.

## Lifecycle

`Draft → Registration → Review → Published → Voting → Voting Closed → Canvassing → Results Published → Archived`

Normal schedule changes lock once registration starts. A pre-closeout administrator emergency schedule change requires a written reason and creates an immutable audit entry. Finalized/result-published/archived elections cannot be rescheduled.

## Secret ballot separation

`voterStatus` and `ballots` are intentionally separate. The ballot document contains only validated candidate IDs and a schema version. It does **not** contain UID, Student ID, name, email, college, receipt, or a client-visible timestamp. The receipt is written only to the participation record in the same atomic server transaction.

No audit event contains voter selections.

## Required deployment

Security source files do not protect the live project until deployed/applied:

- `firestore.rules`
- `firestore.indexes.json`
- `functions/`
- `supabase/storage.sql`
- Firebase App Check + reCAPTCHA Enterprise configuration
- Verified-email administrator access with trusted Firebase custom claims
- Supabase Function secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)

Read `SECURITY_DEPLOYMENT_GUIDE.md` before production use.

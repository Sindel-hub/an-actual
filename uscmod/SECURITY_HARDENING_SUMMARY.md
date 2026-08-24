# USC Election Integrity Hardening Summary

This revision implements the requested election-security redesign. Browser UI checks are treated as convenience only; sensitive authorization is routed through trusted Firebase backend code and deny-by-default Firestore Rules.

## Requested changes mapped to implementation

1. **Verified eligible students** — Student activation matches Student ID + registered email against the active election's `voterRoster`, including enrollment status and `eligible=true`. Unmatched accounts remain pending. Student ID uniqueness is claimed only by the backend and only after email verification.
2. **Ballot confidentiality** — Identity/participation is stored under `voterStatus/{uid}`. Anonymous `ballots/{randomId}` contain candidate IDs only and no UID, Student ID, name, email, college, receipt, or application timestamp field.
3. **No live student candidate totals** — Student pages use only turnout aggregates and the student's own participation status. The legacy `votes` collection is denied by rules.
4. **Server-authoritative phases** — Sensitive registration, review, voting, finalization, and result-publication actions are checked in Cloud Functions using backend time; browser time is display-only. Firestore Rules use `request.time` for browser-readable publication gates.
5. **Version-controlled Firestore Security Rules** — Added `firestore.rules`, `firestore.indexes.json`, `firebase.json`, and rules tests. Rules are deny-by-default.
6. **Atomic vote submission** — `submitAnonymousBallot` uses one Firestore transaction to validate voter eligibility, one-vote state, election phase, candidates/positions, Department Representative college, then records anonymous ballot + participation + turnout + private tally increments atomically.
7. **Department Representative eligibility** — College/department comes from the verified election roster. Students cannot choose another college for representative candidacy or voting.
8. **Real Election IDs** — Election data is namespaced under `elections/{electionId}`. `election_config/current` is only a pointer. A new active election requires the previous one to be archived.
9. **Private Supabase storage** — Added public `usc-public-media` and private `usc-private-documents` migration. Complaint attachments and candidacy documents use private signed access; approved media uses the public bucket.
10. **Stronger officer/admin authorization** — Privileged roles use Firebase custom claims plus approved/active Firestore profiles. No hard-coded administrator email grants access. In this build, administrator access additionally requires a verified Firebase email and sensitive backend operations require recent authentication.
11. **No hard-coded election totals/sample data** — Eligible voter count comes from the finalized roster; candidate lists come from approved election-scoped candidate records; election labels are dynamic.
12. **Fail closed** — Missing/incomplete election configuration disables sensitive election actions and shows an unavailable state rather than assuming registration/voting is open.
13. **Account verification/recovery** — Added email verification gating, Forgot Password, safer failed-login handling, stronger passwords, and Verified Email Administrator Mode for System Administrator accounts.
14. **Shared session/auth guard** — Protected dashboards load a shared guard that re-checks Firebase Auth, email verification, trusted role, active/approved profile state, session expiry, and student voter-roster eligibility where applicable.
15. **Officer tally restriction** — Ordinary officers see turnout/system state only. Candidate tallies require a trusted canvasser/admin and remain unavailable until poll close plus deliberate finalization.
16. **Election lifecycle** — Implements `Draft → Registration → Review → Published → Voting → Voting Closed → Canvassing → Results Published → Archived`, with deliberate Finalize, Publish, Archive, and audited emergency schedule procedures.
17. **Audit trail** — Backend-created immutable audit records cover schedule changes, emergency changes, roster imports, candidate decisions, lifecycle/finalization, result publication, archival, access changes, complaint administration, and administrative exports. Vote selections are never audited.
18. **App Check** — Web App Check initialization and callable-function enforcement are included. The production reCAPTCHA Enterprise site key and Firebase Console enforcement must still be configured.
19. **Recovery/testing/deployment infrastructure** — Added Firebase deployment config, Firestore rules tests, lifecycle tests, static project security tests, a security test matrix, masterlist template, admin/claim scripts, and Firestore backup/restore scripts.

## Important deployment boundary

These source changes do **not** protect a live Firebase/Supabase project until the included rules/functions/storage migration are deployed and the App Check/authentication settings described in `SECURITY_DEPLOYMENT_GUIDE.md` are configured. Run a complete staging election before production use.

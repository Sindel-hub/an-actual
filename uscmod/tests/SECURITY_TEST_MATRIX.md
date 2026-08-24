# USC Election Security Test Matrix

Automated rules/lifecycle coverage exists in `firestore.rules.test.mjs` and `election-lifecycle.test.mjs`. Before a real election, run the staging scenarios below as well.

| Scenario | Expected result |
|---|---|
| Two vote submissions from the same verified student at nearly the same time | Exactly one transaction succeeds; second receives already-voted error; turnout increments once. |
| Vote 1 ms before `votingStart` | Rejected by server. |
| Vote at `votingStart` | Accepted if all other checks pass. |
| Vote immediately before `votingEnd` | Accepted only if the trusted backend receives it before closing. |
| Vote at/after `votingEnd` | Rejected by server. |
| Student changes device clock | Device display may drift briefly; protected backend actions remain controlled by server time. |
| Suspended/inactive student voting | Rejected. |
| Student without current official roster match | Account remains pending / election access rejected. |
| Masterlist email does not match Student ID | Account remains pending. |
| Duplicate Student ID account registration | Server-controlled claim prevents a second UID from claiming the ID. |
| Student not actively enrolled or `eligible=false` | Cannot activate election eligibility. |
| Student tries another college's Department Representative | Rejected by server. |
| Department Representative applicant submits another college | Server ignores that idea and stores the verified roster college. |
| Tampered ballot uses unknown candidate ID | Rejected. |
| Tampered ballot uses a valid candidate ID for the wrong position | Rejected. |
| Tampered ballot uses a non-approved candidate | Rejected. |
| Student reads `ballots` | Denied. |
| Student reads `privateTallies` | Denied. |
| Student reads official results before deliberate publication | Denied. |
| Student reads official results after publication start + deliberate publication | Allowed. |
| Ordinary officer reads private tallies during/after voting | Denied. |
| Designated canvasser reads tallies after voting end but before finalization | Denied. |
| Designated canvasser reads tallies after voting end + finalization | Allowed. |
| Administrator role claim with unverified email | Admin-only Firestore reads denied. |
| Administrator email is not verified | Admin login/privileged operations are rejected. |
| Browser attempts direct vote write | Denied. |
| Browser attempts direct election/schedule write | Denied. |
| Browser attempts self-promotion to officer/admin | Denied. |
| Normal schedule edit after Candidate Registration starts | Rejected. |
| Admin emergency schedule change without reason | Rejected. |
| Admin emergency schedule change with reason before closeout | Allowed and audited. |
| Schedule/candidate/ballot mutation after finalization | Rejected by the normal election APIs. |
| Start a new Election ID while previous current election is unarchived | Rejected. |
| Start next election after prior archive | New records are isolated under the new Election ID. |
| Network interruption during final vote submission | Transaction is all-or-nothing; refresh shows participation or permits retry. |
| Refresh after successful vote | Participation/receipt remains; candidate selections are never shown back. |
| User reads another student's complaint | Denied. |
| Complaint attachment URL guessing | No public document URL; authorized signed URL required. |
| Officer complaint status/reply update | Routed through backend and audit event created. |
| Candidate approval/rejection | Server-time review gate enforced and immutable audit event created. |
| User role/account suspension/change | Trusted claims/profile updated by admin server function and audited. |
| Administrative export | Export contains no ballot selections and creates audit metadata. |
| App Check request from unauthorized client | Rejected after App Check enforcement is enabled. |
| Backup restore rehearsal | Restored only to staging; access rules still deny ballots/private tallies to unauthorized users. |

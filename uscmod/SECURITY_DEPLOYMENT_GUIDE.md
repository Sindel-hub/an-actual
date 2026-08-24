# USC Election Security Deployment Guide

This revision moves election integrity controls out of the browser and into **trusted Firebase backend code, Firebase Authentication/custom claims, deny-by-default Firestore Rules, and private Supabase storage**. The source files must still be deployed/applied to the live Firebase and Supabase projects before they protect production data.

## 1. Security architecture implemented

- **Verified voter roster:** account activation is matched against the **current election's official `voterRoster`**, using Student ID + registered email + active enrollment + `eligible=true`. An unmatched signup remains `pending`.
- **Server-controlled Student ID uniqueness:** after the signup email is verified, `student_id_claims/{studentId}` is created in the activation transaction and cannot be written by browsers. Unverified signups do not reserve a Student ID.
- **Real election IDs:** each election lives under `elections/{electionId}`. `election_config/current` is only the current-election pointer. A new election cannot replace the pointer until the previous election is archived.
- **Secret-ballot separation:** `voterStatus/{uid}` contains participation/receipt data; `ballots/{randomId}` contains candidate IDs only. Browser clients cannot read or write anonymous ballot documents.
- **Atomic vote submission:** `submitAnonymousBallot` validates the active election, server time, user/profile state, official voter roster, one-vote status, every candidate ID/position, and Department Representative college inside one Firestore transaction, then writes participation, anonymous ballot, turnout, and private tallies atomically.
- **No live student results:** student dashboards use aggregate turnout only. Candidate totals are not read from the old `votes` collection and are unavailable until official result publication.
- **Officer tally restriction:** ordinary officers see turnout/system state, not candidate-level tallies. Only a designated `canvasser` or administrator can read private tallies after voting has ended **and** the election has been deliberately finalized.
- **Server-authoritative time:** sensitive Cloud Functions use backend time for registration/review/voting/finalization/publication. Firestore Rules additionally gate browser-readable phase data with `request.time`.
- **Fail closed:** missing/incomplete election data locks sensitive actions instead of defaulting to an open phase.
- **Trusted roles:** `student`, `officer`, `admin`, and optional `canvasser` privileges come from Firebase custom claims plus an approved/active Firestore profile. No hard-coded administrator email grants privilege.
- **Administrator authentication:** System Administrator access uses Verified Email Administrator Mode in this build. Firestore admin rules require a verified email token, trusted `admin` custom claim, and approved/active administrator profile. Sensitive callable operations also require recent authentication.
- **Private documents:** complaint attachments and candidacy documents use `usc-private-documents`; approved posters/event media/public campaign photos use `usc-public-media`.
- **Audit trail:** schedule changes, emergency schedule changes, lifecycle transitions, voter-roster imports, candidate decisions, result publication, archival, user access changes, complaint case changes, and administrative exports produce server-created audit events. Ballot selections are never audited.
- **Shared auth guard:** every student/officer/admin protected page verifies Firebase Authentication, email verification, trusted role, account status, session expiry, and applicable election eligibility rather than trusting `sessionStorage` alone.

## 2. Install dependencies and select the Firebase project

```bash
npm install
cd functions && npm install && cd ..
firebase login
firebase use universitystudentcouncil-856cc
```

A `.firebaserc` is included for the current project ID. Change it if you deploy this copy to staging or a different Firebase project.

## 3. Enable Firebase Authentication protections

### Email verification and recovery

The frontend now supports:

- required email verification before protected access,
- **Forgot Password** via Firebase password-reset email,
- explicit failed-login handling,
- 15-minute dashboard session/idle expiry checks.

Student self-registration still requires the Gmail address recorded in the voter roster. Officer/admin sign-in accepts their registered email address.

### Verified Email Administrator Mode

No authenticator app is required in this build. Administrator access requires:

1. a successful Firebase email/password sign-in,
2. a verified Firebase email,
3. a trusted server-issued `role: admin` custom claim,
4. an approved and active Firestore administrator profile, and
5. recent authentication for sensitive backend operations.

This is simpler to operate but is weaker than true MFA if an administrator password is compromised. Protect the administrator's email account with MFA at the email-provider level and use a unique strong password. See `ADMIN_AUTHENTICATION_CHANGE.md`.

## 4. Configure Firebase App Check

1. In Firebase Console, register the web app with **App Check + reCAPTCHA Enterprise**.
2. Replace `YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY` in `shared/app-config.js` with the registered public site key.
3. Add the production web domain to the App Check provider configuration.
4. Deploy the functions. Sensitive callable functions use `enforceAppCheck: true`.
5. After validating App Check metrics, enable **App Check enforcement for Cloud Firestore** in Firebase Console as well, because some approved public/profile/complaint reads still use the Firestore Web SDK directly.
6. Localhost is prepared for App Check debug-token mode, but you still need a valid configured App Check provider/site key for realistic testing.

If the site key or enforcement setup is incomplete, sensitive callable requests are expected to fail closed.

## 5. Apply Supabase storage hardening

Run `supabase/storage.sql` in the Supabase SQL editor after backing up/migrating existing files. It creates:

- `usc-public-media` — public approved announcements, event media, and published candidate campaign photos.
- `usc-private-documents` — private complaint attachments, candidacy photos before approval, and candidacy supporting documents.

The SQL removes known permissive anonymous-upload policies and makes the legacy mixed `uscstorage` bucket private. Historical public media must be migrated to the public bucket before old public links can work again.

Set backend-only secrets:

```bash
firebase functions:secrets:set SUPABASE_URL
firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
```

Never place the Supabase service-role key in browser JavaScript.

## 6. Bootstrap trusted administrator/officer claims

With Application Default Credentials or a Firebase service-account environment configured:

```bash
node scripts/bootstrap-admin.mjs administrator@school.edu
```

This creates the trusted admin role for Verified Email Administrator Mode; no authenticator enrollment is required.

For later roles:

```bash
node scripts/set-user-claims.mjs officer@school.edu officer false
node scripts/set-user-claims.mjs canvasser@school.edu officer true
```

Users should sign out/sign in after claim changes so Firebase issues a fresh ID token.

## 7. Run automated checks and deploy

```bash
npm test
npm run deploy
```

`firestore.rules`, `firestore.indexes.json`, `firebase.json`, and `.firebaserc` are version-controlled in this ZIP. Rules are deny-by-default, and election-sensitive writes cannot be performed directly from browser JavaScript.

## 8. Create an election and import the official voter roster

1. Sign in as an approved trusted officer/admin.
2. Open **Election Management**.
3. Enter a **unique permanent Election ID**, for example `usc-yyyy-general` with the actual year substituted.
4. Configure every schedule window and save while the election is still `Draft`.
5. As an administrator, import `data/voter-masterlist-template.csv` with:
   `studentId, fullName, email, program, college, enrollmentStatus, eligible`.
6. The import is staged and finalized. Rows not present in the new import are removed from that election's voter roster.
7. The roster is frozen automatically when Candidate Registration starts.
8. `eligibleVoterCount` and public turnout denominator are generated from the finalized roster, not a hard-coded number.

Student signup/activation is checked against this **current election roster**. Verified college/program from the roster is the source of truth for Department Representative candidacy and voting.

## 9. Election lifecycle and immutability

`Draft → Registration → Review → Published → Voting → Voting Closed → Canvassing → Results Published → Archived`

- Normal schedule editing locks when Candidate Registration starts.
- An administrator can use the visible **Emergency schedule procedure** before closeout; a written reason is mandatory and the change is permanently audited.
- After `Voting Closed`, an administrator/designated canvasser must deliberately **Finalize Election**.
- Finalized elections reject new ballots and normal schedule/candidate changes.
- Results can be published only after finalization and after the configured result-publication start according to server time.
- Only an administrator can archive after results publication.
- A new Election ID cannot become current until the prior current election is archived.

## 10. Backups and recovery

Use managed Firestore exports before roster replacement, major administrative changes, finalization, and archival:

```bash
./scripts/backup-firestore.sh
```

Restore only into a staging/non-production project first:

```bash
./scripts/restore-firestore.sh
```

Set the bucket/export variables documented inside those scripts. Supabase private documents also need a tested Supabase backup/export procedure.

Never place anonymous ballot exports in locations readable by students or ordinary officers.

## 11. Production acceptance checklist

- [ ] reCAPTCHA Enterprise App Check key configured.
- [ ] App Check enforcement verified for Functions and Cloud Firestore.
- [ ] `firestore.rules` and indexes deployed from this repository.
- [ ] Cloud Functions deployed with Supabase secrets.
- [ ] Supabase public/private bucket migration completed.
- [ ] Administrator email is verified, trusted admin claim is present, and the admin profile is approved/active.
- [ ] No hard-coded email grants admin access.
- [ ] Correct voter roster imported/finalized for the correct Election ID before registration opens.
- [ ] Student ID + roster email mismatch remains pending.
- [ ] Two-simultaneous-vote scenario tested.
- [ ] Boundary tests run immediately before/at/after voting close.
- [ ] Suspended/unverified/wrong-department scenarios rejected.
- [ ] Students cannot read ballots, private tallies, or unpublished results.
- [ ] Ordinary officers cannot read candidate tallies before finalization/publication.
- [ ] Admin/canvasser access is tested only after poll close + finalization.
- [ ] Password reset and email verification tested on the production Auth domain.
- [ ] Firestore backup and restore rehearsal completed in staging.
- [ ] Full staging election completed from roster import through archive before a real election.

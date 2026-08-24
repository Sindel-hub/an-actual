# Verify Runtime Crash Fix

This patch addresses the repeated generic `internal` error returned by the `adminUpdateUser` callable during student verification.

## Root cause addressed
Older student profiles may not contain optional fields such as `officePosition`. Those `undefined` values were included in the audit payload. Firestore rejects undefined properties unless configured otherwise, which can cause an unhandled callable exception after the user profile/claims update has already run.

## Changes
- Firestore Admin now ignores undefined properties defensively.
- Audit payloads are sanitized recursively before write.
- Student/admin custom claims no longer write a nullable `adminAuthMode` value for non-admins.
- `adminUpdateUser` now reports the stage that failed: profile write, claim synchronization, or audit write.
- An audit-only failure no longer turns an otherwise successful verification into a misleading `internal` popup.
- Added regression coverage for missing optional legacy fields.

## Deployment
Redeploy Functions after applying this patch:

`npx.cmd firebase deploy --only functions`

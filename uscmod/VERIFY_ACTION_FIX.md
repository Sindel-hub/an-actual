# Admin Verify Action Fix

The admin Verify button previously had two independent problems:

1. Cloud Functions enforced Firebase App Check even during local development at `127.0.0.1`, while the project still had an App Check site-key placeholder. The first privileged callable action could therefore fail before reaching the function handler.
2. The admin UI calculated `isVerifiedStudent`, but `adminUpdateUser` did not receive or write that field.

## Development deployment

Set the Functions environment variable `USC_ENFORCE_APP_CHECK=false` while developing locally, deploy Functions, and retry.

## Production

Configure Firebase App Check with a valid reCAPTCHA Enterprise site key, then deploy Functions with `USC_ENFORCE_APP_CHECK=true`.

Verification changes are now server-side, audited, mirrored to the trusted Firebase custom claim, and produce a useful error if a Firestore profile has no matching Firebase Authentication user.

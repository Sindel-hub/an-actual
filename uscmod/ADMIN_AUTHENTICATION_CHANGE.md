# Administrator Authentication Change

This build replaces mandatory TOTP/authenticator-app enrollment with **Verified Email Administrator Mode**.

Administrator access now requires all of the following:

1. Successful Firebase email/password sign-in.
2. Firebase `emailVerified === true`.
3. Trusted server-issued custom claim `role: "admin"`.
4. Firestore profile `role: "admin"`, `accountStatus: "approved"`, and `isActive != false`.
5. Sensitive callable operations continue to require recent Firebase authentication.
6. Firestore rules require the authenticated admin token to have `email_verified == true`.

No Google Authenticator or Microsoft Authenticator setup is required in this build.

## Important security trade-off

Verified-email mode is easier to operate but is weaker than true MFA if an administrator password is stolen. For a production election, stronger second-factor authentication should be restored once it can be tested reliably. Keep the System Administrator account password unique and strong, keep the email account itself protected with MFA, and do not distribute the Firebase service-account JSON.

## Existing legacy MFA factor

If Firebase Authentication reports `auth/multi-factor-auth-required`, that specific Firebase user still has an old MFA factor enrolled. Remove/reset that factor in Firebase Authentication before using this mode. A failed TOTP enrollment normally does not create a factor.

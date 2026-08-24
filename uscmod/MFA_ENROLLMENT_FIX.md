# Administrator Authenticator Removed

The mandatory TOTP/authenticator-app requirement has been removed from this build because it was blocking administrator access during local development.

Administrator access now uses **Verified Email Administrator Mode**. See `ADMIN_AUTHENTICATION_CHANGE.md`.

The system still requires:
- Firebase email/password sign-in,
- a verified Firebase email,
- a trusted server-issued `role: admin` custom claim,
- an approved and active Firestore administrator profile, and
- recent authentication for sensitive backend operations.

No authenticator setup key or six-digit TOTP code is requested by the application.

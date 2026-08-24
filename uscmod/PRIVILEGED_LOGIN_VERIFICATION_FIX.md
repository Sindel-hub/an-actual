# Privileged Login Verification Fix

The project previously conflated two different states:

- Firebase Authentication `emailVerified`
- administrator-controlled school/voter verification in Firestore

This caused a privileged user to be marked verified in the Admin Dashboard but still be blocked at login with an email-verification popup.

The corrected school-provisioned model now uses:

- **System Administrator:** trusted Firebase custom claim `role=admin` + approved/active Firestore admin profile.
- **USC Officer:** approved/active Firestore profile with `role=officer`.
- **Student election eligibility:** `isVerifiedStudent` / voter-roster eligibility remains separate and does not represent email verification.
- Firebase email verification may still be sent for recovery/contact verification, but it is not an access-control gate.

After replacing the project, publish the included `firestore.rules` once in Firebase Console because the administrator rule changed.

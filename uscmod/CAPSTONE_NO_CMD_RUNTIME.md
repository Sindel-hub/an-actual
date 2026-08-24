# Capstone No-CMD Runtime

## What changed

The USC system no longer needs a command window, PowerShell window, localhost bridge, Node background service, or service-account JSON to be open during normal operation.

### Student registration flow

1. System Administrator signs in to the web dashboard.
2. Open **User Directory → Register Student + Print Login Slip**.
3. Enter the Student ID and institutional email.
4. Select the SSU College/Campus and Program from dropdowns.
5. Click **Create Student Account**.
6. The browser creates the Firebase Authentication account through an isolated secondary Firebase Auth instance.
7. The primary administrator session writes the protected Firestore school profile and Student ID mapping.
8. Print or download the generated login slip.
9. The student signs in using the institutional email or Student ID plus the issued temporary password.

### Password recovery

Use **Send Password Reset Link**. New student accounts use their institutional email as the Firebase Authentication email, so Firebase can send password recovery directly to that mailbox.

## No terminal during demonstrations

Once the project is configured and hosted, every normal capstone demonstration action is performed from the browser. There are no `.cmd` launcher files in this build.

## Publishing Firestore Rules without CMD

If the rules need to be updated, open Firebase Console → Firestore Database → Rules, paste the contents of `firestore.rules`, then click **Publish**.

## Security boundary

The browser provisioner cannot create an administrator profile. Firestore Rules require the existing trusted Firebase `admin` claim for school-account provisioning. A Firebase Auth account created outside the USC Admin Dashboard has no approved school profile and cannot access protected USC dashboards.

For a real high-stakes production election, a trusted hosted backend is still recommended for ballot and private-file operations. This build prioritizes a clean, self-contained capstone demonstration on Firebase Spark.

## Officer provisioning
The System Administrator can also create USC Officer accounts directly from the browser at `usc-admin/student-registration/officer-registration.html`. Officer accounts receive Student ID/institutional-email login aliases, a generated temporary password, an assigned USC position, a printable/downloadable login slip, and an institutional-email verification message. No CMD/background bridge is required during normal use.

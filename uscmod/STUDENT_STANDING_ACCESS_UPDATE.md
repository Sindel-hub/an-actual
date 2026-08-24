# Student Year Level, Standing, and Access Control

## Student account fields
Administrators record each student's **Year Level** and **Student Standing** when creating the school account. These fields can also be updated later in **System Administrator > User Directory**.

Supported standings:

- `active` — Active / Enrolled
- `leave` — Leave of Absence
- `inactive` — Inactive / Not Enrolled
- `graduated` — Graduated
- `transferred` — Transferred / Changed School
- `withdrawn` — Withdrawn
- `eliminated` — Eliminated / Dismissed

Only `active` accounts are allowed to use student/officer protected pages. All other standings automatically force `isActive: false` and election eligibility to false. The shared authentication guard also watches the profile in real time, so an already signed-in student is signed out when an administrator changes the account to an inactive standing.

## Why "Missing or insufficient permissions" may appear
Browser provisioning requires the Firestore rules shipped with this project. If Firebase still has an older ruleset, account creation may be rejected with `permission-denied`.

One-time setup without a command line:

1. Open Firebase Console.
2. Open **Firestore Database > Rules**.
3. Open this project's `firestore.rules` file in VS Code.
4. Copy the complete rules file into the Firebase Rules editor.
5. Click **Publish**.
6. Sign out of the USC portal and sign in again as System Administrator so the latest authentication token is used.

Normal student/officer registration and account management then run from the web interface.

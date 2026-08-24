# USC Capstone Browser Mode — Firebase Spark

This capstone build is designed so **normal system operation does not require CMD, PowerShell, Node.js, a localhost bridge, or a Windows background service**.

## Student account creation

System Administrator → User Directory → **Register Student + Print Login Slip**.

The page creates the Firebase Authentication student account using a **secondary Firebase Web Auth instance**. The administrator stays signed in on the primary app while the secondary instance creates the student account. The administrator then writes the school-controlled profile and Student ID mapping through Firestore Security Rules.

Students can log in with either:

- their institutional email, or
- their 6-digit Student ID.

The initial temporary password is displayed once so it can be printed or downloaded as a login slip.

## Password recovery

New browser-provisioned student accounts use the real institutional email as the Firebase Authentication email. If the password is forgotten, the administrator or student can send a Firebase password-reset email. No administrator command-line tool is required.

## Runtime vs deployment

No terminal is needed **to use the running system**. The web app can be hosted normally and operated from the browser.

Firestore Security Rules still need to be published once when the project is installed or updated. You can do that in the Firebase Console under **Firestore Database → Rules**, so even that setup does not require a command window.

## Security model

- System Administrator authority still requires the trusted Firebase `admin` custom claim and an approved/active admin profile.
- Browser provisioning can create only ordinary student profiles through Firestore Rules.
- Student and officer access is derived from the administrator-controlled Firestore profile.
- A self-created Firebase Authentication account has no usable USC profile and cannot enter the protected dashboards.
- Passwords are never stored in Firestore.

## Production note

This browser-only Spark architecture is suitable for a capstone demonstration and school-managed portal workflow. For a real high-stakes election, sensitive ballot and private-file operations are stronger when moved to a trusted hosted backend.

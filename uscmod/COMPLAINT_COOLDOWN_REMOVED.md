# Complaint cooldown update

Removed the client and Firestore 20-second complaint submission cooldown.

Changes:
- Students can submit complaints without waiting.
- Firestore rules no longer reject submissions because of the 20-second timer.
- Existing authentication and validation checks remain.

Deploy Firestore rules after applying:
firebase deploy --only firestore:rules

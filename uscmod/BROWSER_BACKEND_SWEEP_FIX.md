# Browser / Spark Runtime Backend Sweep

This capstone build no longer routes normal runtime actions to disabled Firebase Cloud Functions when `USC_FREE_SPARK_MODE` is enabled.

Updated browser adapters cover:
- Event publishing and event images
- Announcement publishing and announcement images
- Complaint status changes, officer replies, and terminal deletion
- Administrator user updates and audit records
- Election context and schedule management
- Voter roster import/finalization
- Candidate application submission/review and private browser-file viewing
- Anonymous ballot submission for capstone browser mode
- Election finalization, result publication, and archive actions
- Officer dashboard metrics

Public event/announcement media and candidacy files use Firestore chunk storage in browser-only mode. Firestore Rules remain the authorization boundary.

After replacing the project, publish the included `firestore.rules` once in Firebase Console > Firestore Database > Rules.

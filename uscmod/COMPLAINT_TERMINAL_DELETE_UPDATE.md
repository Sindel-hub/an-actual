# Complaint Terminal-State Deletion Update

- Officers/admins can permanently delete a complaint only when its persisted status is `Resolved` or `Closed`.
- The Officer Complaint Management page hides the delete action for all non-terminal states.
- Deletion removes Firestore attachment chunks and the complaint document in the same batch.
- A minimal immutable `complaint_case_logs` event is preserved without complaint body or student identity.
- Browser-only Spark mode can now update complaint status directly with strict Firestore rules, so cases can reach Resolved/Closed without a Cloud Function.
- Officer reply submission still requires the trusted backend path; this update does not loosen reply/thread mutation rules.

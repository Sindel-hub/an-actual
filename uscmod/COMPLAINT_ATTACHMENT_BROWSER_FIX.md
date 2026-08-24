# Complaint Attachment Browser Fix

Complaint attachments no longer require the old `createPrivateDownloadUrl` Cloud Function in the no-CMD/browser-only capstone runtime.

New complaint attachments are chunked inside Firestore under:

`complaints/{complaintId}/attachmentChunks/{chunkId}`

The Firestore rules allow the submitting active school student and authorized officers/admins to read those chunks. The Officer Complaint Management page reconstructs the file in memory. Images display directly in the details panel; documents can be opened or downloaded.

Legacy Supabase-backed complaint attachments are still attempted directly when the currently deployed Supabase policy permits browser reads. If an older private attachment was created under the previous backend-only policy and cannot be read, the UI now explains that it is a legacy attachment instead of showing the generic secure-backend popup.

# Complaint Stress + Mobile Responsiveness Update

## Complaint submission hardening
- Uses random Firestore complaint document IDs to avoid collection write hotspots.
- Uses an atomic Firestore transaction for complaint creation + a per-student cooldown record.
- Firestore Rules enforce a 20-second per-account submission cooldown using `request.time`.
- Prevents repeat-click submissions and coordinates duplicate submissions across browser tabs.
- Retries transient Firestore/network failures with bounded exponential backoff.
- Reuses the same complaint document during retries, preventing accidental duplicate records after a lost response.

## Attachment limits
- Images (JPG/PNG/WEBP): maximum 3 MB.
- Documents (PDF/DOC/DOCX): maximum 5 MB.
- Limits are checked in the browser and again in Firestore Security Rules for complaint metadata.

## Mobile dashboard updates
- Student dashboard: larger touch targets, improved horizontal navigation, responsive cards, welcome banner, election card, calendar, bulletin board and modals.
- Officer dashboard: fluid search/profile toolbar, mobile sidebar compatibility, single-column dashboard cards/events, responsive management tools and full-width profile drawer on small screens.

## Deployment
Because Firestore Rules changed, deploy them before relying on the server-enforced complaint cooldown:

`npx.cmd firebase deploy --only firestore:rules,firestore:indexes`

The synthetic test suite validates 25,000 generated complaint references plus the transaction/rate-limit/attachment/mobile implementation. It is not a substitute for a production load test against Firebase/Supabase quotas.

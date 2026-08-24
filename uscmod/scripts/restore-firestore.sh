#!/usr/bin/env bash
set -euo pipefail
: "${FIREBASE_PROJECT_ID:?Set FIREBASE_PROJECT_ID}"
: "${FIRESTORE_EXPORT_URI:?Set FIRESTORE_EXPORT_URI to a tested export path}"
echo "WARNING: importing Firestore data into project ${FIREBASE_PROJECT_ID}."
read -r -p "Type RESTORE to continue: " CONFIRM
[[ "${CONFIRM}" == "RESTORE" ]] || { echo "Cancelled."; exit 1; }
gcloud firestore import "${FIRESTORE_EXPORT_URI}" --project="${FIREBASE_PROJECT_ID}"

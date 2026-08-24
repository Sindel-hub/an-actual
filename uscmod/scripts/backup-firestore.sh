#!/usr/bin/env bash
set -euo pipefail
: "${FIREBASE_PROJECT_ID:?Set FIREBASE_PROJECT_ID}"
: "${FIRESTORE_BACKUP_BUCKET:?Set FIRESTORE_BACKUP_BUCKET, e.g. gs://usc-election-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
gcloud firestore export "${FIRESTORE_BACKUP_BUCKET}/${STAMP}" --project="${FIREBASE_PROJECT_ID}"
echo "Firestore export requested: ${FIRESTORE_BACKUP_BUCKET}/${STAMP}"

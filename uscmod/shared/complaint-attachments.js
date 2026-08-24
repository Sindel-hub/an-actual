import { db } from "../firebase/firebase-config.js";
import { supabase } from "../supabase/supabase-config.js";
import {
  collection,
  getDocs,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

function clean(value = "") { return String(value || "").trim(); }

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function joinBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

export function complaintAttachmentMeta(complaint = {}) {
  return {
    complaintId: clean(complaint.id || complaint.complaintId),
    name: clean(complaint.attachmentName || complaint.fileName) || "Complaint attachment",
    type: clean(complaint.attachmentType || complaint.fileType) || "application/octet-stream",
    size: Number(complaint.attachmentSize || 0) || 0,
    bucket: clean(complaint.attachmentStorageBucket || complaint.bucket),
    path: clean(complaint.attachmentStoragePath || complaint.attachmentPath || complaint.storagePath || complaint.filePath),
    directUrl: clean(complaint.attachmentUrl || complaint.fileUrl || complaint.publicUrl || complaint.url)
  };
}

export function isImageAttachment(meta = {}) {
  return clean(meta.type).startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(clean(meta.name));
}

async function loadFirestoreChunks(meta) {
  if (!meta.complaintId) throw new Error("Complaint reference is missing for this attachment.");
  const snap = await getDocs(query(
    collection(db, "complaints", meta.complaintId, "attachmentChunks"),
    orderBy("index", "asc")
  ));
  if (snap.empty) throw new Error("Attachment data was not found for this complaint.");
  const parts = snap.docs.map((item) => base64ToBytes(clean(item.data()?.payload)));
  return new Blob([joinBytes(parts)], { type: meta.type || "application/octet-stream" });
}

async function loadLegacySupabase(meta) {
  if (meta.directUrl) {
    const response = await fetch(meta.directUrl, { credentials: "omit" });
    if (!response.ok) throw new Error(`Attachment server returned ${response.status}.`);
    return response.blob();
  }
  if (!meta.path || !meta.bucket) throw new Error("Legacy attachment location is incomplete.");
  const { data, error } = await supabase.storage.from(meta.bucket).download(meta.path);
  if (error || !data) throw new Error(error?.message || "Legacy attachment could not be downloaded.");
  return data;
}

export async function loadComplaintAttachmentBlob(complaint = {}) {
  const meta = complaintAttachmentMeta(complaint);
  if (!meta.path && !meta.directUrl && !meta.name) throw new Error("No attachment was submitted.");
  if (meta.bucket === "firestore-chunks" || meta.path === meta.complaintId) {
    return { meta, blob: await loadFirestoreChunks(meta), source: "firestore-chunks" };
  }
  return { meta, blob: await loadLegacySupabase(meta), source: "legacy" };
}

export function downloadBlob(blob, filename = "attachment") {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = clean(filename) || "attachment";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

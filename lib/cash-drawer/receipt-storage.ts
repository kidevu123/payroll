// Petty-cash receipt storage. Receipts are small images/PDFs saved under
// /data/uploads/drawer-receipts with a random name; the path is stored on
// the cash_drawer_entries row. Cashbook (the linked drawer app) writes to
// the same directory via a host mount, so both apps can serve any receipt.

import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? "/data";
export const RECEIPT_DIR = join(STORAGE_ROOT, "uploads", "drawer-receipts");

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const RECEIPT_MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Validate + persist an uploaded receipt. Returns the stored path. */
export async function writeReceiptFile(file: File): Promise<string> {
  if (file.size === 0) throw new Error("Receipt file is empty.");
  if (file.size > RECEIPT_MAX_BYTES) {
    throw new Error(`Receipt too large (max ${RECEIPT_MAX_BYTES / 1024 / 1024} MB).`);
  }
  const ext = RECEIPT_MIME_EXT[file.type];
  if (!ext) throw new Error("Receipts must be PDF, PNG, JPG, or WEBP.");
  await mkdir(RECEIPT_DIR, { recursive: true });
  const path = join(RECEIPT_DIR, `${randomUUID()}.${ext}`);
  await writeFile(path, Buffer.from(await file.arrayBuffer()));
  return path;
}

/** Containment check for serving — the stored path must live in RECEIPT_DIR. */
export function isReceiptPath(path: string): boolean {
  const resolved = resolve(path);
  const root = resolve(RECEIPT_DIR);
  return resolved === root || resolved.startsWith(root + sep);
}

export function receiptMime(path: string): string {
  if (path.endsWith(".pdf")) return "application/pdf";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

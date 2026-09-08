// Payslip e-signature storage. The tablet posts the signature pad's PNG
// as a data URL; we validate it is a real PNG with actual ink, then save
// it under /data/uploads/payslip-signatures/<periodId>/<payslipId>.png.
// The path is stored on the payslip row and inlined into the on-demand
// signature report PDFs. Signatures are written once and never replaced.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? "/data";
export const SIGNATURE_DIR = join(STORAGE_ROOT, "uploads", "payslip-signatures");

/** A 1000x400 pad PNG with a long signature is ~20 KB; 200 KB is generous. */
export const SIGNATURE_MAX_BYTES = 200 * 1024;
/** Longest edge the pad may send — anything bigger is not a signature pad. */
export const SIGNATURE_MAX_EDGE_PX = 2000;
/** Fewer opaque pixels than this is a stray tap, not a signature. */
export const SIGNATURE_MIN_INK_PX = 150;

const DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class SignatureInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureInvalidError";
  }
}

/** Decode the pad's data URL into PNG bytes. Cheap checks only. */
export function parseSignatureDataUrl(input: unknown): Buffer {
  if (typeof input !== "string" || !input.startsWith(DATA_URL_PREFIX)) {
    throw new SignatureInvalidError("Signature must be a PNG image.");
  }
  const b64 = input.slice(DATA_URL_PREFIX.length);
  // base64 inflates 4/3; bail before decoding a huge payload.
  if (b64.length > Math.ceil((SIGNATURE_MAX_BYTES * 4) / 3) + 4) {
    throw new SignatureInvalidError("Signature image is too large.");
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0 || buf.length > SIGNATURE_MAX_BYTES) {
    throw new SignatureInvalidError("Signature image is too large.");
  }
  if (buf.length < PNG_MAGIC.length || !buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new SignatureInvalidError("Signature must be a PNG image.");
  }
  return buf;
}

export type SignatureCheck = { width: number; height: number; inkPixels: number };

/**
 * Decode the PNG and count opaque pixels. The pad draws opaque strokes on
 * a transparent canvas, so ink == alpha > 0. Rejects an empty canvas even
 * if the client-side "has ink" gate was bypassed.
 */
export async function validateSignaturePng(png: Buffer): Promise<SignatureCheck> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(png).metadata();
  } catch {
    throw new SignatureInvalidError("Signature image could not be read.");
  }
  if (meta.format !== "png" || !meta.width || !meta.height) {
    throw new SignatureInvalidError("Signature must be a PNG image.");
  }
  if (meta.width > SIGNATURE_MAX_EDGE_PX || meta.height > SIGNATURE_MAX_EDGE_PX) {
    throw new SignatureInvalidError("Signature image is too large.");
  }
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let inkPixels = 0;
  for (let i = 3; i < data.length; i += info.channels) {
    if ((data[i] ?? 0) > 0) inkPixels += 1;
  }
  if (inkPixels < SIGNATURE_MIN_INK_PX) {
    throw new SignatureInvalidError("Please sign before continuing.");
  }
  return { width: meta.width, height: meta.height, inkPixels };
}

/** Where a payslip's signature lives. Deterministic so a retry cannot fork. */
export function signatureFilePath(periodId: string, payslipId: string): string {
  return join(SIGNATURE_DIR, periodId, `${payslipId}.png`);
}

/** Persist validated PNG bytes. Returns the stored path. */
export async function writeSignatureFile(
  periodId: string,
  payslipId: string,
  png: Buffer,
): Promise<string> {
  const path = signatureFilePath(periodId, payslipId);
  await mkdir(join(SIGNATURE_DIR, periodId), { recursive: true });
  await writeFile(path, png, { flag: "wx" });
  return path;
}

/** Containment check for reading back — the stored path must live in SIGNATURE_DIR. */
export function isSignaturePath(path: string): boolean {
  const resolved = resolve(path);
  const root = resolve(SIGNATURE_DIR);
  return resolved !== root && resolved.startsWith(root + sep);
}

/** Read a stored signature as a data URL for PDF embedding; null if unreadable. */
export async function readSignatureDataUrl(path: string | null | undefined): Promise<string | null> {
  if (!path || !isSignaturePath(path)) return null;
  try {
    const buf = await readFile(path);
    return `${DATA_URL_PREFIX}${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

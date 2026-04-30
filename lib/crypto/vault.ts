// AES-GCM envelope encryption for secrets stored in the Settings table
// (NGTeco credentials, etc).
//
// The key is read once from NGTECO_VAULT_KEY (env). Rotation: introduce
// VAULT_KEY_PRIMARY + VAULT_KEY_SECONDARY in a future revision and decrypt
// against either; for now, single key is fine.

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export type SealedSecret = { ciphertext: string; iv: string };

function getKey(): Buffer {
  const raw = process.env.NGTECO_VAULT_KEY;
  if (!raw) {
    throw new Error(
      "NGTECO_VAULT_KEY is not set. Generate with `openssl rand -base64 32`.",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("NGTECO_VAULT_KEY must decode to 32 bytes (AES-256-GCM).");
  }
  return buf;
}

export function seal(plaintext: string): SealedSecret {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([enc, tag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

export function open(sealed: SealedSecret): string {
  const key = getKey();
  const iv = Buffer.from(sealed.iv, "base64");
  const blob = Buffer.from(sealed.ciphertext, "base64");
  const tag = blob.subarray(blob.length - 16);
  const enc = blob.subarray(0, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

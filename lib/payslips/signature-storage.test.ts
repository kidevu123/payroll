import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { join } from "node:path";
import {
  SIGNATURE_DIR,
  SIGNATURE_MAX_BYTES,
  SignatureInvalidError,
  isSignaturePath,
  parseSignatureDataUrl,
  signatureFilePath,
  validateSignaturePng,
} from "./signature-storage";

async function blankPng(w = 600, h = 200): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
}

/** Transparent canvas with an opaque black "stroke" rectangle. */
async function inkedPng(strokeW = 200, strokeH = 6): Promise<Buffer> {
  const stroke = await sharp({
    create: { width: strokeW, height: strokeH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return sharp(await blankPng())
    .composite([{ input: stroke, left: 40, top: 100 }])
    .png()
    .toBuffer();
}

const toDataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

describe("parseSignatureDataUrl", () => {
  it("decodes a PNG data URL", async () => {
    const png = await inkedPng();
    expect(parseSignatureDataUrl(toDataUrl(png)).equals(png)).toBe(true);
  });

  it("rejects non-strings and non-PNG data URLs", async () => {
    expect(() => parseSignatureDataUrl(null)).toThrow(SignatureInvalidError);
    expect(() => parseSignatureDataUrl("data:image/jpeg;base64,AAAA")).toThrow(
      SignatureInvalidError,
    );
  });

  it("rejects bytes that are not a PNG even with the PNG prefix", () => {
    const jpegish = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);
    expect(() => parseSignatureDataUrl(toDataUrl(jpegish))).toThrow(/PNG/);
  });

  it("rejects an oversize payload before decoding", () => {
    const big = Buffer.alloc(SIGNATURE_MAX_BYTES + 1, 0x89);
    expect(() => parseSignatureDataUrl(toDataUrl(big))).toThrow(/too large/);
  });
});

describe("validateSignaturePng", () => {
  it("accepts a drawing with ink and reports pixel counts", async () => {
    const res = await validateSignaturePng(await inkedPng());
    expect(res.width).toBe(600);
    expect(res.height).toBe(200);
    expect(res.inkPixels).toBe(200 * 6);
  });

  it("rejects an empty canvas", async () => {
    await expect(validateSignaturePng(await blankPng())).rejects.toThrow(/sign before/);
  });

  it("rejects a stray tap (too little ink)", async () => {
    await expect(validateSignaturePng(await inkedPng(10, 4))).rejects.toThrow(/sign before/);
  });

  it("rejects an oversize canvas", async () => {
    const huge = await sharp(await inkedPng())
      .resize({ width: 2400 })
      .png()
      .toBuffer();
    await expect(validateSignaturePng(huge)).rejects.toThrow(/too large/);
  });

  it("rejects garbage bytes", async () => {
    await expect(
      validateSignaturePng(Buffer.from("\x89PNG\r\n\x1a\nnot really", "latin1")),
    ).rejects.toThrow(SignatureInvalidError);
  });
});

describe("paths", () => {
  it("builds a deterministic per-payslip path inside the signature dir", () => {
    const p = signatureFilePath("period-1", "slip-1");
    expect(p).toBe(join(SIGNATURE_DIR, "period-1", "slip-1.png"));
    expect(isSignaturePath(p)).toBe(true);
  });

  it("refuses paths outside the signature dir", () => {
    expect(isSignaturePath("/etc/passwd")).toBe(false);
    expect(isSignaturePath(join(SIGNATURE_DIR, "..", "x.png"))).toBe(false);
    expect(isSignaturePath(SIGNATURE_DIR)).toBe(false);
  });
});

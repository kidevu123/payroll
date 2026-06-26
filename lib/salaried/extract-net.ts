// Best-effort paystub net-pay extraction. Server-only.
//
// Two stages, both graceful:
//   1. extractPdfText()  — pull the text layer out of a PDF buffer using
//      `unpdf` (a serverless-friendly pdf.js build: no worker, no canvas,
//      no native deps — which matters for the standalone Docker bundle).
//   2. suggestNetFromText() — ask the on-network Ollama model for the
//      post-tax net / take-home figure and parse it defensively.
//
// EVERY failure path returns a typed "miss" instead of throwing. The
// caller (upload UI) treats any miss as "leave the net field empty for
// manual entry" — auto-read NEVER blocks upload. Owner directive: "I
// don't want to type the net by hand", but typing must always still work.

import "server-only";

/** Upper bound on characters fed to the model — keeps the prompt small
 *  and the round-trip fast even on a verbose multi-page paystub. */
const MAX_TEXT_CHARS = 12_000;

/** Sanity envelope for a believable net paycheque, in cents.
 *  Rejects absurd parses (e.g. an SSN or a YTD gross misread as net). */
const MIN_NET_CENTS = 1; // > $0.00
const MAX_NET_CENTS = 5_000_000; // $50,000.00 per period

export type NetSuggestion =
  | { kind: "OK"; netCents: number; source: "ollama" }
  | { kind: "NO_TEXT" } // scanned/image PDF — no extractable text layer
  | { kind: "NOT_CONFIGURED" } // Ollama env not set
  | { kind: "NO_MATCH" } // model couldn't find a net figure
  | { kind: "ERROR"; error: string };

/**
 * Extract the embedded text layer from a PDF buffer. Returns the
 * concatenated page text, or null when the PDF has no usable text
 * (scanned image, encrypted, or corrupt). Never throws.
 */
export async function extractPdfText(buf: Uint8Array): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    const joined = Array.isArray(text) ? text.join("\n") : text;
    const trimmed = joined.trim();
    if (trimmed.length < 8) return null; // effectively empty → treat as scanned
    return trimmed.slice(0, MAX_TEXT_CHARS);
  } catch {
    return null;
  }
}

const NET_PROMPT_SYSTEM =
  "You read US payroll paystubs and return ONLY the employee's NET pay " +
  "(also called take-home pay or net amount) for THIS pay period — the " +
  "post-tax dollar amount actually deposited, NOT the gross, NOT a " +
  "year-to-date (YTD) total, NOT a single tax or deduction line. " +
  "Respond with the number alone, no currency symbol, no commas, no " +
  "words, e.g. 1702.42 — and nothing else. If you cannot find a clear " +
  "net pay figure, respond with exactly: NONE";

/**
 * Ask the local Ollama model for the net pay in the given paystub text.
 * Defensive at every step: missing config, network failure, junk output,
 * or out-of-range numbers all collapse to a typed miss.
 */
export async function suggestNetFromText(
  text: string,
): Promise<NetSuggestion> {
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim().replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL?.trim();
  if (!baseUrl || !model) return { kind: "NOT_CONFIGURED" };

  let raw: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          stream: false,
          // Deterministic, terse — we want a single number back.
          options: { temperature: 0 },
          messages: [
            { role: "system", content: NET_PROMPT_SYSTEM },
            {
              role: "user",
              content: `Paystub text:\n\n${text}\n\nNet pay:`,
            },
          ],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      return { kind: "ERROR", error: `Ollama ${res.status}` };
    }
    const data = (await res.json()) as {
      message?: { content?: string };
      error?: string;
    };
    if (data.error) return { kind: "ERROR", error: data.error };
    raw = data.message?.content?.trim() ?? "";
  } catch (err) {
    return {
      kind: "ERROR",
      error: err instanceof Error ? err.message : "Ollama request failed.",
    };
  }

  const netCents = parseNetCents(raw);
  if (netCents === null) return { kind: "NO_MATCH" };
  if (netCents < MIN_NET_CENTS || netCents > MAX_NET_CENTS) {
    return { kind: "NO_MATCH" };
  }
  return { kind: "OK", netCents, source: "ollama" };
}

/**
 * Parse the model's reply into integer cents. Accepts a bare number,
 * tolerates a leading "$", thousands commas, and surrounding prose; picks
 * the FIRST money-shaped token. Returns null for "NONE" / no match.
 */
export function parseNetCents(raw: string): number | null {
  if (!raw) return null;
  if (/^\s*none\s*$/i.test(raw)) return null;
  // Anchor to the WHOLE reply (the prompt demands the number alone). Picking
  // the first money-shaped token meant a leading date/code like "06/15/2026"
  // produced a confident-but-wrong net that still passed the range guard.
  // Anything other than a single money value -> null, so the caller falls back
  // to manual entry instead of silently saving garbage. >2 decimals is rejected
  // by the anchored end (`1685.999` no longer partial-matches).
  const m = raw.match(/^\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$/);
  if (!m || !m[1]) return null;
  const value = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

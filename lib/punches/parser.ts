// Pure CSV parser for NGTeco punch exports.
//
// Inputs: a CSV with a header row. Column mapping is forgiving — we
// recognize a few common forms (snake_case, "Title Case", camelCase) for
// each conceptual field. The parser maps each row to a `PunchCandidate`
// with structured timestamps and a stable hash for dedupe.
//
// Reference column names (case-insensitive, normalized):
//   employee_id        — required. Becomes `ngtecoEmployeeRef`.
//   employee_name      — display, used for surfacing in unmatched-ref UIs.
//   date               — required. ISO 8601 (YYYY-MM-DD) or US M/D/YYYY.
//   punch_in           — required. HH:mm or "YYYY-MM-DD HH:mm" (allows
//                        midnight crossings).
//   punch_out          — optional. Same formats. Empty = incomplete.
//
// Output is the `PunchCandidate[]` plus a parallel list of `ParseError`s
// for rows we couldn't decode. The orchestrator (`import.ts`) decides what
// to do with each (persist as Punch / record as IngestException).
//
// The parser is total: it never throws on bad input. Every error becomes a
// `ParseError` row.

import { createHash } from "crypto";

export type PunchCandidate = {
  /** NGTeco employee identifier; matches Employee.ngtecoEmployeeRef. */
  ngtecoEmployeeRef: string;
  /** Display label for unmatched-ref UIs. */
  ngtecoEmployeeName: string | null;
  /** ISO timestamp (UTC) for clock in. */
  clockIn: string;
  /** ISO timestamp (UTC) for clock out, or null if incomplete. */
  clockOut: string | null;
  /** Stable hash over the row content; used for dedupe. */
  ngtecoRecordHash: string;
  /** Raw row for forensics / audit. */
  raw: Record<string, string>;
};

export type ParseError = {
  rowIndex: number; // 1-based, excluding the header
  reason: string;
  raw: Record<string, string>;
};

export type ParseResult = {
  candidates: PunchCandidate[];
  errors: ParseError[];
};

/**
 * Parse the entire CSV. Empty rows are skipped (not errors).
 *
 * `timezone`: IANA TZ name (e.g. "America/New_York"). Used to interpret
 * naked `HH:mm` punches against the date column. The output ISO string is
 * UTC; the offset comes from the IANA database.
 */
export function parse(csv: string, timezone: string): ParseResult {
  const lines = parseCsvLines(csv);
  if (lines.length === 0) return { candidates: [], errors: [] };
  const header = lines[0]!.map(normalizeHeader);
  const indexOf = (...names: string[]): number => {
    for (const n of names) {
      const idx = header.indexOf(n);
      if (idx >= 0) return idx;
    }
    return -1;
  };
  // NGTeco's actual export uses "Person ID" + "First Name" + "Last Name".
  // Legacy CSV exports use the same. The aliases below cover NGTeco, the
  // legacy Flask app's processing, and a few generic forms we've seen.
  const empIdIdx = indexOf(
    "person_id",
    "employee_id",
    "id",
    "emp_id",
    "ngteco_employee_id",
    "ref",
  );
  const empNameIdx = indexOf("employee_name", "name", "display_name");
  const firstNameIdx = indexOf("first_name", "firstname");
  const lastNameIdx = indexOf("last_name", "lastname", "surname");
  const dateIdx = indexOf("date", "punch_date", "work_date");
  const inIdx = indexOf("punch_in", "in", "clock_in", "clockin", "time_in");
  const outIdx = indexOf("punch_out", "out", "clock_out", "clockout", "time_out");

  const candidates: PunchCandidate[] = [];
  const errors: ParseError[] = [];
  const seenHashes = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!;
    if (cells.every((c) => c === "")) continue;
    const raw: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      raw[header[j]!] = (cells[j] ?? "").trim();
    }
    const empIdRaw = empIdIdx >= 0 ? cells[empIdIdx]?.trim() ?? "" : "";
    // NGTeco emits IDs with leading zeros ("01", "011"); the legacy app and
    // our import script normalize these to "1" / "11". Keep the raw value
    // available for forensic display, but index against the normalized form.
    const empId = normalizePersonId(empIdRaw);
    const date = dateIdx >= 0 ? cells[dateIdx]?.trim() ?? "" : "";
    const inRaw = inIdx >= 0 ? cells[inIdx]?.trim() ?? "" : "";
    const outRaw = outIdx >= 0 ? cells[outIdx]?.trim() ?? "" : "";

    if (!empId) {
      errors.push({ rowIndex: i, reason: "Missing employee id", raw });
      continue;
    }
    if (!date) {
      errors.push({ rowIndex: i, reason: "Missing date", raw });
      continue;
    }
    if (!inRaw) {
      errors.push({ rowIndex: i, reason: "Missing clock in", raw });
      continue;
    }
    const dateIso = normalizeDate(date);
    if (!dateIso) {
      errors.push({ rowIndex: i, reason: `Unrecognized date "${date}"`, raw });
      continue;
    }
    const clockIn = combineDateTime(dateIso, inRaw, timezone);
    if (!clockIn) {
      errors.push({ rowIndex: i, reason: `Unrecognized clock in "${inRaw}"`, raw });
      continue;
    }
    let clockOut: string | null = null;
    if (outRaw) {
      const out = combineDateTime(dateIso, outRaw, timezone);
      if (!out) {
        errors.push({
          rowIndex: i,
          reason: `Unrecognized clock out "${outRaw}"`,
          raw,
        });
        continue;
      }
      clockOut = out;
      // If clock out is on the same day-string but earlier than clock in,
      // assume it crossed midnight and add 24h.
      const inMs = Date.parse(clockIn);
      const outMs = Date.parse(clockOut);
      if (Number.isFinite(inMs) && Number.isFinite(outMs) && outMs < inMs) {
        clockOut = new Date(outMs + 24 * 60 * 60 * 1000).toISOString();
      }
    }
    const hash = stableHash(empId, dateIso, inRaw, outRaw);
    if (seenHashes.has(hash)) {
      errors.push({
        rowIndex: i,
        reason: `Duplicate row hash within file (${hash})`,
        raw,
      });
      continue;
    }
    seenHashes.add(hash);
    // Display name: prefer "Employee Name" / "Name" / "Display Name", else
    // compose from "First Name" + "Last Name" (the NGTeco shape).
    const directName = empNameIdx >= 0 ? cells[empNameIdx]?.trim() || "" : "";
    const composedName = (() => {
      const f = firstNameIdx >= 0 ? cells[firstNameIdx]?.trim() ?? "" : "";
      const l = lastNameIdx >= 0 ? cells[lastNameIdx]?.trim() ?? "" : "";
      const joined = `${f} ${l}`.trim();
      return joined || null;
    })();
    candidates.push({
      ngtecoEmployeeRef: empId,
      ngtecoEmployeeName: directName || composedName,
      clockIn,
      clockOut,
      ngtecoRecordHash: hash,
      raw,
    });
  }
  return { candidates, errors };
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizePersonId(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("TEMP_")) return raw;
  // Strip leading zeros ("01" → "1") so NGTeco IDs match the canonical form
  // we store in employees.ngteco_employee_ref.
  const numeric = Number(raw.replace(/^0+/, "") || "0");
  if (Number.isFinite(numeric) && /^\d+(\.0)?$/.test(raw.replace(/^0+/, "") || "0")) {
    return String(Math.trunc(numeric));
  }
  return raw;
}

function normalizeDate(s: string): string | null {
  // ISO YYYY-MM-DD already (allow trailing time we'll drop).
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  // US M/D/YYYY or M/D/YY.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (us) {
    const m = us[1]!.padStart(2, "0");
    const d = us[2]!.padStart(2, "0");
    let y = us[3]!;
    if (y.length === 2) {
      // Pivot 2-digit years against the current year. If 20YY would land
      // more than 6 months in the future, treat it as 19YY instead. Catches
      // the common typo "12/27/25" → 2025 even when the current year is 2026.
      const now = new Date();
      const candidate = 2000 + Number(y);
      const candidateDate = new Date(`${candidate}-${m}-${d}T12:00:00Z`);
      const sixMonthsFromNow =
        now.getTime() + 6 * 30 * 24 * 60 * 60 * 1000;
      if (candidateDate.getTime() > sixMonthsFromNow) {
        y = String(candidate - 100);
      } else {
        y = String(candidate);
      }
    }
    return `${y}-${m}-${d}`;
  }
  return null;
}

function combineDateTime(
  dateIso: string,
  timeRaw: string,
  timezone: string,
): string | null {
  // Allow "YYYY-MM-DD HH:mm" — overrides dateIso for the value.
  const fullIso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeRaw);
  if (fullIso) {
    return wallClockToUtc(
      `${fullIso[1]}-${fullIso[2]}-${fullIso[3]}`,
      `${fullIso[4]!.padStart(2, "0")}:${fullIso[5]}`,
      timezone,
    );
  }
  const hhmm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeRaw);
  if (hhmm) {
    return wallClockToUtc(
      dateIso,
      `${hhmm[1]!.padStart(2, "0")}:${hhmm[2]}`,
      timezone,
    );
  }
  return null;
}

/**
 * Convert a wall-clock (date YYYY-MM-DD, time HH:mm) in the given IANA
 * timezone to a UTC ISO timestamp. Uses Intl.DateTimeFormat to get the
 * zone's offset on that date, then composes a Date from the parts.
 */
function wallClockToUtc(
  dateIso: string,
  hhmm: string,
  timezone: string,
): string {
  // Caller passes already-validated forms (`YYYY-MM-DD` and `HH:mm`); the
  // regex guards in normalizeDate / combineDateTime ensure the shape, so we
  // assert non-null on the captures rather than re-checking here.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso)!;
  const t = /^(\d{2}):(\d{2})$/.exec(hhmm)!;
  const y = +m[1]!;
  const mo = +m[2]!;
  const d = +m[3]!;
  const hh = +t[1]!;
  const mm = +t[2]!;
  // Build the assumed UTC instant for the wall clock and probe what TZ the
  // formatter says it's actually in. The diff is the offset to subtract.
  const probe = new Date(Date.UTC(y, mo - 1, d, hh, mm, 0));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(probe);
  // Intl.DateTimeFormat with hour12:false and the year/month/day/hour/minute
  // options always emits these 5 part types, so non-null assertions are safe.
  const get = (k: string) => parts.find((p) => p.type === k)!.value;
  const localY = +get("year");
  const localMo = +get("month");
  const localD = +get("day");
  // V8/JS Intl.DateTimeFormat with hour12:false emits "00" at midnight in
  // every locale we ship. Modulo 24 normalizes the rare "24" some
  // implementations have produced; cheaper than a conditional.
  const localHh = +get("hour") % 24;
  const localMm = +get("minute");
  const utcAsLocal = Date.UTC(localY, localMo - 1, localD, localHh, localMm, 0);
  const offsetMs = probe.getTime() - utcAsLocal;
  return new Date(probe.getTime() + offsetMs).toISOString();
}

function stableHash(...parts: string[]): string {
  return createHash("sha256")
    .update(parts.join(" "))
    .digest("hex")
    .slice(0, 32);
}

function parseCsvLines(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

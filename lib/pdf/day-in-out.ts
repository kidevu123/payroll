// Per-day clock-in / clock-out for the payslip PDFs: the earliest in and the
// latest out of each company-timezone day. Was copied across the three PDF
// builders.
import { companyDayIso } from "@/lib/time/company-day";

export function tzDayKey(d: Date, tz: string): string {
  return companyDayIso(d, tz);
}

export function tzTimeOfDay(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  let h = "00";
  let m = "00";
  let s = "00";
  for (const p of parts) {
    if (p.type === "hour") h = p.value === "24" ? "00" : p.value;
    else if (p.type === "minute") m = p.value;
    else if (p.type === "second") s = p.value;
  }
  return `${h}:${m}:${s}`;
}

export function buildDayInOut(
  punches: {
    clockIn: Date | string;
    clockOut: Date | string | null;
    voidedAt?: Date | string | null;
  }[],
  tz: string,
): Map<string, { inTime?: string; outTime?: string }> {
  const out = new Map<string, { inMs: number; outMs: number }>();
  for (const p of punches) {
    if (p.voidedAt) continue;
    if (!p.clockOut) continue;
    const inT = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
    const outT = p.clockOut instanceof Date ? p.clockOut : new Date(p.clockOut);
    if (Number.isNaN(inT.getTime()) || Number.isNaN(outT.getTime())) continue;
    if (outT.getTime() <= inT.getTime()) continue;
    const day = tzDayKey(inT, tz);
    const cur = out.get(day);
    if (!cur) {
      out.set(day, { inMs: inT.getTime(), outMs: outT.getTime() });
    } else {
      if (inT.getTime() < cur.inMs) cur.inMs = inT.getTime();
      if (outT.getTime() > cur.outMs) cur.outMs = outT.getTime();
    }
  }
  const formatted = new Map<string, { inTime?: string; outTime?: string }>();
  for (const [day, v] of out) {
    formatted.set(day, {
      inTime: tzTimeOfDay(new Date(v.inMs), tz),
      outTime: tzTimeOfDay(new Date(v.outMs), tz),
    });
  }
  return formatted;
}

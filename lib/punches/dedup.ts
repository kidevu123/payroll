// Render-time dedup for visually-duplicate punches.
//
// Why this exists: the realtime NGTeco poll stores second-precision
// clockIn/clockOut, while the manual CSV importer rounds to the minute
// (parser uses Date.UTC(..., hh, mm, 0)). When the same physical shift is
// imported by both paths the rows have different ngteco_record_hash values
// and both survive the partial unique index. To the human eye they read
// identically (e.g. 10:17a→5:05p) but differ by seconds in the DB.
//
// This helper collapses rows that share the same (in-minute, out-minute)
// per employee and keeps the row with the most data (closed > open;
// longest closed duration wins). Render-only — does NOT mutate the DB.
// Use it in any view that lists punches and in computePay's pre-pass so
// payslips don't double-count.

export type PunchLike = {
  id: string;
  clockIn: Date | string;
  clockOut: Date | string | null;
};

function asDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

export function dedupNearDuplicatePunches<T extends PunchLike>(
  rows: T[],
): T[] {
  if (rows.length <= 1) return rows;
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const inMs = asDate(r.clockIn).getTime();
    const outMs = r.clockOut ? asDate(r.clockOut).getTime() : null;
    const inMinute = Math.floor(inMs / 60_000);
    const outMinute = outMs !== null ? Math.floor(outMs / 60_000) : -1;
    const key = `${inMinute}|${outMinute}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const out: T[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]!);
      continue;
    }
    list.sort((a, b) => {
      const ao = a.clockOut ? 1 : 0;
      const bo = b.clockOut ? 1 : 0;
      if (ao !== bo) return bo - ao;
      const aDur = a.clockOut
        ? asDate(a.clockOut).getTime() - asDate(a.clockIn).getTime()
        : 0;
      const bDur = b.clockOut
        ? asDate(b.clockOut).getTime() - asDate(b.clockIn).getTime()
        : 0;
      return bDur - aDur;
    });
    out.push(list[0]!);
  }
  return out.sort(
    (a, b) => asDate(a.clockIn).getTime() - asDate(b.clockIn).getTime(),
  );
}

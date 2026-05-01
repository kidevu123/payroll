// Generic CSV writer. RFC 4180 quoting: fields with comma, quote, CR, or
// LF get wrapped in double-quotes, with embedded quotes doubled.

export type CsvCell = string | number | boolean | null | undefined | Date;

function fmtCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function quote(raw: string): string {
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function toCsv<Row extends Record<string, CsvCell>>(
  rows: readonly Row[],
  columns: readonly (keyof Row & string)[],
): string {
  const lines: string[] = [];
  lines.push(columns.map(quote).join(","));
  for (const r of rows) {
    lines.push(columns.map((c) => quote(fmtCell(r[c]))).join(","));
  }
  // RFC 4180 says CRLF; most consumers accept LF too. Use CRLF.
  return lines.join("\r\n") + "\r\n";
}

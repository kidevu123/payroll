// Formatting shared by the PDF documents. Pure: these files are bundled by
// esbuild on their own (see the Dockerfile), so keep this free of app imports.
const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** "2026-07-20","2026-07-26" -> "JUL 20 - JUL 26, 2026" */
export function fmtRange(startIso: string, endIso: string): string {
  const s = startIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const e = endIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!s || !e) return `${startIso} - ${endIso}`;
  const sm = MONTHS[parseInt(s[2]!, 10) - 1];
  const em = MONTHS[parseInt(e[2]!, 10) - 1];
  const sd = parseInt(s[3]!, 10);
  const ed = parseInt(e[3]!, 10);
  return `${sm} ${sd} - ${em} ${ed}, ${e[1]}`;
}

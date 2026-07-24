// Admin period report — "payroll approval" redesign (owner reference PDF).
//
// Landscape LETTER, two-page target for ~20 employees. Layout, top to bottom:
//   1. Fixed navy running header band (wordmark + cadence title, period range
//      + subtitle, page N/M) — repeats on every page.
//   2. Four KPI cards: employees, total hours, exact payroll, approved payroll.
//   3. Payroll roster — two-column ID / Employee / Hrs / Exact / Pay table.
//   4. Employee detail — a 4-column grid of per-person cards with a navy header
//      bar, day-by-day punch rows (worked shifts highlighted teal, "No punch"
//      days muted), exact + approved totals, and a sign/date line.
//   5. Fixed footer (generated date + confidential + page).
//
// The renderer drives both the roster and the detail grid from the SAME
// data.employees order so the two always agree row-for-row. Money stays
// integer cents until the final format; hours honor the configured decimals.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { AdminReportInput } from "./types";
import { formatMoney } from "@/lib/utils";

const NAVY = "#16233b";
const NAVY_SOFT = "#334155";
const GOLD = "#c8971f";
const INK = "#0f172a";
const MUTED = "#64748b";
const SUBTLE = "#94a3b8";
const HAIRLINE = "#e6ebf2";
const CARD_BORDER = "#dbe4ee";

const PAGE_PADDING = 22;
const HEADER_H = 52;

const styles = StyleSheet.create({
  page: {
    paddingTop: HEADER_H + 12,
    paddingBottom: 26,
    paddingHorizontal: PAGE_PADDING,
    fontSize: 7,
    fontFamily: "Helvetica",
    color: INK,
  },

  // ── Fixed running header band ──────────────────────────────────────────
  headerBand: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_H,
    backgroundColor: NAVY,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: PAGE_PADDING,
  },
  headerLeft: { flex: 1, justifyContent: "center" },
  headerWordmark: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 0.5,
    marginTop: 1,
  },
  headerCenter: { flex: 1.2, alignItems: "center", justifyContent: "center" },
  headerRange: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 0.5,
  },
  headerSub: {
    fontSize: 7.5,
    color: "#a9b6c8",
    marginTop: 3,
    letterSpacing: 0.3,
  },
  headerRight: { flex: 1, alignItems: "flex-end", justifyContent: "center" },
  headerPage: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#cdd6e4",
    letterSpacing: 0.5,
  },

  // ── KPI cards ──────────────────────────────────────────────────────────
  kpiRow: { flexDirection: "row", marginBottom: 8 },
  kpiCard: {
    flex: 1,
    borderWidth: 0.75,
    borderColor: CARD_BORDER,
    borderRadius: 6,
    backgroundColor: "#ffffff",
    paddingVertical: 7,
    paddingRight: 10,
    paddingLeft: 14,
    position: "relative",
  },
  kpiAccent: {
    position: "absolute",
    left: 6,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
  },
  kpiLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  kpiValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
  },

  // ── Roster ─────────────────────────────────────────────────────────────
  rosterCard: {
    borderWidth: 0.75,
    borderColor: CARD_BORDER,
    borderRadius: 6,
    backgroundColor: "#ffffff",
    padding: 8,
    marginBottom: 9,
  },
  rosterHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 5,
  },
  rosterTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    letterSpacing: 0.6,
  },
  rosterTotals: { fontSize: 8.5, fontFamily: "Helvetica-Bold" },
  rosterCols: { flexDirection: "row" },
  rosterCol: { width: "50%", paddingHorizontal: 4 },
  rosterTh: {
    flexDirection: "row",
    backgroundColor: "#f4f7fb",
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 4,
    marginBottom: 1,
  },
  rosterThText: {
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    letterSpacing: 0.6,
  },
  rosterTr: {
    flexDirection: "row",
    paddingVertical: 1.3,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderColor: HAIRLINE,
  },
  rcId: { width: 46, color: SUBTLE, paddingRight: 3 },
  rcName: { flex: 1, color: INK },
  rcHrs: { width: 40, textAlign: "right", color: MUTED },
  rcExact: { width: 48, textAlign: "right", color: MUTED },
  rcPay: {
    width: 40,
    textAlign: "right",
    fontFamily: "Helvetica-Bold",
    color: NAVY,
  },

  // ── Detail section ─────────────────────────────────────────────────────
  detailHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 6,
  },
  detailTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    letterSpacing: 0.8,
  },
  detailHint: { fontSize: 7, color: SUBTLE },

  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  cardOuter: { width: "25%", paddingHorizontal: 4, marginBottom: 6 },
  card: {
    borderWidth: 0.75,
    borderColor: CARD_BORDER,
    borderRadius: 5,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  cardHeader: {
    backgroundColor: NAVY,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  cardName: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    flex: 1,
  },
  cardId: { fontSize: 6.5, color: "#9fb0c6", marginLeft: 4 },
  cardBody: { paddingHorizontal: 7, paddingTop: 4, paddingBottom: 5 },

  rateRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 0.5,
    borderColor: HAIRLINE,
    paddingBottom: 2,
    marginBottom: 1,
  },
  rate: { fontSize: 7, fontFamily: "Helvetica-Bold", color: NAVY, flex: 1 },
  colHead: { fontSize: 5.5, fontFamily: "Helvetica-Bold", color: SUBTLE, letterSpacing: 0.4 },

  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 1.1,
    borderRadius: 2,
  },
  dayRowWorked: { backgroundColor: "#e8f7f2" },
  cDate: { width: "22%", fontSize: 6.5, color: MUTED },
  cDateWorked: { fontFamily: "Helvetica-Bold", color: INK },
  cIn: { width: "19%", fontSize: 6.5, color: INK },
  cOut: { width: "19%", fontSize: 6.5, color: INK },
  cHrs: { width: "18%", fontSize: 6.5, textAlign: "right", color: INK },
  cPay: { width: "22%", fontSize: 6.5, textAlign: "right", color: INK },
  cHrsWorked: { fontFamily: "Helvetica-Bold" },
  cPayWorked: { fontFamily: "Helvetica-Bold", color: NAVY },
  noPunch: { color: SUBTLE },
  taskRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1.4,
  },
  taskLabel: { fontSize: 6, color: MUTED, flex: 1 },
  taskAmt: { fontSize: 6, fontFamily: "Helvetica-Bold", color: NAVY },

  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 0.75,
    borderColor: "#cbd5e1",
    marginTop: 3,
    paddingTop: 3,
  },
  totalsLabel: { fontSize: 6, fontFamily: "Helvetica-Bold", color: MUTED, letterSpacing: 0.5 },
  totalsExact: { fontSize: 8, fontFamily: "Helvetica-Bold", color: INK, marginLeft: 3 },
  totalsPayLabel: { fontSize: 6, fontFamily: "Helvetica-Bold", color: MUTED, letterSpacing: 0.5 },

  signRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 5,
  },
  signLabel: { fontSize: 5.5, fontFamily: "Helvetica-Bold", color: SUBTLE, letterSpacing: 0.6 },
  signBlank: {
    flex: 1,
    borderBottomWidth: 0.5,
    borderColor: "#b6c2d3",
    height: 7,
    marginHorizontal: 3,
  },
  dateBlank: {
    width: 42,
    borderBottomWidth: 0.5,
    borderColor: "#b6c2d3",
    height: 7,
    marginLeft: 3,
  },

  // ── Fixed footer ───────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 10,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    borderTopWidth: 0.5,
    borderColor: HAIRLINE,
    paddingTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 6.5, color: SUBTLE, letterSpacing: 0.3 },
  footerRight: { fontSize: 6.5, color: MUTED, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
});

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];
const MONTHS_LONG = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const ROUNDING_LABEL: Record<string, string> = {
  NONE: "exact payroll",
  NEAREST_DOLLAR: "nearest-dollar payroll",
  NEAREST_QUARTER: "nearest-quarter payroll",
  NEAREST_FIFTEEN_MIN_HOURS: "15-minute rounding",
};

function moneyWhole(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function hrs(h: number, decimals: number): string {
  return h.toFixed(decimals);
}

/** "2026-07-20" -> "07/20" */
function fmtDate(iso: string): string {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}` : iso;
}

/** "06:08:34" -> "6:08a" */
function fmtTime(t: string | undefined): string {
  if (!t) return "";
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) return t;
  const h = parseInt(m[1]!, 10);
  const ampm = h < 12 ? "a" : "p";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]}${ampm}`;
}

/** "2026-07-20","2026-07-26" -> "JUL 20 - JUL 26, 2026" */
function fmtRange(startIso: string, endIso: string): string {
  const s = startIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const e = endIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!s || !e) return `${startIso} - ${endIso}`;
  const sm = MONTHS[parseInt(s[2]!, 10) - 1];
  const em = MONTHS[parseInt(e[2]!, 10) - 1];
  const sd = parseInt(s[3]!, 10);
  const ed = parseInt(e[3]!, 10);
  return `${sm} ${sd} - ${em} ${ed}, ${e[1]}`;
}

/** "2026-07-24T18:46:37Z" -> "Jul 24, 2026" */
function fmtGenerated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function splitHalf<T>(rows: T[]): [T[], T[]] {
  const mid = Math.ceil(rows.length / 2);
  return [rows.slice(0, mid), rows.slice(mid)];
}

type Employee = AdminReportInput["employees"][number];

export function AdminReport({ data }: { data: AdminReportInput }) {
  const brand = data.company.brandColorHex || "#0f766e";
  const dp = data.rules.hoursDecimalPlaces;
  const locale = data.company.locale;
  const employees = data.employees;

  let grandHours = 0;
  let grandGrossCents = 0;
  let grandRoundedCents = 0;
  for (const e of employees) {
    grandHours += e.totals.hours;
    grandGrossCents += e.totals.grossCents;
    grandRoundedCents += e.totals.roundedCents;
  }

  const title = `${data.scheduleLabel ? `${data.scheduleLabel} ` : ""}PAYROLL`;
  const subtitle = `${employees.length} employee${employees.length === 1 ? "" : "s"}  |  ${
    ROUNDING_LABEL[data.rules.rounding] ?? "payroll"
  }`;
  const range = fmtRange(data.period.startDate, data.period.endDate);
  const generated = fmtGenerated(data.generatedAt);
  const totalsLine = `Exact ${formatMoney(grandGrossCents, locale)}  |  Approved ${moneyWhole(
    grandRoundedCents,
    locale,
  )}`;

  const kpis: { label: string; value: string; accent: string }[] = [
    { label: "EMPLOYEES", value: String(employees.length), accent: brand },
    { label: "TOTAL HOURS", value: hrs(grandHours, dp), accent: brand },
    { label: "EXACT PAYROLL", value: formatMoney(grandGrossCents, locale), accent: brand },
    { label: "APPROVED PAYROLL", value: moneyWhole(grandRoundedCents, locale), accent: GOLD },
  ];

  const [leftRoster, rightRoster] = splitHalf(employees);

  return (
    <Document title={`Payroll ${data.period.startDate} to ${data.period.endDate}`}>
      <Page size="LETTER" orientation="landscape" style={styles.page} wrap>
        {/* Running header band */}
        <View style={styles.headerBand} fixed>
          <View style={styles.headerLeft}>
            <Text style={[styles.headerWordmark, { color: brand }]}>
              {data.company.name.toUpperCase()}
            </Text>
            <Text style={styles.headerTitle}>{title}</Text>
          </View>
          <View style={styles.headerCenter}>
            <Text style={styles.headerRange}>{range}</Text>
            <Text style={styles.headerSub}>{subtitle}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text
              style={styles.headerPage}
              render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
            />
          </View>
        </View>

        {/* KPI cards */}
        <View style={styles.kpiRow}>
          {kpis.map((k, i) => (
            <View
              key={k.label}
              style={[styles.kpiCard, i < kpis.length - 1 ? { marginRight: 10 } : {}]}
            >
              <View style={[styles.kpiAccent, { backgroundColor: k.accent }]} />
              <Text style={styles.kpiLabel}>{k.label}</Text>
              <Text style={styles.kpiValue}>{k.value}</Text>
            </View>
          ))}
        </View>

        {/* Payroll roster */}
        <View style={styles.rosterCard}>
          <View style={styles.rosterHead}>
            <Text style={styles.rosterTitle}>PAYROLL ROSTER</Text>
            <Text style={[styles.rosterTotals, { color: brand }]}>{totalsLine}</Text>
          </View>
          <View style={styles.rosterCols}>
            {[leftRoster, rightRoster].map((col, ci) => (
              <View key={`rc-${ci}`} style={styles.rosterCol}>
                <View style={styles.rosterTh}>
                  <Text style={[styles.rosterThText, styles.rcId]}>ID</Text>
                  <Text style={[styles.rosterThText, styles.rcName]}>EMPLOYEE</Text>
                  <Text style={[styles.rosterThText, styles.rcHrs]}>HRS</Text>
                  <Text style={[styles.rosterThText, styles.rcExact]}>EXACT</Text>
                  <Text style={[styles.rosterThText, styles.rcPay]}>PAY</Text>
                </View>
                {col.map((e, ri) => (
                  <View key={`r-${ci}-${ri}`} style={styles.rosterTr}>
                    <Text style={styles.rcId}>{e.legacyId ?? "—"}</Text>
                    <Text style={styles.rcName}>{e.displayName}</Text>
                    <Text style={styles.rcHrs}>{hrs(e.totals.hours, dp)}</Text>
                    <Text style={styles.rcExact}>
                      {formatMoney(e.totals.grossCents, locale)}
                    </Text>
                    <Text style={styles.rcPay}>
                      {moneyWhole(e.totals.roundedCents, locale)}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>

        {/* Employee detail */}
        <View style={styles.detailHead}>
          <Text style={styles.detailTitle}>EMPLOYEE DETAIL</Text>
          <Text style={styles.detailHint}>Worked shifts highlighted in teal</Text>
        </View>
        <View style={styles.grid}>
          {employees.map((e, i) => (
            <View key={`emp-${i}`} style={styles.cardOuter} wrap={false}>
              <DetailCard employee={e} dp={dp} locale={locale} brand={brand} />
            </View>
          ))}
        </View>

        {/* Running footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Generated {generated}  |  Admin payroll approval
          </Text>
          <Text
            style={styles.footerRight}
            render={({ pageNumber }) => `CONFIDENTIAL  |  PAGE ${pageNumber}`}
          />
        </View>
      </Page>
    </Document>
  );
}

function DetailCard({
  employee,
  dp,
  locale,
  brand,
}: {
  employee: Employee;
  dp: number;
  locale: string;
  brand: string;
}) {
  const rate =
    employee.hourlyRateCents !== null && employee.hourlyRateCents !== undefined
      ? `${formatMoney(employee.hourlyRateCents, locale)}/hr`
      : "";

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName}>{employee.displayName}</Text>
        {employee.legacyId ? (
          <Text style={styles.cardId}>#{employee.legacyId}</Text>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.rateRow}>
          <Text style={styles.rate}>{rate}</Text>
          <Text style={[styles.colHead, styles.cIn]}>IN</Text>
          <Text style={[styles.colHead, styles.cOut]}>OUT</Text>
          <Text style={[styles.colHead, styles.cHrs]}>HRS</Text>
          <Text style={[styles.colHead, styles.cPay]}>PAY</Text>
        </View>

        {employee.days.map((d) => {
          const worked = !d.missing;
          return (
            <View
              key={d.date}
              style={[styles.dayRow, worked ? styles.dayRowWorked : {}]}
            >
              <Text style={[styles.cDate, worked ? styles.cDateWorked : {}]}>
                {fmtDate(d.date)}
              </Text>
              {worked ? (
                <>
                  <Text style={styles.cIn}>{fmtTime(d.inTime)}</Text>
                  <Text style={styles.cOut}>{fmtTime(d.outTime)}</Text>
                  <Text style={[styles.cHrs, styles.cHrsWorked]}>
                    {hrs(d.hours, dp)}
                  </Text>
                  <Text style={[styles.cPay, styles.cPayWorked]}>
                    {formatMoney(d.cents, locale)}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={[styles.cIn, styles.noPunch]}>No punch</Text>
                  <Text style={styles.cOut} />
                  <Text style={styles.cHrs} />
                  <Text style={[styles.cPay, styles.noPunch]}>-</Text>
                </>
              )}
            </View>
          );
        })}

        {employee.taskPay.map((t, ti) => (
          <View key={`task-${ti}`} style={styles.taskRow}>
            <Text style={styles.taskLabel}>{t.description || "Task pay"}</Text>
            <Text style={styles.taskAmt}>{formatMoney(t.amountCents, locale)}</Text>
          </View>
        ))}

        <View style={styles.totalsRow}>
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text style={styles.totalsLabel}>EXACT</Text>
            <Text style={styles.totalsExact}>
              {formatMoney(employee.totals.grossCents, locale)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text style={styles.totalsPayLabel}>PAY</Text>
            <Text
              style={{
                fontSize: 10,
                fontFamily: "Helvetica-Bold",
                color: brand,
                marginLeft: 3,
              }}
            >
              {moneyWhole(employee.totals.roundedCents, locale)}
            </Text>
          </View>
        </View>

        <View style={styles.signRow}>
          <Text style={styles.signLabel}>SIGN</Text>
          <View style={styles.signBlank} />
          <Text style={styles.signLabel}>DATE</Text>
          <View style={styles.dateBlank} />
        </View>
      </View>
    </View>
  );
}

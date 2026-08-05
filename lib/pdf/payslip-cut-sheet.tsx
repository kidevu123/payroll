// Cuttable payslip sheet — 4-up landscape grid of self-contained payslip
// cards (owner reference redesign). Each card carries a navy header (MILO
// wordmark + employee name + ID), a pay-period / hourly-rate row, a punch
// table (worked days only), and a footer that pairs TOTAL HOURS + GROSS with
// a brand-colored FINAL PAY chip. Cards have dashed borders so the sheet can be cut
// apart, and a fixed min-height + bottom-pinned footer so every card in a row
// lines up. No page-level header/footer — the cards are the whole document.

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
const INK = "#0f172a";
const MUTED = "#64748b";
const SUBTLE = "#94a3b8";
const HAIRLINE = "#e6ebf2";
const ZEBRA = "#f6f8fb";
const CUT = "#c2ccd9";

const PAGE_PADDING = 16;

const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE_PADDING,
    paddingHorizontal: PAGE_PADDING,
    paddingBottom: PAGE_PADDING,
    fontSize: 6.5,
    fontFamily: "Helvetica",
    color: INK,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  cell: { width: "25%", paddingHorizontal: 4, marginBottom: 8 },

  card: {
    borderWidth: 0.75,
    borderColor: CUT,
    borderStyle: "dashed",
    borderRadius: 5,
    overflow: "hidden",
    minHeight: 150,
    flexDirection: "column",
  },

  // ── Card header (navy) ────────────────────────────────────────────────
  cardHeader: {
    backgroundColor: NAVY,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  headerLeft: { flex: 1 },
  wordmark: {
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  name: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  id: {
    fontSize: 7,
    color: "#9fb0c6",
    fontFamily: "Helvetica-Bold",
    marginLeft: 4,
  },

  // ── Body ──────────────────────────────────────────────────────────────
  body: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 6, flex: 1 },

  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 1,
  },
  metaLabel: {
    fontSize: 5.5,
    fontFamily: "Helvetica-Bold",
    color: SUBTLE,
    letterSpacing: 0.6,
  },
  metaValueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  metaValue: { fontSize: 8, fontFamily: "Helvetica-Bold", color: NAVY },

  th: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderRadius: 2,
    paddingVertical: 2.5,
    paddingHorizontal: 3,
  },
  thText: {
    fontSize: 5.5,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    letterSpacing: 0.5,
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 2,
    paddingHorizontal: 3,
    borderRadius: 2,
  },
  trZebra: { backgroundColor: ZEBRA },

  cDate: { width: "25%", fontSize: 6.5 },
  cIn: { width: "22%", fontSize: 6.5, color: MUTED },
  cOut: { width: "22%", fontSize: 6.5, color: MUTED },
  cHrs: { width: "13%", fontSize: 6.5, textAlign: "right" },
  cPay: { width: "18%", fontSize: 6.5, textAlign: "right" },
  cDateBold: { fontFamily: "Helvetica-Bold", color: INK },
  cHrsBold: { fontFamily: "Helvetica-Bold", color: INK },
  cPayBold: { fontFamily: "Helvetica-Bold", color: NAVY },

  taskRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  taskLabel: { fontSize: 6, color: MUTED, flex: 1 },
  taskAmt: { fontSize: 6, fontFamily: "Helvetica-Bold", color: NAVY },

  spacer: { flexGrow: 1, minHeight: 4 },

  // ── Footer: totals + final pay chip ───────────────────────────────────
  footerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderColor: HAIRLINE,
    paddingTop: 5,
  },
  totalsCol: { flex: 1, paddingRight: 6 },
  totalsLine: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 2,
  },
  totalsLabel: {
    fontSize: 5.5,
    fontFamily: "Helvetica-Bold",
    color: SUBTLE,
    letterSpacing: 0.3,
    width: 52,
  },
  totalsValue: { fontSize: 8, fontFamily: "Helvetica-Bold", color: NAVY },
  finalChip: {
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 64,
  },
  finalLabel: {
    fontSize: 5.5,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 0.8,
    marginBottom: 1,
  },
  finalValue: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },

  keep: { fontSize: 5.5, color: SUBTLE, marginTop: 5, letterSpacing: 0.3 },
});

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** "2026-07-22" -> "07/22/26" */
function fmtDateMDY(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]!.slice(2)}`;
}

/** "2026-07-20","2026-07-26" -> "JUL 20 - JUL 26, 2026" */
function fmtRange(startIso: string, endIso: string): string {
  const s = startIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const e = endIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!s || !e) return `${startIso} - ${endIso}`;
  const sm = MONTHS[parseInt(s[2]!, 10) - 1];
  const em = MONTHS[parseInt(e[2]!, 10) - 1];
  return `${sm} ${parseInt(s[3]!, 10)} - ${em} ${parseInt(e[3]!, 10)}, ${e[1]}`;
}

export function PayslipCutSheet({ data }: { data: AdminReportInput }) {
  const brand = data.company.brandColorHex || "#067049";
  const dp = data.rules.hoursDecimalPlaces;
  const locale = data.company.locale;
  const range = fmtRange(data.period.startDate, data.period.endDate);

  return (
    <Document title={`Payslips ${data.period.startDate}`}>
      <Page size="LETTER" orientation="landscape" style={styles.page} wrap>
        <View style={styles.grid}>
          {data.employees.map((e, i) => {
            const workedDays = e.days.filter((d) => !d.missing && d.hours > 0);
            const rate =
              e.hourlyRateCents !== null && e.hourlyRateCents !== undefined
                ? formatMoney(e.hourlyRateCents, locale)
                : "—";
            return (
              <View key={i} style={styles.cell} wrap={false}>
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.headerLeft}>
                      <Text style={[styles.wordmark, { color: brand }]}>
                        {data.company.name.toUpperCase()}
                      </Text>
                      <Text style={styles.name}>{e.displayName}</Text>
                    </View>
                    {e.legacyId ? (
                      <Text style={styles.id}>ID {e.legacyId}</Text>
                    ) : null}
                  </View>

                  <View style={styles.body}>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>PAY PERIOD</Text>
                      <Text style={styles.metaLabel}>HOURLY RATE</Text>
                    </View>
                    <View style={styles.metaValueRow}>
                      <Text style={styles.metaValue}>{range}</Text>
                      <Text style={styles.metaValue}>{rate}</Text>
                    </View>

                    <View style={styles.th}>
                      <Text style={[styles.thText, styles.cDate]}>DATE</Text>
                      <Text style={[styles.thText, styles.cIn]}>IN</Text>
                      <Text style={[styles.thText, styles.cOut]}>OUT</Text>
                      <Text style={[styles.thText, styles.cHrs]}>HRS</Text>
                      <Text style={[styles.thText, styles.cPay]}>PAY</Text>
                    </View>
                    {workedDays.map((d, ri) => (
                      <View
                        key={d.date}
                        style={[styles.tr, ri % 2 === 1 ? styles.trZebra : {}]}
                      >
                        <Text style={[styles.cDate, styles.cDateBold]}>
                          {fmtDateMDY(d.date)}
                        </Text>
                        <Text style={styles.cIn}>{d.inTime ?? "—"}</Text>
                        <Text style={styles.cOut}>{d.outTime ?? "—"}</Text>
                        <Text style={[styles.cHrs, styles.cHrsBold]}>
                          {d.hours.toFixed(dp)}
                        </Text>
                        <Text style={[styles.cPay, styles.cPayBold]}>
                          {formatMoney(d.cents, locale)}
                        </Text>
                      </View>
                    ))}

                    {e.taskPay.map((t, j) => (
                      <View key={`task-${j}`} style={styles.taskRow}>
                        <Text style={styles.taskLabel}>
                          {t.description || "Task pay"}
                        </Text>
                        <Text style={styles.taskAmt}>
                          {formatMoney(t.amountCents, locale)}
                        </Text>
                      </View>
                    ))}

                    <View style={styles.spacer} />

                    <View style={styles.footerRow}>
                      <View style={styles.totalsCol}>
                        <View style={styles.totalsLine}>
                          <Text style={styles.totalsLabel}>TOTAL HOURS</Text>
                          <Text style={styles.totalsValue}>
                            {e.totals.hours.toFixed(dp)}
                          </Text>
                        </View>
                        <View style={styles.totalsLine}>
                          <Text style={styles.totalsLabel}>GROSS</Text>
                          <Text style={styles.totalsValue}>
                            {formatMoney(e.totals.grossCents, locale)}
                          </Text>
                        </View>
                      </View>
                      <View style={[styles.finalChip, { backgroundColor: brand }]}>
                        <Text style={styles.finalLabel}>FINAL PAY</Text>
                        <Text style={styles.finalValue}>
                          {new Intl.NumberFormat(locale, {
                            style: "currency",
                            currency: "USD",
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                          }).format(e.totals.roundedCents / 100)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.keep}>Keep for your records</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </Page>
    </Document>
  );
}

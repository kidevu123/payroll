// Admin period report — compact 4-column layout. Owner ask:
// "i want the PDF report to be max 2 pages so i can print it front
// and back in a single page". Tuned for ~22 employees on Letter
// portrait: page 1 = payroll summary table (one row per employee,
// shift subtotals + grand total). Page 2 = per-employee detail
// blocks in a 4-col grid, each block has the employee header,
// day-by-day rows, totals, and a signature line.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { AdminReportInput } from "./types";

const PAGE_PADDING = 16;

// Single typeface throughout (Helvetica + Helvetica-Bold). The
// previous version mixed Helvetica with Courier for numerics, which
// looks dated and ransom-note-y on a payroll PDF. Numbers stay
// right-aligned and tabular via consistent column widths — modern
// payroll software does the same.
const styles = StyleSheet.create({
  page: {
    padding: PAGE_PADDING,
    fontSize: 7,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  summaryTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 1,
  },
  summaryMeta: {
    fontSize: 6.5,
    color: "#64748b",
    marginBottom: 4,
  },
  table: {
    borderWidth: 0.5,
    borderColor: "#cbd5e1",
    borderRadius: 2,
    marginBottom: 6,
  },
  th: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 2.5,
    paddingHorizontal: 5,
    borderBottomWidth: 0.5,
    borderColor: "#cbd5e1",
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 1.75,
    paddingHorizontal: 5,
    borderBottomWidth: 0.25,
    borderColor: "#eef2f7",
  },
  shiftSubtotal: {
    flexDirection: "row",
    paddingVertical: 2,
    paddingHorizontal: 5,
    backgroundColor: "#fff7ed",
    borderBottomWidth: 0.5,
    borderColor: "#cbd5e1",
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
  },
  grandTotal: {
    flexDirection: "row",
    paddingVertical: 2.5,
    paddingHorizontal: 5,
    borderTopWidth: 1,
    borderColor: "#0f172a",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  cId: { width: 36 },
  cName: { flex: 2.4, fontSize: 7 },
  cShift: { width: 60 },
  cHours: { width: 52, textAlign: "right", paddingRight: 6 },
  cPay: { width: 64, textAlign: "right", paddingRight: 6, color: "#475569" },
  // Rounded Pay = what the employee actually receives. Owner ask:
  // "why wouldnt you bold rounded pay since thats what theyd actually
  // receive". Bold weight + brand color + slightly larger for the
  // header AND every row of this column.
  cRounded: {
    width: 72,
    textAlign: "right",
    fontFamily: "Helvetica-Bold",
  },
  // Per-employee detail block (rendered in a 4-col grid for 2-page fit).
  breakdownTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
    marginBottom: 4,
    color: "#475569",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -2,
  },
  block: {
    width: "25%",
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  blockInner: {
    borderWidth: 0.75,
    borderColor: "#cbd5e1",
    borderRadius: 2,
    padding: 3,
  },
  blockHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingBottom: 2,
    marginBottom: 2,
    borderBottomWidth: 0.5,
    borderColor: "#e2e8f0",
  },
  blockName: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    flex: 1,
  },
  blockMeta: {
    fontSize: 6,
    color: "#64748b",
  },
  blockTable: {
    marginBottom: 2,
  },
  blockTr: {
    flexDirection: "row",
    fontSize: 6,
    paddingVertical: 0.75,
  },
  blockTrAlt: {
    backgroundColor: "#fafafa",
  },
  // Per-day row column widths. All cells share the page font; right-
  // aligned numeric columns + tabular widths keep the table grid tidy
  // without resorting to a monospace face.
  bcDate: { width: "24%" },
  bcIn: { width: "20%" },
  bcOut: { width: "20%" },
  bcHours: { width: "16%", textAlign: "right", paddingRight: 4 },
  bcPay: { width: "20%", textAlign: "right" },
  blockTotalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 1.5,
    borderTopWidth: 0.5,
    borderColor: "#e2e8f0",
    fontSize: 6.5,
  },
  blockTotalLabel: {
    fontFamily: "Helvetica-Bold",
  },
  // Two stacked lines: Signature ___________  Date __________ .
  // Owner ask: "add date next to signature, it needs to look better".
  blockSigRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 4,
    fontSize: 5.5,
    color: "#64748b",
  },
  sigBlank: {
    flex: 1,
    borderBottomWidth: 0.5,
    borderColor: "#94a3b8",
    height: 8,
    marginHorizontal: 2,
  },
  dateBlank: {
    width: 36,
    borderBottomWidth: 0.5,
    borderColor: "#94a3b8",
    height: 8,
    marginLeft: 2,
  },
  footer: {
    position: "absolute",
    bottom: 12,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    fontSize: 7,
    color: "#94a3b8",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function money(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

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

function fmtDate(iso: string): string {
  // "2026-04-27" -> "04/27"
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}` : iso;
}

function fmtTime(t: string | undefined): string {
  if (!t) return "—";
  // "06:08:34" -> "6:08a"
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) return t;
  const h = parseInt(m[1]!, 10);
  const ampm = h < 12 ? "a" : "p";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]}${ampm}`;
}

export function AdminReport({ data }: { data: AdminReportInput }) {
  let grandHours = 0;
  let grandGrossCents = 0;
  let grandRoundedCents = 0;
  for (const e of data.employees) {
    grandHours += e.totals.hours;
    grandGrossCents += e.totals.grossCents;
    grandRoundedCents += e.totals.roundedCents;
  }

  const brand = data.company.brandColorHex;

  return (
    <Document
      title={`Admin Report ${data.period.startDate} to ${data.period.endDate}`}
    >
      <Page size="LETTER" orientation="landscape" style={styles.page} wrap>
        <Text style={[styles.summaryTitle, { color: brand }]}>
          {data.company.name} — Payroll {data.period.startDate} to {data.period.endDate}
        </Text>
        <Text style={styles.summaryMeta}>
          {data.employees.length} employee{data.employees.length === 1 ? "" : "s"} ·
          rounding {data.rules.rounding.toLowerCase().replace(/_/g, " ")} ·
          generated {data.generatedAt}
        </Text>

        {/* Owner ask: drop the Shift column + Day/Unassigned subtotals
            and let the page run landscape so the summary stays
            single-page. Employees are now a flat alphabetical list
            with one grand-total row at the end. */}
        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cId}>ID</Text>
            <Text style={styles.cName}>Employee</Text>
            <Text style={styles.cHours}>Hours</Text>
            <Text style={styles.cPay}>Total</Text>
            <Text style={styles.cRounded}>Rounded</Text>
          </View>

          {data.employees
            .slice()
            .sort((a, b) => a.displayName.localeCompare(b.displayName))
            .map((r, i) => (
              <View key={`row-${i}`} style={styles.tr}>
                <Text style={styles.cId}>{r.legacyId ?? ""}</Text>
                <Text style={styles.cName}>{r.displayName}</Text>
                <Text style={styles.cHours}>
                  {hrs(r.totals.hours, data.rules.hoursDecimalPlaces)}
                </Text>
                <Text style={styles.cPay}>
                  {money(r.totals.grossCents, data.company.locale)}
                </Text>
                <Text style={styles.cRounded}>
                  {moneyWhole(r.totals.roundedCents, data.company.locale)}
                </Text>
              </View>
            ))}

          <View style={styles.grandTotal}>
            <Text style={styles.cId} />
            <Text style={styles.cName}>GRAND TOTAL</Text>
            <Text style={styles.cHours}>
              {hrs(grandHours, data.rules.hoursDecimalPlaces)}
            </Text>
            <Text style={styles.cPay}>
              {money(grandGrossCents, data.company.locale)}
            </Text>
            <Text style={styles.cRounded}>
              {moneyWhole(grandRoundedCents, data.company.locale)}
            </Text>
          </View>
        </View>

        <Text style={[styles.breakdownTitle, { color: brand }]}>
          Detailed breakdown by employee
        </Text>

        {/* 3-column grid of employee blocks. wrap=true on the page +
            wrap=false on the block lets blocks flow to subsequent
            pages without splitting individual blocks. */}
        <View style={styles.grid}>
          {data.employees.map((e, idx) => (
            <View key={`emp-${idx}`} style={styles.block} wrap={false}>
              <View style={styles.blockInner}>
                <View style={styles.blockHeader}>
                  <Text style={styles.blockName}>{e.displayName}</Text>
                  {e.legacyId && (
                    <Text style={styles.blockMeta}>#{e.legacyId}</Text>
                  )}
                </View>
                <Text style={styles.blockMeta}>
                  {e.hourlyRateCents !== null && e.hourlyRateCents !== undefined
                    ? `${money(e.hourlyRateCents, data.company.locale)}/hr`
                    : ""}
                </Text>

                <View style={[styles.blockTable, { marginTop: 3 }]}>
                  {e.days.map((d) => (
                    <View
                      key={d.date}
                      style={[
                        styles.blockTr,
                        d.missing ? { backgroundColor: "#fef3c7" } : {},
                      ]}
                    >
                      <Text style={styles.bcDate}>{fmtDate(d.date)}</Text>
                      {d.missing ? (
                        <>
                          <Text
                            style={[
                              styles.bcIn,
                              { color: "#92400e", fontFamily: "Helvetica" },
                            ]}
                          >
                            (no record)
                          </Text>
                          <Text style={styles.bcOut} />
                          <Text style={styles.bcHours}>—</Text>
                          <Text style={styles.bcPay}>—</Text>
                        </>
                      ) : (
                        <>
                          <Text style={styles.bcIn}>{fmtTime(d.inTime)}</Text>
                          <Text style={styles.bcOut}>{fmtTime(d.outTime)}</Text>
                          <Text style={styles.bcHours}>
                            {hrs(d.hours, data.rules.hoursDecimalPlaces)}
                          </Text>
                          <Text style={styles.bcPay}>
                            {money(d.cents, data.company.locale)}
                          </Text>
                        </>
                      )}
                    </View>
                  ))}
                </View>

                <View style={styles.blockTotalsRow}>
                  <Text style={styles.blockTotalLabel}>
                    {money(e.totals.grossCents, data.company.locale)}
                  </Text>
                  <Text style={{ fontFamily: "Helvetica-Bold", color: brand }}>
                    {money(e.totals.roundedCents, data.company.locale)}
                  </Text>
                </View>

                <View style={styles.blockSigRow}>
                  <Text>Signature</Text>
                  <View style={styles.sigBlank} />
                  <Text>Date</Text>
                  <View style={styles.dateBlank} />
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {data.company.name} · {data.period.startDate} to {data.period.endDate}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

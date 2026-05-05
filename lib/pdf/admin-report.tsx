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

const styles = StyleSheet.create({
  page: {
    padding: PAGE_PADDING,
    fontSize: 7,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  // Top section: payroll summary table.
  summaryTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 3,
  },
  summaryMeta: {
    fontSize: 7,
    color: "#64748b",
    marginBottom: 5,
  },
  table: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 2,
    marginBottom: 6,
  },
  th: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderColor: "#cbd5e1",
    fontFamily: "Helvetica-Bold",
    fontSize: 6.5,
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 1.5,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderColor: "#e2e8f0",
  },
  shiftSubtotal: {
    flexDirection: "row",
    paddingVertical: 2,
    paddingHorizontal: 4,
    backgroundColor: "#fff7ed",
    borderBottomWidth: 1,
    borderColor: "#cbd5e1",
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
  },
  grandTotal: {
    flexDirection: "row",
    paddingVertical: 2.5,
    paddingHorizontal: 4,
    borderTopWidth: 1.5,
    borderColor: "#0f172a",
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
  },
  cId: { width: 36, fontFamily: "Courier", fontSize: 7 },
  cName: { flex: 2.2 },
  cShift: { width: 60 },
  // paddingRight on hours so a 3-digit value (e.g. 145.44) doesn't
  // visually collide with the dollar-sign of the pay column. Same pattern
  // on pay → rounded.
  cHours: {
    width: 50,
    fontFamily: "Courier",
    textAlign: "right",
    paddingRight: 6,
  },
  cPay: {
    width: 60,
    fontFamily: "Courier",
    textAlign: "right",
    paddingLeft: 4,
    paddingRight: 6,
  },
  cRounded: {
    width: 60,
    fontFamily: "Courier",
    textAlign: "right",
    paddingLeft: 4,
  },
  // Per-employee detail block (rendered in a 4-col grid for 2-page fit).
  breakdownTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
    marginBottom: 3,
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
    fontSize: 5.5,
    color: "#64748b",
  },
  blockTable: {
    marginBottom: 2,
  },
  blockTr: {
    flexDirection: "row",
    fontSize: 5.5,
  },
  blockTrAlt: {
    backgroundColor: "#fafafa",
  },
  // Per-day row column widths. Add explicit right padding on the hours
  // cell so a long hours value (e.g. "12.05") doesn't visually collide
  // with the $-sign of the pay cell. Without this gap the report
  // printed as "12.05$144.60" with no space.
  bcDate: { width: "24%" },
  bcIn: { width: "20%", fontFamily: "Courier" },
  bcOut: { width: "20%", fontFamily: "Courier" },
  bcHours: {
    width: "16%",
    fontFamily: "Courier",
    textAlign: "right",
    paddingRight: 6,
  },
  bcPay: {
    width: "20%",
    fontFamily: "Courier",
    textAlign: "right",
    paddingLeft: 4,
  },
  blockTotalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 1.5,
    borderTopWidth: 0.5,
    borderColor: "#e2e8f0",
    fontSize: 6,
  },
  blockTotalLabel: {
    fontFamily: "Helvetica-Bold",
  },
  blockSig: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 2,
    fontSize: 5,
    color: "#64748b",
  },
  sigBlank: {
    flex: 1,
    borderBottomWidth: 0.5,
    borderColor: "#94a3b8",
    height: 7,
    marginHorizontal: 2,
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

                <View style={styles.blockSig}>
                  <Text>Sig</Text>
                  <View style={styles.sigBlank} />
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

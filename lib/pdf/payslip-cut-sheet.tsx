// Cuttable payslip sheet — 2-col grid, dashed cut lines between rows
// + columns. Each card has the daily In/Out/Hours/Pay table and the
// total + rounded total at the bottom. No signature line, no shift
// label — the owner's spec is "just hours of the person and total" so
// they can scissor along the dashes and hand each employee their own
// slip.
//
// Sizing target: ~22 employees in 1–2 pages on US Letter. Two columns
// at ~50% width, ~7pt body text, dotted internal table borders to
// keep the visual weight low while still showing the daily breakdown.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { AdminReportInput } from "./types";

const PAGE_PADDING = 18;

const styles = StyleSheet.create({
  page: {
    padding: PAGE_PADDING,
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  // Header band at the top of page 1.
  header: {
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
  },
  headerMeta: {
    fontSize: 8,
    color: "#475569",
    marginTop: 1,
  },
  // 2-col grid of payslip cards.
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: "50%",
    padding: 4,
  },
  card: {
    borderWidth: 0.75,
    borderColor: "#94a3b8",
    borderStyle: "dashed",
    borderRadius: 3,
    padding: 6,
  },
  // Header row: name (bold) + ID, second row: period + rate.
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  name: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  id: {
    fontSize: 7.5,
    color: "#475569",
    marginLeft: 4,
  },
  metaLine: {
    fontSize: 6.5,
    color: "#64748b",
    fontStyle: "italic",
    marginTop: 1,
    marginBottom: 4,
  },
  // Daily table.
  th: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 2,
    paddingHorizontal: 3,
    fontFamily: "Helvetica-Bold",
    fontSize: 6.5,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: "#cbd5e1",
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 1.5,
    paddingHorizontal: 3,
    borderBottomWidth: 0.25,
    borderColor: "#e2e8f0",
  },
  cDate: { width: "23%", fontFamily: "Courier" },
  cIn: { width: "22%", fontFamily: "Courier", textAlign: "center" },
  cOut: { width: "22%", fontFamily: "Courier", textAlign: "center" },
  cHours: { width: "13%", fontFamily: "Courier", textAlign: "right" },
  cPay: { width: "20%", fontFamily: "Courier", textAlign: "right" },
  // Totals.
  totalsBlock: {
    marginTop: 3,
    paddingTop: 3,
    borderTopWidth: 0.75,
    borderColor: "#cbd5e1",
  },
  totalLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1,
  },
  // Owner ask: bold Rounded Pay (the amount actually paid) and
  // de-emphasize the gross "Total". Total stays visible as a
  // breakdown line but Rounded Pay is now the headline.
  totalLabel: { fontSize: 7, color: "#64748b" },
  totalValue: {
    fontSize: 7,
    fontFamily: "Helvetica",
    textAlign: "right",
    color: "#64748b",
  },
  roundedLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
  },
  roundedValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },
  empty: { color: "#94a3b8" },
  footer: {
    position: "absolute",
    bottom: 8,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    fontSize: 6,
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

function formatDateMDY(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

function rateLine(
  data: AdminReportInput,
  emp: AdminReportInput["employees"][number],
): string {
  const parts: string[] = [];
  parts.push(
    `Pay Period: ${data.period.startDate} to ${data.period.endDate}`,
  );
  if (emp.hourlyRateCents != null) {
    parts.push(`Hourly Rate: ${money(emp.hourlyRateCents, data.company.locale)}`);
  }
  return parts.join("    ");
}

export function PayslipCutSheet({ data }: { data: AdminReportInput }) {
  return (
    <Document title={`Employee Payslips ${data.period.startDate}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            Employee Payslips - {data.period.startDate} to {data.period.endDate}
          </Text>
          <Text style={styles.headerMeta}>
            Found {data.employees.length}{" "}
            {data.employees.length === 1 ? "employee payslip" : "employee payslips"}
          </Text>
        </View>
        <View style={styles.grid}>
          {data.employees.map((e, i) => (
            <View key={i} style={styles.cell} wrap={false}>
              <View
                style={[
                  styles.card,
                  { borderColor: data.company.brandColorHex },
                ]}
              >
                <View style={styles.row}>
                  <Text style={styles.name}>
                    {e.displayName}
                    {e.legacyId ? (
                      <Text style={styles.id}> ID: {e.legacyId}</Text>
                    ) : null}
                  </Text>
                </View>
                <Text style={styles.metaLine}>{rateLine(data, e)}</Text>

                <View style={styles.th}>
                  <Text style={styles.cDate}>Date</Text>
                  <Text style={styles.cIn}>In</Text>
                  <Text style={styles.cOut}>Out</Text>
                  <Text style={styles.cHours}>Hours</Text>
                  <Text style={styles.cPay}>Pay</Text>
                </View>
                {e.days
                  .filter((d) => !d.missing && d.hours > 0)
                  .map((d) => (
                    <View key={d.date} style={styles.tr}>
                      <Text style={styles.cDate}>{formatDateMDY(d.date)}</Text>
                      <Text
                        style={[styles.cIn, !d.inTime ? styles.empty : {}]}
                      >
                        {d.inTime ?? "—"}
                      </Text>
                      <Text
                        style={[styles.cOut, !d.outTime ? styles.empty : {}]}
                      >
                        {d.outTime ?? "—"}
                      </Text>
                      <Text style={styles.cHours}>
                        {d.hours.toFixed(data.rules.hoursDecimalPlaces)}
                      </Text>
                      <Text style={styles.cPay}>
                        {money(d.cents, data.company.locale)}
                      </Text>
                    </View>
                  ))}

                {e.taskPay.length > 0
                  ? e.taskPay.map((t, j) => (
                      <View key={`task-${j}`} style={styles.tr}>
                        <Text style={[styles.cDate, { width: "55%" }]}>
                          {t.description}
                        </Text>
                        <Text
                          style={[
                            styles.cPay,
                            { width: "45%", marginLeft: "auto" },
                          ]}
                        >
                          {money(t.amountCents, data.company.locale)}
                        </Text>
                      </View>
                    ))
                  : null}

                <View style={styles.totalsBlock}>
                  <View style={styles.totalLine}>
                    <Text style={styles.totalLabel}>
                      Total Hours: {e.totals.hours.toFixed(2)} · gross{" "}
                      {money(e.totals.grossCents, data.company.locale)}
                    </Text>
                    <Text style={styles.totalValue} />
                  </View>
                  <View style={styles.totalLine}>
                    <Text style={styles.roundedLabel}>Pay:</Text>
                    <Text
                      style={[
                        styles.roundedValue,
                        { color: data.company.brandColorHex },
                      ]}
                    >
                      {money(e.totals.roundedCents, data.company.locale)}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.footer} fixed>
          <Text>{data.company.name}</Text>
          <Text>Generated {data.generatedAt}</Text>
        </View>
      </Page>
    </Document>
  );
}

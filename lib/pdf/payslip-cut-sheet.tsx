// Cuttable payslip sheet — compact 4-column landscape cards. Matches the
// owner's reference: title band, page pill, numbered employee cards, daily
// rows, total hours/gross, and a large rounded Pay amount.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { AdminReportInput } from "./types";
import { formatMoney } from "@/lib/utils";

const PAGE_PADDING = 14;

const styles = StyleSheet.create({
  page: {
    paddingTop: 18,
    paddingHorizontal: PAGE_PADDING,
    paddingBottom: 16,
    fontSize: 6.5,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  pagePill: {
    position: "absolute",
    top: 16,
    right: PAGE_PADDING,
    borderWidth: 0.75,
    borderColor: "#c4b5fd",
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    fontSize: 7,
    color: "#0f172a",
    backgroundColor: "#f5f3ff",
  },
  // Header band at the top of page 1.
  header: {
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
  },
  headerMeta: {
    fontSize: 8,
    color: "#475569",
    marginTop: 1,
  },
  // 4-col grid of payslip cards.
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: "25%",
    padding: 3,
  },
  card: {
    borderWidth: 0.5,
    borderColor: "#dbe4f0",
    borderRadius: 4,
    padding: 6,
    minHeight: 142,
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
  badge: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 5,
    paddingTop: 3,
    fontSize: 7,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    color: "#5b21b6",
    backgroundColor: "#ddd6fe",
  },
  id: {
    fontSize: 7,
    color: "#475569",
    marginLeft: 4,
  },
  metaLine: {
    fontSize: 6.25,
    color: "#64748b",
    marginTop: 1,
    marginBottom: 4,
  },
  // Daily table.
  th: {
    flexDirection: "row",
    paddingVertical: 2,
    paddingHorizontal: 2,
    fontFamily: "Helvetica-Bold",
    fontSize: 6,
    borderBottomWidth: 0.5,
    borderTopWidth: 0.5,
    borderStyle: "dashed",
    borderColor: "#c4b5fd",
    color: "#0f766e",
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 1.2,
    paddingHorizontal: 2,
    borderBottomWidth: 0.25,
    borderColor: "#edf2f7",
  },
  cDate: { width: "23%", fontFamily: "Courier" },
  cIn: { width: "22%", fontFamily: "Courier", textAlign: "center" },
  cOut: { width: "22%", fontFamily: "Courier", textAlign: "center" },
  cHours: { width: "13%", fontFamily: "Courier", textAlign: "right" },
  cPay: { width: "20%", fontFamily: "Courier", textAlign: "right" },
  // Totals.
  totalsBlock: {
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 0.5,
    borderStyle: "dashed",
    borderColor: "#c4b5fd",
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
    parts.push(`Hourly Rate: ${formatMoney(emp.hourlyRateCents, data.company.locale)}`);
  }
  return parts.join("    ");
}

export function PayslipCutSheet({ data }: { data: AdminReportInput }) {
  return (
    <Document title={`Employee Payslips ${data.period.startDate}`}>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <Text
          style={styles.pagePill}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
        />
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
                  <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                    <Text style={styles.badge}>{i + 1}</Text>
                    <Text style={styles.name}>{e.displayName}</Text>
                  </View>
                  {e.legacyId ? <Text style={styles.id}>ID: {e.legacyId}</Text> : null}
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
                        {formatMoney(d.cents, data.company.locale)}
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
                          {formatMoney(t.amountCents, data.company.locale)}
                        </Text>
                      </View>
                    ))
                  : null}

                <View style={styles.totalsBlock}>
                  <View style={styles.totalLine}>
                    <Text style={styles.totalLabel}>
                      Total Hours: {e.totals.hours.toFixed(2)} · gross{" "}
                      {formatMoney(e.totals.grossCents, data.company.locale)}
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
                      {formatMoney(e.totals.roundedCents, data.company.locale)}
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

// Compact batch payslip sheet — one employee, multiple pay periods.
// Landscape letter: up to 8 period cards per page (4 columns × 2 rows).
// Weekly payslips (≤7 day rows) pack 8 to a sheet; denser periods use fewer.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { EmployeePayslipBatchInput } from "./types";
import { formatMoney } from "@/lib/utils";

const PAGE_PADDING = 14;
const GRID_COLUMNS = 4;

/** Pick page capacity from the tallest period card in the batch. */
function cardsPerPage(periods: EmployeePayslipBatchInput["periods"]): number {
  const maxRows = Math.max(
    1,
    ...periods.map(
      (p) =>
        p.days.filter((d) => d.hours > 0).length + p.taskPay.length,
    ),
  );
  if (maxRows <= 7) return 8;
  if (maxRows <= 11) return 4;
  return 2;
}

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
  header: {
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
  },
  headerMeta: {
    fontSize: 8,
    color: "#475569",
    marginTop: 1,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / GRID_COLUMNS}%`,
    padding: 2,
  },
  card: {
    borderWidth: 0.5,
    borderColor: "#dbe4f0",
    borderRadius: 4,
    padding: 5,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  periodTitle: {
    fontSize: 8,
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
  metaLine: {
    fontSize: 6.25,
    color: "#64748b",
    marginTop: 2,
    marginBottom: 4,
  },
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
  totalLabel: { fontSize: 7, color: "#64748b" },
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function PayslipBatchSheet({ data }: { data: EmployeePayslipBatchInput }) {
  const perPage = cardsPerPage(data.periods);
  const pages = chunk(data.periods, perPage);
  const empMeta = [
    data.employee.legacyId ? `ID: ${data.employee.legacyId}` : null,
    data.employee.hourlyRateCents != null
      ? `Rate: ${formatMoney(data.employee.hourlyRateCents, data.company.locale)}`
      : null,
    data.employee.shiftName ? `Shift: ${data.employee.shiftName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Document title={`${data.employee.displayName} — payslips`}>
      {pages.map((periods, pageIdx) => (
        <Page key={pageIdx} size="LETTER" orientation="landscape" style={styles.page}>
          <Text
            style={styles.pagePill}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
            fixed
          />
          {pageIdx === 0 ? (
            <View style={styles.header}>
              <Text style={styles.headerTitle}>{data.employee.displayName}</Text>
              <Text style={styles.headerMeta}>
                {empMeta || data.company.name} · {data.periods.length}{" "}
                {data.periods.length === 1 ? "pay period" : "pay periods"}
              </Text>
            </View>
          ) : null}
          <View style={styles.grid}>
            {periods.map((period, i) => {
              const n = pageIdx * perPage + i + 1;
              return (
                <View key={`${period.startDate}-${period.endDate}`} style={styles.cell} wrap={false}>
                  <View
                    style={[
                      styles.card,
                      { borderColor: data.company.brandColorHex },
                    ]}
                  >
                    <View style={styles.row}>
                      <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                        <Text style={styles.badge}>{n}</Text>
                        <Text style={styles.periodTitle}>
                          {period.startDate} – {period.endDate}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.th}>
                      <Text style={styles.cDate}>Date</Text>
                      <Text style={styles.cIn}>In</Text>
                      <Text style={styles.cOut}>Out</Text>
                      <Text style={styles.cHours}>Hrs</Text>
                      <Text style={styles.cPay}>Pay</Text>
                    </View>
                    {period.days
                      .filter((d) => d.hours > 0)
                      .map((d) => (
                        <View key={d.date} style={styles.tr}>
                          <Text style={styles.cDate}>{formatDateMDY(d.date)}</Text>
                          <Text style={[styles.cIn, !d.inTime ? styles.empty : {}]}>
                            {d.inTime ?? "—"}
                          </Text>
                          <Text style={[styles.cOut, !d.outTime ? styles.empty : {}]}>
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

                    {period.taskPay.map((t, j) => (
                      <View key={`task-${j}`} style={styles.tr}>
                        <Text style={[styles.cDate, { width: "55%" }]}>
                          {t.description}
                        </Text>
                        <Text
                          style={[styles.cPay, { width: "45%", marginLeft: "auto" }]}
                        >
                          {formatMoney(t.amountCents, data.company.locale)}
                        </Text>
                      </View>
                    ))}

                    <View style={styles.totalsBlock}>
                      <View style={styles.totalLine}>
                        <Text style={styles.totalLabel}>
                          {period.totals.hours.toFixed(2)} h · gross{" "}
                          {formatMoney(period.totals.grossCents, data.company.locale)}
                        </Text>
                      </View>
                      <View style={styles.totalLine}>
                        <Text style={styles.roundedLabel}>Pay:</Text>
                        <Text
                          style={[
                            styles.roundedValue,
                            { color: data.company.brandColorHex },
                          ]}
                        >
                          {formatMoney(period.totals.roundedCents, data.company.locale)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
          <View style={styles.footer} fixed>
            <Text>{data.company.name}</Text>
            <Text>Generated {data.generatedAt}</Text>
          </View>
        </Page>
      ))}
    </Document>
  );
}

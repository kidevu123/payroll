// Individual Payslip PDF — single-page US Letter portrait.
//
// Per spec §10: header band → employee block → daily table → subtotals →
// task pay → total card → footer. No emoji. Numbers monospace + right-
// aligned. Brand color comes from company settings.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  Font,
} from "@react-pdf/renderer";
import type { PayslipDocInput } from "./types";

// Avoid network font fetches — register the Helvetica/Times built-ins only.
Font.registerHyphenationCallback((w) => [w]);

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  band: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 8,
    borderBottomWidth: 2,
    marginBottom: 16,
  },
  bandTitle: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  bandSub: { fontSize: 10, color: "#475569" },
  bandRight: { alignItems: "flex-end" },
  block: { marginBottom: 14 },
  blockH: { fontSize: 9, color: "#64748b", marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  blockBody: { fontSize: 11 },
  table: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    marginBottom: 14,
  },
  th: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderColor: "#f1f5f9",
  },
  trAlt: { backgroundColor: "#fafbfc" },
  cellDate: { width: 100 },
  cellNum: { flex: 1, fontFamily: "Courier", textAlign: "right" },
  cellLabel: { flex: 1, color: "#64748b", fontSize: 9 },
  totalCard: {
    borderWidth: 2,
    borderRadius: 6,
    padding: 12,
    marginTop: 4,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  totalLabel: { fontSize: 10, color: "#475569" },
  totalValue: { fontFamily: "Courier", fontSize: 11 },
  grandLabel: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  grandValue: { fontFamily: "Courier-Bold", fontSize: 14 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 8,
    color: "#94a3b8",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  ot: { color: "#a16207" },
});

function money(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(cents / 100);
}

function hrs(h: number, decimals: number): string {
  return h.toFixed(decimals);
}

export function PayslipDoc({ data }: { data: PayslipDocInput }) {
  const brand = data.company.brandColorHex;
  return (
    <Document title={`Payslip ${data.employee.displayName} ${data.period.startDate}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={[styles.band, { borderBottomColor: brand }]}>
          <View>
            <Text style={[styles.bandTitle, { color: brand }]}>Pay Statement</Text>
            <Text style={styles.bandSub}>{data.company.name}</Text>
            <Text style={styles.bandSub}>{data.company.address}</Text>
          </View>
          <View style={styles.bandRight}>
            <Text style={styles.bandSub}>Period</Text>
            <Text>
              {data.period.startDate} - {data.period.endDate}
            </Text>
          </View>
        </View>

        <View style={[styles.block, { flexDirection: "row", justifyContent: "space-between" }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.blockH}>Employee</Text>
            <Text style={styles.blockBody}>{data.employee.displayName}</Text>
            {data.employee.legalName !== data.employee.displayName ? (
              <Text style={styles.bandSub}>(Legal: {data.employee.legalName})</Text>
            ) : null}
            {data.employee.legacyId ? (
              <Text style={styles.bandSub}>ID: {data.employee.legacyId}</Text>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.blockH}>Shift</Text>
            <Text style={styles.blockBody}>{data.employee.shiftName ?? "Unassigned"}</Text>
            <Text style={styles.blockH}>Rounding</Text>
            <Text style={styles.blockBody}>{data.rules.rounding}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={[styles.cellDate, styles.cellLabel]}>Date</Text>
            <Text style={styles.cellLabel}>Notes</Text>
            <Text style={[styles.cellNum, styles.cellLabel]}>Hours</Text>
            <Text style={[styles.cellNum, styles.cellLabel]}>Pay</Text>
          </View>
          {data.days.map((d, i) => (
            <View key={d.date} style={[styles.tr, i % 2 ? styles.trAlt : {}]}>
              <Text style={styles.cellDate}>{d.date}</Text>
              <Text style={[styles.cellLabel, d.isOvertime ? styles.ot : {}]}>
                {d.isOvertime ? "Overtime hours" : ""}
              </Text>
              <Text style={styles.cellNum}>{hrs(d.hours, data.rules.hoursDecimalPlaces)}</Text>
              <Text style={styles.cellNum}>{money(d.cents, data.company.locale)}</Text>
            </View>
          ))}
        </View>

        {data.taskPay.length > 0 ? (
          <View style={styles.table}>
            <View style={styles.th}>
              <Text style={[styles.cellDate, styles.cellLabel]}>Task pay</Text>
              <Text style={styles.cellLabel}>Description</Text>
              <Text style={[styles.cellNum, styles.cellLabel]}>Amount</Text>
            </View>
            {data.taskPay.map((t, i) => (
              <View key={i} style={styles.tr}>
                <Text style={styles.cellDate} />
                <Text style={styles.cellLabel}>{t.description}</Text>
                <Text style={styles.cellNum}>{money(t.amountCents, data.company.locale)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={[styles.totalCard, { borderColor: brand }]}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Regular pay</Text>
            <Text style={styles.totalValue}>{money(data.totals.regularCents, data.company.locale)}</Text>
          </View>
          {data.totals.overtimeCents > 0 ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Overtime premium</Text>
              <Text style={styles.totalValue}>{money(data.totals.overtimeCents, data.company.locale)}</Text>
            </View>
          ) : null}
          {data.totals.taskCents > 0 ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Task pay / adjustments</Text>
              <Text style={styles.totalValue}>{money(data.totals.taskCents, data.company.locale)}</Text>
            </View>
          ) : null}
          <View style={[styles.totalRow, { marginTop: 6 }]}>
            <Text style={styles.totalLabel}>
              Hours: <Text style={styles.totalValue}>{hrs(data.totals.hours, data.rules.hoursDecimalPlaces)}</Text>
            </Text>
            <Text style={styles.totalLabel}>
              Gross: <Text style={styles.totalValue}>{money(data.totals.grossCents, data.company.locale)}</Text>
            </Text>
          </View>
          <View
            style={[
              styles.totalRow,
              { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderColor: "#e2e8f0" },
            ]}
          >
            <Text style={styles.grandLabel}>Net pay (rounded)</Text>
            <Text style={[styles.grandValue, { color: brand }]}>
              {money(data.totals.roundedCents, data.company.locale)}
            </Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>Generated {data.generatedAt}</Text>
          <Text>{data.company.name}</Text>
        </View>
      </Page>
    </Document>
  );
}

// Combined admin period report — one page per employee in the legacy
// "Date / In / Out / Hours / Pay" format, then a final-page Payroll Summary
// with shift subtotals + grand total. Mirrors the format the owner has
// historically printed and signed.
//
// Supersedes the older `signature-report.tsx`. The two share no code so
// signature-report can be removed in a follow-up once the publish handler
// is migrated and the audit log no longer references the old artifact.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { AdminReportInput, PayslipDocInput } from "./types";
import { PayslipBody } from "./payslip";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  summaryPage: {
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  summaryTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    marginBottom: 12,
  },
  table: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 3,
    marginBottom: 14,
  },
  th: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderColor: "#cbd5e1",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
  },
  shiftSubtotal: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: "#fff7ed",
    borderBottomWidth: 1,
    borderColor: "#cbd5e1",
    fontFamily: "Helvetica-Bold",
  },
  grandTotal: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderTopWidth: 2,
    borderColor: "#0f172a",
    fontFamily: "Helvetica-Bold",
  },
  cId: { width: 60, fontFamily: "Courier" },
  cName: { flex: 2 },
  cShift: { width: 60 },
  cHours: { width: 80, fontFamily: "Courier", textAlign: "right" },
  cPay: { width: 90, fontFamily: "Courier", textAlign: "right" },
  cRounded: { width: 80, fontFamily: "Courier", textAlign: "right" },
  sun: { fontFamily: "Helvetica-Bold" },
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
  breakdownTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
    marginBottom: 4,
    color: "#475569",
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

export function AdminReport({ data }: { data: AdminReportInput }) {
  // Group employees by shift, preserving the order they arrive in.
  const shifts = new Map<string, AdminReportInput["employees"]>();
  for (const e of data.employees) {
    const k = e.shiftName ?? "Unassigned";
    const list = shifts.get(k) ?? [];
    list.push(e);
    shifts.set(k, list);
  }
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
      {data.employees.map((e, idx) => {
        const slip: PayslipDocInput = {
          company: data.company,
          employee: {
            displayName: e.displayName,
            legalName: e.legalName,
            legacyId: e.legacyId,
            shiftName: e.shiftName,
            hourlyRateCents: e.hourlyRateCents,
          },
          period: data.period,
          rules: data.rules,
          days: e.days,
          totals: e.totals,
          taskPay: e.taskPay,
          generatedAt: data.generatedAt,
        };
        return (
          <Page
            key={`emp-${idx}-${e.legacyId ?? e.displayName}`}
            size="LETTER"
            style={styles.page}
          >
            <PayslipBody data={slip} />
            <View style={styles.footer} fixed>
              <Text>
                {data.company.name} - {data.period.startDate} to {data.period.endDate}
              </Text>
              <Text>Generated {data.generatedAt}</Text>
            </View>
          </Page>
        );
      })}

      <Page size="LETTER" style={styles.summaryPage}>
        <Text style={[styles.summaryTitle, { color: brand }]}>
          Payroll Summary - {data.period.startDate} to {data.period.endDate}
        </Text>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cId}>Person ID</Text>
            <Text style={styles.cName}>Employee Name</Text>
            <Text style={styles.cShift}>Shift</Text>
            <Text style={styles.cHours}>Total Hours</Text>
            <Text style={styles.cPay}>Total Pay</Text>
            <Text style={styles.cRounded}>Rounded Pay</Text>
          </View>

          {[...shifts.entries()].map(([shiftName, rows]) => {
            let sHours = 0;
            let sGross = 0;
            let sRounded = 0;
            for (const r of rows) {
              sHours += r.totals.hours;
              sGross += r.totals.grossCents;
              sRounded += r.totals.roundedCents;
            }
            return (
              <View key={`shift-${shiftName}`}>
                {rows.map((r, i) => (
                  <View key={`row-${shiftName}-${i}`} style={styles.tr}>
                    <Text style={styles.cId}>{r.legacyId ?? ""}</Text>
                    <Text style={styles.cName}>
                      <Text style={[styles.sun, { color: brand }]}>{"☀  "}</Text>
                      {r.displayName}
                    </Text>
                    <Text style={styles.cShift}>{r.shiftName ?? "Unassigned"}</Text>
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
                <View style={styles.shiftSubtotal}>
                  <Text style={styles.cId} />
                  <Text style={styles.cName}>
                    <Text style={[styles.sun, { color: brand }]}>{"☀  "}</Text>
                    {shiftName} Shift Total
                  </Text>
                  <Text style={styles.cShift} />
                  <Text style={styles.cHours}>
                    {hrs(sHours, data.rules.hoursDecimalPlaces)}
                  </Text>
                  <Text style={styles.cPay}>
                    {money(sGross, data.company.locale)}
                  </Text>
                  <Text style={styles.cRounded}>
                    {moneyWhole(sRounded, data.company.locale)}
                  </Text>
                </View>
              </View>
            );
          })}

          <View style={styles.grandTotal}>
            <Text style={styles.cId} />
            <Text style={styles.cName}>GRAND TOTAL</Text>
            <Text style={styles.cShift} />
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

        <Text style={styles.breakdownTitle}>Detailed Breakdown by Employee</Text>

        <View style={styles.footer} fixed>
          <Text>
            {data.company.name} - {data.period.startDate} to {data.period.endDate}
          </Text>
          <Text>Generated {data.generatedAt}</Text>
        </View>
      </Page>
    </Document>
  );
}

// Individual Payslip PDF — single-page US Letter portrait.
//
// Matches the legacy admin-report per-employee section the owner expects:
//
//   Date:_________
//   ☀  Juan J
//   ID: 9 | Rate: $15.00 | Shift: Day
//   Date         In          Out         Hours    Pay
//   04/16/2026   06:35:03    19:04:54    12.50    $187.50
//   ...
//   Total: $2143.20
//   Rounded Pay: $2143.00
//   Signature:_________
//
// No emoji. The "☀" (U+2600 BLACK SUN WITH RAYS) glyph IS what the owner
// wants as a shift indicator — it's a typographic dingbat, not an emoji.
// Numbers monospace + right-aligned. Brand color comes from company settings.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  Font,
} from "@react-pdf/renderer";
import type { PayslipDocInput } from "./types";

// Avoid network font fetches — register the Helvetica/Courier built-ins only.
Font.registerHyphenationCallback((w) => [w]);

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  dateLine: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 12,
  },
  dateLabel: { fontSize: 10, color: "#0f172a" },
  dateBlank: {
    flexGrow: 1,
    borderBottomWidth: 1,
    borderColor: "#0f172a",
    marginLeft: 4,
    height: 12,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  sun: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    marginRight: 6,
  },
  name: { fontFamily: "Helvetica-Bold", fontSize: 14 },
  meta: { fontSize: 10, color: "#475569", marginBottom: 10 },
  table: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 3,
    marginBottom: 10,
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
  trAlt: { backgroundColor: "#fafbfc" },
  cDate: { width: 80 },
  cIn: { width: 70, fontFamily: "Courier" },
  cOut: { width: 70, fontFamily: "Courier" },
  cHours: { flex: 1, fontFamily: "Courier", textAlign: "right" },
  cPay: { width: 80, fontFamily: "Courier", textAlign: "right" },
  ot: { color: "#a16207" },
  totals: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderColor: "#cbd5e1",
  },
  totalLine: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 2,
  },
  totalLabel: { fontSize: 10, color: "#0f172a", marginRight: 8 },
  totalValue: { fontFamily: "Courier-Bold", fontSize: 11, width: 100, textAlign: "right" },
  taskTable: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 3,
    marginTop: 8,
    marginBottom: 4,
  },
  taskTh: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  taskRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderColor: "#f1f5f9",
  },
  taskDesc: { flex: 1 },
  taskAmt: { width: 80, fontFamily: "Courier", textAlign: "right" },
  signRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  signLabel: { fontSize: 10, color: "#0f172a" },
  signBlank: {
    flexGrow: 1,
    borderBottomWidth: 1,
    borderColor: "#0f172a",
    marginLeft: 4,
    height: 14,
  },
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
});

function money(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function hrs(h: number, decimals: number): string {
  return h.toFixed(decimals);
}

/** Reformat YYYY-MM-DD to MM/DD/YYYY for the legacy daily-row date column. */
function formatDateMDY(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

/**
 * Render the per-employee section the legacy admin report uses. Exported
 * separately so the combined AdminReport can re-use it without duplicating
 * markup. Note: this is a pure JSX fragment — the page-level wrapping is
 * the caller's job.
 */
export function PayslipBody({ data }: { data: PayslipDocInput }) {
  const brand = data.company.brandColorHex;
  const rateLine = (() => {
    const parts: string[] = [];
    if (data.employee.legacyId) parts.push(`ID: ${data.employee.legacyId}`);
    if (
      data.employee.hourlyRateCents !== null &&
      data.employee.hourlyRateCents !== undefined
    ) {
      parts.push(`Rate: ${money(data.employee.hourlyRateCents, data.company.locale)}`);
    }
    parts.push(`Shift: ${data.employee.shiftName ?? "Unassigned"}`);
    return parts.join(" | ");
  })();

  return (
    <View>
      <View style={styles.dateLine}>
        <Text style={styles.dateLabel}>Date:</Text>
        <View style={styles.dateBlank} />
      </View>

      <View style={styles.nameRow}>
        <Text style={[styles.sun, { color: brand }]}>{"☀"}</Text>
        <Text style={styles.name}>{data.employee.displayName}</Text>
      </View>
      <Text style={styles.meta}>{rateLine}</Text>

      <View style={styles.table}>
        <View style={styles.th}>
          <Text style={styles.cDate}>Date</Text>
          <Text style={styles.cIn}>In</Text>
          <Text style={styles.cOut}>Out</Text>
          <Text style={styles.cHours}>Hours</Text>
          <Text style={styles.cPay}>Pay</Text>
        </View>
        {data.days.map((d, i) => (
          <View key={d.date} style={[styles.tr, i % 2 ? styles.trAlt : {}]}>
            <Text style={styles.cDate}>{formatDateMDY(d.date)}</Text>
            <Text style={styles.cIn}>{d.inTime ?? ""}</Text>
            <Text style={styles.cOut}>{d.outTime ?? ""}</Text>
            <Text style={[styles.cHours, d.isOvertime ? styles.ot : {}]}>
              {hrs(d.hours, data.rules.hoursDecimalPlaces)}
            </Text>
            <Text style={styles.cPay}>
              {money(d.cents, data.company.locale)}
            </Text>
          </View>
        ))}
      </View>

      {data.taskPay.length > 0 ? (
        <View style={styles.taskTable}>
          <View style={styles.taskTh}>
            <Text style={styles.taskDesc}>Task pay / adjustments</Text>
            <Text style={styles.taskAmt}>Amount</Text>
          </View>
          {data.taskPay.map((t, i) => (
            <View key={i} style={styles.taskRow}>
              <Text style={styles.taskDesc}>{t.description}</Text>
              <Text style={styles.taskAmt}>
                {money(t.amountCents, data.company.locale)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.totals}>
        <View style={styles.totalLine}>
          <Text style={styles.totalLabel}>Total:</Text>
          <Text style={styles.totalValue}>
            {money(data.totals.grossCents, data.company.locale)}
          </Text>
        </View>
        <View style={styles.totalLine}>
          <Text style={styles.totalLabel}>Rounded Pay:</Text>
          <Text style={[styles.totalValue, { color: brand }]}>
            {money(data.totals.roundedCents, data.company.locale)}
          </Text>
        </View>
      </View>

      <View style={styles.signRow}>
        <Text style={styles.signLabel}>Signature:</Text>
        <View style={styles.signBlank} />
      </View>
    </View>
  );
}

export function PayslipDoc({ data }: { data: PayslipDocInput }) {
  return (
    <Document
      title={`Payslip ${data.employee.displayName} ${data.period.startDate}`}
    >
      <Page size="LETTER" style={styles.page}>
        <PayslipBody data={data} />
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

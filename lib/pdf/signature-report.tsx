// Admin period signature report — single-page US Letter portrait.
// Hard constraint: 25 employees fit on one page. Compress before splitting.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { SignatureReportInput } from "./types";

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  band: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 6,
    borderBottomWidth: 2,
    marginBottom: 8,
  },
  bandTitle: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  table: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 3,
  },
  th: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderColor: "#cbd5e1",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
    minHeight: 18,
  },
  shiftRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 6,
    backgroundColor: "#fff7ed",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    borderBottomWidth: 1,
    borderColor: "#cbd5e1",
  },
  cShift: { width: 60 },
  cName: { flex: 1.6 },
  cId: { width: 50, fontFamily: "Courier", fontSize: 8 },
  cHours: { width: 38, fontFamily: "Courier", textAlign: "right" },
  cPay: { width: 60, fontFamily: "Courier", textAlign: "right" },
  cSig: { flex: 1.2, borderBottomWidth: 1, borderColor: "#94a3b8", marginHorizontal: 4 },
  cDate: { width: 50, borderBottomWidth: 1, borderColor: "#94a3b8" },
  totals: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderTopWidth: 2,
    borderColor: "#0f172a",
    fontFamily: "Helvetica-Bold",
  },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 28,
    right: 28,
    fontSize: 7,
    color: "#94a3b8",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function SignatureReport({ data }: { data: SignatureReportInput }) {
  // Group rows by shift, preserving the order the rows arrive in.
  const shifts = new Map<string, typeof data.rows>();
  for (const r of data.rows) {
    const k = r.shiftName || "Unassigned";
    const list = shifts.get(k) ?? [];
    list.push(r);
    shifts.set(k, list);
  }
  let grandHours = 0;
  let grandCents = 0;

  return (
    <Document title={`Signature Report ${data.period.startDate}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={[styles.band, { borderBottomColor: data.company.brandColorHex }]}>
          <View>
            <Text style={[styles.bandTitle, { color: data.company.brandColorHex }]}>
              Period Signature Report
            </Text>
            <Text>{data.company.name}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text>
              {data.period.startDate} - {data.period.endDate}
            </Text>
            <Text style={{ fontSize: 7, color: "#64748b" }}>
              Generated {data.generatedAt}
            </Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cShift}>Shift</Text>
            <Text style={styles.cName}>Name</Text>
            <Text style={styles.cId}>ID</Text>
            <Text style={styles.cHours}>Hours</Text>
            <Text style={styles.cPay}>Pay</Text>
            <Text style={styles.cSig}>Signature</Text>
            <Text style={styles.cDate}>Date</Text>
          </View>
          {[...shifts.entries()].map(([shift, rows]) => {
            let hSum = 0;
            let cSum = 0;
            for (const r of rows) {
              hSum += r.hours;
              cSum += r.roundedCents;
            }
            grandHours += hSum;
            grandCents += cSum;
            return (
              <View key={shift}>
                <View style={styles.shiftRow}>
                  <Text style={styles.cShift}>{shift}</Text>
                  <Text style={styles.cName}>{rows.length} {rows.length === 1 ? "person" : "people"}</Text>
                  <Text style={styles.cId} />
                  <Text style={styles.cHours}>{hSum.toFixed(2)}</Text>
                  <Text style={styles.cPay}>{fmtMoney(cSum)}</Text>
                  <Text style={styles.cSig} />
                  <Text style={styles.cDate} />
                </View>
                {rows.map((r, i) => (
                  <View key={`${shift}-${i}`} style={styles.tr}>
                    <Text style={styles.cShift} />
                    <Text style={styles.cName}>{r.employeeName}</Text>
                    <Text style={styles.cId}>{r.legacyId ?? ""}</Text>
                    <Text style={styles.cHours}>{r.hours.toFixed(2)}</Text>
                    <Text style={styles.cPay}>{fmtMoney(r.roundedCents)}</Text>
                    <Text style={styles.cSig} />
                    <Text style={styles.cDate} />
                  </View>
                ))}
              </View>
            );
          })}
          <View style={styles.totals}>
            <Text style={styles.cShift}>Grand</Text>
            <Text style={styles.cName} />
            <Text style={styles.cId} />
            <Text style={styles.cHours}>{grandHours.toFixed(2)}</Text>
            <Text style={styles.cPay}>{fmtMoney(grandCents)}</Text>
            <Text style={styles.cSig} />
            <Text style={styles.cDate} />
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{data.company.name}</Text>
          <Text>Signature confirms receipt of pay for the listed period.</Text>
        </View>
      </Page>
    </Document>
  );
}

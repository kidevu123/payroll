// Cut-Sheet payslip mode — 3 columns × N rows of mini-payslips on US
// Letter, with dotted cut lines. Optional output for the print dialog.

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { CutSheetInput } from "./types";

const styles = StyleSheet.create({
  page: {
    padding: 18,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  card: {
    width: "33%",
    padding: 8,
    borderStyle: "dashed",
    borderColor: "#94a3b8",
    borderRightWidth: 1,
    borderBottomWidth: 1,
    minHeight: 90,
  },
  name: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  id: { fontSize: 8, color: "#64748b", marginBottom: 4 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 9,
  },
  num: { fontFamily: "Courier" },
  band: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 6,
    borderBottomWidth: 2,
    marginBottom: 8,
  },
  bandTitle: { fontSize: 14, fontFamily: "Helvetica-Bold" },
});

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function CutSheet({ data }: { data: CutSheetInput }) {
  return (
    <Document title={`Cut-Sheet ${data.period.startDate}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={[styles.band, { borderBottomColor: data.company.brandColorHex }]}>
          <Text style={[styles.bandTitle, { color: data.company.brandColorHex }]}>
            Pay Stub Cut-Sheet
          </Text>
          <Text>
            {data.period.startDate} - {data.period.endDate}
          </Text>
        </View>
        <View style={styles.grid}>
          {data.cards.map((c, i) => (
            <View key={i} style={styles.card}>
              <Text style={styles.name}>{c.employeeName}</Text>
              {c.legacyId ? <Text style={styles.id}>ID: {c.legacyId}</Text> : null}
              <View style={styles.row}>
                <Text>Hours</Text>
                <Text style={styles.num}>{c.hours.toFixed(2)}</Text>
              </View>
              <View style={styles.row}>
                <Text>Net pay</Text>
                <Text style={styles.num}>{money(c.roundedCents)}</Text>
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

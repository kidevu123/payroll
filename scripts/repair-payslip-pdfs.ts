/**
 * Regenerate payslip PDF files for rows missing pdf_path.
 *
 *   npx tsx scripts/repair-payslip-pdfs.ts [--period-start=YYYY-MM-DD]
 *   npx tsx scripts/repair-payslip-pdfs.ts --all-missing
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { payPeriods, payslips } from "@/lib/db/schema";
import { regeneratePayslipPdf } from "@/lib/pdf/render-payslip-pdf";

async function main() {
  const periodArg = process.argv.find((a) => a.startsWith("--period-start="));
  const allMissing = process.argv.includes("--all-missing");
  const periodStart = periodArg?.split("=")[1];

  if (!allMissing && !periodStart) {
    console.error(
      "Usage: repair-payslip-pdfs.ts --period-start=YYYY-MM-DD | --all-missing",
    );
    process.exit(1);
  }

  const rows = await db
    .select({
      id: payslips.id,
      employeeId: payslips.employeeId,
      periodStart: payPeriods.startDate,
    })
    .from(payslips)
    .innerJoin(payPeriods, eq(payslips.periodId, payPeriods.id))
    .where(
      and(
        isNull(payslips.voidedAt),
        sql`(payslips.pdf_path IS NULL OR payslips.pdf_path NOT LIKE '%.pdf')`,
        periodStart ? eq(payPeriods.startDate, periodStart) : sql`true`,
      ),
    )
    .orderBy(payPeriods.startDate);

  if (rows.length === 0) {
    console.log("No payslips need PDF repair.");
    return;
  }

  console.log(`Repairing ${rows.length} payslip PDF(s)…`);
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const pdfPath = await regeneratePayslipPdf(row.id);
      if (!pdfPath) {
        skipped++;
        continue;
      }
      await db
        .update(payslips)
        .set({ pdfPath, generatedAt: new Date() })
        .where(eq(payslips.id, row.id));
      ok++;
      console.log(`  ✓ ${row.periodStart} ${row.employeeId.slice(0, 8)}…`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${row.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Done. ${ok} regenerated, ${skipped} skipped, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

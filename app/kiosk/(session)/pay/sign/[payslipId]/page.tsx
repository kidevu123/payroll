import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payPeriods } from "@/lib/db/schema";
import { listPublishedPayslipsForEmployee } from "@/lib/db/queries/payslips";
import type { KioskLang } from "@/lib/kiosk/copy";
import { PayslipSignScreen } from "../../../../sign-screen";
import { kioskSignPayslipAction, requireKioskEmployee } from "../../../../actions";

export const dynamic = "force-dynamic";

export default async function KioskPaySign({
  params,
}: {
  params: Promise<{ payslipId: string }>;
}) {
  const { payslipId } = await params;
  const employee = await requireKioskEmployee();
  if (!employee) redirect("/kiosk");
  const lang = (employee.language === "es" ? "es" : "en") as KioskLang;

  // Ownership + published gate, and never re-sign.
  const mine = await listPublishedPayslipsForEmployee(employee.id);
  const slip = mine.find((p) => p.id === payslipId);
  if (!slip || slip.signedAt) redirect("/kiosk/pay");
  const [period] = await db
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.id, slip.periodId))
    .limit(1);
  if (!period) redirect("/kiosk/pay");

  return (
    <PayslipSignScreen
      lang={lang}
      slip={slip}
      period={period}
      action={kioskSignPayslipAction}
      backHref="/kiosk/pay"
    />
  );
}

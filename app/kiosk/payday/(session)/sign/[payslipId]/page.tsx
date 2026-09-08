import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import { getPayslipById } from "@/lib/db/queries/payslips";
import { PAYDAY_IDLE_RETURN_S } from "@/lib/kiosk/payday";
import type { KioskLang } from "@/lib/kiosk/copy";
import { PayslipSignScreen } from "../../../../sign-screen";
import { paydaySignPayslipAction, requirePaydayPeriod } from "../../../actions";
import { PaydayIdleReturn } from "../../idle-return";

export const dynamic = "force-dynamic";

export default async function PaydaySignPage({
  params,
}: {
  params: Promise<{ payslipId: string }>;
}) {
  const { payslipId } = await params;
  const period = await requirePaydayPeriod();
  if (!period) redirect("/kiosk/payday");

  // Period gate: only payslips of the unlocked period, published, active,
  // and not yet signed.
  const slip = await getPayslipById(payslipId);
  if (!slip || slip.periodId !== period.id || slip.voidedAt || !slip.publishedAt || slip.signedAt) {
    redirect("/kiosk/payday/list");
  }
  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, slip.employeeId))
    .limit(1);
  if (!employee) redirect("/kiosk/payday/list");
  const lang = (employee.language === "es" ? "es" : "en") as KioskLang;

  return (
    <>
      <PaydayIdleReturn idleSeconds={PAYDAY_IDLE_RETURN_S} />
      <PayslipSignScreen
        lang={lang}
        employeeName={employee.displayName}
        slip={slip}
        period={period}
        action={paydaySignPayslipAction}
        backHref="/kiosk/payday/list"
      />
    </>
  );
}

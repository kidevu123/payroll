import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, payrollRuns, payslips, users } from "@/lib/db/schema";
import { dispatch } from "@/lib/notifications/router";

function messageFor(language: string | null | undefined): {
  title: string;
  body: string;
} {
  if (language === "es") {
    return {
      title: "Recibo de pago listo",
      body: "Tu recibo de pago ya esta listo. Revisalo y apruebalo en la app.",
    };
  }
  return {
    title: "Payslip ready",
    body: "Your payslip is ready. Please review and approve it in the app.",
  };
}

export async function notifyEmployeesPayslipsPublished(
  runId: string,
): Promise<number> {
  const [run] = await db
    .select({
      id: payrollRuns.id,
      periodId: payrollRuns.periodId,
      publishedToPortalAt: payrollRuns.publishedToPortalAt,
    })
    .from(payrollRuns)
    .where(eq(payrollRuns.id, runId));
  if (!run?.publishedToPortalAt) return 0;

  const rows = await db
    .select({
      userId: users.id,
      employeeId: employees.id,
      language: employees.language,
    })
    .from(payslips)
    .innerJoin(employees, eq(payslips.employeeId, employees.id))
    .innerJoin(users, eq(users.employeeId, employees.id))
    .where(
      and(
        eq(payslips.payrollRunId, runId),
        isNull(payslips.voidedAt),
        isNull(users.disabledAt),
      ),
    );

  const seen = new Set<string>();
  const entries = rows.flatMap((row) => {
    if (seen.has(row.userId)) return [];
    seen.add(row.userId);
    const msg = messageFor(row.language);
    return [
      {
        recipientId: row.userId,
        kind: "payroll_run.published" as const,
        payload: {
          periodId: run.periodId,
          runId,
          employeeId: row.employeeId,
          title: msg.title,
          body: msg.body,
        },
        push: {
          title: msg.title,
          body: msg.body,
          url: `/me/pay/${run.periodId}`,
          tag: `payroll_published:${runId}`,
        },
      },
    ];
  });

  await dispatch(entries);
  return entries.length;
}

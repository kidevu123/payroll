// CSV export endpoint. Admin-only. Query string:
//   ?type=employees | payslips | punches | audit | periods
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD (where applicable)

import { NextResponse } from "next/server";
import { desc, eq, and, gte, lte } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import {
  employees,
  payslips,
  payPeriods,
  punches,
  auditLog,
} from "@/lib/db/schema";
import { toCsv } from "@/lib/reports/csv-export";
import { getPeriodTotals } from "@/lib/reports/period-totals";

function attach(filename: string, body: string): Response {
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(req: Request): Promise<Response> {
  await requireAdmin();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  if (type === "employees") {
    const rows = await db.select().from(employees);
    return attach(
      "employees.csv",
      toCsv(
        rows.map((e) => ({
          id: e.id,
          legacyId: e.legacyId ?? "",
          displayName: e.displayName,
          legalName: e.legalName,
          email: e.email,
          phone: e.phone ?? "",
          status: e.status,
          payType: e.payType,
          hourlyRateCents: e.hourlyRateCents ?? "",
          hiredOn: e.hiredOn,
          ngtecoEmployeeRef: e.ngtecoEmployeeRef ?? "",
        })),
        [
          "id",
          "legacyId",
          "displayName",
          "legalName",
          "email",
          "phone",
          "status",
          "payType",
          "hourlyRateCents",
          "hiredOn",
          "ngtecoEmployeeRef",
        ],
      ),
    );
  }

  if (type === "payslips") {
    const rows = await db
      .select({
        id: payslips.id,
        employeeId: payslips.employeeId,
        periodId: payslips.periodId,
        startDate: payPeriods.startDate,
        endDate: payPeriods.endDate,
        hoursWorked: payslips.hoursWorked,
        grossPayCents: payslips.grossPayCents,
        roundedPayCents: payslips.roundedPayCents,
        taskPayCents: payslips.taskPayCents,
        publishedAt: payslips.publishedAt,
        acknowledgedAt: payslips.acknowledgedAt,
      })
      .from(payslips)
      .innerJoin(payPeriods, eq(payslips.periodId, payPeriods.id))
      .where(
        and(
          from ? gte(payPeriods.startDate, from) : undefined,
          to ? lte(payPeriods.startDate, to) : undefined,
        ),
      );
    return attach(
      "payslips.csv",
      toCsv(rows, [
        "id",
        "employeeId",
        "periodId",
        "startDate",
        "endDate",
        "hoursWorked",
        "grossPayCents",
        "roundedPayCents",
        "taskPayCents",
        "publishedAt",
        "acknowledgedAt",
      ]),
    );
  }

  if (type === "punches") {
    const rows = await db
      .select({
        id: punches.id,
        employeeId: punches.employeeId,
        periodId: punches.periodId,
        clockIn: punches.clockIn,
        clockOut: punches.clockOut,
        source: punches.source,
        editedAt: punches.editedAt,
        editReason: punches.editReason,
        voidedAt: punches.voidedAt,
      })
      .from(punches);
    return attach(
      "punches.csv",
      toCsv(rows, [
        "id",
        "employeeId",
        "periodId",
        "clockIn",
        "clockOut",
        "source",
        "editedAt",
        "editReason",
        "voidedAt",
      ]),
    );
  }

  if (type === "audit") {
    const rows = await db
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        actorId: auditLog.actorId,
        actorRole: auditLog.actorRole,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        ip: auditLog.ip,
      })
      .from(auditLog)
      .orderBy(desc(auditLog.id))
      .limit(5000);
    return attach(
      "audit.csv",
      toCsv(rows, [
        "id",
        "createdAt",
        "actorId",
        "actorRole",
        "action",
        "targetType",
        "targetId",
        "ip",
      ]),
    );
  }

  if (type === "periods") {
    const rows = await getPeriodTotals(from, to);
    return attach(
      "period-totals.csv",
      toCsv(rows, [
        "periodId",
        "startDate",
        "endDate",
        "hours",
        "grossCents",
        "roundedCents",
        "taskCents",
        "employeeCount",
      ]),
    );
  }

  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}

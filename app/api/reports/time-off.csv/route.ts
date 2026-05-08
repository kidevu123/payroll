// CSV export for the year-end time-off tally. Mirrors the on-screen
// table at /reports/time-off — same year scope, same per-employee
// rows, same totals semantics.

import { type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { tallyTimeOffByEmployeeForYear } from "@/lib/db/queries/time-off";
import { listEmployees } from "@/lib/db/queries/employees";
import { getSetting } from "@/lib/settings/runtime";
import { toCsv } from "@/lib/reports/csv-export";

const HOURS_PER_DAY = 8;

export async function GET(req: NextRequest): Promise<Response> {
  await requireAdmin();
  const company = await getSetting("company");
  const todayInTz = new Intl.DateTimeFormat("en-CA", {
    timeZone: company.timezone,
  }).format(new Date());
  const currentYear = Number(todayInTz.slice(0, 4));
  const yearParam = Number(req.nextUrl.searchParams.get("year"));
  const year =
    Number.isFinite(yearParam) && yearParam >= 2020 && yearParam <= 2100
      ? yearParam
      : currentYear;

  const [tally, employees] = await Promise.all([
    tallyTimeOffByEmployeeForYear(year),
    listEmployees(),
  ]);
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const rows = tally
    .map((t) => {
      const emp = empMap.get(t.employeeId);
      if (!emp) return null;
      const totalHours =
        (t.unpaidDays + t.sickDays + t.personalDays + t.otherDays) *
          HOURS_PER_DAY +
        t.scheduleNoteHours;
      return {
        employee: emp.displayName,
        payType: emp.payType,
        unpaidDays: t.unpaidDays,
        sickDays: t.sickDays,
        personalDays: t.personalDays,
        otherDays: t.otherDays,
        scheduleNoteHours: Number(t.scheduleNoteHours.toFixed(2)),
        totalHours: Number(totalHours.toFixed(2)),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort(
      (a, b) =>
        b.totalHours - a.totalHours || a.employee.localeCompare(b.employee),
    );

  const csv = toCsv(rows, [
    "employee",
    "payType",
    "unpaidDays",
    "sickDays",
    "personalDays",
    "otherDays",
    "scheduleNoteHours",
    "totalHours",
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="time-off-${year}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

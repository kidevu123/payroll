import Link from "next/link";
import { UserPlus } from "lucide-react";
import type { Employee } from "@/lib/db/schema";

export function EmployeesSetupBanner({
  employees,
}: {
  employees: Employee[];
}) {
  if (employees.length === 0) return null;

  return (
    <div className="rounded-card border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <UserPlus className="h-5 w-5 shrink-0 text-amber-700 mt-0.5" aria-hidden />
        <div className="space-y-2 min-w-0">
          <p className="font-medium text-amber-950">
            {employees.length === 1
              ? "1 new person from the time clock — finish setup"
              : `${employees.length} new people from the time clock — finish setup`}
          </p>
          <p className="text-sm text-amber-900/90">
            Milo imported their NGTeco ID, name, and email. Add hourly rate and
            pay schedule, then set them to Active when they should be paid.
          </p>
          <ul className="text-sm text-amber-950 space-y-1">
            {employees.slice(0, 6).map((e) => (
              <li key={e.id}>
                <Link
                  href={`/employees/${e.id}/edit`}
                  className="underline underline-offset-2 hover:text-amber-800"
                >
                  {e.displayName}
                  {e.ngtecoEmployeeRef ? ` · ID ${e.ngtecoEmployeeRef}` : ""}
                </Link>
              </li>
            ))}
            {employees.length > 6 ? (
              <li className="text-amber-800">
                + {employees.length - 6} more —{" "}
                <Link href="/employees?status=INACTIVE" className="underline">
                  view inactive
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

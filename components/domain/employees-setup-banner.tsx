"use client";

import * as React from "react";
import Link from "next/link";
import { UserPlus, X } from "lucide-react";
import type { Employee } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { ignoreNgtecoSetupEmployeeAction } from "@/app/(admin)/employees/actions";

export function EmployeesSetupBanner({
  employees,
}: {
  employees: Employee[];
}) {
  const [visible, setVisible] = React.useState(employees);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setVisible(employees);
  }, [employees]);

  if (visible.length === 0) return null;

  return (
    <div className="rounded-card border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <UserPlus
          className="h-5 w-5 shrink-0 text-amber-700 mt-0.5"
          aria-hidden
        />
        <div className="space-y-2 min-w-0 flex-1">
          <p className="font-medium text-amber-950">
            {visible.length === 1
              ? "1 new person from the time clock — finish setup"
              : `${visible.length} new people from the time clock — finish setup`}
          </p>
          <p className="text-sm text-amber-900/90">
            Milo imported their NGTeco ID, name, and email. Add hourly rate and
            pay schedule, then set them to Active when they should be paid.
            Owners or non-payroll people can be ignored.
          </p>
          <ul className="text-sm text-amber-950 space-y-1.5">
            {visible.slice(0, 6).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3"
              >
                <Link
                  href={`/employees/${e.id}/edit`}
                  className="underline underline-offset-2 hover:text-amber-800 min-w-0 truncate"
                >
                  {e.displayName}
                  {e.ngtecoEmployeeRef ? ` · ID ${e.ngtecoEmployeeRef}` : ""}
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-amber-900 hover:text-amber-950 hover:bg-amber-100/80"
                  disabled={pendingId === e.id}
                  onClick={async () => {
                    setPendingId(e.id);
                    const result = await ignoreNgtecoSetupEmployeeAction(e.id);
                    setPendingId(null);
                    if ("ok" in result && result.ok) {
                      setVisible((list) => list.filter((x) => x.id !== e.id));
                    }
                  }}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  {pendingId === e.id ? "…" : "Ignore"}
                </Button>
              </li>
            ))}
            {visible.length > 6 ? (
              <li className="text-amber-800">
                + {visible.length - 6} more —{" "}
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

import Link from "next/link";
import { Users, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EmployeeRow } from "@/components/domain/employee-row";
import { listEmployees } from "@/lib/db/queries/employees";
import { listActiveShifts } from "@/lib/db/queries/shifts";

type SearchParams = Promise<{
  q?: string;
  status?: "ACTIVE" | "INACTIVE" | "TERMINATED";
  shift?: string;
}>;

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const [employees, shifts] = await Promise.all([
    listEmployees({
      ...(params.q ? { search: params.q } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.shift ? { shiftId: params.shift } : {}),
    }),
    listActiveShifts(),
  ]);
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Employees</h1>
          <p className="text-sm text-[--text-muted]">
            {employees.length} {employees.length === 1 ? "person" : "people"}
          </p>
        </div>
        <Button asChild>
          <Link href="/employees/new">
            <Plus className="h-4 w-4" /> Add employee
          </Link>
        </Button>
      </div>

      <form
        action="/employees"
        method="GET"
        className="flex flex-wrap items-end gap-2 rounded-[--radius-card] border border-[--border] bg-[--surface] p-3"
      >
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search name or email"
          className="h-9 flex-1 min-w-[12rem] rounded-[--radius-input] border border-[--border] bg-[--surface] px-3 text-sm"
        />
        <select
          name="status"
          defaultValue={params.status ?? ""}
          className="h-9 rounded-[--radius-input] border border-[--border] bg-[--surface] px-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="TERMINATED">Terminated</option>
        </select>
        <select
          name="shift"
          defaultValue={params.shift ?? ""}
          className="h-9 rounded-[--radius-input] border border-[--border] bg-[--surface] px-2 text-sm"
        >
          <option value="">All shifts</option>
          {shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="secondary">
          Apply
        </Button>
        {(params.q || params.status || params.shift) && (
          <Button asChild size="sm" variant="ghost">
            <Link href="/employees">Clear</Link>
          </Button>
        )}
      </form>

      {employees.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No employees match"
          description="Add your first employee or clear the filters above."
          action={
            <Button asChild>
              <Link href="/employees/new">
                <Plus className="h-4 w-4" /> Add employee
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {employees.map((e) => (
            <EmployeeRow
              key={e.id}
              employee={e}
              shift={e.shiftId ? shiftById.get(e.shiftId) ?? null : null}
              href={`/employees/${e.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

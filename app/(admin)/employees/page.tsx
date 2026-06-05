import Link from "next/link";
import { Users, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EmployeeRow } from "@/components/domain/employee-row";
import { cn } from "@/lib/utils";
import {
  listEmployees,
  listEmployeesNeedingNgtecoSetup,
} from "@/lib/db/queries/employees";
import { listActiveShifts } from "@/lib/db/queries/shifts";
import { EmployeesSetupBanner } from "@/components/domain/employees-setup-banner";
import { EmployeesPageHeader } from "@/components/domain/employees-header-actions";

type StatusFilter = "ACTIVE" | "INACTIVE" | "TERMINATED";

type SearchParams = Promise<{
  q?: string;
  status?: StatusFilter;
  shift?: string;
}>;

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  // Terminated employees only render on the explicit Terminated tab. The
  // default ("Active") and "All" views both exclude TERMINATED so old
  // staff don't clutter day-to-day work.
  const employees = await listEmployees({
    ...(params.q ? { search: params.q } : {}),
    ...(params.status ? { status: params.status } : { excludeTerminated: true }),
    ...(params.shift ? { shiftId: params.shift } : {}),
  });
  const shifts = await listActiveShifts();
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  // Counts for the pill toggles — the unfiltered roster is small (≤100), so
  // re-fetching each status total without a search filter is cheap and
  // keeps the toggle UI honest about what each click will reveal.
  const [allActive, allInactive, allTerminated, needingSetup] = await Promise.all([
    listEmployees({ status: "ACTIVE", ...(params.q ? { search: params.q } : {}) }),
    listEmployees({ status: "INACTIVE", ...(params.q ? { search: params.q } : {}) }),
    listEmployees({ status: "TERMINATED", ...(params.q ? { search: params.q } : {}) }),
    listEmployeesNeedingNgtecoSetup(),
  ]);
  const livingCount = allActive.length + allInactive.length;

  const buildHref = (overrides: Partial<{ q: string; status: StatusFilter | ""; shift: string }>) => {
    const sp = new URLSearchParams();
    const q = overrides.q ?? params.q ?? "";
    const status = overrides.status !== undefined ? overrides.status : params.status ?? "";
    const shift = overrides.shift !== undefined ? overrides.shift : params.shift ?? "";
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    if (shift) sp.set("shift", shift);
    const qs = sp.toString();
    return qs ? `/employees?${qs}` : "/employees";
  };

  const explicitStatus = params.status; // null when "All" (active+inactive) is selected
  const currentShift = params.shift ?? "";

  return (
    <div className="space-y-4">
      <EmployeesPageHeader
        shownCount={employees.length}
        livingCount={livingCount}
        terminatedCount={allTerminated.length}
      />

      <EmployeesSetupBanner employees={needingSetup} />

      {/* Filter / search bar */}
      <form
        action="/employees"
        method="GET"
        className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3"
      >
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" aria-hidden="true" />
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search name or email"
            className="h-9 w-full rounded-input border border-border bg-surface pl-9 pr-3 text-sm placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60"
          />
          {/* Preserve other params on submit */}
          {explicitStatus ? <input type="hidden" name="status" value={explicitStatus} /> : null}
          {currentShift ? <input type="hidden" name="shift" value={currentShift} /> : null}
        </div>

        {/* Pill toggle group: status */}
        <div className="inline-flex h-9 items-center rounded-input border border-border bg-surface p-0.5 text-xs shrink-0 self-start md:self-auto">
          <PillToggle
            href={buildHref({ status: "" })}
            active={!explicitStatus}
            label="All"
            count={livingCount}
          />
          <PillToggle
            href={buildHref({ status: "ACTIVE" })}
            active={explicitStatus === "ACTIVE"}
            label="Active"
            count={allActive.length}
          />
          <PillToggle
            href={buildHref({ status: "INACTIVE" })}
            active={explicitStatus === "INACTIVE"}
            label="Inactive"
            count={allInactive.length}
          />
          <PillToggle
            href={buildHref({ status: "TERMINATED" })}
            active={explicitStatus === "TERMINATED"}
            label="Terminated"
            count={allTerminated.length}
          />
        </div>

        {/* Shift filter row removed — owner ask: drop shift UI from
            admin views. Shift records remain (employees still link to
            them under the hood) but they no longer surface as a
            filter chip. The PillToggle group used to live here.
            `shifts` is still resolved server-side so the existing
            admin export keeps the column. */}

        {(params.q || explicitStatus || currentShift) && (
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
        <div className="rounded-card border border-border/70 bg-surface shadow-card overflow-hidden divide-y divide-border/60">
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

function PillToggle({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-chip px-2.5 h-8 font-medium tracking-tight transition-colors",
        active
          ? "bg-brand-700 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.12)]"
          : "text-text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      {label}
      {typeof count === "number" && (
        <span
          className={cn(
            "tabular-nums text-[10px]",
            active ? "text-white/80" : "text-text-subtle",
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

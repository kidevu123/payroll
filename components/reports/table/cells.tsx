"use client";

// Small display cells of a reports ledger row: status, payment method,
// portal visibility, Zoho push badges.
import { cn } from "@/lib/utils";
import { CheckCircle2, CircleDot, Banknote, Landmark, Lock } from "lucide-react";
import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import type { ZohoOrganization } from "@/lib/db/schema";
import {
  STATUS_CHIP_BASE,
  statusChipClasses,
  type StatusTone,
} from "@/components/domain/status-pill";


/** Period status chip — the mockup's single loud state cue per row.
 *  PAID reads as "Completed"; LOCKED and OPEN stay literal. */
/** Period state chip. Tones come from the shared status vocabulary so this
 *  reads identically to the same period's chip on /payroll. */
export function StatusCell({ state }: { state: "OPEN" | "LOCKED" | "PAID" }) {
  const spec = {
    PAID: { tone: "success", label: "Completed", Icon: CheckCircle2 },
    LOCKED: { tone: "warn", label: "Locked", Icon: Lock },
    OPEN: { tone: "info", label: "Open", Icon: CircleDot },
  }[state] as { tone: StatusTone; label: string; Icon: typeof Lock };
  const { Icon } = spec;
  return (
    <span className={cn(STATUS_CHIP_BASE, statusChipClasses(spec.tone))}>
      <Icon className="h-3 w-3" aria-hidden /> {spec.label}
    </span>
  );
}

/** Payment-method table cell — quiet icon + text (calm pass: the status
 *  chip is the single colored element per row; this column just states
 *  the rail, like the reference mock). */
export function PaymentMethodCell({
  state,
  method,
}: {
  state: "OPEN" | "LOCKED" | "PAID";
  method: "BANK" | "CASH" | null;
}) {
  if (state !== "PAID") {
    return <span className="text-xs text-text-subtle">—</span>;
  }
  // Icon always; the words from lg, where the column has its own track.
  const Icon = method === "CASH" ? Banknote : Landmark;
  const label = method === "CASH" ? "Cash drawer" : "Bank transfer";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-text-muted whitespace-nowrap"
      title={label}
    >
      <Icon className="h-3.5 w-3.5 text-text-subtle" aria-hidden />
      <span className="hidden lg:inline">{label}</span>
      <span className="sr-only lg:hidden">{label}</span>
    </span>
  );
}

/** Period payment-method chip (PAID, mobile cluster) — quiet neutral. */
export function PaymentChip({
  state,
  method,
}: {
  state: "OPEN" | "LOCKED" | "PAID";
  method: "BANK" | "CASH" | null;
}) {
  if (state !== "PAID") return null;
  const Icon = method === "CASH" ? Banknote : Landmark;
  const label = method === "CASH" ? "Cash drawer" : "Bank transfer";
  return (
    <span className="inline-flex items-center gap-1 rounded-chip border border-border/70 bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted whitespace-nowrap">
      <Icon className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}

/** Portal visibility chip (per run). */
/**
 * Employee-visibility indicator. Deliberately a glyph, not a second chip:
 * two full chips wrapped onto a second line in the status column, so rows
 * with a publication state stood ~20px taller than rows without and the
 * table read as ragged.
 */
export function VisibilityChip({ published }: { published: boolean }) {
  // Published is the normal state, so it gets no mark — a green check
  // next to a green "Completed" chip on every row was pure repetition.
  // Only the exception (still internal, employees can't see it) is flagged.
  if (published) return null;
  const label = "Internal only — not yet visible to employees";
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-warning-700"
    >
      <CircleDot className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
}

/** Read-only Zoho push summary badges (mutate via the overflow menu). */
export function ZohoBadges({
  run,
  haute,
  boomin,
}: {
  run: ReportRow;
  haute: ZohoOrganization | undefined;
  boomin: ZohoOrganization | undefined;
}) {
  const pushedHaute = run.zohoPushes.find((p) => p.orgId === haute?.id);
  const pushedBoomin = run.zohoPushes.find((p) => p.orgId === boomin?.id);
  if (!pushedHaute && !pushedBoomin) return null;
  return (
    <div className="flex items-center gap-1.5">
      {pushedHaute && (
        <span
          className="inline-flex items-center gap-1 rounded-chip bg-success-50 px-1.5 py-0.5 text-[10px] font-medium text-success-800 ring-1 ring-inset ring-success-100"
          title={`Haute · expense ${pushedHaute.expenseId ?? "—"}`}
        >
          <CheckCircle2 className="h-2.5 w-2.5" /> Haute
        </span>
      )}
      {pushedBoomin && (
        <span
          className="inline-flex items-center gap-1 rounded-chip bg-success-50 px-1.5 py-0.5 text-[10px] font-medium text-success-800 ring-1 ring-inset ring-success-100"
          title={`Boomin · expense ${pushedBoomin.expenseId ?? "—"}`}
        >
          <CheckCircle2 className="h-2.5 w-2.5" /> Boomin
        </span>
      )}
    </div>
  );
}

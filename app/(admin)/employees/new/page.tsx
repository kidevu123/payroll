import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listActiveShifts } from "@/lib/db/queries/shifts";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
import { getSetting } from "@/lib/settings/runtime";
import { companyTodayIso } from "@/lib/time/company-day";
import {
  EmployeeForm,
  type ScheduleOption,
  type ShiftOption,
} from "../employee-form";
import { AddPersonChooser } from "../add-person-chooser";
import { LoginOnlyForm } from "../login-only-form";

type Classification =
  | "WEEKLY_HOURLY"
  | "SEMI_HOURLY"
  | "MONTHLY_HOURLY"
  | "SALARIED";

/** The 3-way fork selected in Step 1. */
type AddKind = "hourly" | "salaried" | "login";

function addKindFromParam(kind: string | undefined): AddKind | undefined {
  if (kind === "hourly" || kind === "salaried" || kind === "login") {
    return kind;
  }
  return undefined;
}

function classificationFromScheduleParam(
  schedule: string | undefined,
): Classification | undefined {
  if (schedule === "monthly") return "MONTHLY_HOURLY";
  if (schedule === "semi") return "SEMI_HOURLY";
  if (schedule === "weekly") return "WEEKLY_HOURLY";
  return undefined;
}

/**
 * Pre-select the right classification group for the chosen fork. Hourly
 * defers to a more specific `?schedule=` param when present (preserves the
 * CSV-import deep-link behavior); otherwise defaults to weekly hourly.
 * Salaried jumps straight to SALARIED. Login-only never reaches the
 * employee form, so it has no classification.
 */
function classificationForKind(
  kind: Exclude<AddKind, "login">,
  schedule: string | undefined,
): Classification {
  if (kind === "salaried") return "SALARIED";
  return classificationFromScheduleParam(schedule) ?? "WEEKLY_HOURLY";
}

export default async function NewEmployeePage({
  searchParams,
}: {
  searchParams: Promise<{
    ngtecoRef?: string;
    displayName?: string;
    schedule?: string;
    kind?: string;
  }>;
}) {
  const [shifts, schedules, params, company] = await Promise.all([
    listActiveShifts(),
    listSchedules(),
    searchParams,
    getSetting("company"),
  ]);
  const tz = company?.timezone ?? "America/New_York";
  const prefillNgtecoRef = params.ngtecoRef?.slice(0, 64);
  const prefillDisplayName = params.displayName?.slice(0, 120);

  // A `?schedule=` deep-link (from CSV import) implies an hourly hire even
  // without an explicit `?kind=`, so it skips the chooser. Otherwise the
  // fork the owner picked in Step 1 drives which form renders.
  const kind =
    addKindFromParam(params.kind) ??
    (params.schedule ? ("hourly" as const) : undefined);

  // ─── Step 1: chooser ─────────────────────────────────────────────
  if (!kind) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Add a person</h1>
          <p className="text-sm text-text-muted">
            Who are you adding? Pick the option that fits — you can change
            most details later.
          </p>
        </div>
        <AddPersonChooser />
        <p className="text-xs text-text-muted">
          <Link href="/employees" className="underline underline-offset-2">
            Back to employees
          </Link>
        </p>
      </div>
    );
  }

  // ─── Step 2 (login-only): minimal login form ─────────────────────
  if (kind === "login") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <Link
            href="/employees/new"
            className="inline-flex items-center gap-1 text-xs text-text-muted underline-offset-2 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to chooser
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Add a login-only person</h1>
          <p className="text-sm text-text-muted">
            Creates an app login with a role — no clock and no pay through the
            app.
          </p>
        </div>
        <LoginOnlyForm />
      </div>
    );
  }

  // ─── Step 2 (hourly / salaried): existing employee form ──────────
  const shiftOptions: ShiftOption[] = shifts.map((s) => ({
    id: s.id,
    name: s.name,
  }));
  const scheduleOptions: ScheduleOption[] = schedules.map((s) => ({
    id: s.id,
    name: s.name,
    periodKind: s.periodKind,
    active: s.active,
  }));
  const classification = classificationForKind(kind, params.schedule);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/employees/new"
          className="inline-flex items-center gap-1 text-xs text-text-muted underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to chooser
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {kind === "salaried" ? "New salaried employee" : "New hourly employee"}
        </h1>
        <p className="text-sm text-text-muted">
          {kind === "salaried"
            ? "Paid externally — upload their paystub on a cadence from the Salaried tab."
            : "Hourly rate becomes the first row in the rate-history timeline."}
          {prefillNgtecoRef && (
            <span className="mt-1 block text-xs text-warning-700">
              Prefilled from a CSV upload — confirm name and fill the rate.
            </span>
          )}
        </p>
      </div>
      <EmployeeForm
        shifts={shiftOptions}
        schedules={scheduleOptions}
        mode="create"
        prefill={{
          ...(prefillDisplayName ? { displayName: prefillDisplayName } : {}),
          ...(prefillNgtecoRef ? { ngtecoEmployeeRef: prefillNgtecoRef } : {}),
          hiredOn: companyTodayIso(new Date(), tz),
          classification,
        }}
      />
    </div>
  );
}

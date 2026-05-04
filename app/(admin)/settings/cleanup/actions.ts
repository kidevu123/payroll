"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth-guards";
import {
  backfillNullRunTotals,
  deleteEmptyOrphanPeriods,
  findEmptyOrphanPeriods,
  findOverlappingPeriods,
  getPeriodEmployeeSummary,
  mergeOverlappingPair,
  tagLegacyPeriodsBySchedule,
  type MergeOverlappingPairResult,
  type PeriodEmployeeSummary,
  type TagLegacyResult,
} from "@/lib/db/queries/cleanup";

export async function tagLegacyPeriodsBySchedule_Action(): Promise<{
  result?: TagLegacyResult;
  error?: string;
}> {
  try {
    const session = await requireOwner();
    const result = await tagLegacyPeriodsBySchedule({
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/cleanup");
    revalidatePath("/payroll");
    revalidatePath("/reports");
    return { result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Tag failed.",
    };
  }
}

export async function backfillNullRunTotalsAction(): Promise<{
  fixed: Array<{ runId: string; previousTotal: number | null; newTotal: number }>;
  error?: string;
}> {
  try {
    const session = await requireOwner();
    const fixed = await backfillNullRunTotals({
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/cleanup");
    revalidatePath("/reports");
    revalidatePath("/payroll");
    return { fixed };
  } catch (err) {
    return {
      fixed: [],
      error: err instanceof Error ? err.message : "Backfill failed.",
    };
  }
}

export async function previewEmptyOrphanPeriodsAction(): Promise<{
  candidates: Array<{ id: string; startDate: string; endDate: string; state: string }>;
  error?: string;
}> {
  try {
    await requireOwner();
    const candidates = await findEmptyOrphanPeriods();
    return { candidates };
  } catch (err) {
    return {
      candidates: [],
      error: err instanceof Error ? err.message : "Preview failed.",
    };
  }
}

export async function deleteEmptyOrphanPeriodsAction(): Promise<{
  deleted: Array<{ id: string; startDate: string; endDate: string }>;
  error?: string;
}> {
  try {
    const session = await requireOwner();
    const deleted = await deleteEmptyOrphanPeriods({
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/cleanup");
    revalidatePath("/reports");
    revalidatePath("/payroll");
    return { deleted };
  } catch (err) {
    return {
      deleted: [],
      error: err instanceof Error ? err.message : "Delete failed.",
    };
  }
}

export async function previewOverlappingPeriodsAction(): Promise<{
  pairs: Awaited<ReturnType<typeof findOverlappingPeriods>>;
  error?: string;
}> {
  try {
    await requireOwner();
    const pairs = await findOverlappingPeriods(200);
    return { pairs };
  } catch (err) {
    return {
      pairs: [],
      error: err instanceof Error ? err.message : "Preview failed.",
    };
  }
}

export async function previewPeriodEmployeeSummaryAction(
  periodId: string,
): Promise<{ rows: PeriodEmployeeSummary[]; error?: string }> {
  try {
    await requireOwner();
    const rows = await getPeriodEmployeeSummary(periodId);
    return { rows };
  } catch (err) {
    return {
      rows: [],
      error: err instanceof Error ? err.message : "Preview failed.",
    };
  }
}

export async function mergeOverlappingPairAction(
  survivorId: string,
  loserId: string,
): Promise<{
  result?: MergeOverlappingPairResult;
  error?: string;
}> {
  try {
    const session = await requireOwner();
    const result = await mergeOverlappingPair(survivorId, loserId, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/cleanup");
    revalidatePath("/payroll");
    revalidatePath("/reports");
    return { result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Merge failed.",
    };
  }
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Actor } from "@/lib/db/queries/employees";
import {
  createPunch,
  editPunch,
  listPunches,
  voidPunch,
} from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";
import { wallClockToUtc } from "@/lib/time/wall-clock";
import {
  NGTECO_MANUAL_PUNCH_SYNC_QUEUE,
  type ManualPunchSyncJobData,
} from "@/lib/ngteco/manual-punch-sync";
import { toolError, toolJson } from "../util.js";

async function queueNgtecoPunchSync(
  punchId: string,
  actor: Actor,
): Promise<void> {
  try {
    const { getBoss } = await import("@/lib/jobs");
    const boss = await getBoss();
    await boss.send(NGTECO_MANUAL_PUNCH_SYNC_QUEUE, {
      punchId,
      actorId: actor.id,
      actorRole: actor.role,
    } satisfies ManualPunchSyncJobData);
  } catch {
    /* queue outage should not roll back payroll correction */
  }
}

const isoDateTime = z
  .string()
  .describe("ISO datetime, e.g. 2026-06-03T18:10:00");

export function registerPunchTools(server: McpServer, actor: Actor): void {
  server.registerTool(
    "payroll_list_punches",
    {
      title: "List punches",
      description:
        "List time punches. Filter by period, employee, or clock-in date range.",
      inputSchema: {
        periodId: z.string().uuid().optional(),
        employeeId: z.string().uuid().optional(),
        clockAfter: isoDateTime.optional().describe("Inclusive clock-in lower bound"),
        clockBefore: isoDateTime.optional().describe("Inclusive clock-in upper bound"),
        limit: z.number().int().min(1).max(500).default(100),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      try {
        const punches = await listPunches({
          ...(input.periodId ? { periodId: input.periodId } : {}),
          ...(input.employeeId ? { employeeId: input.employeeId } : {}),
          ...(input.clockAfter
            ? { clockAfter: new Date(input.clockAfter) }
            : {}),
          ...(input.clockBefore
            ? { clockBefore: new Date(input.clockBefore) }
            : {}),
        });
        return toolJson({
          count: punches.length,
          punches: punches.slice(0, input.limit),
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_create_punch",
    {
      title: "Create manual punch",
      description:
        "Add a manual admin punch. Queues NGTeco mend sync in the background.",
      inputSchema: {
        employeeId: z.string().uuid(),
        periodId: z.string().uuid(),
        clockIn: isoDateTime,
        clockOut: isoDateTime.optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
        syncToNgteco: z
          .boolean()
          .default(true)
          .describe("Push mend rows to NGTeco after save"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      try {
        const company = await getSetting("company");
        const clockInWall = input.clockIn.replace(/([+-]\d{2}:?\d{2}|Z)$/i, "");
        const clockIn = wallClockToUtc(clockInWall, company.timezone);
        if (!clockIn) return toolError(`Invalid clockIn: ${input.clockIn}`);
        const clockOut = input.clockOut
          ? (() => {
              const wall = input.clockOut!.replace(
                /([+-]\d{2}:?\d{2}|Z)$/i,
                "",
              );
              return wallClockToUtc(wall, company.timezone);
            })()
          : null;
        if (input.clockOut && !clockOut) {
          return toolError(`Invalid clockOut: ${input.clockOut}`);
        }
        const punch = await createPunch(
          {
            employeeId: input.employeeId,
            periodId: input.periodId,
            clockIn,
            clockOut,
            source: "MANUAL_ADMIN",
            notes: input.notes ?? null,
          },
          actor,
        );
        if (input.syncToNgteco) {
          await queueNgtecoPunchSync(punch.id, actor);
        }
        return toolJson({ ok: true, punch, ngtecoSyncQueued: input.syncToNgteco });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_edit_punch",
    {
      title: "Edit punch",
      description:
        "Edit clock times on a punch. Reassigns period if needed. Optionally syncs to NGTeco.",
      inputSchema: {
        punchId: z.string().uuid(),
        clockIn: isoDateTime.optional(),
        clockOut: isoDateTime.optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
        reason: z.string().min(1).max(500),
        syncToNgteco: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      try {
        const company = await getSetting("company");
        const patch: {
          clockIn?: Date;
          clockOut?: Date | null;
          notes?: string | null;
        } = {};
        if (input.clockIn) {
          const wall = input.clockIn.replace(/([+-]\d{2}:?\d{2}|Z)$/i, "");
          const parsed = wallClockToUtc(wall, company.timezone);
          if (!parsed) return toolError(`Invalid clockIn: ${input.clockIn}`);
          patch.clockIn = parsed;
        }
        if (input.clockOut !== undefined) {
          patch.clockOut = input.clockOut
            ? (() => {
                const wall = input.clockOut!.replace(
                  /([+-]\d{2}:?\d{2}|Z)$/i,
                  "",
                );
                return wallClockToUtc(wall, company.timezone);
              })()
            : null;
          if (input.clockOut && !patch.clockOut) {
            return toolError(`Invalid clockOut: ${input.clockOut}`);
          }
        }
        if (input.notes !== undefined) patch.notes = input.notes;
        const punch = await editPunch(
          input.punchId,
          patch,
          input.reason,
          actor,
        );
        if (input.syncToNgteco) {
          await queueNgtecoPunchSync(punch.id, actor);
        }
        return toolJson({ ok: true, punch, ngtecoSyncQueued: input.syncToNgteco });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_void_punch",
    {
      title: "Void punch",
      description: "Soft-void a punch with a required reason.",
      inputSchema: {
        punchId: z.string().uuid(),
        reason: z.string().min(1).max(500),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ punchId, reason }) => {
      try {
        const punch = await voidPunch(punchId, reason, actor);
        return toolJson({ ok: true, punch });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

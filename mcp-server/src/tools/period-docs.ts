import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { employees, payPeriods } from "@/lib/db/schema";
import type { Actor } from "@/lib/db/queries/employees";
import { createDoc } from "@/lib/db/queries/payroll-documents";
import {
  PAYROLL_DOC_MAX_BYTES as MAX_BYTES,
  writePaystubFile,
} from "@/lib/documents/paystub-storage";
import { toolError, toolJson } from "../util.js";

const kindSchema = z.enum(["W2", "PAYSTUB", "OTHER"]);


export function registerPeriodDocTools(
  server: McpServer,
  actor: Actor,
): void {
  server.registerTool(
    "payroll_upload_period_paystub",
    {
      title: "Upload period paystub",
      description:
        "Store an external accountant paystub on a pay period (requiresW2Upload " +
        "employees like Juan). Used by automation that ingests accountant emails.",
      inputSchema: {
        periodId: z.string().uuid(),
        employeeId: z.string().uuid(),
        originalFilename: z.string().min(1).max(255),
        pdfBase64: z.string().min(1),
        mime: z.string().default("application/pdf"),
        kind: kindSchema.default("PAYSTUB"),
        netAmountDollars: z
          .number()
          .positive()
          .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
            message: "netAmountDollars must have at most 2 decimal places",
          }),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      try {
        const kind = kindSchema.parse(input.kind);
        const buf = Buffer.from(input.pdfBase64, "base64");
        if (buf.length === 0) {
          return toolError("pdfBase64 decoded to an empty file.");
        }
        if (buf.length > MAX_BYTES) {
          return toolError(`File too large (max ${MAX_BYTES / 1024 / 1024} MB).`);
        }

        const [period] = await db
          .select()
          .from(payPeriods)
          .where(eq(payPeriods.id, input.periodId));
        if (!period) {
          return toolError(`Period not found: ${input.periodId}`);
        }
        if (period.state === "PAID") {
          return toolError(
            "Period is paid. Unmark paid before uploading documents.",
          );
        }

        const [employee] = await db
          .select({
            id: employees.id,
            displayName: employees.displayName,
            requiresW2Upload: employees.requiresW2Upload,
            payScheduleId: employees.payScheduleId,
            payType: employees.payType,
          })
          .from(employees)
          .where(eq(employees.id, input.employeeId));
        if (!employee) {
          return toolError(`Employee not found: ${input.employeeId}`);
        }
        if (!employee.requiresW2Upload) {
          return toolError(
            `${employee.displayName} is not flagged for external paystub upload.`,
          );
        }
        if (
          employee.payScheduleId &&
          period.payScheduleId &&
          employee.payScheduleId !== period.payScheduleId
        ) {
          return toolError(
            `${employee.displayName} is not on the same pay schedule as this period.`,
          );
        }
        if (employee.payType === "SALARIED" && period.payScheduleId) {
          const { paySchedules } = await import("@/lib/db/schema");
          const [schedule] = await db
            .select({ periodKind: paySchedules.periodKind })
            .from(paySchedules)
            .where(eq(paySchedules.id, period.payScheduleId));
          if (schedule?.periodKind === "WEEKLY") {
            return toolError(
              "Salaried employees cannot upload paystubs on weekly periods.",
            );
          }
        }

        const amountCents = Math.round(input.netAmountDollars * 100);
        if (kind === "PAYSTUB" && amountCents <= 0) {
          return toolError(
            "netAmountDollars is required for PAYSTUB uploads (post-tax net).",
          );
        }

        const filePath = await writePaystubFile({
          segments: [input.periodId, input.employeeId],
          originalFilename: input.originalFilename,
          mime: input.mime,
          buf,
        });

        const row = await createDoc(
          {
            periodId: input.periodId,
            employeeId: input.employeeId,
            kind,
            filePath,
            mime: input.mime,
            originalFilename: input.originalFilename,
            sizeBytes: buf.length,
            visibleToEmployee: true,
            uploadedById: actor.id,
            amountCents,
            ...(period.startDate ? { payPeriodStart: period.startDate } : {}),
            ...(period.endDate ? { payPeriodEnd: period.endDate } : {}),
          },
          actor,
        );

        return toolJson({
          documentId: row.id,
          periodId: row.periodId,
          employeeId: row.employeeId,
          kind: row.kind,
          originalFilename: row.originalFilename,
          amountCents: row.amountCents,
          payPeriodStart: row.payPeriodStart,
          payPeriodEnd: row.payPeriodEnd,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

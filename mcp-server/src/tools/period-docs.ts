import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { employees, payPeriods } from "@/lib/db/schema";
import type { Actor } from "@/lib/db/queries/employees";
import { createDoc } from "@/lib/db/queries/payroll-documents";
import { toolError, toolJson } from "../util.js";

const PAYROLL_DOC_ROOT =
  process.env.PAYROLL_DOC_ROOT ?? "/data/uploads/payroll-docs";
const MAX_BYTES = 10 * 1024 * 1024;

const kindSchema = z.enum(["W2", "PAYSTUB", "OTHER"]);

function mimeToExt(mime: string): string {
  switch (mime) {
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return ".xlsx";
    default:
      return "";
  }
}

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
        netAmountDollars: z.number().positive(),
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

        const dir = join(PAYROLL_DOC_ROOT, input.periodId, input.employeeId);
        await mkdir(dir, { recursive: true });
        const ext = extname(input.originalFilename) || mimeToExt(input.mime);
        const stored = `${randomUUID()}${ext}`;
        const filePath = join(dir, stored);
        await writeFile(filePath, buf, { mode: 0o640 });

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

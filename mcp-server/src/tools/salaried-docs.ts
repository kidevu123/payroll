import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import type { Actor } from "@/lib/db/queries/employees";
import { createDoc } from "@/lib/db/queries/payroll-documents";
import {
  PAYROLL_DOC_MAX_BYTES as MAX_BYTES,
  writePaystubFile,
} from "@/lib/documents/paystub-storage";
import { toolError, toolJson } from "../util.js";

const kindSchema = z.enum(["W2", "PAYSTUB", "OTHER"]);


export function registerSalariedDocTools(
  server: McpServer,
  actor: Actor,
): void {
  server.registerTool(
    "payroll_upload_salaried_paystub",
    {
      title: "Upload salaried paystub",
      description:
        "Store a salaried employee paystub PDF (or image) for the employee portal. " +
        "Used by automation that ingests accountant emails.",
      inputSchema: {
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
          })
          .optional(),
        payPeriodStart: z.string().date().optional(),
        payPeriodEnd: z.string().date().optional(),
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

        const [employee] = await db
          .select({
            id: employees.id,
            payType: employees.payType,
            displayName: employees.displayName,
          })
          .from(employees)
          .where(eq(employees.id, input.employeeId));
        if (!employee) {
          return toolError(`Employee not found: ${input.employeeId}`);
        }
        if (employee.payType !== "SALARIED") {
          return toolError(
            `${employee.displayName} is not classified as Salaried (got ${employee.payType}).`,
          );
        }

        let amountCents: number | null = null;
        if (input.netAmountDollars !== undefined) {
          amountCents = Math.round(input.netAmountDollars * 100);
        }
        if (kind === "PAYSTUB" && (amountCents === null || amountCents <= 0)) {
          return toolError(
            "netAmountDollars is required for PAYSTUB uploads (post-tax net the employee receives).",
          );
        }
        if (
          input.payPeriodStart &&
          input.payPeriodEnd &&
          input.payPeriodEnd < input.payPeriodStart
        ) {
          return toolError("payPeriodEnd cannot be before payPeriodStart.");
        }

        const filePath = await writePaystubFile({
          segments: ["_salaried", input.employeeId],
          originalFilename: input.originalFilename,
          mime: input.mime,
          buf,
        });

        const row = await createDoc(
          {
            periodId: null,
            employeeId: input.employeeId,
            kind,
            filePath,
            mime: input.mime,
            originalFilename: input.originalFilename,
            sizeBytes: buf.length,
            visibleToEmployee: true,
            uploadedById: actor.id,
            payPeriodStart: input.payPeriodStart ?? null,
            payPeriodEnd: input.payPeriodEnd ?? null,
            amountCents,
          },
          actor,
        );

        return toolJson({
          documentId: row.id,
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

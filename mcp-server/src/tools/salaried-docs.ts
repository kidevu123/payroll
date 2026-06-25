import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
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
        netAmountDollars: z.number().positive().optional(),
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

        const dir = join(PAYROLL_DOC_ROOT, "_salaried", input.employeeId);
        await mkdir(dir, { recursive: true });
        const ext = extname(input.originalFilename) || mimeToExt(input.mime);
        const stored = `${randomUUID()}${ext}`;
        const filePath = join(dir, stored);
        await writeFile(filePath, buf, { mode: 0o640 });

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

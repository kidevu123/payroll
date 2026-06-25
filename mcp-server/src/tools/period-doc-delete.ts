import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { payPeriods } from "@/lib/db/schema";
import type { Actor } from "@/lib/db/queries/employees";
import { deleteDoc, getDoc } from "@/lib/db/queries/payroll-documents";
import { toolError, toolJson } from "../util.js";

export function registerPeriodDocDeleteTools(
  server: McpServer,
  actor: Actor,
): void {
  server.registerTool(
    "payroll_delete_period_document",
    {
      title: "Delete period paystub document",
      description:
        "Soft-delete a payroll period document (paystub/W2). " +
        "Used to roll back automation test uploads.",
      inputSchema: {
        documentId: z.string().uuid(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ documentId }) => {
      try {
        const doc = await getDoc(documentId);
        if (!doc) {
          return toolError(`Document not found: ${documentId}`);
        }
        if (doc.deletedAt) {
          return toolJson({ ok: true, alreadyDeleted: true, documentId });
        }
        if (doc.periodId) {
          const [period] = await db
            .select({ state: payPeriods.state })
            .from(payPeriods)
            .where(eq(payPeriods.id, doc.periodId));
          if (period?.state === "PAID") {
            return toolError(
              "Period is paid. Unmark paid before deleting documents.",
            );
          }
        }
        const row = await deleteDoc(documentId, actor);
        return toolJson({
          ok: true,
          documentId: row.id,
          periodId: row.periodId,
          employeeId: row.employeeId,
          originalFilename: row.originalFilename,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

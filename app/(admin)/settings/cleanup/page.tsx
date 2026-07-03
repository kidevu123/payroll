// Owner-only data cleanup tools. Surfaces the bugs the multi-agent audit
// found in production (NULL run totals, empty orphan periods, overlapping
// periods) and lets the owner act on them with audit trails.

import { requireOwner } from "@/lib/auth-guards";
import { CleanupTools } from "./cleanup-tools";
import { PdfRebuildButton } from "./pdf-rebuild-button";

export const dynamic = "force-dynamic";

export default async function CleanupPage() {
  await requireOwner();
  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-heading font-semibold tracking-tight text-text">Data cleanup</h2>
        <p className="text-xs text-text-muted">
          One-shot fixes for legacy drift surfaced by the audit fleet. Each
          action runs in its own transaction with row-level verification and
          writes audit_log entries. Owner-only.
        </p>
      </div>
      <CleanupTools />
      <PdfRebuildButton />
    </div>
  );
}

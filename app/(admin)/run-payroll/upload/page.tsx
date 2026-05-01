import { listSchedules } from "@/lib/db/queries/pay-schedules";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function Page() {
  const schedules = await listSchedules();
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload punch CSV</h1>
        <p className="text-sm text-text-muted">
          For backfills or when the NGTeco scraper is offline. Accepts the
          standard NGTeco export shape and a permissive legacy fallback.
          The import lands a payroll run in <span className="font-mono text-xs">AWAITING_ADMIN_REVIEW</span>.
        </p>
      </div>
      <UploadForm schedules={schedules} />
    </div>
  );
}

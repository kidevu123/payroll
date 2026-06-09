import { and, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import {
  payrollRuns,
  zohoAdminReportBackups,
  zohoOrganizations,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import { logger } from "@/lib/telemetry";
import { buildAdminReportArtifacts } from "@/lib/pdf/build-admin-report";
import { uploadAdminReportToWorkDrive } from "@/lib/zoho/workdrive";

export const ZOHO_ADMIN_REPORT_BACKUP_QUEUE = "zoho.admin-report.backup";

export type ZohoAdminReportBackupJob = {
  periodId: string;
  runId?: string | null;
};

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function enqueueZohoAdminReportBackup(args: {
  periodId: string;
  runId?: string | null;
}): Promise<void> {
  const { getBoss } = await import("@/lib/jobs");
  const boss = await getBoss();
  await boss.send(ZOHO_ADMIN_REPORT_BACKUP_QUEUE, {
    periodId: args.periodId,
    runId: args.runId ?? null,
  } satisfies ZohoAdminReportBackupJob);
}

export async function handleZohoAdminReportBackup(
  job: ZohoAdminReportBackupJob,
): Promise<void> {
  const enabledOrgs = (
    await db.select().from(zohoOrganizations)
  ).filter(
    (org) =>
      org.active &&
      org.workdriveAdminReportBackupEnabled &&
      !!org.workdriveAdminReportFolderId,
  );
  if (enabledOrgs.length === 0) {
    logger.info(
      { periodId: job.periodId, runId: job.runId ?? null },
      "zoho.admin-report.backup: no enabled WorkDrive folders",
    );
    return;
  }

  const [run] = job.runId
    ? await db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.id, job.runId))
        .limit(1)
    : await db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.periodId, job.periodId))
        .limit(1);

  const artifacts = await buildAdminReportArtifacts(job.periodId);
  const digest = sha256(artifacts.pdfBytes);
  const sizeBytes = artifacts.pdfBytes.byteLength;

  for (const org of enabledOrgs) {
    const folderId = org.workdriveAdminReportFolderId;
    if (!folderId) continue;

    const [existingOk] = await db
      .select()
      .from(zohoAdminReportBackups)
      .where(
        and(
          eq(zohoAdminReportBackups.periodId, job.periodId),
          eq(zohoAdminReportBackups.organizationId, org.id),
          eq(zohoAdminReportBackups.sha256, digest),
          eq(zohoAdminReportBackups.status, "OK"),
        ),
      )
      .limit(1);
    if (existingOk) {
      logger.info(
        {
          periodId: job.periodId,
          orgId: org.id,
          fileId: existingOk.zohoFileId,
        },
        "zoho.admin-report.backup: already uploaded",
      );
      continue;
    }

    try {
      const uploaded = await uploadAdminReportToWorkDrive({
        org,
        folderId,
        filename: artifacts.filename,
        pdfBytes: artifacts.pdfBytes,
      });
      const [row] = await db
        .insert(zohoAdminReportBackups)
        .values({
          periodId: job.periodId,
          payrollRunId: run?.id ?? job.runId ?? null,
          organizationId: org.id,
          folderId,
          zohoFileId: uploaded.fileId,
          filename: artifacts.filename,
          sha256: digest,
          sizeBytes,
          status: "OK",
          uploadedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();
      await writeAudit({
        actorId: null,
        actorRole: "OWNER",
        action: "zoho.workdrive.admin_report_backup.ok",
        targetType: "PayPeriod",
        targetId: job.periodId,
        after: {
          orgId: org.id,
          fileId: uploaded.fileId,
          filename: artifacts.filename,
          sizeBytes,
          backupId: row?.id ?? null,
        },
      });
      logger.info(
        { periodId: job.periodId, orgId: org.id, fileId: uploaded.fileId },
        "zoho.admin-report.backup: uploaded",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.insert(zohoAdminReportBackups).values({
        periodId: job.periodId,
        payrollRunId: run?.id ?? job.runId ?? null,
        organizationId: org.id,
        folderId,
        filename: artifacts.filename,
        sha256: digest,
        sizeBytes,
        status: "ERROR",
        errorMessage: message,
      });
      await writeAudit({
        actorId: null,
        actorRole: "OWNER",
        action: "zoho.workdrive.admin_report_backup.error",
        targetType: "PayPeriod",
        targetId: job.periodId,
        after: {
          orgId: org.id,
          filename: artifacts.filename,
          error: message,
        },
      });
      logger.error(
        { periodId: job.periodId, orgId: org.id, err: message },
        "zoho.admin-report.backup: failed",
      );
    }
  }
}

import { writeAudit } from "@/lib/db/audit";
import { getPunchForNgtecoSync } from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";
import { openNgtecoCredentials } from "@/lib/ngteco/credentials";
import {
  buildManualPunchSyncEvents,
  formatNgtecoManualPunchTimestamp,
} from "@/lib/ngteco/manual-punch-sync";
import { logger } from "@/lib/telemetry";

export async function handleManualPunchNgtecoSync(input: {
  punchId: string;
  actorId: string;
  actorRole: "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "ACCOUNTANT" | "EMPLOYEE";
}): Promise<void> {
  const punch = await getPunchForNgtecoSync(input.punchId);
  if (!punch) {
    logger.warn(
      { punchId: input.punchId },
      "manual punch sync: punch not found",
    );
    return;
  }
  if (punch.voidedAt) {
    logger.info(
      { punchId: punch.id },
      "manual punch sync: punch is voided; skipping",
    );
    return;
  }
  const syncableSources = new Set([
    "MANUAL_ADMIN",
    "MISSED_PUNCH_APPROVED",
    "NGTECO_AUTO",
  ]);
  if (!syncableSources.has(punch.source)) {
    logger.info(
      { punchId: punch.id, source: punch.source },
      "manual punch sync: punch source is not pushed to NGTeco",
    );
    return;
  }

  const company = await getSetting("company");
  const ngteco = await getSetting("ngteco");
  const credentials = await openNgtecoCredentials();
  const events = buildManualPunchSyncEvents({
    punchId: punch.id,
    personId: punch.ngtecoEmployeeRef,
    employeeName: punch.employeeName,
    clockIn: punch.clockIn,
    clockOut: punch.clockOut,
  });
  const { addManualAttendancePunch } = await import("@/lib/ngteco/scraper");

  for (const event of events) {
    const timestamp = formatNgtecoManualPunchTimestamp(
      event.punchAt,
      company.timezone,
    );
    await addManualAttendancePunch({
      portalUrl: ngteco.portalUrl,
      username: credentials.username,
      password: credentials.password,
      headless: ngteco.headless,
      runId: `manual-punch-${punch.id}-${event.kind}`,
      personId: event.personId,
      personName: event.employeeName,
      punchDate: timestamp.date,
      punchTime: timestamp.time,
      timeZoneOffset: timestamp.timeZoneOffset,
      remarks: `Synced from Milo punch ${punch.id} (${event.kind})`,
    });
  }

  await writeAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "punch.ngteco_sync",
    targetType: "Punch",
    targetId: punch.id,
    after: {
      ngtecoEmployeeRef: punch.ngtecoEmployeeRef,
      eventsSynced: events.map((e) => e.kind),
    },
  });
}

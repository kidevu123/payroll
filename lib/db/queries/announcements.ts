// Announcement queries — audience resolution + insert + list for the
// admin-side notification sender. Uses the existing notifications.dispatch
// router to fan out, and persists a row in `announcements` for history.

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  announcements,
  employees,
  paySchedules,
  users,
  type Announcement,
  type NewAnnouncement,
} from "@/lib/db/schema";

export type AudienceMode = "ALL" | "BY_ROLE" | "BY_SCHEDULE" | "SPECIFIC";

export type AudienceFilter =
  | { mode: "ALL" }
  | { mode: "BY_ROLE"; payTypes: ReadonlyArray<"HOURLY" | "SALARIED" | "TASK" | "MIXED"> }
  | { mode: "BY_SCHEDULE"; periodKinds: ReadonlyArray<"WEEKLY" | "SEMI_MONTHLY" | "MONTHLY"> }
  | { mode: "SPECIFIC"; employeeIds: ReadonlyArray<string> };

export type ResolvedRecipient = {
  userId: string;
  employeeId: string;
  displayName: string;
  email: string | null;
};

/** Resolve a filter to the set of (userId, employeeId, displayName)
 *  triples that should receive the announcement. Excludes terminated
 *  employees, employees without a linked user, and disabled users. */
export async function resolveAnnouncementRecipients(
  filter: AudienceFilter,
): Promise<ResolvedRecipient[]> {
  // Common base: active/inactive employees that have a linked, enabled user.
  const conditions = [
    sql`${employees.status} <> 'TERMINATED'`,
    sql`${users.disabledAt} IS NULL`,
    sql`${users.id} IS NOT NULL`,
  ];

  if (filter.mode === "BY_ROLE") {
    if (filter.payTypes.length === 0) return [];
    conditions.push(inArray(employees.payType, [...filter.payTypes] as never));
  } else if (filter.mode === "BY_SCHEDULE") {
    if (filter.periodKinds.length === 0) return [];
    // Match paySchedules.periodKind for the employee's schedule. Employees
    // with NULL payScheduleId fall outside this filter (broadcast to "all"
    // is the right tool for them).
    conditions.push(
      sql`${paySchedules.periodKind} IN (${sql.join(
        filter.periodKinds.map((k) => sql`${k}`),
        sql.raw(", "),
      )})`,
    );
  } else if (filter.mode === "SPECIFIC") {
    if (filter.employeeIds.length === 0) return [];
    conditions.push(inArray(employees.id, [...filter.employeeIds]));
  }

  const rows = await db
    .select({
      userId: users.id,
      employeeId: employees.id,
      displayName: employees.displayName,
      email: users.email,
    })
    .from(employees)
    .innerJoin(users, eq(users.employeeId, employees.id))
    .leftJoin(paySchedules, eq(paySchedules.id, employees.payScheduleId))
    .where(and(...conditions));

  return rows;
}

/** Persist an announcement row. Caller fans out via dispatch() before
 *  calling this; we record what the audience filter looked like AND the
 *  count actually reached so the history page reflects reality even if
 *  the audience changes (employee terminated, role changed, etc). */
export async function recordAnnouncement(
  input: Omit<NewAnnouncement, "id" | "sentAt">,
): Promise<Announcement> {
  const [row] = await db.insert(announcements).values(input).returning();
  if (!row) throw new Error("recordAnnouncement: insert empty");
  return row;
}

/** History page query — newest first, joined to the sender's email. */
export async function listAnnouncements(limit = 100): Promise<
  Array<
    Announcement & {
      sentByEmail: string | null;
    }
  >
> {
  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      link: announcements.link,
      audienceKind: announcements.audienceKind,
      audienceLabels: announcements.audienceLabels,
      audienceIds: announcements.audienceIds,
      recipientCount: announcements.recipientCount,
      sentById: announcements.sentById,
      sentAt: announcements.sentAt,
      sentByEmail: users.email,
    })
    .from(announcements)
    .leftJoin(users, eq(users.id, announcements.sentById))
    .orderBy(desc(announcements.sentAt))
    .limit(limit);
  return rows;
}

/** Quick recipient count probe for the compose form. Same filter shape
 *  as resolveAnnouncementRecipients but returns just the count, which
 *  the form can show as "This will reach N people" without paying for
 *  the full row payload. */
export async function previewRecipientCount(
  filter: AudienceFilter,
): Promise<number> {
  const recipients = await resolveAnnouncementRecipients(filter);
  return recipients.length;
}

void isNull;

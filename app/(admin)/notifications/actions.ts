"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth-guards";
import {
  deleteAnnouncementForHistory,
  previewRecipientCount,
  recordAnnouncement,
  resolveAnnouncementRecipients,
  type AudienceFilter,
} from "@/lib/db/queries/announcements";
import { dispatch } from "@/lib/notifications/router";
import { writeAudit } from "@/lib/db/audit";

const baseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  link: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .refine(
      (v) => !v || v.startsWith("/") || /^https?:\/\//.test(v),
      "Link must start with / (internal) or http(s)://",
    ),
  mode: z.enum(["ALL", "BY_ROLE", "BY_SCHEDULE", "SPECIFIC"]),
  payTypes: z.array(z.enum(["HOURLY", "SALARIED", "TASK", "MIXED"])).optional(),
  periodKinds: z.array(z.enum(["WEEKLY", "SEMI_MONTHLY", "MONTHLY"])).optional(),
  employeeIds: z.array(z.string().uuid()).optional(),
});

function buildFilter(parsed: z.infer<typeof baseSchema>): AudienceFilter {
  if (parsed.mode === "BY_ROLE") {
    return { mode: "BY_ROLE", payTypes: parsed.payTypes ?? [] };
  }
  if (parsed.mode === "BY_SCHEDULE") {
    return { mode: "BY_SCHEDULE", periodKinds: parsed.periodKinds ?? [] };
  }
  if (parsed.mode === "SPECIFIC") {
    return { mode: "SPECIFIC", employeeIds: parsed.employeeIds ?? [] };
  }
  return { mode: "ALL" };
}

function audienceLabels(filter: AudienceFilter): string[] {
  if (filter.mode === "ALL") return ["All employees"];
  if (filter.mode === "BY_ROLE") return [...filter.payTypes];
  if (filter.mode === "BY_SCHEDULE") return [...filter.periodKinds];
  return []; // SPECIFIC — names are looked up by id at render time
}

/** Compose-form preview action. Returns just the count so the form can
 *  show "This will reach N people" without firing anything. */
export async function previewAnnouncementAction(input: {
  mode: "ALL" | "BY_ROLE" | "BY_SCHEDULE" | "SPECIFIC";
  payTypes?: string[];
  periodKinds?: string[];
  employeeIds?: string[];
}): Promise<{ count: number } | { error: string }> {
  await requireAdmin();
  const parsed = z
    .object({
      mode: z.enum(["ALL", "BY_ROLE", "BY_SCHEDULE", "SPECIFIC"]),
      payTypes: z
        .array(z.enum(["HOURLY", "SALARIED", "TASK", "MIXED"]))
        .optional(),
      periodKinds: z.array(z.enum(["WEEKLY", "SEMI_MONTHLY", "MONTHLY"])).optional(),
      employeeIds: z.array(z.string().uuid()).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid filter." };
  }
  // buildFilter expects the title/body/link too but only reads mode +
  // the audience arrays — synthesise the rest with empty placeholders.
  const filter = buildFilter({
    title: "",
    body: "",
    mode: parsed.data.mode,
    payTypes: parsed.data.payTypes as never,
    periodKinds: parsed.data.periodKinds as never,
    employeeIds: parsed.data.employeeIds,
  });
  const count = await previewRecipientCount(filter);
  return { count };
}

export async function sendAnnouncementAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();

  // Multi-select fields arrive as repeated form entries. Normalize.
  const getAll = (k: string): string[] =>
    formData
      .getAll(k)
      .map((v) => (typeof v === "string" ? v : ""))
      .filter(Boolean);

  const parsed = baseSchema.safeParse({
    title: formData.get("title") ?? "",
    body: formData.get("body") ?? "",
    link: formData.get("link") || null,
    mode: formData.get("mode") ?? "ALL",
    payTypes: getAll("payTypes"),
    periodKinds: getAll("periodKinds"),
    employeeIds: getAll("employeeIds"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const filter = buildFilter(parsed.data);
  const recipients = await resolveAnnouncementRecipients(filter);
  if (recipients.length === 0) {
    return {
      error:
        "No one matches that audience filter. Pick a wider audience or invite the missing employees first.",
    };
  }

  // Fan-out: in-app + push (per channelsFor() in router). Push payload
  // carries the operator-typed words verbatim so the OS notification
  // matches what's in the bell.
  const link = parsed.data.link ?? "/me/home";
  await dispatch(
    recipients.map((r) => ({
      recipientId: r.userId,
      kind: "admin.announcement" as const,
      payload: {
        title: parsed.data.title,
        body: parsed.data.body,
        link,
      },
      push: {
        title: parsed.data.title,
        body: parsed.data.body,
        url: link,
        tag: "announcement",
      },
    })),
  );

  // Persist the history row. audienceLabels keeps the human-readable
  // tag list ("HOURLY", "WEEKLY", "All employees") for the listing
  // page; audienceIds carries the explicit employee ids when SPECIFIC
  // so the listing can re-render their names.
  const announcement = await recordAnnouncement({
    title: parsed.data.title,
    body: parsed.data.body,
    link: parsed.data.link ?? null,
    audienceKind: parsed.data.mode,
    audienceLabels: audienceLabels(filter),
    audienceIds:
      parsed.data.mode === "SPECIFIC"
        ? (parsed.data.employeeIds ?? null)
        : null,
    recipientCount: recipients.length,
    sentById: session.user.id,
  });
  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "announcement.send",
    targetType: "Announcement",
    targetId: announcement.id,
    after: {
      audienceKind: parsed.data.mode,
      recipientCount: recipients.length,
      title: parsed.data.title,
    },
  });

  revalidatePath("/notifications");
  redirect("/notifications");
}

export async function deleteAnnouncementAction(
  formData: FormData,
): Promise<void> {
  const session = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;

  const deleted = await deleteAnnouncementForHistory({
    id: id.data,
    actorId: session.user.id,
  });

  if (deleted) {
    await writeAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "announcement.delete",
      targetType: "Announcement",
      targetId: deleted.id,
      before: {
        title: deleted.title,
        sentAt: deleted.sentAt,
        recipientCount: deleted.recipientCount,
      },
      after: {
        deletedAt: deleted.deletedAt,
      },
    });
  }

  revalidatePath("/notifications");
}

// ── Templates ────────────────────────────────────────────────────────────

const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  link: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .refine(
      (v) => !v || v.startsWith("/") || /^https?:\/\//.test(v),
      "Link must start with / (internal) or http(s)://",
    ),
});

export async function createTemplateAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = templateSchema.safeParse({
    name: formData.get("name"),
    title: formData.get("title"),
    body: formData.get("body"),
    link: formData.get("link") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid template" };
  }
  const { createAnnouncementTemplate } = await import(
    "@/lib/db/queries/announcement-templates"
  );
  const row = await createAnnouncementTemplate({
    name: parsed.data.name,
    title: parsed.data.title,
    body: parsed.data.body,
    link: parsed.data.link ?? null,
    createdById: session.user.id,
  });
  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "announcementTemplate.create",
    targetType: "AnnouncementTemplate",
    targetId: row.id,
    after: { name: row.name, title: row.title },
  });
  revalidatePath("/notifications");
  redirect("/notifications");
}

export async function deleteTemplateAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const { softDeleteAnnouncementTemplate } = await import(
    "@/lib/db/queries/announcement-templates"
  );
  const deleted = await softDeleteAnnouncementTemplate({
    id: id.data,
    actorId: session.user.id,
  });
  if (deleted) {
    await writeAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "announcementTemplate.delete",
      targetType: "AnnouncementTemplate",
      targetId: deleted.id,
      before: { name: deleted.name, title: deleted.title },
      after: { deletedAt: deleted.deletedAt },
    });
  }
  revalidatePath("/notifications");
}

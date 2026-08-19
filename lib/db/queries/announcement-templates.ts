// Announcement template queries — list / create / soft-delete. Templates
// are compose-form starting points only; sent announcements never reference
// them, so deletion is always safe.

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  announcementTemplates,
  type AnnouncementTemplate,
  type NewAnnouncementTemplate,
} from "@/lib/db/schema";

export async function listAnnouncementTemplates(
  limit = 50,
): Promise<AnnouncementTemplate[]> {
  return db
    .select()
    .from(announcementTemplates)
    .where(isNull(announcementTemplates.deletedAt))
    .orderBy(desc(announcementTemplates.createdAt))
    .limit(limit);
}

export async function getAnnouncementTemplateById(
  id: string,
): Promise<AnnouncementTemplate | null> {
  const [row] = await db
    .select()
    .from(announcementTemplates)
    .where(
      and(
        eq(announcementTemplates.id, id),
        isNull(announcementTemplates.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createAnnouncementTemplate(
  input: Omit<NewAnnouncementTemplate, "id" | "createdAt">,
): Promise<AnnouncementTemplate> {
  const [row] = await db
    .insert(announcementTemplates)
    .values(input)
    .returning();
  if (!row) throw new Error("createAnnouncementTemplate: insert empty");
  return row;
}

export async function softDeleteAnnouncementTemplate(args: {
  id: string;
  actorId: string;
}): Promise<AnnouncementTemplate | null> {
  const [row] = await db
    .update(announcementTemplates)
    .set({ deletedAt: new Date(), deletedById: args.actorId })
    .where(
      and(
        eq(announcementTemplates.id, args.id),
        isNull(announcementTemplates.deletedAt),
      ),
    )
    .returning();
  return row ?? null;
}

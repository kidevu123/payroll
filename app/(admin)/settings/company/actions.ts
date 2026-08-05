"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import { setSetting, getSetting } from "@/lib/settings/runtime";
import { companySchema } from "@/lib/settings/schemas";

export async function saveCompany(formData: FormData): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const current = await getSetting("company");
  const parsed = companySchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address") ?? "",
    logoPath: current.logoPath,
    brandColorHex: formData.get("brandColorHex") ?? "#067049",
    timezone: formData.get("timezone") ?? "America/New_York",
    locale: formData.get("locale") ?? "en-US",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  // Spread `current` first so any fields the form doesn't manage (e.g.
  // faviconPath, iconsGeneratedAt added by /settings/branding) survive
  // a company-form save. Without this, those values silently reset on
  // every Save click.
  await setSetting("company", { ...current, ...parsed.data }, {
    actorId: session.user.id,
    actorRole: session.user.role,
  });
  revalidatePath("/", "layout");
}

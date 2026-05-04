"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting, setSetting } from "@/lib/settings/runtime";
import {
  generateIcons,
  saveFavicon,
  saveLogo,
} from "@/lib/branding/storage";

const colorSchema = z.object({
  brandColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a 6-digit hex color"),
});

export async function updateBrandColorAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = colorSchema.safeParse({ brandColorHex: formData.get("brandColorHex") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid color." };
  }
  const company = await getSetting("company");
  await setSetting(
    "company",
    { ...company, brandColorHex: parsed.data.brandColorHex },
    { actorId: session.user.id, actorRole: session.user.role },
  );
  revalidatePath("/settings/branding");
}

const IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function uploadLogoAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a logo file." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: `File too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).` };
  }
  if (!IMAGE_MIME.has(file.type)) {
    return { error: "Only PNG, JPEG, WEBP, or SVG logos are accepted." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const saved = await saveLogo(buffer, file.type);
    // Generate PWA icons from the logo, but only if not an SVG (sharp's
    // SVG support is patchy across distros — fallback gives us initials).
    let generated = false;
    if (file.type !== "image/svg+xml") {
      try {
        await generateIcons(saved.path);
        generated = true;
      } catch (err) {
        console.warn("PWA icon generation failed:", err);
      }
    }
    const company = await getSetting("company");
    await setSetting(
      "company",
      {
        ...company,
        logoPath: saved.url,
        iconsGeneratedAt: generated ? new Date().toISOString() : company.iconsGeneratedAt,
      },
      { actorId: session.user.id, actorRole: session.user.role },
    );
    revalidatePath("/", "layout");
    revalidatePath("/settings/branding");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Upload failed." };
  }
}

export async function uploadFaviconAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const file = formData.get("favicon");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a favicon file." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: `File too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).` };
  }
  if (!IMAGE_MIME.has(file.type)) {
    return { error: "Only PNG, JPEG, WEBP, SVG, or ICO favicons are accepted." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const saved = await saveFavicon(buffer, file.type);
    const company = await getSetting("company");
    await setSetting(
      "company",
      { ...company, faviconPath: saved.url },
      { actorId: session.user.id, actorRole: session.user.role },
    );
    revalidatePath("/", "layout");
    revalidatePath("/settings/branding");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Upload failed." };
  }
}

export async function regenerateIconsAction(): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const company = await getSetting("company");
  if (!company.logoPath) {
    return { error: "Upload a logo first." };
  }
  // Re-derive the disk path. saveLogo uses /data/uploads/branding/logo.{ext};
  // findAssetPath probes the known extensions for us.
  const { findAssetPath } = await import("@/lib/branding/storage");
  const found = await findAssetPath("logo");
  if (!found) return { error: "Logo file not found on disk." };
  try {
    await generateIcons(found.path);
    await setSetting(
      "company",
      { ...company, iconsGeneratedAt: new Date().toISOString() },
      { actorId: session.user.id, actorRole: session.user.role },
    );
    revalidatePath("/", "layout");
    revalidatePath("/settings/branding");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Regenerate failed." };
  }
}

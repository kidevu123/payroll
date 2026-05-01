"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth-guards";
import { updateEmployee } from "@/lib/db/queries/employees";

const schema = z.object({
  displayName: z.string().min(1).max(120),
  phone: z.string().max(40).optional().nullable(),
  language: z.enum(["en", "es"]),
});

export async function saveProfileAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireSession();
  if (!session.user.employeeId) return { error: "Not linked." };
  const parsed = schema.safeParse({
    displayName: formData.get("displayName"),
    phone: formData.get("phone") || null,
    language: formData.get("language") || "en",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  await updateEmployee(
    session.user.employeeId,
    {
      displayName: parsed.data.displayName,
      phone: parsed.data.phone ?? null,
      language: parsed.data.language,
    },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath("/me/profile");
  revalidatePath("/", "layout"); // refresh i18n locale on next render
}

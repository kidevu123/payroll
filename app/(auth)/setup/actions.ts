"use server";

import { z } from "zod";
import { hasAnyUser, createUser } from "@/lib/db/queries/users";
import { hashPassword } from "@/lib/auth";
import { setSetting } from "@/lib/settings/runtime";
import { writeAudit } from "@/lib/db/audit";

const schema = z.object({
  companyName: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(12).max(200),
});

export async function createOwner(formData: FormData): Promise<{ error?: string } | void> {
  // Race-condition guard: only the first POST wins.
  if (await hasAnyUser()) return { error: "Setup has already been completed." };

  const parsed = schema.safeParse({
    companyName: formData.get("companyName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { companyName, email, password } = parsed.data;

  const passwordHash = await hashPassword(password);
  const user = await createUser({ email, passwordHash, role: "OWNER" });

  await setSetting(
    "company",
    {
      name: companyName,
      address: "",
      logoPath: null,
      brandColorHex: "#0f766e",
      timezone: "America/New_York",
      locale: "en-US",
    },
    { actorId: user.id, actorRole: "OWNER" },
  );

  await writeAudit({
    actorId: user.id,
    actorRole: "OWNER",
    action: "setup.complete",
    targetType: "User",
    targetId: user.id,
  });
}

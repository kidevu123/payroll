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
  let user;
  try {
    user = await createUser({ email, passwordHash, role: "OWNER" });
  } catch (err) {
    // Race: a concurrent setup POST already created the first user (email is
    // unique). Treat as "already completed" instead of a raw 23505.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return { error: "Setup has already been completed." };
    }
    throw err;
  }

  await setSetting(
    "company",
    {
      name: companyName,
      address: "",
      logoPath: null,
      brandColorHex: "#067049",
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

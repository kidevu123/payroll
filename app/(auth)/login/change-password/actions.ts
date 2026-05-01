"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireSessionAllowingPasswordChange } from "@/lib/auth-guards";
import { changeOwnPassword } from "@/lib/db/queries/users";
import { signOut } from "@/lib/auth";

const schema = z
  .object({
    password: z.string().min(8, "At least 8 characters."),
    confirm: z.string().min(8),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });

export async function changePasswordAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireSessionAllowingPasswordChange();
  const parsed = schema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  await changeOwnPassword(session.user.id, parsed.data.password);
  // Force a fresh login so the JWT picks up the cleared mustChangePassword.
  await signOut({ redirect: false });
  redirect("/login?reset=ok");
}

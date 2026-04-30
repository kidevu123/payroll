"use server";

import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";

export async function signInAction(
  formData: FormData,
): Promise<{ error?: string } | undefined> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // Auth.js v5 wraps errors thrown from authorize() in a CallbackRouteError
      // whose .cause shape varies between betas. Walk it defensively.
      const causeMessage =
        (err.cause as { err?: { message?: string }; message?: string } | undefined)?.err
          ?.message ??
        (err.cause as { message?: string } | undefined)?.message ??
        err.message;
      if (causeMessage === "RATE_LIMITED") {
        return { error: "Too many failed attempts. Try again in a few minutes." };
      }
      if (causeMessage === "LOCKED") {
        return { error: "This account is temporarily locked. Contact your administrator." };
      }
      return { error: "Invalid email or password." };
    }
    throw err;
  }
}

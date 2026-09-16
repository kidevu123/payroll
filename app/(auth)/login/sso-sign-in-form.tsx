"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Auth.js OAuth sign-in via POST + CSRF.
 *
 * The server-action form this replaces was unreliable on the first click:
 * the action redirect raced the client router and the button appeared dead
 * until a second press. Posting the CSRF token straight to the provider
 * endpoint is the documented path and works first time.
 */
export function SsoSignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startSso() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/csrf", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Could not start SSO");
      const { csrfToken } = (await res.json()) as { csrfToken: string };

      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/auth/signin/authentik";

      for (const [name, value] of [
        ["csrfToken", csrfToken],
        ["callbackUrl", callbackUrl],
      ] as const) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }

      document.body.appendChild(form);
      form.submit();
    } catch {
      setLoading(false);
      setError("Could not start SSO. Please try again.");
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="lg" className="w-full" disabled={loading} onClick={startSso}>
        {loading ? "Redirecting..." : "Sign in with SSO"}
      </Button>
      {error ? <p className="text-center text-xs text-danger-700">{error}</p> : null}
    </div>
  );
}

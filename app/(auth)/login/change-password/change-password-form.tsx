"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm() {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const result = await changePasswordAction(form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Save and sign in again"}
      </Button>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOwner } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await createOwner(fd);
          if (res?.error) {
            setError(res.error);
            return;
          }
          router.replace("/login");
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="companyName">Company name</Label>
        <Input id="companyName" name="companyName" required minLength={1} maxLength={120} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Owner email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-xs text-[--text-subtle]">
          Use at least 12 characters. A password manager is recommended.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account..." : "Create owner account"}
      </Button>
    </form>
  );
}

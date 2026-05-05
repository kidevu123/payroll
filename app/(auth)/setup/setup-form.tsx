"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { createOwner } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Live field state so we can disable the submit button until everything
  // is valid. The server still re-validates everything (Zod in actions.ts);
  // this is purely for UX.
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState<{ companyName?: boolean; email?: boolean; password?: boolean }>({});

  const validity = useMemo(() => {
    const trimmed = companyName.trim();
    return {
      companyName: trimmed.length >= 1 && trimmed.length <= 120,
      email: EMAIL_RE.test(email.trim()),
      password: password.length >= 12,
    };
  }, [companyName, email, password]);

  const allValid = validity.companyName && validity.email && validity.password;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!allValid) {
          setTouched({ companyName: true, email: true, password: true });
          return;
        }
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const res = await createOwner(fd);
          if (res?.error) {
            setError(res.error);
            return;
          }
          router.replace("/login");
        });
      }}
      noValidate
      className="space-y-5"
    >
      <div className="space-y-1.5">
        <Label htmlFor="companyName">Company name</Label>
        <Input
          id="companyName"
          name="companyName"
          required
          minLength={1}
          maxLength={120}
          autoFocus
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, companyName: true }))}
          aria-invalid={touched.companyName && !validity.companyName ? true : undefined}
          className={cn(
            touched.companyName && !validity.companyName &&
              "border-danger-700/70 focus-visible:ring-danger-700",
          )}
        />
        {touched.companyName && !validity.companyName ? (
          <FieldError>Company name is required.</FieldError>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Owner email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          aria-invalid={touched.email && !validity.email ? true : undefined}
          className={cn(
            touched.email && !validity.email &&
              "border-danger-700/70 focus-visible:ring-danger-700",
          )}
        />
        {touched.email && !validity.email ? (
          <FieldError>Enter a valid email address.</FieldError>
        ) : null}
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
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          aria-describedby="password-hint"
          aria-invalid={touched.password && !validity.password ? true : undefined}
          className={cn(
            touched.password && !validity.password &&
              "border-danger-700/70 focus-visible:ring-danger-700",
          )}
        />
        <p
          id="password-hint"
          className={cn(
            "inline-flex items-center gap-1.5 text-xs leading-relaxed",
            validity.password ? "text-success-700" : "text-text-subtle",
          )}
        >
          {validity.password ? (
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : null}
          <span>Use at least 12 characters. A password manager is recommended.</span>
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="inline-flex items-start gap-1.5 text-xs text-danger-700 leading-relaxed"
        >
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={pending || !allValid}
      >
        {pending ? "Creating account..." : "Create owner account"}
      </Button>
    </form>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-1 inline-flex items-start gap-1.5 text-xs text-danger-700 leading-relaxed"
    >
      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

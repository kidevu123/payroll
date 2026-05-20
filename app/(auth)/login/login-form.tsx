"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";
import { signInAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function LoginForm({ oidcEnabled }: { oidcEnabled?: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get("from") ?? "/";
  const t = useTranslations("auth");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const errored = Boolean(error);

  return (
    <div className="space-y-5">
      {oidcEnabled && (
        <>
          <Button
            size="lg"
            className="w-full"
            onClick={() => signIn("authentik", { callbackUrl: from || "/" })}
          >
            Sign in with SSO
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <hr className="flex-1" />
            <span>or sign in with email</span>
            <hr className="flex-1" />
          </div>
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const res = await signInAction(fd);
            if (res?.error) {
              setError(res.error);
              return;
            }
            router.replace(from);
            router.refresh();
          });
        }}
        noValidate
        className="space-y-5"
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus={!oidcEnabled}
            required
            aria-invalid={errored || undefined}
            onChange={() => {
              if (error) setError(null);
            }}
            className={cn(errored && "border-danger-700/70 focus-visible:ring-danger-700")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={errored || undefined}
            aria-describedby={errored ? "login-error" : undefined}
            onChange={() => {
              if (error) setError(null);
            }}
            className={cn(errored && "border-danger-700/70 focus-visible:ring-danger-700")}
          />
          {errored ? (
            <p
              id="login-error"
              role="alert"
              className="mt-1 inline-flex items-start gap-1.5 text-xs text-danger-700 leading-relaxed"
            >
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
        <Button type="submit" size="lg" className={cn("w-full", oidcEnabled && "variant-outline")} variant={oidcEnabled ? "outline" : "default"} disabled={pending}>
          {pending ? t("signingIn") : t("signIn")}
        </Button>
      </form>
    </div>
  );
}

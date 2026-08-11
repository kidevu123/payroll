"use client";

import * as React from "react";
import { LogOut } from "lucide-react";
import { signOutAction } from "./sign-out-action";

/**
 * Robust sign-out trigger. The previous form-action pattern lived inside
 * the user-menu dropdown; clicks sometimes raced the click-outside
 * handler that closed the menu before the form could submit, leaving
 * users with a button that did nothing. This wraps the server action
 * in a transition + manual location reload so the navigation happens
 * regardless of whether the menu has unmounted.
 */
export function SignOutButton({ label }: { label: string }) {
  const [pending, start] = React.useTransition();
  return (
    <button
      type="button"
      role="menuitem"
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        start(async () => {
          try {
            await signOutAction();
          } catch {
            // signOut throws NEXT_REDIRECT internally; ignore and fall
            // through to the explicit navigation below.
          }
          // Belt-and-braces: even when the server action's redirect
          // doesn't propagate (dropdown unmount, etc.), we land the user
          // on /login deterministically.
          window.location.href = "/login";
        });
      }}
      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-text-muted hover:bg-surface-2/40 hover:text-text transition-colors text-left disabled:opacity-60"
    >
      <LogOut className="h-4 w-4 text-text-subtle" aria-hidden />
      {pending ? "…" : label}
    </button>
  );
}

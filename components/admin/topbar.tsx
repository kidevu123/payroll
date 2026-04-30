"use client";

import { Bell, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "./sign-out-action";

export function Topbar({ email, role }: { email: string; role: string }) {
  return (
    <div className="h-14 border-b border-[--border] bg-[--surface] flex items-center justify-end gap-3 px-4 lg:px-6">
      <button
        type="button"
        aria-label="Notifications"
        className="h-9 w-9 inline-flex items-center justify-center rounded-[--radius-input] hover:bg-[--surface-2]"
      >
        <Bell className="h-4 w-4" aria-hidden />
      </button>
      <div className="text-right leading-tight">
        <div className="text-sm">{email}</div>
        <div className="text-xs text-[--text-subtle]">{role}</div>
      </div>
      <form action={signOutAction}>
        <Button variant="ghost" size="icon" aria-label="Sign out">
          <LogOut className="h-4 w-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}

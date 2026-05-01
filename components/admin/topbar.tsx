"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "./sign-out-action";

export function Topbar({
  email,
  role,
  unreadCount,
}: {
  email: string;
  role: string;
  unreadCount: number;
}) {
  return (
    <div className="h-14 border-b border-[--border] bg-[--surface] flex items-center justify-end gap-3 px-4 lg:px-6">
      <Link
        href="/requests"
        aria-label="Notifications"
        className="relative h-9 w-9 inline-flex items-center justify-center rounded-[--radius-input] hover:bg-[--surface-2]"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unreadCount > 0 ? (
          <span
            aria-label={`${unreadCount} unread`}
            className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Link>
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

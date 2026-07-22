// Authed kiosk shell: guard, big header with sign-out, idle auto-logout.

import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { requireKioskEmployee, kioskLogoutAction } from "../actions";
import { kioskCopy, type KioskLang } from "@/lib/kiosk/copy";
import { KioskIdleWatcher } from "./idle-watcher";
import { KIOSK_IDLE_LOGOUT_S } from "@/lib/kiosk/session";

export const dynamic = "force-dynamic";

export default async function KioskSessionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const employee = await requireKioskEmployee();
  if (!employee) redirect("/kiosk");
  const lang = (employee.language === "es" ? "es" : "en") as KioskLang;
  const c = kioskCopy(lang);
  const firstName =
    employee.preferredName?.trim() ||
    employee.displayName.trim().split(/\s+/)[0];

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-2xl font-bold tracking-tight">
            {c.hi}, {firstName}
          </p>
          <KioskIdleWatcher
            idleSeconds={KIOSK_IDLE_LOGOUT_S}
            label={c.autoSignOut}
          />
        </div>
        <form action={kioskLogoutAction}>
          <button
            type="submit"
            className="flex h-16 items-center gap-2 rounded-xl bg-danger-700 px-7 text-2xl font-bold text-white shadow-card active:opacity-90"
          >
            <LogOut className="h-7 w-7" /> {c.exit}
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}

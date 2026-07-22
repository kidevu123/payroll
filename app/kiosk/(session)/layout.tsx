// Authed kiosk shell: guard, big header with sign-out, idle auto-logout.

import { redirect } from "next/navigation";
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
            className="h-14 rounded-2xl bg-neutral-900 px-6 text-xl font-bold text-white active:bg-neutral-700"
          >
            {c.done}
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}

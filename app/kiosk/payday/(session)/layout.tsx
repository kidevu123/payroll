// Payday-mode shell: period banner + End button. No employee idle
// logout here — the owner is holding the tablet; the signing screen has
// its own idle return-to-list instead.

import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { paydayEndAction, requirePaydayPeriod } from "../actions";

export const dynamic = "force-dynamic";

export default async function PaydaySessionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const period = await requirePaydayPeriod();
  if (!period) redirect("/kiosk/payday");
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T12:00:00Z`));

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-2xl font-bold tracking-tight">Payday signing</p>
          <p className="text-base text-text-muted">
            {fmt(period.startDate)} – {fmt(period.endDate)}
          </p>
        </div>
        <form action={paydayEndAction}>
          <button
            type="submit"
            className="flex h-16 items-center gap-2 rounded-xl bg-danger-700 px-7 text-2xl font-bold text-white shadow-card active:opacity-90"
          >
            <LogOut className="h-7 w-7" /> End
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}

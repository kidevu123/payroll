import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock3, Banknote, Flag, CalendarPlus, ChevronRight } from "lucide-react";
import { requireKioskEmployee } from "../../actions";
import { kioskCopy, type KioskLang } from "@/lib/kiosk/copy";

export const dynamic = "force-dynamic";

export default async function KioskHome({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const employee = await requireKioskEmployee();
  if (!employee) redirect("/kiosk");
  const c = kioskCopy((employee.language === "es" ? "es" : "en") as KioskLang);
  const sp = await searchParams;

  const tiles = [
    {
      href: "/kiosk/hours",
      title: c.myHours,
      sub: c.myHoursSub,
      Icon: Clock3,
    },
    { href: "/kiosk/pay", title: c.myPay, sub: c.myPaySub, Icon: Banknote },
    {
      href: "/kiosk/fix",
      title: c.fixPunch,
      sub: c.fixPunchSub,
      Icon: Flag,
    },
    {
      href: "/kiosk/timeoff",
      title: c.timeOffTile,
      sub: c.timeOffTileSub,
      Icon: CalendarPlus,
    },
  ];

  return (
    <main className="flex flex-1 flex-col gap-4">
      {sp.sent ? (
        <p className="flex items-center gap-3 rounded-xl border-2 border-brand-200 bg-brand-50 px-4 py-4 text-xl font-semibold text-brand-900">
          <CheckCircle2 className="h-7 w-7 shrink-0" /> {c.sentBanner}
        </p>
      ) : null}
      {tiles.map(({ href, title, sub, Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-5 rounded-xl border-2 border-border bg-surface px-6 py-7 active:bg-surface-2"
        >
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white">
            <Icon className="h-9 w-9" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-2xl font-bold tracking-tight">
              {title}
            </span>
            <span className="block text-lg text-text-muted">{sub}</span>
          </span>
          <ChevronRight className="h-8 w-8 shrink-0 text-text-subtle" />
        </Link>
      ))}
    </main>
  );
}

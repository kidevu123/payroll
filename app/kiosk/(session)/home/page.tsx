import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock3, Banknote, Flag, ChevronRight } from "lucide-react";
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
  ];

  return (
    <main className="flex flex-1 flex-col gap-4">
      {sp.sent ? (
        <p className="flex items-center gap-3 rounded-2xl border-2 border-teal-300 bg-teal-50 px-4 py-4 text-xl font-semibold text-teal-900">
          <CheckCircle2 className="h-7 w-7 shrink-0" /> {c.sentBanner}
        </p>
      ) : null}
      {tiles.map(({ href, title, sub, Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-5 rounded-3xl border-2 border-neutral-300 bg-white px-6 py-7 active:bg-neutral-100"
        >
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-teal-700 text-white">
            <Icon className="h-9 w-9" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-2xl font-bold tracking-tight">
              {title}
            </span>
            <span className="block text-lg text-neutral-500">{sub}</span>
          </span>
          <ChevronRight className="h-8 w-8 shrink-0 text-neutral-400" />
        </Link>
      ))}
    </main>
  );
}

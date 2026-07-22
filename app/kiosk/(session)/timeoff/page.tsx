import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireKioskEmployee } from "../../actions";
import { kioskCopy, type KioskLang } from "@/lib/kiosk/copy";
import { getSetting } from "@/lib/settings/runtime";
import { companyDayIso } from "@/lib/time/company-day";
import { KioskTimeOffForm } from "./timeoff-form";

export const dynamic = "force-dynamic";

export default async function KioskTimeOff() {
  const employee = await requireKioskEmployee();
  if (!employee) redirect("/kiosk");
  const lang = (employee.language === "es" ? "es" : "en") as KioskLang;
  const c = kioskCopy(lang);
  const company = await getSetting("company");
  const todayIso = companyDayIso(new Date(), company.timezone);

  return (
    <main className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/kiosk/home"
          className="flex h-14 items-center gap-2 rounded-xl border-2 border-border px-5 text-xl font-semibold active:bg-surface-2"
        >
          <ArrowLeft className="h-6 w-6" /> {c.back}
        </Link>
        <p className="text-xl font-bold">{c.timeOffTile}</p>
      </div>
      <KioskTimeOffForm copy={c} todayIso={todayIso} />
    </main>
  );
}

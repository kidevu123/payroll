import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import { getSetting } from "@/lib/settings/runtime";
import { requireKioskEmployee } from "./actions";
import { KioskLoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function KioskLoginPage() {
  const employee = await requireKioskEmployee();
  if (employee) redirect("/kiosk/home");
  const company = await getSetting("company").catch(() => null);
  return (
    <>
      <div className="flex justify-center pt-2">
        <Wordmark
          name={company?.name || "Payroll"}
          logoPath={company?.logoPath ?? null}
          size="lg"
        />
      </div>
      <KioskLoginForm />
      <p className="pb-2 pt-4 text-center">
        <Link
          href="/kiosk/payday"
          className="inline-flex h-12 items-center rounded-xl px-4 text-base font-semibold text-text-muted underline-offset-4 active:bg-surface-2"
        >
          Payday signing (office code)
        </Link>
      </p>
    </>
  );
}

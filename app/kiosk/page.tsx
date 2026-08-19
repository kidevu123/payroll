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
    </>
  );
}

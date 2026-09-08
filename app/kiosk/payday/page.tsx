import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import { getSetting } from "@/lib/settings/runtime";
import { requirePaydayPeriod } from "./actions";
import { PaydayCodeForm } from "./code-form";

export const dynamic = "force-dynamic";

export default async function PaydayUnlockPage() {
  const period = await requirePaydayPeriod();
  if (period) redirect("/kiosk/payday/list");
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
      <PaydayCodeForm />
    </>
  );
}

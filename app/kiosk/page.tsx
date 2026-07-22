import { redirect } from "next/navigation";
import { requireKioskEmployee } from "./actions";
import { KioskLoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function KioskLoginPage() {
  const employee = await requireKioskEmployee();
  if (employee) redirect("/kiosk/home");
  return <KioskLoginForm />;
}

// Employee shell. Mobile-first with a max-width container and a fixed
// bottom-nav. The sw.js + manifest land via the root layout so they apply
// here automatically.
//
// Salaried staff don't punch in — their Time tab would show empty state
// forever — so we hide it via the BottomNav.hideTime flag based on the
// session user's payType.

import { requireSession } from "@/lib/auth-guards";
import { getEmployee } from "@/lib/db/queries/employees";
import { BottomNav } from "@/components/employee/bottom-nav";
import { ServiceWorkerRegister } from "@/components/employee/sw-register";
import { AppFooter } from "@/components/app-footer";

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const employee = session.user.employeeId
    ? await getEmployee(session.user.employeeId)
    : null;
  const isSalaried = employee?.payType === "SALARIED";
  return (
    <div className="min-h-dvh pb-20 bg-page">
      <ServiceWorkerRegister />
      <div className="max-w-md mx-auto page-enter">{children}</div>
      <AppFooter className="pb-2 max-w-md mx-auto" />
      <BottomNav hideTime={isSalaried} />
    </div>
  );
}

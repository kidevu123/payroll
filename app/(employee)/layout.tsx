// Employee shell. Mobile-first with a max-width container and a fixed
// bottom-nav. The sw.js + manifest land via the root layout so they apply
// here automatically.

import { requireSession } from "@/lib/auth-guards";
import { BottomNav } from "@/components/employee/bottom-nav";
import { ServiceWorkerRegister } from "@/components/employee/sw-register";
import { AppFooter } from "@/components/app-footer";

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return (
    <div className="min-h-dvh pb-20 bg-page">
      <ServiceWorkerRegister />
      <div className="max-w-md mx-auto page-enter">{children}</div>
      <AppFooter className="pb-2 max-w-md mx-auto" />
      <BottomNav />
    </div>
  );
}

// Employee shell. Mobile-first with a max-width container and a fixed
// bottom-nav. The sw.js + manifest land via the root layout so they apply
// here automatically.

import { requireSession } from "@/lib/auth-guards";
import { BottomNav } from "@/components/employee/bottom-nav";
import { ServiceWorkerRegister } from "@/components/employee/sw-register";

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return (
    <div className="min-h-dvh pb-16 bg-[--surface-2]/50">
      <ServiceWorkerRegister />
      <div className="max-w-md mx-auto">{children}</div>
      <BottomNav />
    </div>
  );
}

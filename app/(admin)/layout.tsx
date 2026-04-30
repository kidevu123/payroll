import { requireAdmin } from "@/lib/auth-guards";
import { Sidebar } from "@/components/admin/sidebar";
import { Topbar } from "@/components/admin/topbar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  return (
    <div className="min-h-dvh flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar email={session.user.email} role={session.user.role} />
        <main className="flex-1 p-6 lg:p-8 max-w-screen-2xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

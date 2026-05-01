import { requireAdmin } from "@/lib/auth-guards";
import { Sidebar } from "@/components/admin/sidebar";
import { Topbar } from "@/components/admin/topbar";
import { AppFooter } from "@/components/app-footer";
import { unreadCount } from "@/lib/notifications/in-app";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  const unread = await unreadCount(session.user.id).catch(() => 0);
  return (
    <div className="min-h-dvh flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          email={session.user.email}
          role={session.user.role}
          unreadCount={unread}
        />
        <main className="flex-1 p-6 lg:p-8 max-w-screen-2xl w-full mx-auto">{children}</main>
        <AppFooter />
      </div>
    </div>
  );
}

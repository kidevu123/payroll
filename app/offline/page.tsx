// Static offline fallback served by the service worker when a navigation
// request fails. Avoid imports that pull in the DB / settings runtime so
// it stays cacheable.

export const dynamic = "force-static";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">You&apos;re offline</h1>
        <p className="text-sm text-text-muted">
          Reconnect and try again. Your sign-in stays active.
        </p>
      </div>
    </main>
  );
}

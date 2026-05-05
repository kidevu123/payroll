// Static offline fallback served by the service worker when a navigation
// request fails. Avoid imports that pull in the DB / settings runtime so
// it stays cacheable. Bilingual copy — "You're offline" / "Sin conexión".

export const dynamic = "force-static";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-6 text-center">
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold">You&apos;re offline</h1>
          <p className="text-sm text-text-muted">
            Reconnect and try again. Your sign-in stays active.
          </p>
        </div>
        <div className="border-t border-border/50 pt-3">
          <h2 className="text-sm font-semibold">Sin conexión</h2>
          <p className="text-xs text-text-muted">
            Reconéctese e inténtelo de nuevo. Su sesión sigue activa.
          </p>
        </div>
      </div>
    </main>
  );
}

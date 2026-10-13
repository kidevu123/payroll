"use client";

// A thin bar across the top while a navigation is in flight.
//
// The admin routes used to have a loading.tsx skeleton each. That made every
// click slower, not faster: the skeleton appears instantly, and React then
// holds the real content back for about 300 ms after any fallback is shown,
// even when the data arrived in 30 ms. Without the skeletons a screen swaps in
// as soon as it is ready; this bar is the feedback for the rare slow one, and
// it only appears after a short delay so fast navigations show nothing at all.

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

const SHOW_AFTER_MS = 150;
const GIVE_UP_AFTER_MS = 10_000;

function NavProgressInner() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [active, setActive] = React.useState(false);
  const showTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUpTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = React.useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
    showTimer.current = null;
    giveUpTimer.current = null;
    setActive(false);
  }, []);

  // The URL changed: the navigation finished.
  React.useEffect(() => {
    stop();
  }, [pathname, search, stop]);

  React.useEffect(() => {
    function onClick(event: MouseEvent) {
      // Not `event.defaultPrevented`: next/link prevents the default on every
      // in-app click (that is how it navigates without a reload), and its
      // handler runs before this one.
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith("/api/")) return;
      // Same page (or only the #hash differs): nothing will load.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      stop();
      showTimer.current = setTimeout(() => setActive(true), SHOW_AFTER_MS);
      giveUpTimer.current = setTimeout(stop, GIVE_UP_AFTER_MS);
    }
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      stop();
    };
  }, [stop]);

  if (!active) return null;
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      aria-busy="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-brand-700/15"
    >
      <div className="nav-progress-bar h-full w-1/3 bg-brand-700" />
    </div>
  );
}

export function NavProgress() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <React.Suspense fallback={null}>
      <NavProgressInner />
    </React.Suspense>
  );
}

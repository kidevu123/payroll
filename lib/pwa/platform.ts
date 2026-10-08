// Browser checks shared by the install banner and the push-notification
// toggle. Safe to import anywhere: both return false on the server.

/**
 * iOS Web Push only delivers when the page is launched from a Home
 * Screen icon (PWA standalone mode). A subscription made in a regular
 * Safari tab silently never receives anything from APNs. Detect this
 * before subscribing so the user gets actionable guidance instead of
 * a button that quietly does nothing.
 */
export function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPad on iOS 13+ reports "MacIntel" platform but has touch events.
  const isIDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" &&
      (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1);
  return isIDevice;
}

export function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  // iOS-specific: window.navigator.standalone. Other browsers: media
  // query display-mode.
  type Nav = Navigator & { standalone?: boolean };
  if ((navigator as Nav).standalone === true) return true;
  return window.matchMedia("(display-mode: standalone)").matches;
}

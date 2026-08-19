"use client";

// PDF document links dead-end inside the installed PWA: iOS renders the PDF
// inline in the app frame with no share or print controls, so there is no
// path to AirPrint or Save to Files. When the app runs standalone and the
// browser can share files, intercept the click, fetch the PDF, and hand it
// to the native share sheet (Print, Save to Files, Mail all live there).
//
// Everywhere else (desktop + non-installed mobile browsers) the link no
// longer opens a new tab — it opens the document in the in-app viewer panel
// (PdfViewerProvider) so the app stays in place. If no viewer is mounted the
// anchor falls back to same-tab navigation.

import * as React from "react";
import { usePdfViewer } from "@/components/domain/pdf-viewer";

function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true
  );
}

function canShareFiles(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.canShare !== "function") return false;
  try {
    const probe = new File([new Uint8Array([37])], "probe.pdf", {
      type: "application/pdf",
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

function filenameFrom(header: string | null, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

export type PdfLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  /** Fallback filename when Content-Disposition doesn't provide one. */
  filename?: string;
};

export const PdfLink = React.forwardRef<HTMLAnchorElement, PdfLinkProps>(
  ({ href, filename = "document.pdf", onClick, children, ...rest }, ref) => {
    const [busy, setBusy] = React.useState(false);
    const viewer = usePdfViewer();

    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented || !href) return;
      // Let power users still force a new tab / download via modifier-click
      // or middle-click; don't hijack those.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
        return;
      }

      // Installed PWA: iOS has no share/print chrome around an inline PDF, so
      // hand the file to the native share sheet (AirPrint / Save to Files).
      if (isStandalonePwa() && canShareFiles()) {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        void (async () => {
          try {
            const res = await fetch(href, {
              headers: { Accept: "application/pdf" },
            });
            if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
            const blob = await res.blob();
            const file = new File(
              [blob],
              filenameFrom(res.headers.get("content-disposition"), filename),
              { type: "application/pdf" },
            );
            await navigator.share({ files: [file] });
          } catch (err) {
            // Dismissing the share sheet is not an error. Anything else falls
            // back to plain navigation, same as the untouched anchor.
            if (!(err instanceof DOMException && err.name === "AbortError")) {
              window.open(href, "_blank", "noopener");
            }
          } finally {
            setBusy(false);
          }
        })();
        return;
      }

      // Regular browser: open in the in-app viewer panel instead of a new tab.
      if (viewer) {
        e.preventDefault();
        viewer.open({ href: String(href), filename });
      }
      // No viewer mounted: fall through to the anchor's same-tab navigation.
    };

    return (
      <a
        ref={ref}
        href={href}
        aria-busy={busy || undefined}
        onClick={handleClick}
        {...rest}
      >
        {children}
      </a>
    );
  },
);
PdfLink.displayName = "PdfLink";

"use client";

// PDF document links dead-end inside the installed PWA: iOS renders the PDF
// inline in the app frame with no share or print controls, so there is no
// path to AirPrint or Save to Files. When the app runs standalone and the
// browser can share files, intercept the click, fetch the PDF, and hand it
// to the native share sheet (Print, Save to Files, Mail all live there).
// Everywhere else the link behaves as a normal new-tab anchor.

import * as React from "react";

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

    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented || !href) return;
      if (!isStandalonePwa() || !canShareFiles()) return;
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
    };

    return (
      <a
        ref={ref}
        href={href}
        target="_blank"
        rel="noopener"
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

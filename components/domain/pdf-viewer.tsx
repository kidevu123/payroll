"use client";

// In-app document viewer. Report/paystub/receipt links used to open in a new
// browser tab (target="_blank"), which dead-ends on mobile and scatters tabs
// on desktop. Instead, links now open the document in an overlay panel on the
// current page — the app stays underneath, and Print / Save / Close live in
// the panel header. Same-origin inline PDFs and images both render in the
// iframe. The installed-PWA share-sheet flow is handled upstream in PdfLink;
// by the time we reach this viewer we are in a regular browser context where
// an iframe reliably renders the document.

import * as React from "react";
import { createPortal } from "react-dom";
import { X, Printer, Download } from "lucide-react";

export type ViewerDoc = {
  /** Same-origin URL that serves the document inline. */
  href: string;
  /** Suggested filename for the Save action. */
  filename: string;
  /** Optional human title for the panel header; defaults to the filename. */
  title?: string;
  /**
   * "frame" (default) embeds the PDF in an iframe — fine in a normal
   * browser. "pages" renders every page to a canvas with pdf.js — needed in
   * the installed iOS PWA, where an iframe shows only the first page and
   * offers no controls.
   */
  mode?: "frame" | "pages";
};

type PdfViewerContextValue = {
  open: (doc: ViewerDoc) => void;
};

const PdfViewerContext = React.createContext<PdfViewerContextValue | null>(null);

/** Returns the viewer opener, or null when no provider is mounted (callers
 *  should fall back to plain navigation). */
export function usePdfViewer(): PdfViewerContextValue | null {
  return React.useContext(PdfViewerContext);
}

export function PdfViewerProvider({ children }: { children: React.ReactNode }) {
  const [doc, setDoc] = React.useState<ViewerDoc | null>(null);
  const open = React.useCallback((next: ViewerDoc) => setDoc(next), []);
  const close = React.useCallback(() => setDoc(null), []);

  const value = React.useMemo(() => ({ open }), [open]);

  return (
    <PdfViewerContext.Provider value={value}>
      {children}
      {doc ? <PdfViewerOverlay doc={doc} onClose={close} /> : null}
    </PdfViewerContext.Provider>
  );
}

function PdfViewerOverlay({
  doc,
  onClose,
}: {
  doc: ViewerDoc;
  onClose: () => void;
}) {
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const [mounted, setMounted] = React.useState(false);
  const title = doc.title ?? doc.filename;

  // Portal target only exists on the client; gate the render so SSR is a no-op.
  React.useEffect(() => setMounted(true), []);

  // Escape to close + lock background scroll while the panel is open.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const pages = doc.mode === "pages";

  async function shareFile(): Promise<boolean> {
    if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
    try {
      const res = await fetch(doc.href, { headers: { Accept: "application/pdf" } });
      if (!res.ok) return false;
      const file = new File([await res.blob()], doc.filename, { type: "application/pdf" });
      if (!navigator.canShare({ files: [file] })) return false;
      await navigator.share({ files: [file] });
      return true;
    } catch {
      return true; // dismissed share sheet is not a failure
    }
  }

  function print() {
    if (pages) {
      // No frame to print; the share sheet carries AirPrint on iOS.
      void shareFile().then((ok) => {
        if (!ok) window.open(doc.href, "_blank", "noopener");
      });
      return;
    }
    const frameWindow = frameRef.current?.contentWindow;
    try {
      frameWindow?.focus();
      frameWindow?.print();
    } catch {
      // Some engines refuse to print an embedded PDF via the frame; opening
      // the file in a fresh context is the reliable fallback for those.
      window.open(doc.href, "_blank", "noopener");
    }
  }

  function save() {
    if (pages) {
      void shareFile().then((ok) => {
        if (!ok) window.open(doc.href, "_blank", "noopener");
      });
      return;
    }
    // `download` on a same-origin anchor overrides the route's inline
    // Content-Disposition and saves the file instead of navigating.
    const a = document.createElement("a");
    a.href = doc.href;
    a.download = doc.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex flex-col bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Backdrop click closes; clicks inside the panel do not bubble here.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col p-2 sm:p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border/70 bg-surface shadow-card-strong">
          <header className="flex items-center gap-2 border-b border-border/70 bg-surface-2/60 px-3 py-2.5 sm:px-4">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-text">
              {title}
            </p>
            <button
              type="button"
              onClick={print}
              className="inline-flex h-9 items-center gap-1.5 rounded-input px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60"
            >
              <Printer className="h-4 w-4" aria-hidden /> Print
            </button>
            <button
              type="button"
              onClick={save}
              className="inline-flex h-9 items-center gap-1.5 rounded-input px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60"
            >
              <Download className="h-4 w-4" aria-hidden /> Save
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-9 w-9 items-center justify-center rounded-input text-text-muted transition-colors hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60"
            >
              <X className="h-4.5 w-4.5" aria-hidden />
            </button>
          </header>
          {pages ? (
            <PdfPages href={doc.href} />
          ) : (
            <iframe
              ref={frameRef}
              src={doc.href}
              title={title}
              className="min-h-0 flex-1 bg-white"
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * pdf.js page renderer: fetches the PDF once and paints each page to a
 * canvas at device pixel ratio. Loaded on demand so the pdf.js bundle only
 * ships when a document is actually opened in pages mode.
 */
function PdfPages({ href }: { href: string }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");

  React.useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const res = await fetch(href, { headers: { Accept: "application/pdf" } });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const data = new Uint8Array(await res.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        const width = Math.max(320, host.clientWidth - 24);
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        for (let n = 1; n <= pdf.numPages; n += 1) {
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const viewport = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
          canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
          canvas.className = "mx-auto block bg-white shadow-card";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          host.appendChild(canvas);
        }
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [href]);

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface-2 p-3">
      {state === "loading" && (
        <p className="py-10 text-center text-sm text-text-muted">Loading document…</p>
      )}
      {state === "error" && (
        <p className="py-10 text-center text-sm text-danger-700">
          This document could not be displayed.{" "}
          <a href={href} target="_blank" rel="noopener" className="underline">Open it directly</a>.
        </p>
      )}
      <div ref={hostRef} className="space-y-3" />
    </div>
  );
}

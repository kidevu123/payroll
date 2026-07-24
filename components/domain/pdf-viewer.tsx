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

  function print() {
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
          <iframe
            ref={frameRef}
            src={doc.href}
            title={title}
            className="min-h-0 flex-1 bg-white"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

"use client";

// Finger/stylus signature pad. No dependency: a DPR-scaled canvas with
// pointer events, round-capped strokes on a transparent background, and
// a PNG data URL handed to the parent after every stroke. The parent owns
// the form; this component only reports ink.

import * as React from "react";

const STROKE_CSS_PX = 3.5;

export function SignaturePad({
  onChange,
  clearLabel,
  hint,
  className,
}: {
  /** Called with the PNG data URL after each stroke, or null when cleared. */
  onChange: (dataUrl: string | null) => void;
  clearLabel: string;
  hint: string;
  className?: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const drawingRef = React.useRef(false);
  const hasInkRef = React.useRef(false);
  const [hasInk, setHasInk] = React.useState(false);

  // Size the bitmap to the rendered box at device pixel ratio so strokes
  // stay crisp on high-DPI tablets. Resizing wipes the canvas, so it only
  // happens on mount and on real viewport changes.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = STROKE_CSS_PX;
      ctx.strokeStyle = "#0f172a";
      hasInkRef.current = false;
      setHasInk(false);
      onChange(null);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // onChange is stable enough for our callers; re-fitting on every
    // parent render would wipe in-progress signatures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A dot for a tap-only stroke so short marks still register.
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    hasInkRef.current = true;
    setHasInk(true);
    onChange(e.currentTarget.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    hasInkRef.current = false;
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className={className}>
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label={hint}
          className="block h-56 w-full touch-none rounded-xl border-2 border-dashed border-border bg-surface"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
        />
        {!hasInk ? (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xl text-text-subtle">
            {hint}
          </p>
        ) : null}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-8 bottom-10 border-b-2 border-border"
        />
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk}
          className="h-12 rounded-xl border-2 border-border px-5 text-lg font-semibold text-text-muted active:bg-surface-2 disabled:opacity-40"
        >
          {clearLabel}
        </button>
      </div>
    </div>
  );
}

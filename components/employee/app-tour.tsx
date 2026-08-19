"use client";

import * as React from "react";
import { ArrowRight, Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const TOUR_KEY = "milo.tour.completed.v1";

type TourStep = {
  /** CSS selector for the element being highlighted. */
  target: string;
  /** Plain-string key under "tour.<key>.title" / ".body" — translations
   *  resolve client-side via the strings prop so this component stays
   *  pure-presentation with no async. */
  key: "home" | "time" | "pay" | "profile" | "notifications";
  /** Position relative to the target element. */
  placement: "top" | "bottom";
};

const STEPS: TourStep[] = [
  { target: '[data-tour="nav-home"]', key: "home", placement: "top" },
  { target: '[data-tour="nav-time"]', key: "time", placement: "top" },
  { target: '[data-tour="nav-pay"]', key: "pay", placement: "top" },
  { target: '[data-tour="nav-profile"]', key: "profile", placement: "top" },
];

export type TourStrings = {
  welcomeTitle: string;
  welcomeBody: string;
  start: string;
  skip: string;
  next: string;
  done: string;
  steps: Record<
    TourStep["key"],
    { title: string; body: string }
  >;
};

export function AppTour({
  strings,
  /** Force the tour to show even if previously completed — useful for the
   *  "Replay tour" button on /me/profile. */
  force = false,
}: {
  strings: TourStrings;
  force?: boolean;
}) {
  const [phase, setPhase] = React.useState<"idle" | "welcome" | "step" | "done">(
    "idle",
  );
  const [stepIdx, setStepIdx] = React.useState(0);
  const [rect, setRect] = React.useState<DOMRect | null>(null);

  // First-load: decide whether to show. We delay the welcome card by a
  // beat so the page's own onboarding banner isn't competing for the
  // user's eyes.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!force && window.localStorage.getItem(TOUR_KEY) === "1") {
      setPhase("done");
      return;
    }
    const t = setTimeout(() => setPhase("welcome"), 400);
    return () => clearTimeout(t);
  }, [force]);

  // While in "step" phase, locate the target element so we can position
  // the tooltip relative to it. Measure once, then re-measure on scroll and
  // resize — the old requestAnimationFrame loop called setState ~60×/s for
  // the whole step, burning main-thread time on every employee page render.
  React.useEffect(() => {
    if (phase !== "step") return;
    const step = STEPS[stepIdx];
    if (!step) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = document.querySelector(step.target);
      setRect(el ? (el as HTMLElement).getBoundingClientRect() : null);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", schedule);
    };
  }, [phase, stepIdx]);

  function complete() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TOUR_KEY, "1");
    }
    setPhase("done");
  }

  if (phase === "idle" || phase === "done") return null;

  // Welcome card sits centered, no spotlight yet. Single primary CTA
  // ("Show me around") + a "Skip for now" ghost button.
  if (phase === "welcome") {
    return (
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/55"
      >
        <div className="w-full max-w-sm rounded-card bg-surface p-5 shadow-pop space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 ring-1 ring-inset ring-brand-200">
              <Sparkles className="h-4 w-4 text-brand-700" />
            </span>
            <h3 className="text-base font-semibold tracking-tight antialiased">
              {strings.welcomeTitle}
            </h3>
          </div>
          <p className="text-sm text-text-muted leading-relaxed">
            {strings.welcomeBody}
          </p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={complete}
            >
              {strings.skip}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setStepIdx(0);
                setPhase("step");
              }}
            >
              {strings.start} <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Step phase — spotlight + tooltip.
  const step = STEPS[stepIdx]!;
  const stepCopy = strings.steps[step.key];
  const isLast = stepIdx === STEPS.length - 1;

  // Tooltip placement: above for nav-tour items (placement="top") so we
  // don't blanket the navbar. Clamp X within the viewport so the
  // tooltip never overflows the right edge — was happening on the last
  // step (rightmost bottom-nav item) on narrow phones.
  const tooltipStyle: React.CSSProperties = (() => {
    const TOOLTIP_W = 288; // matches w-72
    const MARGIN = 12;
    const viewportW =
      typeof window !== "undefined" ? window.innerWidth : 360;
    if (!rect) {
      return {
        position: "fixed",
        bottom: "20%",
        left: Math.max(MARGIN, (viewportW - TOOLTIP_W) / 2),
        width: Math.min(TOOLTIP_W, viewportW - MARGIN * 2),
      };
    }
    const desiredLeft = rect.left + rect.width / 2 - TOOLTIP_W / 2;
    const clampedLeft = Math.max(
      MARGIN,
      Math.min(desiredLeft, viewportW - TOOLTIP_W - MARGIN),
    );
    const baseTop =
      step.placement === "top" ? rect.top - 12 : rect.bottom + 12;
    return {
      position: "fixed",
      top: baseTop,
      left: clampedLeft,
      width: Math.min(TOOLTIP_W, viewportW - MARGIN * 2),
      transform: step.placement === "top" ? "translateY(-100%)" : undefined,
    };
  })();

  return (
    <>
      {/* Dim overlay with a square cut-out around the target element.
          Uses a two-layer trick: a full-screen overlay + a transparent
          ring positioned on the target. The ring's outline acts as a
          spotlight without needing SVG masks. */}
      <div className="fixed inset-0 z-[60] bg-black/55 pointer-events-none" />
      {rect && (
        <div
          className="fixed z-[61] pointer-events-none rounded-card ring-2 ring-brand-300 ring-offset-4 ring-offset-black/0"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow:
              "0 0 0 9999px rgba(0,0,0,0.55), 0 0 30px 4px rgba(13,148,136,0.35)",
          }}
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        className="z-[70] rounded-card bg-surface p-4 shadow-pop space-y-2.5"
        style={tooltipStyle}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-micro uppercase text-brand-700">
            {stepIdx + 1} / {STEPS.length}
          </p>
          <button
            type="button"
            aria-label="Close"
            onClick={complete}
            className="-m-2 flex h-9 w-9 items-center justify-center rounded-input text-text-subtle hover:text-text [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h4 className="text-sm font-semibold tracking-tight antialiased">
          {stepCopy.title}
        </h4>
        <p className="text-xs text-text-muted leading-relaxed">
          {stepCopy.body}
        </p>
        <div className="flex items-center justify-end gap-2 pt-1">
          {!isLast ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setStepIdx((i) => i + 1)}
            >
              {strings.next} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={complete}>
              <Check className="h-3.5 w-3.5" /> {strings.done}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

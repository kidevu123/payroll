"use client";

// State for a start / end pair of <input type="date"> fields where the end
// may not precede the start: the end input's `min` follows the start (so the
// native picker greys out earlier days and the browser blocks submit), and
// moving the start past the end pulls the end forward to it.
import * as React from "react";
import { endAfterStartChange } from "@/lib/time-off/date-range";

type Change = React.ChangeEvent<HTMLInputElement>;

export function useDateRange(initialStart = "", initialEnd = "", floor?: string) {
  const [start, setStart] = React.useState(initialStart);
  const [end, setEnd] = React.useState(initialEnd);
  /** Back to the initial pair, e.g. when a dialog that owns the form closes. */
  const reset = React.useCallback(() => {
    setStart(initialStart);
    setEnd(initialEnd);
  }, [initialStart, initialEnd]);
  return {
    reset,
    start: {
      value: start,
      onChange: (e: Change) => {
        const next = e.target.value;
        setStart(next);
        setEnd((prev) => endAfterStartChange(next, prev));
      },
    },
    end: {
      value: end,
      min: start || floor,
      onChange: (e: Change) => setEnd(e.target.value),
    },
  };
}

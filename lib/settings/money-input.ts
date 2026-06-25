// Shared schema for parsing dollar inputs into integer cents.
//
// Money is integer cents app-wide (per CLAUDE.md). Admin forms accept
// dollars as a free-text input (`<input type="number" step="0.01">`). Naive
// `parseFloat` + `Math.round(* 100)` accepts garbage like `"1685.999"` (gains
// a cent), `"1e2"`, `Infinity`, `NaN`. Use this schema instead.

import { z } from "zod";

const DOLLAR_REGEX = /^\d+(\.\d{1,2})?$/;

/** Optional dollar amount — empty/whitespace → null. */
export const optionalDollarsToCents = z
  .union([
    z.literal("").transform(() => null),
    z
      .string()
      .regex(DOLLAR_REGEX, "Enter a positive number with up to 2 decimal places (e.g. 1685.00)")
      .transform((s) => Math.round(Number(s) * 100)),
  ])
  .nullable();

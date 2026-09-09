"use client";

// Year scope for the whole page (?year=). Reads as a date range like the
// mock; the app's periods never straddle years so a year is the unit.

import { CalendarDays, ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

export function YearPicker({ year, years }: { year: number; years: number[] }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label className="relative inline-flex h-10 items-center gap-2 rounded-input border border-border bg-surface pl-3 pr-9 text-sm font-medium text-text shadow-card">
      <CalendarDays className="h-4 w-4 text-text-muted" aria-hidden />
      <span className="hidden tabular-nums sm:inline">Jan 1, {year} – Dec 31, {year}</span>
      <span className="tabular-nums sm:hidden">{year}</span>
      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-text-muted" aria-hidden />
      <select
        aria-label="Year"
        value={year}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set("year", e.target.value);
          router.push(`/reports?${next.toString()}`);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </label>
  );
}

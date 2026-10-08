"use client";

// The ledger toolbar: search plus schedule / status / payment / sort selects.
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

import {
  type StatusFilter,
  type MethodFilter,
  type SortKey,
} from "@/lib/reports/table-model";


const SELECT_CLASS =
  "h-9 rounded-input border border-border bg-surface px-2.5 text-xs font-medium text-text transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60";

export function FilterBar({
  periodCount,
  scheduleTab,
  query,
  setQuery,
  status,
  setStatus,
  method,
  setMethod,
  sort,
  setSort,
  hasActiveFilters,
  onClear,
}: {
  periodCount: number;
  scheduleTab: string;
  query: string;
  setQuery: (v: string) => void;
  status: StatusFilter;
  setStatus: (v: StatusFilter) => void;
  method: MethodFilter;
  setMethod: (v: MethodFilter) => void;
  sort: SortKey;
  setSort: (v: SortKey) => void;
  hasActiveFilters: boolean;
  onClear: () => void;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2.5">
      <label className="relative min-w-[8rem] max-w-[16rem] flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pay runs..."
          aria-label="Search pay runs"
          className="h-9 [@media(pointer:coarse)]:h-11 w-full rounded-input border border-border bg-surface pl-8 pr-2.5 text-xs text-text placeholder:text-text-subtle transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60"
        />
      </label>
      <FilterSelect
        label="Schedule"
        value={scheduleTab}
        onChange={(v) =>
          router.push(v === "all" ? "/reports" : `/reports?schedule=${v}`)
        }
        options={[
          ["all", "All"],
          ["weekly", "Weekly"],
          ["semi-monthly", "Semi-monthly"],
          ["monthly", "Monthly"],
          ["salaried", "Salaried"],
        ]}
      />
      <FilterSelect
        label="Status"
        value={status}
        onChange={(v) => setStatus(v as StatusFilter)}
        options={[
          ["all", "All"],
          ["PAID", "Completed"],
          ["LOCKED", "Locked"],
          ["OPEN", "Open"],
        ]}
      />
      <FilterSelect
        label="Paid via"
        value={method}
        onChange={(v) => setMethod(v as MethodFilter)}
        options={[
          ["all", "All"],
          ["BANK", "Bank transfer"],
          ["CASH", "Cash drawer"],
        ]}
      />
      <FilterSelect
        label="Sort"
        value={sort}
        onChange={(v) => setSort(v as SortKey)}
        options={[
          ["newest", "Newest first"],
          ["oldest", "Oldest first"],
          ["net-desc", "Net pay, high to low"],
          ["net-asc", "Net pay, low to high"],
        ]}
      />
      {hasActiveFilters && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-9 text-xs"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </Button>
      )}
      <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-text-subtle">
        {periodCount} {periodCount === 1 ? "period" : "periods"}
      </span>
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  // Self-labeling options ("Status: Completed") — an outside label pushed
  // the bar onto two lines at the 1440px content cap, and a bare "All"
  // select says nothing.
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {label}: {l}
        </option>
      ))}
    </select>
  );
}

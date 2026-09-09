"use client";

// Tab strip above the ledger. Panels are server-rendered and passed in;
// the active tab lives in the URL (?tab=) so it survives reloads.

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

import { REPORTS_TABS, type ReportsTabKey } from "./reports-tab-key";

const TABS = REPORTS_TABS;

export function ReportsTabs({ active, panels }: { active: ReportsTabKey; panels: Record<ReportsTabKey, React.ReactNode> }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <div className="space-y-3">
      <div role="tablist" className="flex gap-6 border-b border-border/70">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={active === key}
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              if (key === "runs") next.delete("tab");
              else next.set("tab", key);
              const qs = next.toString();
              router.push(qs ? `/reports?${qs}` : "/reports");
            }}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2.5 pt-1 text-sm font-medium transition-colors",
              active === key ? "border-brand-700 text-brand-700" : "border-transparent text-text-muted hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{panels[active]}</div>
    </div>
  );
}

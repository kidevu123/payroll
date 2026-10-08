// A small on/off chip for picking one mode out of a few (cron picker,
// announcement audience).
export function ModeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-3 rounded-chip border text-xs font-medium transition-colors ${
        active
          ? "border-brand-700 bg-brand-700 text-brand-fg"
          : "border-border bg-surface text-text-muted hover:bg-surface-2/40"
      }`}
    >
      {label}
    </button>
  );
}

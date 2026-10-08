// One dot + label of the desktop grid's colour legend.
import { legendDotClass, type CellState } from "@/lib/time-grid/cell-state";

export function Legend({ label, state }: { label: string; state: CellState }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full shrink-0 ${legendDotClass(state)}`} />
      {label}
    </span>
  );
}

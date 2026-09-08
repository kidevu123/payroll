"use client";

// The kiosk's on-screen numeric keypad: 1-9, Clear, 0, Delete. Thumb-sized
// keys for the outdoor tablet. Shared by the PIN sign-in and the payday
// code entry.

import { Delete } from "lucide-react";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export function Keypad({
  onPress,
  onClear,
  onDelete,
  clearLabel = "Clear",
}: {
  onPress: (digit: string) => void;
  onClear: () => void;
  onDelete: () => void;
  clearLabel?: string;
}) {
  const key =
    "h-20 rounded-xl border-2 border-border bg-surface text-3xl font-bold active:bg-surface-2";
  return (
    <div className="mx-auto grid w-full max-w-sm grid-cols-3 gap-3">
      {DIGITS.map((d) => (
        <button key={d} type="button" onClick={() => onPress(d)} className={key}>
          {d}
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="h-20 rounded-xl border-2 border-border bg-surface text-lg font-semibold text-text-muted active:bg-surface-2"
      >
        {clearLabel}
      </button>
      <button type="button" onClick={() => onPress("0")} className={key}>
        0
      </button>
      <button
        type="button"
        aria-label="Delete"
        onClick={onDelete}
        className="flex h-20 items-center justify-center rounded-xl border-2 border-border bg-surface active:bg-surface-2"
      >
        <Delete className="h-8 w-8" />
      </button>
    </div>
  );
}

"use client";

// The small status line under the net field while a PDF is being read.
import { Loader2, Sparkles } from "lucide-react";
import { type ReadState } from "@/lib/salaried/upload-format";

export function ReadStatus({ state }: { state: ReadState }) {
  if (state.kind === "IDLE") return null;
  if (state.kind === "READING") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <Loader2 className="h-3 w-3 animate-spin" /> Reading net from PDF…
      </p>
    );
  }
  if (state.kind === "FILLED") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-success-700">
        <Sparkles className="h-3 w-3" /> Net read from PDF — confirm before
        upload.
      </p>
    );
  }
  return (
    <p className="text-[11px] text-text-subtle">{state.reason}</p>
  );
}

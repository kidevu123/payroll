"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PayRulesSettings } from "@/lib/settings/schemas";
import { savePayRules } from "./actions";

const RULES = [
  { value: "NONE", label: "None — pay exact computed amount" },
  { value: "NEAREST_DOLLAR", label: "Nearest dollar (half-up)" },
  { value: "NEAREST_QUARTER", label: "Nearest $0.25" },
  { value: "NEAREST_FIFTEEN_MIN_HOURS", label: "Nearest 0.25h hours per day" },
];

export function PayRulesForm({ settings }: { settings: PayRulesSettings }) {
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [otEnabled, setOtEnabled] = React.useState(settings.overtime.enabled);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Pay rules</h2>
      <form
          action={async (form) => {
            setPending(true);
            setError(null);
            setSaved(false);
            const result = await savePayRules(form);
            setPending(false);
            if (result?.error) setError(result.error);
            else setSaved(true);
          }}
          className="space-y-5"
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Rounding rule</legend>
            <div className="space-y-1.5">
              {RULES.map((r) => (
                <label key={r.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="rounding"
                    value={r.value}
                    defaultChecked={settings.rounding === r.value}
                    required
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1 max-w-xs">
            <Label htmlFor="hoursDecimalPlaces">Hours decimal places</Label>
            <Input
              id="hoursDecimalPlaces"
              name="hoursDecimalPlaces"
              type="number"
              min={0}
              max={6}
              defaultValue={settings.hoursDecimalPlaces}
              required
            />
          </div>

          <fieldset className="space-y-2 rounded-card border border-border bg-surface-2/50 p-4">
            <legend className="text-sm font-medium px-1">Overtime</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="overtimeEnabled"
                checked={otEnabled}
                onChange={(e) => setOtEnabled(e.target.checked)}
              />
              Pay overtime above the threshold
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="overtimeThresholdHours">Threshold (hours/period)</Label>
                <Input
                  id="overtimeThresholdHours"
                  name="overtimeThresholdHours"
                  type="number"
                  min={0}
                  step={0.25}
                  defaultValue={settings.overtime.thresholdHours}
                  disabled={!otEnabled}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="overtimeMultiplier">Multiplier</Label>
                <Input
                  id="overtimeMultiplier"
                  name="overtimeMultiplier"
                  type="number"
                  min={1}
                  step={0.05}
                  defaultValue={settings.overtime.multiplier}
                  disabled={!otEnabled}
                  required
                />
              </div>
            </div>
          </fieldset>

          {error && <p className="text-sm text-red-700">{error}</p>}
          {saved && <p className="text-sm text-emerald-700">Saved.</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
    </div>
  );
}

import { PhaseStub } from "../_phase-stub";
export default function Page() {
  return (
    <PhaseStub
      title="Pay rules"
      description="Rounding, decimal places, optional overtime. Defaults: round to nearest dollar, 2 decimals, OT off."
      phase={1}
    />
  );
}

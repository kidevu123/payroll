import { PhaseStub } from "../settings/_phase-stub";

export default function NgtecoPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">NGTeco</h1>
      <PhaseStub
        title="Run history"
        description="Recent imports, durations, exceptions, screenshots."
        phase={2}
      />
    </div>
  );
}

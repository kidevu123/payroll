import { PhaseStub } from "../settings/_phase-stub";

export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <PhaseStub
        title="YTD totals, trends, exports"
        description="Charts via recharts, CSV export."
        phase={6}
      />
    </div>
  );
}

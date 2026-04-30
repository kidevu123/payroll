import { PhaseStub } from "../settings/_phase-stub";

export default function RequestsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Requests</h1>
      <PhaseStub
        title="Missed punches & time off"
        description="Approve or reject employee-submitted requests."
        phase={5}
        detail="The request data model exists. Inline approve/reject and the bell-badge notifications land in Phase 5."
      />
    </div>
  );
}

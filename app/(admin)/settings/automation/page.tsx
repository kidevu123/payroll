import { PhaseStub } from "../_phase-stub";
export default function Page() {
  return (
    <PhaseStub
      title="Automation"
      description="Cron schedule, employee fix window, suspicious-duration thresholds."
      phase={3}
      detail="Default cron is Sunday 7pm ET. Employee fix window is 24 hours. Editing UI ships with the run state machine."
    />
  );
}

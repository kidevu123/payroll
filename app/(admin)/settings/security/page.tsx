import { PhaseStub } from "../_phase-stub";
export default function Page() {
  return (
    <PhaseStub
      title="Security"
      description="Admin 2FA, session timeout, login rate limit. Defaults: 2FA off, 30-day rolling sessions, 5 attempts / 15 min."
      phase={1}
    />
  );
}

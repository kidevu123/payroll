import { PhaseStub } from "../_phase-stub";
export default function Page() {
  return (
    <PhaseStub
      title="NGTeco"
      description="Portal URL, encrypted credentials, headless toggle, test connection, manual run."
      phase={2}
      detail="Connection details are stored encrypted with AES-GCM. UI ships with the Playwright import pipeline."
    />
  );
}

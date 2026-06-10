import { requireAdmin } from "@/lib/auth-guards";
import { assistantConfigured } from "@/lib/assistant/chat";
import { AssistantChat } from "@/components/admin/assistant-chat";

export default async function AssistantPage() {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text">
          Assistant
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Payroll copilot for owners and admins. Not visible to employees.
        </p>
      </div>
      <AssistantChat configured={assistantConfigured()} />
    </div>
  );
}

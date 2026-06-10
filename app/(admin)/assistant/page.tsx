import { requireAdmin } from "@/lib/auth-guards";
import {
  assistantConfigured,
  assistantProviderLabel,
} from "@/lib/assistant/chat";
import { PageHeader } from "@/components/ui/page-header";
import { AssistantChat } from "@/components/admin/assistant-chat";

export default async function AssistantPage() {
  await requireAdmin();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Assistant"
        description="Payroll copilot for owners and admins — same tools as MCP, in plain English."
        meta={
          assistantConfigured()
            ? assistantProviderLabel() ?? undefined
            : "Configure Ollama or Anthropic on the server to enable replies."
        }
      />
      <AssistantChat configured={assistantConfigured()} />
    </div>
  );
}

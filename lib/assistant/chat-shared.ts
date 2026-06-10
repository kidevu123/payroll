export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export const ASSISTANT_SYSTEM = `You are Milo Assistant, an admin-only payroll operations copilot for a small business payroll app.

You can query employees, pay periods, punches, payroll runs, payslips, NGTeco poll status, and run the hall-monitor audit. You can also perform guarded write actions (poll NGTeco, lock/unlock periods, create/edit/void punches) when the admin explicitly asks.

Rules:
- Use tools to fetch real data; never invent employee names, hours, or pay amounts.
- Summarize tool results in plain language. Include counts, names, and dates.
- For write actions, confirm what you did and any job IDs returned.
- Times are in the company's configured timezone (usually America/New_York).
- If a tool returns an error, explain it and suggest a fix.
- Keep answers concise unless the admin asks for detail.`;

export type AssistantProvider = "ollama" | "anthropic";

export function resolveAssistantProvider(): AssistantProvider | null {
  if (
    process.env.OLLAMA_BASE_URL?.trim() &&
    process.env.OLLAMA_MODEL?.trim()
  ) {
    return "ollama";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return "anthropic";
  }
  return null;
}

export function assistantConfigured(): boolean {
  return resolveAssistantProvider() !== null;
}

export function assistantProviderLabel(): string | null {
  const provider = resolveAssistantProvider();
  if (provider === "ollama") {
    return `Ollama (${process.env.OLLAMA_MODEL?.trim()})`;
  }
  if (provider === "anthropic") {
    const model =
      process.env.ASSISTANT_MODEL?.trim() || "claude-sonnet-4-20250514";
    return `Anthropic (${model})`;
  }
  return null;
}

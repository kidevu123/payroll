import type { Actor } from "@/lib/db/queries/employees";
import {
  executePayrollTool,
  PAYROLL_ASSISTANT_TOOLS,
} from "./payroll-tools";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

const SYSTEM = `You are Milo Assistant, an admin-only payroll operations copilot for a small business payroll app.

You can query employees, pay periods, punches, payroll runs, payslips, NGTeco poll status, and run the hall-monitor audit. You can also perform guarded write actions (poll NGTeco, lock/unlock periods, create/edit/void punches) when the admin explicitly asks.

Rules:
- Use tools to fetch real data; never invent employee names, hours, or pay amounts.
- Summarize tool results in plain language. Include counts, names, and dates.
- For write actions, confirm what you did and any job IDs returned.
- Times are in the company's configured timezone (usually America/New_York).
- If a tool returns an error, explain it and suggest a fix.
- Keep answers concise unless the admin asks for detail.`;

const MAX_TOOL_ROUNDS = 8;

export function assistantConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function runPayrollAssistantChat(
  history: ChatMessage[],
  actor: Actor,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to the server environment to enable the assistant.",
    );
  }

  const model =
    process.env.ASSISTANT_MODEL?.trim() || "claude-sonnet-4-20250514";

  const messages: AnthropicMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: SYSTEM,
        tools: PAYROLL_ASSISTANT_TOOLS,
        messages,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Assistant API error (${res.status}): ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      content: AnthropicContentBlock[];
      stop_reason: string;
    };

    const textParts = data.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text);
    const toolUses = data.content.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      return textParts.join("\n").trim() || "Done.";
    }

    messages.push({ role: "assistant", content: data.content });

    const toolResults: AnthropicContentBlock[] = [];
    for (const tool of toolUses) {
      const result = await executePayrollTool(tool.name, tool.input, actor);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: result,
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (data.stop_reason === "end_turn" && textParts.length > 0) {
      return textParts.join("\n").trim();
    }
  }

  return "I hit the tool-call limit for this question. Try a narrower follow-up.";
}

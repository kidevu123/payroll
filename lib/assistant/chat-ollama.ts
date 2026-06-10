import type { Actor } from "@/lib/db/queries/employees";
import { executePayrollTool } from "./payroll-tools";
import { ASSISTANT_SYSTEM, type ChatMessage } from "./chat-shared";
import { toOllamaTools } from "./to-ollama-tools";

type OllamaToolCall = {
  function: {
    name: string;
    arguments?: Record<string, unknown> | string;
  };
};

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
};

const MAX_TOOL_ROUNDS = 8;

function parseToolArguments(
  raw: Record<string, unknown> | string | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw;
}

export async function runOllamaAssistantChat(
  history: ChatMessage[],
  actor: Actor,
): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim().replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL?.trim();
  if (!baseUrl || !model) {
    throw new Error(
      "OLLAMA_BASE_URL and OLLAMA_MODEL must be set to use the local assistant.",
    );
  }

  const messages: OllamaMessage[] = [
    { role: "system", content: ASSISTANT_SYSTEM },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const tools = toOllamaTools();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        tools,
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama error (${res.status}): ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      message?: OllamaMessage;
      error?: string;
    };

    if (data.error) {
      throw new Error(data.error);
    }

    const message = data.message;
    if (!message) {
      throw new Error("Ollama returned an empty response.");
    }

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return message.content?.trim() || "Done.";
    }

    messages.push(message);

    for (const call of toolCalls) {
      const name = call.function.name;
      const args = parseToolArguments(call.function.arguments);
      const result = await executePayrollTool(name, args, actor);
      messages.push({ role: "tool", tool_name: name, content: result });
    }
  }

  return "I hit the tool-call limit for this question. Try a narrower follow-up.";
}

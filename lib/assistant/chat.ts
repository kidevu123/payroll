import type { Actor } from "@/lib/db/queries/employees";
import { runAnthropicAssistantChat } from "./chat-anthropic";
import { runOllamaAssistantChat } from "./chat-ollama";
import {
  assistantConfigured,
  assistantProviderLabel,
  resolveAssistantProvider,
  type ChatMessage,
} from "./chat-shared";

export type { ChatMessage } from "./chat-shared";
export {
  assistantConfigured,
  assistantProviderLabel,
  resolveAssistantProvider,
};

export async function runPayrollAssistantChat(
  history: ChatMessage[],
  actor: Actor,
): Promise<string> {
  const provider = resolveAssistantProvider();
  if (provider === "ollama") {
    return runOllamaAssistantChat(history, actor);
  }
  if (provider === "anthropic") {
    return runAnthropicAssistantChat(history, actor);
  }
  throw new Error(
    "Assistant is not configured. Set OLLAMA_BASE_URL + OLLAMA_MODEL, or ANTHROPIC_API_KEY.",
  );
}

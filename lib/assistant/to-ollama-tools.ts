import { PAYROLL_ASSISTANT_TOOLS } from "./payroll-tools";

/** OpenAI/Ollama function schema for /api/chat tools. */
export function toOllamaTools() {
  return PAYROLL_ASSISTANT_TOOLS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

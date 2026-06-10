import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  assistantConfigured,
  runPayrollAssistantChat,
  type ChatMessage,
} from "@/lib/assistant/chat";

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(16_000),
      }),
    )
    .min(1)
    .max(40),
});

const ADMIN_ROLES = new Set(["OWNER", "ADMIN", "PAYROLL_STAFF"]);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ADMIN_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!assistantConfigured()) {
    return NextResponse.json(
      {
        error:
          "Assistant is not configured. Set ANTHROPIC_API_KEY on the server.",
      },
      { status: 503 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const actor = { id: session.user.id, role: session.user.role };

  try {
    const reply = await runPayrollAssistantChat(
      body.messages as ChatMessage[],
      actor,
    );
    return NextResponse.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Assistant failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

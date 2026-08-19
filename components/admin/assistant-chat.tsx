"use client";

import { useRef, useState } from "react";
import { Bot, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PAYROLL_ASSISTANT_CAPABILITIES } from "@/lib/assistant/capabilities";
import { cn } from "@/lib/utils";

type Message = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "Run hall monitor and summarize issues",
  "What's the NGTeco poll status?",
  "List open pay periods",
  "Who has open punches from prior days?",
];

export function AssistantChat({ configured }: { configured: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    const next: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Request failed.");
        setMessages(messages);
        return;
      }
      setMessages([...next, { role: "assistant", content: data.reply ?? "" }]);
      requestAnimationFrame(() =>
        bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
      );
    } catch {
      setError("Network error. Try again.");
      setMessages(messages);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="flex min-h-[32rem] flex-col">
        <CardHeader className="border-b border-border/60 py-3">
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-brand-700" aria-hidden />
            Chat
          </CardTitle>
          {!configured && (
            <p className="rounded-input border border-warning-200 bg-warning-50 px-3 py-2 text-body text-warning-900">
              Set <code className="text-caption">OLLAMA_BASE_URL</code> +{" "}
              <code className="text-caption">OLLAMA_MODEL</code>, or{" "}
              <code className="text-caption">ANTHROPIC_API_KEY</code>, on the
              server to enable replies.
            </p>
          )}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-text-muted">
                  Try one of these:
                </p>
                <div className="flex flex-wrap gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!configured || loading}
                      onClick={() => void send(s)}
                      className="rounded-lg border border-border/70 bg-surface-2/60 px-3 py-1.5 text-left text-[13px] text-text hover:bg-surface-2/40 disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[90%] rounded-xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
                  m.role === "user"
                    ? "ml-auto bg-brand-700 text-white"
                    : "bg-surface-2 text-text",
                )}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-[13px] text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Working…
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          {error && (
            <p className="text-[13px] text-danger-700" role="alert">
              {error}
            </p>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                configured
                  ? "Ask about payroll, punches, polls…"
                  : "Assistant unavailable until API key is set"
              }
              disabled={!configured || loading}
              rows={2}
              className="min-h-[2.75rem] flex-1 resize-none rounded-input border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/50 disabled:opacity-50"
            />
            <Button
              type="submit"
              disabled={!configured || loading || !input.trim()}
              className="self-end"
            >
              <Send className="h-4 w-4" aria-hidden />
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </CardContent>
      </Card>

      <aside className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>
              MCP capabilities
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[28rem] space-y-4 overflow-y-auto p-4 pt-0 text-[12px]">
            {PAYROLL_ASSISTANT_CAPABILITIES.map((group) => (
              <div key={group.title}>
                <h3 className="mb-1.5 font-medium text-text">{group.title}</h3>
                <ul className="space-y-1.5 text-text-muted">
                  {group.items.map((item) => (
                    <li key={item.name}>
                      <span
                        className={cn(
                          item.mutates && "text-warning-800",
                        )}
                      >
                        {item.description}
                      </span>
                      {item.mutates && (
                        <span className="ml-1 text-micro uppercase text-warning-700">
                          writes
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
        <p className="text-[11px] text-text-muted leading-relaxed px-1">
          Cursor and other MCP clients use the same tools over HTTP at port
          3100. This chat runs them in-process with your logged-in admin
          session.
        </p>
      </aside>
    </div>
  );
}

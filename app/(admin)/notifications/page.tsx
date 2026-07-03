import Link from "next/link";
import { Plus, Megaphone, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listAnnouncements } from "@/lib/db/queries/announcements";
import { listEmployees } from "@/lib/db/queries/employees";
import { deleteAnnouncementAction } from "./actions";

export const dynamic = "force-dynamic";

const AUDIENCE_LABEL: Record<string, string> = {
  ALL: "All employees",
  BY_ROLE: "By role",
  BY_SCHEDULE: "By schedule",
  SPECIFIC: "Specific",
};

function shortDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export default async function NotificationsPage() {
  const [announcements, employees] = await Promise.all([
    listAnnouncements(100),
    listEmployees(),
  ]);
  const empById = new Map(employees.map((e) => [e.id, e.displayName]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Notifications
          </h1>
          <p className="text-sm text-text-muted">
            Send a custom message to employees, and review what&apos;s been
            sent. Recipients see it in their in-app inbox + as a push
            notification on devices that opted in.
          </p>
        </div>
        <Button asChild>
          <Link href="/notifications/new">
            <Plus className="h-4 w-4" /> Send announcement
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">History</CardTitle>
          <CardDescription className="text-xs">
            Newest first. Recipient counts reflect the audience at send
            time, not at view time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {announcements.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="No announcements yet"
              description="Click 'Send announcement' to broadcast a message."
            />
          ) : (
            announcements.map((a) => {
              const labels = Array.isArray(a.audienceLabels)
                ? (a.audienceLabels as string[])
                : [];
              const ids = Array.isArray(a.audienceIds)
                ? (a.audienceIds as string[])
                : [];
              const audienceText =
                a.audienceKind === "SPECIFIC" && ids.length > 0
                  ? ids
                      .map((id) => empById.get(id) ?? "Unknown")
                      .slice(0, 3)
                      .join(", ") +
                    (ids.length > 3 ? ` +${ids.length - 3} more` : "")
                  : a.audienceKind === "ALL"
                    ? "All employees"
                    : labels.join(" · ") || AUDIENCE_LABEL[a.audienceKind];
              return (
                <div
                  key={a.id}
                  className="rounded-card border border-border bg-surface p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {a.title}
                    </h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-text-muted tabular-nums">
                        {shortDateTime(a.sentAt)}
                      </span>
                      <form action={deleteAnnouncementAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 md:h-7 md:w-7 text-text-muted hover:text-danger-700"
                          title="Delete announcement from history"
                          aria-label={`Delete announcement ${a.title}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </form>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-text-muted">
                    {a.body}
                  </p>
                  {a.link && (
                    <p className="text-xs">
                      <span className="text-text-subtle">Link: </span>
                      <a
                        href={a.link}
                        className="text-brand-700 hover:underline break-all"
                        target={
                          a.link.startsWith("http") ? "_blank" : undefined
                        }
                        rel={
                          a.link.startsWith("http")
                            ? "noopener noreferrer"
                            : undefined
                        }
                      >
                        {a.link}
                      </a>
                    </p>
                  )}
                  <div className="flex items-center gap-3 flex-wrap text-[11px] text-text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {audienceText}
                    </span>
                    <span className="font-medium">
                      <span aria-hidden="true" className="mr-1 text-text-subtle">
                        ·
                      </span>
                      {a.recipientCount}{" "}
                      {a.recipientCount === 1 ? "recipient" : "recipients"}
                    </span>
                    {a.sentByEmail && (
                      <span>
                        <span aria-hidden="true" className="mr-1 text-text-subtle">
                          ·
                        </span>
                        by {a.sentByEmail}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

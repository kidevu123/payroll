// /notifications — announcement composer entry + sent history.
//
// Jul 2026 detail pass (owner direction): the page reads as a proper
// operations surface, not a bare list. Overview tiles up top (sent this
// month, people reached, last sent), then the history as scannable rows —
// audience-typed icon tile, title + relative time, body, and a meta row
// of chips. Squared corners + visible borders per the global token shift.

import Link from "next/link";
import {
  Plus,
  Megaphone,
  Trash2,
  Users,
  Briefcase,
  CalendarRange,
  UserRound,
  Send,
  Clock3,
  ExternalLink,
  LayoutTemplate,
  PenLine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { listAnnouncements } from "@/lib/db/queries/announcements";
import { listAnnouncementTemplates } from "@/lib/db/queries/announcement-templates";
import { listEmployees } from "@/lib/db/queries/employees";
import { getSetting } from "@/lib/settings/runtime";
import { deleteAnnouncementAction, deleteTemplateAction } from "./actions";

export const dynamic = "force-dynamic";

const AUDIENCE_LABEL: Record<string, string> = {
  ALL: "All employees",
  BY_ROLE: "By role",
  BY_SCHEDULE: "By schedule",
  SPECIFIC: "Specific people",
};

const AUDIENCE_ICON: Record<string, LucideIcon> = {
  ALL: Users,
  BY_ROLE: Briefcase,
  BY_SCHEDULE: CalendarRange,
  SPECIFIC: UserRound,
};

function relativeTime(from: Date, now: Date): string {
  const mins = Math.round((now.getTime() - from.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export default async function NotificationsPage() {
  const [announcements, employees, company, templates] = await Promise.all([
    listAnnouncements(100),
    listEmployees(),
    getSetting("company").catch(() => null),
    listAnnouncementTemplates().catch(() => []),
  ]);
  const empById = new Map(employees.map((e) => [e.id, e.displayName]));
  const tz = company?.timezone ?? "America/New_York";
  const now = new Date();

  const fmtDateTime = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // Overview numbers — month-to-date in the company timezone.
  const monthKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).format(now);
  const inMonth = announcements.filter(
    (a) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
      }).format(new Date(a.sentAt)) === monthKey,
  );
  const reachedThisMonth = inMonth.reduce(
    (sum, a) => sum + (a.recipientCount ?? 0),
    0,
  );
  const lastSent = announcements[0]?.sentAt
    ? relativeTime(new Date(announcements[0].sentAt), now)
    : "—";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Send a custom message to employees, and review what's been sent. Recipients see it in their in-app inbox plus a push notification on devices that opted in."
        actions={
          <Button asChild>
            <Link href="/notifications/new">
              <Plus className="h-4 w-4" /> Send announcement
            </Link>
          </Button>
        }
      />

      {/* Overview tiles — squared icon plates, one accent each. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <OverviewTile
          Icon={Send}
          tone="bg-info-50 text-info-700"
          value={String(inMonth.length)}
          label="Sent this month"
        />
        <OverviewTile
          Icon={Users}
          tone="bg-success-50 text-success-700"
          value={String(reachedThisMonth)}
          label="People reached this month"
        />
        <OverviewTile
          Icon={Clock3}
          tone="bg-warning-50 text-warning-700"
          value={lastSent}
          label="Last announcement"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {announcements.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Megaphone}
                title="No announcements yet"
                description="Click 'Send announcement' to broadcast a message."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {announcements.map((a) => {
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
                      : labels.join(" · ") ||
                        AUDIENCE_LABEL[a.audienceKind] ||
                        a.audienceKind;
                const AudienceIcon = AUDIENCE_ICON[a.audienceKind] ?? Users;
                const sentAt = new Date(a.sentAt);
                return (
                  <li key={a.id} className="flex gap-3 px-4 py-3.5 sm:px-5">
                    {/* Audience-typed icon plate. */}
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-input bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100"
                    >
                      <AudienceIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold text-text">
                            {a.title}
                          </h3>
                          <p
                            className="text-[11px] text-text-muted tabular-nums"
                            title={sentAt.toISOString()}
                          >
                            {relativeTime(sentAt, now)} ·{" "}
                            {fmtDateTime.format(sentAt)}
                            {a.sentByEmail ? ` · by ${a.sentByEmail}` : ""}
                          </p>
                        </div>
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
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
                        {a.body}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <MetaChip>
                          <Users className="h-3 w-3" aria-hidden />
                          {audienceText}
                        </MetaChip>
                        <MetaChip>
                          {a.recipientCount}{" "}
                          {a.recipientCount === 1 ? "recipient" : "recipients"}
                        </MetaChip>
                        {a.link ? (
                          <a
                            href={a.link}
                            className="inline-flex items-center gap-1 rounded-chip border border-info-200/80 bg-info-50 px-2 py-0.5 text-[11px] font-medium text-info-700 hover:underline"
                            target={a.link.startsWith("http") ? "_blank" : undefined}
                            rel={
                              a.link.startsWith("http")
                                ? "noopener noreferrer"
                                : undefined
                            }
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            <span className="max-w-[16rem] truncate">{a.link}</span>
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Saved templates — reusable starting points. "Use" opens the
          compose form pre-filled; audience is always chosen per send. */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4 text-brand-700" aria-hidden />
              <h2 className="text-sm font-semibold text-text">Saved templates</h2>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/notifications/templates/new">
                <Plus className="h-3.5 w-3.5" /> New template
              </Link>
            </Button>
          </div>
          {templates.length === 0 ? (
            <p className="px-4 py-5 text-sm text-text-muted sm:px-5">
              No templates yet. Save one and it becomes a one-tap starting
              point for future announcements.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {templates.map((tpl) => (
                <li
                  key={tpl.id}
                  className="flex items-center gap-3 px-4 py-3 sm:px-5"
                >
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-input bg-success-50 text-success-700 ring-1 ring-inset ring-success-200/60"
                  >
                    <PenLine className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">
                      {tpl.name}
                    </p>
                    <p className="truncate text-xs text-text-muted">
                      {tpl.title}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/notifications/new?template=${tpl.id}`}>
                        Use
                      </Link>
                    </Button>
                    <form action={deleteTemplateAction}>
                      <input type="hidden" name="id" value={tpl.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 text-text-muted hover:text-danger-700"
                        title="Delete template"
                        aria-label={`Delete template ${tpl.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OverviewTile({
  Icon,
  tone,
  value,
  label,
}: {
  Icon: LucideIcon;
  tone: string;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-border/70 bg-surface p-4 shadow-card">
      <span
        aria-hidden
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-input ${tone}`}
      >
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xl font-semibold tracking-tight tabular-nums text-text">
          {value}
        </p>
        <p className="truncate text-xs text-text-muted">{label}</p>
      </div>
    </div>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-chip border border-border/70 bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">
      {children}
    </span>
  );
}

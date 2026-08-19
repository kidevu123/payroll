// /notifications — announcement center, composed to the owner's reference
// mock: four overview tiles (all real metrics — no open-rate, we don't
// track reads), the History card with a centered first-run empty state,
// then a three-card row of Saved templates / Recent recipients / Best
// practice. The header CTA uses the dark shell's brand accent.

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
  BellRing,
  Lightbulb,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  listAnnouncements,
  getAnnouncementTotals,
} from "@/lib/db/queries/announcements";
import { countPushDevices } from "@/lib/db/queries/push-subscriptions";
import { listAnnouncementTemplates } from "@/lib/db/queries/announcement-templates";
import { listEmployees } from "@/lib/db/queries/employees";
import { getSetting } from "@/lib/settings/runtime";
import { deleteAnnouncementAction, deleteTemplateAction } from "./actions";
import { DASH } from "@/components/dashboard/theme";

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
  const [announcements, employees, company, templates, totals, pushDevices] =
    await Promise.all([
      listAnnouncements(100),
      listEmployees(),
      getSetting("company").catch(() => null),
      listAnnouncementTemplates().catch(() => []),
      getAnnouncementTotals().catch(() => ({
        sentCount: 0,
        recipientsReached: 0,
      })),
      countPushDevices().catch(() => 0),
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
  const audienceTextOf = (a: (typeof announcements)[number]): string => {
    const labels = Array.isArray(a.audienceLabels)
      ? (a.audienceLabels as string[])
      : [];
    const ids = Array.isArray(a.audienceIds) ? (a.audienceIds as string[]) : [];
    if (a.audienceKind === "SPECIFIC" && ids.length > 0) {
      return (
        ids
          .map((id) => empById.get(id) ?? "Unknown")
          .slice(0, 3)
          .join(", ") + (ids.length > 3 ? ` +${ids.length - 3} more` : "")
      );
    }
    if (a.audienceKind === "ALL") return "All employees";
    return labels.join(" · ") || AUDIENCE_LABEL[a.audienceKind] || a.audienceKind;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Send announcements and updates to your team via in-app inbox or push notification."
        actions={
          <Link
            href="/notifications/new"
            className="inline-flex h-10 items-center gap-2 rounded-input px-4 text-sm font-medium"
            style={{
              color: DASH.onAccent,
              background: DASH.accentGradient,
              boxShadow: "0 10px 24px -12px rgba(5,150,105,0.7)",
            }}
          >
            <Plus className="h-4 w-4" /> Send announcement
          </Link>
        }
      />

      {/* Overview tiles — tinted icon circle left, headline figure on top,
          matching the reference mock. Real metrics only. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewTile
          Icon={Send}
          tone="bg-info-50 text-info-700"
          value={String(totals.sentCount)}
          label="Announcements sent"
          sub="All time"
        />
        <OverviewTile
          Icon={Users}
          tone="bg-success-50 text-success-700"
          value={String(totals.recipientsReached)}
          label="Recipients reached"
          sub="All time"
        />
        <OverviewTile
          Icon={Clock3}
          tone="bg-warning-50 text-warning-700"
          value={String(inMonth.length)}
          label="Sent this month"
          sub={`${reachedThisMonth} people reached`}
        />
        <OverviewTile
          Icon={BellRing}
          tone="bg-brand-50 text-brand-700"
          value={String(pushDevices)}
          label="Push devices enrolled"
          sub="Get instant alerts"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border/60 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-text">History</h2>
            <p className="text-xs text-text-muted">
              Your sent announcements appear here with audience and reach.
            </p>
          </div>
          {announcements.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span
                aria-hidden
                className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 ring-8 ring-brand-50/40"
              >
                <Megaphone className="h-7 w-7 text-brand-700" />
              </span>
              <div className="space-y-1">
                <p className="text-base font-semibold text-text">
                  No announcements yet
                </p>
                <p className="text-sm text-text-muted">
                  Share important updates, reminders, and news with your team.
                </p>
              </div>
              <Link
                href="/notifications/new"
                className="mt-1 inline-flex h-10 items-center gap-2 rounded-input px-4 text-sm font-medium"
                style={{
                  color: DASH.onAccent,
                  background: DASH.accentGradient,
                }}
              >
                <Plus className="h-4 w-4" /> Send your first announcement
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {announcements.map((a) => {
                const audienceText = audienceTextOf(a);
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

      {/* Bottom row — Saved templates / Recent recipients / Best practice,
          mirroring the reference mock's three-card composition. */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* Saved templates — reusable starting points. "Use" opens the
            compose form pre-filled; audience is always chosen per send. */}
        <Card>
          <CardContent className="flex h-full flex-col p-0">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
              <LayoutTemplate className="h-4 w-4 text-brand-700" aria-hidden />
              <h2 className="text-sm font-semibold text-text">Saved templates</h2>
            </div>
            {templates.length === 0 ? (
              <p className="flex-1 px-4 py-5 text-sm text-text-muted">
                No templates yet. Save one and it becomes a one-tap starting
                point for future announcements.
              </p>
            ) : (
              <ul className="flex-1 divide-y divide-border/60">
                {templates.slice(0, 5).map((tpl) => (
                  <li key={tpl.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      aria-hidden
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-input bg-success-50 text-success-700 ring-1 ring-inset ring-success-200/60"
                    >
                      <PenLine className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">
                        {tpl.name}
                      </p>
                      <p className="truncate text-xs text-text-muted">
                        {tpl.title}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button asChild size="sm" variant="secondary" className="h-8 text-xs">
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
                          className="h-8 w-8 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 text-text-muted hover:text-danger-700"
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
            <div className="border-t border-border/60 px-4 py-2.5">
              <Link
                href="/notifications/templates/new"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium hover:underline"
                style={{ color: DASH.emerald }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Create new template
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Recent recipients — audiences from the latest sends. */}
        <Card>
          <CardContent className="flex h-full flex-col p-0">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
              <Users className="h-4 w-4 text-brand-700" aria-hidden />
              <h2 className="text-sm font-semibold text-text">Recent recipients</h2>
            </div>
            {announcements.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                <span
                  aria-hidden
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2"
                >
                  <Users className="h-5 w-5 text-text-subtle" />
                </span>
                <p className="text-sm font-medium text-text">No recent recipients</p>
                <p className="text-xs text-text-muted">
                  Recipients from your announcements will appear here.
                </p>
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-border/60">
                {announcements.slice(0, 5).map((a) => {
                  const AudienceIcon = AUDIENCE_ICON[a.audienceKind] ?? Users;
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span
                        aria-hidden
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-input bg-info-50 text-info-700 ring-1 ring-inset ring-info-200/60"
                      >
                        <AudienceIcon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text">
                          {audienceTextOf(a)}
                        </p>
                        <p className="truncate text-xs text-text-muted">
                          {a.recipientCount}{" "}
                          {a.recipientCount === 1 ? "recipient" : "recipients"} ·{" "}
                          {relativeTime(new Date(a.sentAt), now)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Best practice — static guidance, mirrors the mock's footer strip. */}
        <Card>
          <CardContent className="flex h-full flex-col p-0">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
              <Lightbulb className="h-4 w-4 text-brand-700" aria-hidden />
              <h2 className="text-sm font-semibold text-text">Best practice</h2>
            </div>
            <ul className="flex-1 space-y-3 px-4 py-4 text-sm leading-relaxed text-text-muted">
              <li>
                Short, clear messages get the highest engagement — say the one
                thing people need to know first.
              </li>
              <li>
                Add a link so a tap lands people exactly where the action is
                (their Time tab, the Calendar, a policy page).
              </li>
              <li>
                Push notifications reach only enrolled devices — nudge the
                team to enable them from Profile.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function OverviewTile({
  Icon,
  tone,
  value,
  label,
  sub,
}: {
  Icon: LucideIcon;
  tone: string;
  value: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-start gap-3.5 rounded-card border border-border/70 bg-surface p-4 shadow-card">
      <span
        aria-hidden
        className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-2xl font-semibold leading-tight tracking-tight tabular-nums text-text">
          {value}
        </p>
        <p className="truncate text-[13px] text-text-muted">{label}</p>
        <p className="truncate text-[11px] text-text-subtle">{sub}</p>
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

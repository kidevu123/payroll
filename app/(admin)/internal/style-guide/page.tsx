// Internal style guide. Owner-only. Renders every reusable design primitive
// in one place so a future reviewer (or a future Claude) can audit drift.
//
// Not linked from the sidebar — reach it at /internal/style-guide. Gated to
// OWNER role on top of the admin layout's ADMIN guard, since this is a
// dev-only surface that exposes design tokens.

import * as React from "react";
import { requireOwner } from "@/lib/auth-guards";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/domain/status-pill";
import { Avatar } from "@/components/domain/avatar";
import { Wordmark } from "@/components/brand/wordmark";
import { PayrollRunCard } from "@/components/domain/payroll-run-card";
import { Inbox, Calendar, Users, ShieldCheck } from "lucide-react";

export default async function StyleGuidePage() {
  await requireOwner();
  return (
    <div className="space-y-12 max-w-5xl">
      <header>
        <p className="text-[10px] uppercase tracking-wider text-text-subtle">
          Internal · Owner only
        </p>
        <h1 className="text-display font-semibold tracking-tight">Style guide</h1>
        <p className="mt-2 text-sm text-text-muted max-w-2xl">
          Every reusable primitive on one page. Use this to audit drift, confirm
          dark-mode contrast, and copy a known-good pattern when building a new
          surface.
        </p>
      </header>

      <Section title="Color tokens" hint="All ink and surface colors are @theme variables — flip OS theme to verify dark mode.">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <Swatch name="brand-700" className="bg-brand-700 text-brand-fg" />
          <Swatch name="brand-800" className="bg-brand-800 text-brand-fg" />
          <Swatch name="brand-50" className="bg-brand-50 text-brand-800" />
          <Swatch name="page" className="bg-page text-text border border-border" />
          <Swatch name="surface" className="bg-surface text-text border border-border" />
          <Swatch name="surface-2" className="bg-surface-2 text-text border border-border" />
          <Swatch name="success-50/700" className="bg-success-50 text-success-700 border border-success-200" />
          <Swatch name="warn-50/700" className="bg-warn-50 text-warn-700 border border-warn-200" />
          <Swatch name="danger-50/700" className="bg-danger-50 text-danger-700 border border-danger-200" />
          <Swatch name="info-50/700" className="bg-info-50 text-info-700 border border-info-200" />
        </div>
      </Section>

      <Section title="Typography" hint="Inter for UI, JetBrains Mono for numerics + tokens.">
        <div className="space-y-3">
          <p className="text-display font-semibold tracking-tight">Display — 32/40</p>
          <p className="text-title font-semibold tracking-tight">Title — 24/32</p>
          <p className="text-heading font-semibold tracking-tight">Heading — 18/28</p>
          <p className="text-body">Body — 14/22 default for paragraph copy.</p>
          <p className="text-caption text-text-muted uppercase tracking-wider">
            Caption — 11/16
          </p>
          <p className="font-mono tabular-nums">
            Mono · 1,234,567.89 · run-7c2d-4f01
          </p>
        </div>
      </Section>

      <Section title="Wordmark" hint="Drives auth panel + sidebar.">
        <div className="flex flex-col gap-4">
          <Wordmark name="Acme Manufacturing" size="lg" />
          <Wordmark name="Acme Manufacturing" size="md" />
          <Wordmark name="Acme Manufacturing" size="sm" />
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          <div className="space-y-1.5">
            <Label htmlFor="sg-email">Email</Label>
            <Input id="sg-email" type="email" placeholder="you@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sg-pass">Password</Label>
            <Input id="sg-pass" type="password" placeholder="••••••••" />
          </div>
        </div>
      </Section>

      <Section title="Status pills">
        <div className="flex flex-wrap gap-2">
          <StatusPill status="OPEN" />
          <StatusPill status="LOCKED" />
          <StatusPill status="PAID" />
          <StatusPill status="PENDING" />
          <StatusPill status="APPROVED" />
          <StatusPill status="REJECTED" />
          <StatusPill status="ACTIVE" />
          <StatusPill status="INACTIVE" />
          <StatusPill status="SCHEDULED" />
          <StatusPill status="INGESTING" />
          <StatusPill status="INGEST_FAILED" />
          <StatusPill status="AWAITING_ADMIN_REVIEW" />
          <StatusPill status="PUBLISHED" />
          <StatusPill status="FAILED" />
        </div>
      </Section>

      <Section title="Avatars">
        <div className="flex flex-wrap items-center gap-2">
          {[
            "Maria Hernandez",
            "Jamal Patel",
            "Lin Wei",
            "Aisha Khan",
            "Diego Romero",
            "Tom Gilroy",
          ].map((n) => (
            <span key={n} className="flex items-center gap-2">
              <Avatar name={n} size="lg" />
              <Avatar name={n} size="md" />
              <Avatar name={n} size="sm" />
            </span>
          ))}
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Basic card</CardTitle>
              <CardDescription>
                shadow-card, rounded-card, border-border. Hover with shadow-card-hover.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-text-muted">
                Cards anchor most surfaces. Lift content into a card whenever
                it has its own header or call-to-action.
              </p>
            </CardContent>
          </Card>
          <EmptyState
            icon={Inbox}
            title="No requests yet"
            description="When an employee submits a missed-punch or time-off request, it'll show up here for you to review."
            action={<Button size="sm">View settings</Button>}
          />
        </div>
      </Section>

      <Section title="Empty states — tones">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <EmptyState
            icon={Calendar}
            title="No periods open"
            description="Configure pay periods to start tracking."
            tone="brand"
          />
          <EmptyState
            icon={Users}
            title="No employees"
            description="Add your first employee to get going."
            tone="neutral"
          />
        </div>
      </Section>

      <Section title="PayrollRunCard — every state">
        <div className="space-y-4">
          {(
            [
              "AWAITING_ADMIN_REVIEW",
              "PUBLISHED",
              "INGESTING",
              "INGEST_FAILED",
              "AWAITING_EMPLOYEE_FIXES",
              "NO_RUN",
            ] as const
          ).map((s) => (
            <PayrollRunCard
              key={s}
              state={s}
              period={{ startDate: "2026-04-20", endDate: "2026-04-26" }}
              runId="demo-run-id"
              stats={{
                hours: 312.5,
                gross: 1842500,
                rounded: 1842500,
                employeeCount: 18,
                unresolvedAlerts: s === "AWAITING_ADMIN_REVIEW" ? 2 : 0,
              }}
            />
          ))}
        </div>
      </Section>

      <Section title="Iconography" hint="Lucide only. No emoji anywhere.">
        <div className="flex items-center gap-4 text-text-muted">
          <ShieldCheck className="h-6 w-6" aria-label="Secure" />
          <Inbox className="h-6 w-6" aria-label="Inbox" />
          <Calendar className="h-6 w-6" aria-label="Calendar" />
          <Users className="h-6 w-6" aria-label="Users" />
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="text-heading font-semibold tracking-tight">{title}</h2>
        {hint ? (
          <p className="text-xs text-text-muted max-w-md text-right">{hint}</p>
        ) : null}
      </div>
      <div className="rounded-card border border-border bg-surface p-6 shadow-card">
        {children}
      </div>
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div
      className={`rounded-input p-3 text-xs font-mono tabular-nums ${className}`}
    >
      {name}
    </div>
  );
}

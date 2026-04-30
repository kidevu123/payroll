// Admin dashboard — Phase 0 placeholder. Phase 3 will populate the
// "Current Payroll Run" card per §8.2.

import { CalendarDays, Workflow, MessageSquareWarning } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-[--text-muted]">
            One place, one source of truth for the current payroll run.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Current payroll run</CardTitle>
          <CardDescription>
            Foundation phase. The orchestrator and run-card UI ship in Phase 3.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={CalendarDays}
            title="No active run"
            description="The first run will be scheduled automatically once the cron job is enabled in Settings → Automation."
            action={
              <Button asChild variant="secondary">
                <Link href="/settings/automation">Open automation settings</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pending requests</CardTitle>
            <CardDescription>Missed punches and time off awaiting your review.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={MessageSquareWarning}
              title="No pending requests"
              description="When employees submit requests, they appear here for one-tap approval."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Last NGTeco import</CardTitle>
            <CardDescription>Status of the most recent automated punch ingest.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Workflow}
              title="No imports yet"
              description="Configure the connection in Settings → NGTeco, then run a test import."
              action={
                <Button asChild variant="secondary">
                  <Link href="/settings/ngteco">Configure NGTeco</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

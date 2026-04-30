import Link from "next/link";
import { Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/domain/status-pill";
import { listPeriods } from "@/lib/db/queries/pay-periods";

export default async function PayrollPage() {
  const periods = await listPeriods({ limit: 60 });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Payroll</h1>
        <p className="text-sm text-[--text-muted]">
          {periods.length} {periods.length === 1 ? "period" : "periods"}, newest first
        </p>
      </div>
      {periods.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No pay periods yet"
          description="Periods auto-create once an employee exists."
          action={
            <Button asChild>
              <Link href="/employees/new">Add employee</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {periods.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-4 border-b-0">
                <div>
                  <CardTitle className="text-base">
                    {p.startDate} – {p.endDate}
                  </CardTitle>
                </div>
                <StatusPill status={p.state} />
              </CardHeader>
              <CardContent className="flex items-center justify-between p-4 pt-2 text-xs text-[--text-muted]">
                <div>
                  {p.lockedAt ? <>Locked {p.lockedAt.toISOString().slice(0, 10)}</> : "Open"}
                  {p.paidAt ? <> · Paid {p.paidAt.toISOString().slice(0, 10)}</> : null}
                </div>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/payroll/${p.id}`}>Review</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// Cash drawer reconciliation. Owner + Admin + Accountant. Tracks
// every deposit (with required invoice number) and every withdrawal
// (auto-recorded when a pay period is marked PAID with method=CASH,
// or manually for corrections). Running balance = sum(DEPOSIT) -
// sum(WITHDRAWAL), constrained to never go negative.

import Link from "next/link";
import { Wallet, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { requireCashDrawerAccess } from "@/lib/auth-guards";
import { getDrawerBalanceCents, listEntries } from "@/lib/db/queries/cash-drawer";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MoneyDisplay } from "@/components/domain/money-display";
import { DepositForm, WithdrawForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function CashDrawerPage() {
  await requireCashDrawerAccess();
  const [balanceCents, entries] = await Promise.all([
    getDrawerBalanceCents(),
    listEntries(),
  ]);

  const totalDeposits = entries
    .filter((e) => e.entry.kind === "DEPOSIT")
    .reduce((s, e) => s + Number(e.entry.amountCents), 0);
  const totalWithdrawals = entries
    .filter((e) => e.entry.kind === "WITHDRAWAL")
    .reduce((s, e) => s + Number(e.entry.amountCents), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cash drawer</h1>
          <p className="text-xs text-text-muted mt-0.5">
            On-prem cash reconciliation. Deposits require an invoice number;
            withdrawals are mostly auto-recorded when a payroll period is paid
            in cash.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wallet className="h-4 w-4 text-brand-700" />
              On hand
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              <MoneyDisplay cents={balanceCents} monospace={false} />
            </p>
            <p className="text-[11px] text-text-muted mt-1">
              {entries.length} ledger entries
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ArrowDownToLine className="h-4 w-4 text-emerald-700" />
              Deposits (lifetime)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              <MoneyDisplay cents={totalDeposits} monospace={false} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ArrowUpFromLine className="h-4 w-4 text-amber-700" />
              Withdrawals (lifetime)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              <MoneyDisplay cents={totalWithdrawals} monospace={false} />
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ArrowDownToLine className="h-4 w-4 text-emerald-700" />
              Add cash to the drawer
            </CardTitle>
            <CardDescription>
              Required: invoice number for the source of the deposit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DepositForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ArrowUpFromLine className="h-4 w-4 text-amber-700" />
              Manual withdrawal
            </CardTitle>
            <CardDescription>
              Use sparingly — payroll cash payments record automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WithdrawForm />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Ledger</CardTitle>
          <CardDescription>Newest first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-2/50 text-[10px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left px-4 py-2 font-medium">Kind</th>
                  <th className="text-left px-4 py-2 font-medium">Invoice / Period</th>
                  <th className="text-left px-4 py-2 font-medium">Notes</th>
                  <th className="text-right px-4 py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                      No drawer activity yet. Record your first deposit above.
                    </td>
                  </tr>
                ) : (
                  entries.map(({ entry, period, createdByEmail }) => (
                    <tr key={entry.id} className="hover:bg-surface-2/40">
                      <td className="px-4 py-2 text-xs text-text-muted tabular-nums">
                        {new Date(
                          entry.createdAt as unknown as string,
                        ).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-[10px] font-medium tracking-tight ${
                            entry.kind === "DEPOSIT"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-amber-200 bg-amber-50 text-amber-800"
                          }`}
                        >
                          {entry.kind === "DEPOSIT" ? (
                            <ArrowDownToLine className="h-3 w-3" />
                          ) : (
                            <ArrowUpFromLine className="h-3 w-3" />
                          )}
                          {entry.kind}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {entry.kind === "DEPOSIT" ? (
                          <span className="font-mono">{entry.invoiceNumber ?? "—"}</span>
                        ) : period ? (
                          <Link
                            href={`/payroll/${period.id}`}
                            className="text-text-muted hover:text-brand-700 hover:underline underline-offset-2"
                          >
                            {period.startDate} – {period.endDate}
                          </Link>
                        ) : (
                          <span className="text-text-subtle">manual</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-muted">
                        {entry.notes ?? ""}
                        {createdByEmail && (
                          <span className="block text-[10px] text-text-subtle mt-0.5">
                            by {createdByEmail}
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums font-semibold ${
                          entry.kind === "DEPOSIT"
                            ? "text-emerald-700"
                            : "text-amber-700"
                        }`}
                      >
                        {entry.kind === "WITHDRAWAL" ? "-" : ""}
                        <MoneyDisplay
                          cents={Number(entry.amountCents)}
                          monospace={false}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

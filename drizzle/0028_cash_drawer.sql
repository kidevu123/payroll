-- Cash drawer + payment method on pay periods.
--
-- Owner ask: track every cash payment of payroll against a "drawer"
-- balance, with deposits requiring an invoice number. Accountant role
-- (added in 0027) gets a view scoped to just this surface.

CREATE TYPE "payment_method" AS ENUM ('BANK', 'CASH');
CREATE TYPE "cash_drawer_kind" AS ENUM ('DEPOSIT', 'WITHDRAWAL');

CREATE TABLE "cash_drawer_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" "cash_drawer_kind" NOT NULL,
  "amount_cents" bigint NOT NULL,
  "invoice_number" text,
  "notes" text,
  -- Withdrawals link back to the period that consumed them; deposits
  -- have a NULL period_id. Set null on period delete (audit row in
  -- the cash drawer remains for historical balance reconstruction).
  "period_id" uuid REFERENCES "pay_periods"("id") ON DELETE SET NULL,
  "created_by_id" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "cash_drawer_entries_kind_idx" ON "cash_drawer_entries" ("kind");
CREATE INDEX "cash_drawer_entries_period_idx" ON "cash_drawer_entries" ("period_id");
CREATE INDEX "cash_drawer_entries_created_idx" ON "cash_drawer_entries" ("created_at");

ALTER TABLE "pay_periods"
  ADD COLUMN IF NOT EXISTS "payment_method" "payment_method",
  ADD COLUMN IF NOT EXISTS "cash_drawer_entry_id" uuid REFERENCES "cash_drawer_entries"("id") ON DELETE SET NULL;

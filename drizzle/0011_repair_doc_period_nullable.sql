-- Idempotent repair for 0010_glorious_gamma_corps. Same Drizzle silent-
-- no-op pattern (bit 0006 → 0007 and 0008 → 0009). 0010 was recorded
-- as applied in __drizzle_migrations but its DDL never ran.
--
-- DROP NOT NULL is naturally idempotent — running it on an already-
-- nullable column is a no-op, so this is safe whether 0010 partly
-- applied or not.

ALTER TABLE "payroll_period_documents" ALTER COLUMN "period_id" DROP NOT NULL;

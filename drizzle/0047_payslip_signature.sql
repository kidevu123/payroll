CREATE TABLE IF NOT EXISTS "kiosk_payday_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"period_id" uuid NOT NULL,
	"issued_by_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shifts" ALTER COLUMN "color_hex" SET DEFAULT '#067049';--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "signature_path" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "signed_via" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_payday_codes" ADD CONSTRAINT "kiosk_payday_codes_period_id_pay_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."pay_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_payday_codes" ADD CONSTRAINT "kiosk_payday_codes_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_payday_codes_code_unique" ON "kiosk_payday_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kiosk_payday_codes_period_idx" ON "kiosk_payday_codes" USING btree ("period_id");
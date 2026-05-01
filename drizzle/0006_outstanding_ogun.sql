ALTER TYPE "public"."pay_type" ADD VALUE 'SALARIED';--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "voided_by_id" uuid;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "void_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payslips" ADD CONSTRAINT "payslips_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "shifts" ALTER COLUMN "color_hex" SET DEFAULT '#067049';--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "signature_path" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "signed_via" text;
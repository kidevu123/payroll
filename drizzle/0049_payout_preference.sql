CREATE TYPE "public"."payout_preference" AS ENUM('CASH', 'ZELLE');--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "payout_preference" "payout_preference";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "zelle_contact" text;
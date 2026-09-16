ALTER TABLE "users" ADD COLUMN "authentik_sub" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "authentik_pk" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "authentik_username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "authentik_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_authentik_sub_unique" ON "users" USING btree ("authentik_sub");
ALTER TABLE "projects" ADD COLUMN "logo" "bytea";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "logo_mime_type" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "logo_updated_at" timestamp with time zone;
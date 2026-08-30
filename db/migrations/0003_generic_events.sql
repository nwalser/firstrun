-- THIS MIGRATION IS DESTRUCTIVE, AND THAT IS THE POINT.
--
-- The visit-to-install join is gone from the product, so the machinery that
-- served it is gone from the database: download_tokens, download_hints,
-- identity_edges and person_overrides are dropped outright, along with the two
-- enums that only ever named their contents. Nothing here is recoverable and
-- nothing is meant to be -- there is no shim, no archive table and no way back,
-- because a half-kept join is worse than no join at all.
--
-- Identity becomes two columns. `distinct_id` is the anonymous id one surface
-- generated for itself; `user_id` is whatever the customer passed to
-- `identify()`. Existing rows keep what they can: the old web visitor or
-- install id becomes the distinct id, the old account id becomes the user id,
-- and a row that carried neither is deleted, because an event that belongs to
-- nothing cannot be counted as a unique and NOT NULL is how that is enforced
-- from now on.
--
-- `surface` and `source_kind` widen from two values to five. `app` becomes
-- `desktop`. Postgres cannot remove a value from an enum, so both types are
-- rebuilt rather than extended, which is also what stops `app` surviving as a
-- value nothing writes and something eventually reads.
--
-- Hand-written rather than generated: the generated form drops the identity
-- columns before anything can be carried out of them, and adds a NOT NULL
-- column to a table that already has rows.

DROP VIEW IF EXISTS "events_resolved";--> statement-breakpoint

DROP TABLE IF EXISTS "download_tokens" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "download_hints" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "identity_edges" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "person_overrides" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "edge_method";--> statement-breakpoint
DROP TYPE IF EXISTS "distinct_type";--> statement-breakpoint

-- IF NOT EXISTS throughout: `drizzle-kit push` exists in package.json, and a
-- developer who has used it may already have some of this. Drizzle's ledger
-- stops the file running twice, but it cannot know what push did behind its
-- back.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "distinct_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint

-- Carry what can be carried. The precedence is the one the surfaces themselves
-- imply: a web row only ever had a visitor id, an app row only ever had an
-- install id, so the COALESCE picks whichever the row actually had.
UPDATE "events"
   SET "distinct_id" = COALESCE("web_visitor_id", "install_id", "account_id"),
       "user_id"     = "account_id"
 WHERE "distinct_id" IS NULL;--> statement-breakpoint

DELETE FROM "events" WHERE "distinct_id" IS NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "distinct_id" SET NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "events_person_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "events_install_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "events_visitor_idx";--> statement-breakpoint

ALTER TABLE "events" DROP COLUMN IF EXISTS "person_id";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN IF EXISTS "web_visitor_id";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN IF EXISTS "install_id";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN IF EXISTS "account_id";--> statement-breakpoint

-- The funnel and the retention curve walk one unique key at a time, and the
-- versions table groups by install. All three land here.
CREATE INDEX IF NOT EXISTS "events_distinct_idx" ON "events" USING btree ("project_id","distinct_id");--> statement-breakpoint

-- Five surfaces, not two. Rebuilt rather than extended because `app` has to
-- stop existing, and ALTER TYPE has no way to take a value back out.
ALTER TYPE "surface" RENAME TO "surface_old";--> statement-breakpoint
CREATE TYPE "surface" AS ENUM('web', 'desktop', 'mobile', 'server', 'other');--> statement-breakpoint
ALTER TABLE "events"
  ALTER COLUMN "surface" TYPE "surface"
  USING (CASE "surface"::text WHEN 'app' THEN 'desktop' ELSE "surface"::text END)::"surface";--> statement-breakpoint
DROP TYPE "surface_old";--> statement-breakpoint

ALTER TYPE "source_kind" RENAME TO "source_kind_old";--> statement-breakpoint
CREATE TYPE "source_kind" AS ENUM('web', 'desktop', 'mobile', 'server', 'other');--> statement-breakpoint
ALTER TABLE "sources"
  ALTER COLUMN "kind" TYPE "source_kind" USING "kind"::text::"source_kind";--> statement-breakpoint
DROP TYPE "source_kind_old";

-- Multiple dashboards per project, and the indexes the filter pickers need.
--
-- Hand-written rather than generated, because the generated version drops a
-- NOT NULL column onto a table that already has rows and fails. `slug` arrives
-- nullable, is backfilled from the name, and is tightened afterwards.
--
-- IF NOT EXISTS throughout: `drizzle-kit push` exists in package.json, and a
-- developer who has used it has these columns already. Drizzle's ledger stops
-- this file running twice, but it cannot know what push did behind its back.
ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "slug" text;--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Slugify the name the same way repo.ts does -- lowercase, non-alphanumerics
-- collapsed to hyphens, trimmed, capped at 40 -- then suffix duplicates within
-- a project. Suffixed rather than rejected: the name belongs to the user and
-- two boards called "Website" is a thing somebody is allowed to have done.
WITH based AS (
    SELECT id,
           project_id,
           created_at,
           COALESCE(
             NULLIF(
               regexp_replace(
                 left(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), 40),
                 '^-+|-+$', '', 'g'
               ),
               ''
             ),
             'overview'
           ) AS base
      FROM dashboards
     WHERE slug IS NULL
),
numbered AS (
    SELECT id,
           base,
           row_number() OVER (PARTITION BY project_id, base ORDER BY created_at, id) AS n
      FROM based
)
UPDATE dashboards d
   SET slug = CASE WHEN numbered.n = 1 THEN numbered.base
                   ELSE numbered.base || '-' || numbered.n END
  FROM numbered
 WHERE numbered.id = d.id;--> statement-breakpoint

-- Tab order from the order they were created, which is the order they were
-- already being listed in.
WITH ordered AS (
    SELECT id,
           (row_number() OVER (PARTITION BY project_id ORDER BY created_at, id))::int - 1 AS pos
      FROM dashboards
)
UPDATE dashboards d
   SET position = ordered.pos
  FROM ordered
 WHERE ordered.id = d.id;--> statement-breakpoint

ALTER TABLE "dashboards" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dashboards_project_slug_key" ON "dashboards" USING btree ("project_id","slug");--> statement-breakpoint

-- The filter pickers ask for the distinct os / channel / app_version a project
-- has ever sent, and the sources list asks when each source was last heard
-- from. Both run on every project page load; without these each is a
-- sequential scan of the largest table here to fill a four-item dropdown.
CREATE INDEX IF NOT EXISTS "events_source_time_idx" ON "events" USING btree ("project_id","source_id","event_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_os_idx" ON "events" USING btree ("project_id","os");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_channel_idx" ON "events" USING btree ("project_id","channel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_app_version_idx" ON "events" USING btree ("project_id","app_version");

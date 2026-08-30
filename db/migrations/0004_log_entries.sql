-- THIS MIGRATION IS DESTRUCTIVE, AND THAT IS THE POINT.
--
-- `events` becomes `log_entries`: one partitioned table, one row shape, for all
-- telemetry. An error is a log entry, an event is a log entry, a metric sample
-- is a log entry. Meaning is assigned by CONVENTION at write time and by QUERY
-- at read time, never by a closed set of types in the backend.
--
-- Five columns are promoted -- project_id, time, distinct_id, severity, name --
-- plus the two the table needs to work at all (entry_id for dedup, ingested_at
-- for debugging). Everything else FOLDS INTO `attributes`: os, arch, locale,
-- app_version, channel, url, referrer, the utm fields, session_id, user_id and
-- source_id. Existing rows are carried across into that shape, using the
-- OpenTelemetry semantic-convention keys where OTel has named the thing and
-- `firstrun.*` where it has not. Nothing is lost; a lot of it moves.
--
-- What IS lost: the old `surface` enum column, and with it the type. A surface
-- is a property of the SOURCE, not of an entry, so it survives as the
-- `firstrun.source.surface` attribute the edge stamps from the source row. An
-- enum on the entry would have been a sixth promoted column pretending to be a
-- type. Postgres cannot drop a value from an enum, so the type goes entirely.
--
-- Severity is NULL on every migrated row, deliberately. The old table had no
-- severity, we do not know what these entries were, and an entry silently filed
-- as INFO is a lie a filter would act on. Unclassified is the truth.
--
-- Hand-written rather than generated, for three reasons the generator cannot
-- reach: `PARTITION BY RANGE` has no Drizzle expression at all; the generated
-- form would drop the old columns before anything could be carried out of them;
-- and the partition helpers below are the retention policy, which is a thing
-- this system does rather than a shape it has.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

-- No foreign key to `projects`. A partitioned table can carry one, but then
-- every partition carries the trigger, and `deleteProject` in db/repo.ts
-- already removes a project's entries explicitly. The cascade was doing work
-- the repo does anyway, on the largest table in the database.
CREATE TABLE IF NOT EXISTS "log_entries" (
  "project_id"  uuid        NOT NULL,
  "time"        timestamptz NOT NULL,
  "entry_id"    uuid        NOT NULL,
  "ingested_at" timestamptz NOT NULL DEFAULT now(),
  "distinct_id" text        NOT NULL,
  "severity"    smallint,
  "name"        text        NOT NULL,
  "attributes"  jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- (project_id, time, entry_id), and `time` is in it because it has to be:
  -- Postgres will not enforce a unique constraint on a partitioned table unless
  -- the constraint contains the partition key. Dedup wants (project_id,
  -- entry_id) alone -- every SDK replays its disk queue after a crash, so the
  -- same entry id arriving twice is the normal case that ON CONFLICT DO NOTHING
  -- absorbs -- and a replayed entry carries the timestamp it was stamped with
  -- on the client, so the same id genuinely does arrive with the same time.
  --
  -- `time` sits SECOND rather than last so this key's btree is also the
  -- per-project time-range index every query starts with. That is one fewer
  -- btree on the hottest table in the database.
  --
  -- Named the way drizzle names it, which is what meta/0004_snapshot.json
  -- records. Nothing references the constraint by name (db/log-entries.ts
  -- deliberately writes a bare `ON CONFLICT DO NOTHING` so that the schema owns
  -- which columns dedup uses), but a database whose catalogue disagrees with
  -- the snapshot is a diff waiting to appear in somebody's next `generate`.
  CONSTRAINT "log_entries_project_id_time_entry_id_pk"
    PRIMARY KEY ("project_id", "time", "entry_id")
) PARTITION BY RANGE ("time");--> statement-breakpoint

-- The safety net. An entry stamped in 2019 by a machine with a wrong clock, or
-- one that arrives the second before the next month's partition is created,
-- lands here instead of failing the insert. Ingest must never reject a row for
-- an administrative reason.
--
-- It is a net, not a home: `log_entries_create_partition` moves rows out of it
-- into the real partition when that month is created, because a default
-- partition holding rows for a range you later want to add is the one thing
-- that makes adding it fail.
CREATE TABLE IF NOT EXISTS "log_entries_default"
  PARTITION OF "log_entries" DEFAULT;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Partition management
-- ---------------------------------------------------------------------------

-- MONTHLY, not weekly.
--
-- Partition count is a real cost: pruning happens at plan time and the planner
-- walks the list, so a dashboard running twenty compiled queries pays it twenty
-- times. Monthly keeps a year of history at thirteen partitions; weekly would
-- make it fifty-three for finer drop granularity nobody has asked for. The
-- windows the product actually offers -- 7, 14, 30, 90, 365 days -- prune to
-- between one and thirteen partitions either way, and retention sold in months
-- is retention people can reason about.
--
-- Weekly is the right answer at a volume where one month of one project does
-- not fit comfortably in cache. Changing granularity later means creating the
-- new partitions and copying, not redesigning, because nothing above this file
-- knows how wide a partition is.

CREATE OR REPLACE FUNCTION log_entries_partition_name(bound date)
  RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT 'log_entries_' || to_char($1, 'YYYY_MM') $$;--> statement-breakpoint

-- Creates the partition covering the month `month_start` falls in, and returns
-- its name. Idempotent: an existing partition is returned untouched.
--
-- The dance with the default partition is the whole reason this is a function
-- and not a CREATE TABLE. Attaching a partition while the default holds rows in
-- the new range fails, so the rows are moved first: build the table standalone,
-- drain the matching rows out of the default into it, give it a CHECK matching
-- the bound so ATTACH can skip the validation scan, attach, drop the now
-- redundant CHECK.
CREATE OR REPLACE FUNCTION log_entries_create_partition(month_start date)
  RETURNS text LANGUAGE plpgsql AS
$$
DECLARE
  start_at date := date_trunc('month', month_start)::date;
  end_at   date := (date_trunc('month', month_start) + interval '1 month')::date;
  part     text := log_entries_partition_name(date_trunc('month', month_start)::date);
BEGIN
  IF to_regclass('public.' || quote_ident(part)) IS NOT NULL THEN
    RETURN part;
  END IF;

  EXECUTE format('CREATE TABLE %I (LIKE log_entries INCLUDING DEFAULTS)', part);

  EXECUTE format(
    'WITH moved AS (
       DELETE FROM log_entries_default
        WHERE "time" >= %L AND "time" < %L
        RETURNING *
     )
     INSERT INTO %I SELECT * FROM moved',
    start_at, end_at, part
  );

  EXECUTE format(
    'ALTER TABLE %I ADD CONSTRAINT %I CHECK ("time" >= %L AND "time" < %L)',
    part, part || '_bound', start_at, end_at
  );

  EXECUTE format(
    'ALTER TABLE log_entries ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)',
    part, start_at, end_at
  );

  -- The partition bound now says the same thing, and a redundant CHECK is one
  -- more expression the planner evaluates on every insert.
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', part, part || '_bound');

  RETURN part;
END
$$;--> statement-breakpoint

-- Everything from `months_back` months ago through `months_ahead` months from
-- now. Called on every boot, so the month after this one always exists before
-- anybody's clock rolls into it, and a database restored from a year-old dump
-- comes back with somewhere to put its own history.
CREATE OR REPLACE FUNCTION log_entries_ensure_partitions(
  months_back  int DEFAULT 1,
  months_ahead int DEFAULT 2
) RETURNS int LANGUAGE plpgsql AS
$$
DECLARE
  m      date;
  made   int := 0;
BEGIN
  FOR m IN
    SELECT generate_series(
             date_trunc('month', now()) - make_interval(months => months_back),
             date_trunc('month', now()) + make_interval(months => months_ahead),
             interval '1 month'
           )::date
  LOOP
    IF to_regclass('public.' || quote_ident(log_entries_partition_name(m))) IS NULL THEN
      made := made + 1;
    END IF;
    PERFORM log_entries_create_partition(m);
  END LOOP;
  RETURN made;
END
$$;--> statement-breakpoint

-- Retention is dropping a partition. It is never a DELETE.
--
-- A bulk DELETE over a hundred million rows writes a hundred million dead
-- tuples, leaves the indexes bloated, and hands the work to autovacuum at the
-- worst possible moment. DROP TABLE is a catalogue change and an unlink.
--
-- Returns the partitions it dropped, so a caller can log what went rather than
-- how many. The default partition is never a candidate: it has no bound to
-- expire, and dropping it would turn an out-of-range insert back into an error.
CREATE OR REPLACE FUNCTION log_entries_drop_expired(retain_months int)
  RETURNS SETOF text LANGUAGE plpgsql AS
$$
DECLARE
  cutoff date := (date_trunc('month', now()) - make_interval(months => retain_months))::date;
  part   text;
BEGIN
  IF retain_months < 1 THEN
    RAISE EXCEPTION 'retain_months must be at least 1, got %', retain_months;
  END IF;

  FOR part IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class p ON p.oid = i.inhparent
     WHERE p.relname = 'log_entries'
       AND c.relname <> 'log_entries_default'
       AND c.relname ~ '^log_entries_[0-9]{4}_[0-9]{2}$'
       -- The name carries the bound, so the cutoff is a string comparison on a
       -- format that sorts chronologically. Reading pg_get_expr(relpartbound)
       -- would mean parsing SQL text to learn something the name already says.
       AND to_date(right(c.relname, 7), 'YYYY_MM') < cutoff
     ORDER BY c.relname
  LOOP
    EXECUTE format('DROP TABLE %I', part);
    RETURN NEXT part;
  END LOOP;
END
$$;--> statement-breakpoint

-- Somewhere for the rows below to go. The oldest event in a development
-- database is thirty days back and the newest is today, so two months back and
-- two forward covers the carry-over and the next two boots.
SELECT log_entries_ensure_partitions(2, 2);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Carry the old rows across
-- ---------------------------------------------------------------------------

-- Guarded, because a database that never had `events` (a fresh clone running
-- every migration in order does, but a Railway volume restored from before
-- 0000 does not) must still end up with an empty `log_entries` rather than an
-- error. The whole insert is inside the DO block for the same reason: the
-- column references would fail to parse if the table were absent.
DO $$
BEGIN
  IF to_regclass('public.events') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO log_entries (
    project_id, "time", entry_id, ingested_at, distinct_id, severity, name, attributes
  )
  SELECT
    e.project_id,
    e.event_time,
    e.event_id,
    e.ingest_time,
    e.distinct_id,
    -- Unclassified, and honestly so. See the header.
    NULL::smallint,
    e.event_name,

    -- The customer's own `props` keys go in at the top level, because that is
    -- what they will be from now on: `track("x", { plan: "pro" })` writes
    -- `plan`. The conventional keys are merged AFTER, so a props key that
    -- happens to collide with one loses -- the stamped value is the one the
    -- edge observed, and the one a query can trust.
    COALESCE(e.props, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'firstrun.source.id',      e.source_id,
      'firstrun.source.surface', e.surface::text,

      'user.id',                 e.user_id,
      'session.id',              e.session_id,

      'service.version',         e.app_version,
      'firstrun.channel',        e.channel,
      'os.type',                 e.os,
      'host.arch',               e.arch,
      'browser.language',        e.locale,

      'url.full',                e.url,
      -- The path alone. A breakdown by page groups on this; grouping on a full
      -- URL is a thousand rows of query strings and answers nothing.
      'url.path',                CASE
                                   WHEN e.url IS NULL THEN NULL
                                   ELSE COALESCE(
                                          NULLIF(
                                            regexp_replace(
                                              regexp_replace(e.url, '^[a-z][a-z0-9+.-]*://[^/?#]*', '', 'i'),
                                              '[?#].*$', ''
                                            ),
                                            ''
                                          ),
                                          '/'
                                        )
                                 END,

      'firstrun.referrer',       e.referrer,
      'firstrun.referrer.host',  CASE
                                   WHEN e.referrer IS NULL THEN NULL
                                   ELSE NULLIF(
                                          lower(regexp_replace(
                                            regexp_replace(e.referrer, '^[a-z][a-z0-9+.-]*://', '', 'i'),
                                            '[/?#].*$', ''
                                          )),
                                          ''
                                        )
                                 END,

      'firstrun.utm.source',     e.utm_source,
      'firstrun.utm.medium',     e.utm_medium,
      'firstrun.utm.campaign',   e.utm_campaign,

      -- A web vital was three strings in `props`. It becomes a measurement:
      -- `firstrun.metric` names it and `firstrun.value` is a NUMBER, so a
      -- percentile over it is arithmetic rather than a cast per row.
      'firstrun.metric',         CASE WHEN e.event_name = 'web_vital'
                                      THEN e.props ->> 'metric' END,
      'firstrun.value',          CASE WHEN e.event_name = 'web_vital'
                                       AND (e.props ->> 'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
                                      THEN (e.props ->> 'value')::numeric END,

      -- Same move for time on page, which was a string in props and is a
      -- duration everywhere else in the vocabulary.
      'firstrun.duration_ms',    CASE WHEN (e.props ->> 'duration_ms') ~ '^[0-9]+$'
                                      THEN (e.props ->> 'duration_ms')::numeric END
    ))
  FROM events e
  -- The partitions created above cover two months back. Anything older than
  -- that lands in the default partition, which is exactly what it is for.
  ON CONFLICT DO NOTHING;
END
$$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Indexes, after the load
-- ---------------------------------------------------------------------------

-- Built after the rows are in, because building a GIN index once over a
-- populated table is dramatically cheaper than maintaining it through a bulk
-- insert. Declared on the parent, so Postgres creates and attaches the matching
-- index on every existing partition and on every partition created later --
-- including the ones `log_entries_create_partition` makes at three in the
-- morning next February, which is the part that would otherwise be forgotten.

-- One name, one window: the shape of almost every question the product asks.
-- The name is an equality and the time is the range that follows it, so the
-- name goes first.
CREATE INDEX IF NOT EXISTS "log_entries_name_time_idx"
  ON "log_entries" ("project_id", "name", "time");--> statement-breakpoint

-- "Errors and worse over the last day" is a range on the 1..24 ladder.
CREATE INDEX IF NOT EXISTS "log_entries_severity_time_idx"
  ON "log_entries" ("project_id", "severity", "time");--> statement-breakpoint

-- One person's timeline, and every walk that counts uniques.
CREATE INDEX IF NOT EXISTS "log_entries_distinct_time_idx"
  ON "log_entries" ("project_id", "distinct_id", "time");--> statement-breakpoint

-- The index that makes `attributes` a query surface rather than a blob we
-- happen to store.
--
-- DEFAULT jsonb_ops, NOT jsonb_path_ops. path_ops is smaller and faster on
-- containment, and containment (`attributes @> '{"os.type":"windows"}'`) is
-- most of what db/query.ts emits -- but it indexes ONLY containment. Key
-- existence (`?`, `?|`) is not in its operator class at all, and the compiler
-- emits that for every "is set" filter and every "has one of these keys"
-- attribute picker. One index covering every index-eligible operator we emit
-- beats a smaller index plus a sequential scan whenever somebody asks a
-- question the smaller one cannot answer.
--
-- If containment ever dominates hard enough that the size difference matters,
-- this is the single line to change, and db/query.ts records exactly which
-- predicates are index-eligible so the consequence is legible.
CREATE INDEX IF NOT EXISTS "log_entries_attributes_idx"
  ON "log_entries" USING gin ("attributes");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The old world
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS "events" CASCADE;--> statement-breakpoint

-- Nothing has a `surface` column any more. Postgres cannot remove a value from
-- an enum, and an enum nothing writes is a type something eventually reads.
DROP TYPE IF EXISTS "surface";

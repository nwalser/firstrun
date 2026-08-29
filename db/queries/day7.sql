-- Day 7: of the people who got as far as a first run, how many were still
-- launching the app a week or more later.
--
-- The cohort is people with BOTH a download and a first run, not every install.
-- That keeps this number on the same chain as the other four -- someone at step
-- four must have appeared at step three. Retention across all installs
-- regardless of provenance is a different and also useful number; it is
-- retention.sql, and putting it in this row would silently change what the
-- funnel means.
--
-- Bucketed on event_time, never ingest_time: a laptop shut for a week uploads
-- its day-7 launch on day 14 and still counts as day 7. See CLAUDE.md rule 2.
--
-- $1 project_id, $2 from, $3 to, $4 source_id (nullable)
WITH remap AS (
    SELECT e.from_id AS install_id,
           min(wp.person_id::text)::uuid AS person_id
      FROM identity_edges e
      JOIN (
            SELECT web_visitor_id, min(person_id::text)::uuid AS person_id
              FROM events_resolved
             WHERE project_id = $1 AND web_visitor_id IS NOT NULL
             GROUP BY web_visitor_id
           ) wp ON wp.web_visitor_id = e.to_id
     WHERE e.project_id = $1
       AND e.method = 'estimate'
       AND e.from_type = 'install'
       AND e.to_type = 'web_visitor'
     GROUP BY e.from_id
),
scoped AS (
    SELECT ev.event_name,
           ev.event_time,
           ev.person_id AS person_exact,
           COALESCE(r.person_id, ev.person_id) AS person_est
      FROM events_resolved ev
      LEFT JOIN remap r ON r.install_id = ev.install_id
     WHERE ev.project_id = $1
       AND ev.event_time >= $2
       AND ev.event_time <  $3
       AND ($4::uuid IS NULL OR ev.source_id = $4::uuid)
),
people AS (
    SELECT 'exact'::text AS kind, person_exact AS person_id, event_name, event_time FROM scoped
    UNION ALL
    SELECT 'estimated'::text, person_est, event_name, event_time FROM scoped
),
agg AS (
    SELECT kind,
           person_id,
           count(*) FILTER (WHERE event_name = 'download_started') > 0 AS has_download,
           count(*) FILTER (WHERE event_name = 'app_first_run')    > 0 AS has_first_run,
           min(event_time) FILTER (WHERE event_name = 'app_first_run') AS first_run_at,
           max(event_time) FILTER (WHERE event_name IN ('app_launch', 'purchase')) AS last_app_at
      FROM people
     GROUP BY kind, person_id
)
SELECT kind,
       count(*) FILTER (WHERE has_download AND has_first_run) AS first_run,
       count(*) FILTER (
           WHERE has_download
             AND has_first_run
             AND last_app_at >= first_run_at + interval '7 days'
       ) AS day7
  FROM agg
 GROUP BY kind

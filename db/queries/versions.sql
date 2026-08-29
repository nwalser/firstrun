-- Active installs per app version, and how many have gone quiet.
--
-- The version model is the half of the product a generic analytics tool does
-- not have. The number that matters is not "how many are on 1.3.x" but "how
-- many people on 1.3.x stopped launching" -- a stale cohort still running is a
-- support problem, a stale cohort gone silent is churn nobody attributed to the
-- release.
--
-- An install's version is the last one it reported, not the one it installed
-- with. Quiet means nothing on event_time for $3 days.
--
-- $1 project_id, $2 now, $3 quiet_days, $4 source_id (nullable)
WITH per_install AS (
    SELECT DISTINCT ON (install_id)
           install_id,
           app_version,
           person_id,
           max(event_time) OVER (PARTITION BY install_id) AS last_seen_at
      FROM events_resolved
     WHERE project_id = $1
       AND surface = 'app'
       AND install_id IS NOT NULL
       AND app_version IS NOT NULL
       AND ($4::uuid IS NULL OR source_id = $4::uuid)
     ORDER BY install_id, event_time DESC
)
SELECT app_version,
       count(*)                                                                   AS installs,
       count(DISTINCT person_id)                                                  AS people,
       count(*) FILTER (WHERE last_seen_at >= $2::timestamptz - ($3 || ' days')::interval) AS active,
       count(*) FILTER (WHERE last_seen_at <  $2::timestamptz - ($3 || ' days')::interval) AS quiet,
       max(last_seen_at)                                                          AS newest_activity
  FROM per_install
 GROUP BY app_version
 ORDER BY string_to_array(app_version, '.')::int[] DESC

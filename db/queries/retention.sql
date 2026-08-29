-- The retention curve: share of installs still launching, by day since first run.
--
-- Unlike day7.sql this is every install, whatever its provenance -- the
-- question is "does the app keep people", not "can we trace where they came
-- from". Two different questions, two different queries, and conflating them is
-- how a retention number ends up quietly measuring attribution instead.
--
-- The denominator shrinks with the day index on purpose: someone who installed
-- three days ago cannot have a day-7, and counting them as churned would drag
-- the tail of the curve toward zero for no reason other than the calendar.
--
-- $1 workspace_id, $2 from, $3 to, $4 max_day, $5 source_id (nullable)
WITH firsts AS (
    SELECT person_id, min(event_time) AS first_run_at
      FROM events_resolved
     WHERE workspace_id = $1
       AND event_name = 'app_first_run'
       AND event_time >= $2
       AND event_time <  $3
       AND ($5::uuid IS NULL OR source_id = $5::uuid)
     GROUP BY person_id
),
activity AS (
    SELECT f.person_id,
           floor(extract(epoch FROM (e.event_time - f.first_run_at)) / 86400)::int AS day
      FROM firsts f
      JOIN events_resolved e
        ON e.workspace_id = $1
       AND e.person_id = f.person_id
       AND e.surface = 'app'
       AND e.event_time >= f.first_run_at
     GROUP BY f.person_id, 2
),
days AS (SELECT generate_series(0, $4::int) AS day)
SELECT d.day,
       (SELECT count(*) FROM firsts f
         WHERE f.first_run_at <= $3::timestamptz - (d.day || ' days')::interval) AS eligible,
       count(DISTINCT a.person_id) AS retained
  FROM days d
  LEFT JOIN activity a ON a.day = d.day
 GROUP BY d.day
 ORDER BY d.day

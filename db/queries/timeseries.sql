-- One metric per day, over the window.
--
-- Bucketed on event_time and gap-filled with generate_series, so a day nobody
-- did anything is a zero rather than a missing point. A line chart that closes
-- its own gaps quietly turns a two-day outage into a gentle slope.
--
-- Counts distinct people, not events: three page views from one person on one
-- day is one visitor, which is the only reading that composes with the funnel.
--
-- $1 workspace_id, $2 from, $3 to, $4 event_name, $5 source_id (nullable)
WITH days AS (
    SELECT generate_series(
             date_trunc('day', $2::timestamptz),
             date_trunc('day', $3::timestamptz - interval '1 microsecond'),
             interval '1 day'
           ) AS day
),
counted AS (
    SELECT date_trunc('day', event_time) AS day,
           count(DISTINCT person_id)     AS people
      FROM events_resolved
     WHERE workspace_id = $1
       AND event_name = $4
       AND event_time >= $2
       AND event_time <  $3
       AND ($5::uuid IS NULL OR source_id = $5::uuid)
     GROUP BY 1
)
SELECT days.day,
       COALESCE(counted.people, 0) AS people
  FROM days
  LEFT JOIN counted ON counted.day = days.day
 ORDER BY days.day

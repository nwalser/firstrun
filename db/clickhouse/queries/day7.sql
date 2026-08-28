-- Day 7: of the people who ran the app once, how many were still running it a
-- week or more later.
--
-- `retention` rather than two countIfs because the pair semantics are the point:
-- r[2] can never exceed r[1], so the number on the screen cannot go up when the
-- denominator goes down. Bucketed on event_time, never ingest_time -- a laptop
-- that was shut for a week uploads its whole day-7 launch on day 14 and must
-- still count as day 7. See CLAUDE.md rule 2.
--
-- Params: project UUID, from/to DateTime64(3)
SELECT
    sum(r[1]) AS first_run,
    sum(r[2]) AS day7
FROM
(
    SELECT
        person_id,
        retention(
            has_first_run,
            has_first_run AND last_app_at >= first_run_at + toIntervalDay(7)
        ) AS r
    FROM
    (
        SELECT
            person_id,
            countIf(event_name = 'app_first_run') > 0 AS has_first_run,
            minIf(event_time, event_name = 'app_first_run') AS first_run_at,
            maxIf(event_time, event_name IN ('app_launch', 'purchase')) AS last_app_at
        FROM events_resolved
        WHERE project_id = {project:UUID}
          AND surface = 'app'
          AND event_time >= {from:DateTime64(3)}
          AND event_time <  {to:DateTime64(3)}
        GROUP BY person_id
    )
    GROUP BY person_id, has_first_run, first_run_at, last_app_at
)

-- Day 7: of the people who got as far as a first run, how many were still
-- launching the app a week or more later.
--
-- `retention` rather than two countIfs because the pair semantics are the
-- point: r[2] can never exceed r[1], so the number on the screen cannot go up
-- when the denominator goes down.
--
-- The cohort is people with BOTH a download and a first run, not every install.
-- That keeps this step on the same chain as the other four numbers -- a person
-- who appears at step 4 must have appeared at step 3. Retention across all
-- installs regardless of provenance is a different and also useful number; it
-- is not this one, and putting it in this row would silently change what the
-- funnel means.
--
-- Bucketed on event_time, never ingest_time: a laptop shut for a week uploads
-- its day-7 launch on day 14 and still counts as day 7. See CLAUDE.md rule 2.
--
-- Returns one row per kind, exact and estimated, exactly as funnel.sql does.
--
-- Params: project UUID, from/to DateTime64(3)
WITH
    remap AS
    (
        SELECT
            edge.from_id AS install_id,
            any(wp.person_id) AS person_id
        FROM
        (
            SELECT from_id, to_id
            FROM identity_edges FINAL
            WHERE project_id = {project:UUID}
              AND method = 'estimate'
              AND from_type = 'install'
              AND to_type = 'web_visitor'
        ) AS edge
        INNER JOIN
        (
            SELECT web_visitor_id, any(person_id) AS person_id
            FROM events_resolved
            WHERE project_id = {project:UUID} AND web_visitor_id IS NOT NULL
            GROUP BY web_visitor_id
        ) AS wp ON edge.to_id = wp.web_visitor_id
        GROUP BY edge.from_id
    ),
    scoped AS
    (
        SELECT
            e.event_name AS event_name,
            e.event_time AS event_time,
            e.person_id AS person_exact,
            coalesce(
                nullIf(r.person_id, toUUID('00000000-0000-0000-0000-000000000000')),
                e.person_id
            ) AS person_est
        FROM events_resolved AS e
        LEFT JOIN remap AS r ON e.install_id = r.install_id
        WHERE e.project_id = {project:UUID}
          AND e.event_time >= {from:DateTime64(3)}
          AND e.event_time <  {to:DateTime64(3)}
    ),
    per_person AS
    (
        SELECT
            'exact' AS kind,
            person_exact AS person_id,
            countIf(event_name = 'download_started') > 0 AS has_download,
            countIf(event_name = 'app_first_run') > 0 AS has_first_run,
            minIf(event_time, event_name = 'app_first_run') AS first_run_at,
            maxIf(event_time, event_name IN ('app_launch', 'purchase')) AS last_app_at
        FROM scoped
        GROUP BY person_exact

        UNION ALL

        SELECT
            'estimated' AS kind,
            person_est AS person_id,
            countIf(event_name = 'download_started') > 0 AS has_download,
            countIf(event_name = 'app_first_run') > 0 AS has_first_run,
            minIf(event_time, event_name = 'app_first_run') AS first_run_at,
            maxIf(event_time, event_name IN ('app_launch', 'purchase')) AS last_app_at
        FROM scoped
        GROUP BY person_est
    )
SELECT
    kind,
    sum(r[1]) AS first_run,
    sum(r[2]) AS day7
FROM
(
    SELECT
        kind,
        person_id,
        retention(
            has_download AND has_first_run,
            has_download AND has_first_run AND last_app_at >= first_run_at + toIntervalDay(7)
        ) AS r
    FROM per_person
    GROUP BY kind, person_id, has_download, has_first_run, first_run_at, last_app_at
)
GROUP BY kind

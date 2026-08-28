-- The four ordered steps of the chain, counted twice: once over exact person
-- ids, once over person ids that also absorb estimated matches.
--
-- Two rows come back, kind='exact' and kind='estimated'. The screen shows the
-- exact number and the difference between them, labelled as an estimate. They
-- are never added together into one number, because one of them is a fact about
-- people and the other is a guess about rows. See CLAUDE.md rule 1.
--
-- Day 7 is not a windowFunnel step -- "still here a week later" is not an
-- ordering constraint, it is a gap constraint. It lives in day7.sql.
--
-- Params: project UUID, from/to DateTime64(3), window UInt64 (milliseconds)
WITH
    remap AS
    (
        -- install -> the person its estimated web visitor already belongs to.
        -- Read from identity_edges directly: these edges deliberately never
        -- reached person_overrides.
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
            -- windowFunnel will not take a DateTime64, and truncating to whole
            -- seconds would make two steps that happened in the same second
            -- ambiguous. Milliseconds since epoch keeps the ordering honest.
            toUInt64(toUnixTimestamp64Milli(e.event_time)) AS ts,
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
    )
SELECT
    kind,
    countIf(lvl >= 1) AS visited,
    countIf(lvl >= 2) AS downloaded,
    countIf(lvl >= 3) AS first_run,
    countIf(lvl >= 4) AS paid
FROM
(
    SELECT
        'exact' AS kind,
        person_exact AS person_id,
        windowFunnel({window:UInt64})(
            ts,
            event_name = 'page_view',
            event_name = 'download_started',
            event_name = 'app_first_run',
            event_name = 'purchase'
        ) AS lvl
    FROM scoped
    GROUP BY person_exact

    UNION ALL

    SELECT
        'estimated' AS kind,
        person_est AS person_id,
        windowFunnel({window:UInt64})(
            ts,
            event_name = 'page_view',
            event_name = 'download_started',
            event_name = 'app_first_run',
            event_name = 'purchase'
        ) AS lvl
    FROM scoped
    GROUP BY person_est
)
GROUP BY kind

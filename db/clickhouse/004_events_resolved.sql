-- Every query reads this, never `events` directly.
--
-- events.person_id is whatever identity resolved at ingest time. If a merge has
-- happened since and squash has not yet run, the truth lives in
-- person_overrides. This view applies that small table and hands back the one
-- column callers care about, so no query has to remember to do it.
--
-- Three left joins rather than one because a merge can be discovered through
-- any of the three distincts. account wins over install wins over web_visitor,
-- which is the same precedence the resolver uses. Post-resolution they agree;
-- the ordering only matters in the window where one has been written and
-- another has not.
--
-- nullIf against the zero uuid rather than relying on join_use_nulls, so the
-- view is correct whatever settings the caller arrives with.
CREATE OR REPLACE VIEW events_resolved AS
SELECT
    e.project_id      AS project_id,
    e.event_id        AS event_id,
    e.event_name      AS event_name,
    e.event_time      AS event_time,
    e.ingest_time     AS ingest_time,
    e.surface         AS surface,
    e.web_visitor_id  AS web_visitor_id,
    e.install_id      AS install_id,
    e.account_id      AS account_id,
    e.session_id      AS session_id,
    e.app_version     AS app_version,
    e.channel         AS channel,
    e.os              AS os,
    e.arch            AS arch,
    e.locale          AS locale,
    e.url             AS url,
    e.referrer        AS referrer,
    e.utm_source      AS utm_source,
    e.utm_medium      AS utm_medium,
    e.utm_campaign    AS utm_campaign,
    e.props           AS props,
    coalesce(
        nullIf(oa.person_id, toUUID('00000000-0000-0000-0000-000000000000')),
        nullIf(oi.person_id, toUUID('00000000-0000-0000-0000-000000000000')),
        nullIf(ow.person_id, toUUID('00000000-0000-0000-0000-000000000000')),
        e.person_id
    ) AS person_id
FROM events AS e
LEFT JOIN
(
    SELECT project_id, distinct_id, person_id
    FROM person_overrides FINAL
    WHERE distinct_type = 'account'
) AS oa ON e.project_id = oa.project_id AND e.account_id = oa.distinct_id
LEFT JOIN
(
    SELECT project_id, distinct_id, person_id
    FROM person_overrides FINAL
    WHERE distinct_type = 'install'
) AS oi ON e.project_id = oi.project_id AND e.install_id = oi.distinct_id
LEFT JOIN
(
    SELECT project_id, distinct_id, person_id
    FROM person_overrides FINAL
    WHERE distinct_type = 'web_visitor'
) AS ow ON e.project_id = ow.project_id AND e.web_visitor_id = ow.distinct_id

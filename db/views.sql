-- Every analytics query reads events_resolved, never events directly.
--
-- events.person_id is whatever identity resolved at ingest time. If a merge has
-- happened since and the squash job has not run yet, the truth is in
-- person_overrides. This view applies that small table so no query has to
-- remember to, and so "correct within a second" does not depend on a background
-- job having caught up.
--
-- Three joins rather than one because a merge can be discovered through any of
-- the three distincts. account beats install beats web_visitor, which is the
-- precedence the resolver uses. After resolution they agree; the ordering only
-- matters in the window where one has been written and another has not.
CREATE OR REPLACE VIEW events_resolved AS
SELECT
    e.project_id,
    e.event_id,
    e.source_id,
    e.event_name,
    e.event_time,
    e.ingest_time,
    e.surface,
    e.web_visitor_id,
    e.install_id,
    e.account_id,
    e.session_id,
    e.app_version,
    e.channel,
    e.os,
    e.arch,
    e.locale,
    e.url,
    e.referrer,
    e.utm_source,
    e.utm_medium,
    e.utm_campaign,
    e.props,
    COALESCE(oa.person_id, oi.person_id, ow.person_id, e.person_id) AS person_id
FROM events AS e
LEFT JOIN person_overrides AS oa
       ON oa.project_id = e.project_id
      AND oa.distinct_type = 'account'
      AND oa.distinct_id = e.account_id
LEFT JOIN person_overrides AS oi
       ON oi.project_id = e.project_id
      AND oi.distinct_type = 'install'
      AND oi.distinct_id = e.install_id
LEFT JOIN person_overrides AS ow
       ON ow.project_id = e.project_id
      AND ow.distinct_type = 'web_visitor'
      AND ow.distinct_id = e.web_visitor_id;

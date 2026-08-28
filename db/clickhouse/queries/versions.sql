-- Active installs per app version, and how many of them have gone quiet.
--
-- The version model is the half of the product PostHog does not have. The
-- number that matters is not "how many are on 1.3.x" but "how many people on
-- 1.3.x stopped launching the app" -- a stale cohort that is still running is a
-- support problem, a stale cohort that went silent is churn nobody attributed
-- to the release.
--
-- An install's version is the last one it reported, not the one it installed
-- with. Quiet means nothing on event_time for `quiet_days`.
--
-- The inner aliases are deliberately not named `app_version` / `person_id`:
-- ClickHouse resolves a WHERE clause against subquery aliases, and an alias
-- that shadows the column it aggregates makes the filter illegal.
--
-- Params: project UUID, now DateTime64(3), quiet_days UInt32
SELECT
    last_version AS app_version,
    count() AS installs,
    uniqExact(last_person) AS people,
    countIf(last_seen_at >= {now:DateTime64(3)} - toIntervalDay({quiet_days:UInt32})) AS active,
    countIf(last_seen_at <  {now:DateTime64(3)} - toIntervalDay({quiet_days:UInt32})) AS quiet,
    max(last_seen_at) AS newest_activity
FROM
(
    SELECT
        install_id,
        argMax(app_version, event_time) AS last_version,
        argMax(person_id, event_time) AS last_person,
        max(event_time) AS last_seen_at
    FROM events_resolved
    WHERE project_id = {project:UUID}
      AND surface = 'app'
      AND install_id IS NOT NULL
      AND app_version IS NOT NULL
    GROUP BY install_id
)
GROUP BY last_version
ORDER BY last_version DESC

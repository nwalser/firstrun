-- The ordered chain, counted twice: once over exact person ids, once over
-- person ids that also absorb estimated matches.
--
-- Two rows come back, kind='exact' and kind='estimated'. The screen shows the
-- exact number and the difference between them, labelled. They are never added
-- into one number, because one is a fact about people and the other is a guess
-- about rows. See CLAUDE.md rule 1.
--
-- This is what ClickHouse spelled `windowFunnel`. Written out, the semantics
-- are clearer than the function was: each stage may only look at events at or
-- after the stage before it, and the whole chain must fit inside one window
-- measured from the first step. A person who visited in January and installed
-- in March is one conversion, not two halves.
--
-- Day 7 is not a stage here. "Still here a week later" is a gap constraint, not
-- an ordering one, and it lives in day7.sql.
--
-- $1 project_id, $2 from, $3 to, $4 window interval, $5 source_id (nullable)
WITH remap AS (
    -- install -> the person its estimated web visitor already belongs to.
    -- Read from identity_edges directly: these edges deliberately never
    -- reached person_overrides.
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
       AND ($5::uuid IS NULL OR ev.source_id = $5::uuid)
),
people AS (
    SELECT 'exact'::text AS kind, person_exact AS person_id, event_name, event_time FROM scoped
    UNION ALL
    SELECT 'estimated'::text, person_est, event_name, event_time FROM scoped
),
s1 AS (
    SELECT kind, person_id, min(event_time) AS t1
      FROM people
     WHERE event_name = 'page_view'
     GROUP BY kind, person_id
),
s2 AS (
    SELECT s1.kind, s1.person_id, s1.t1, min(p.event_time) AS t2
      FROM s1
      JOIN people p
        ON p.kind = s1.kind AND p.person_id = s1.person_id
       AND p.event_name = 'download_started'
       AND p.event_time >= s1.t1
       AND p.event_time <= s1.t1 + $4::interval
     GROUP BY s1.kind, s1.person_id, s1.t1
),
s3 AS (
    SELECT s2.kind, s2.person_id, s2.t1, min(p.event_time) AS t3
      FROM s2
      JOIN people p
        ON p.kind = s2.kind AND p.person_id = s2.person_id
       AND p.event_name = 'app_first_run'
       AND p.event_time >= s2.t2
       AND p.event_time <= s2.t1 + $4::interval
     GROUP BY s2.kind, s2.person_id, s2.t1
),
s4 AS (
    SELECT s3.kind, s3.person_id, min(p.event_time) AS t4
      FROM s3
      JOIN people p
        ON p.kind = s3.kind AND p.person_id = s3.person_id
       AND p.event_name = 'purchase'
       AND p.event_time >= s3.t3
       AND p.event_time <= s3.t1 + $4::interval
     GROUP BY s3.kind, s3.person_id
)
SELECT s1.kind,
       count(*)               AS visited,
       count(s2.person_id)    AS downloaded,
       count(s3.person_id)    AS first_run,
       count(s4.person_id)    AS paid
  FROM s1
  LEFT JOIN s2 ON s2.kind = s1.kind AND s2.person_id = s1.person_id
  LEFT JOIN s3 ON s3.kind = s1.kind AND s3.person_id = s1.person_id
  LEFT JOIN s4 ON s4.kind = s1.kind AND s4.person_id = s1.person_id
 GROUP BY s1.kind

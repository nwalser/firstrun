-- The fast path for a merge.
--
-- Rewriting events.person_id is a ClickHouse mutation and takes as long as it
-- takes. A person who just claimed a token should be joined in the funnel a
-- second later, not a squash interval later. So an exact link writes here
-- immediately, queries apply this table as a small join, and the squash job
-- later drains it into events.person_id and deletes what it drained.
--
-- Small and hot by construction: a row only exists between a merge and the next
-- squash run. If this table is large, squash is not running.
CREATE TABLE IF NOT EXISTS person_overrides
(
    project_id     UUID,
    distinct_type  Enum8('web_visitor' = 1, 'install' = 2, 'account' = 3),
    distinct_id    String,
    person_id      UUID,
    version        UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (project_id, distinct_type, distinct_id)

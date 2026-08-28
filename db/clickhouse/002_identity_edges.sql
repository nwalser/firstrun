-- Every belief we hold about two distincts being the same person.
--
-- method='token' and method='account' are exact and drive person_id.
-- method='estimate' is a guess. It is stored here, reported separately by the
-- funnel, and never allowed to influence a person id. See CLAUDE.md rule 1.
--
-- ReplacingMergeTree so a re-claimed token or a re-sent account edge collapses
-- instead of accumulating. The ORDER BY is the edge's natural key.
CREATE TABLE IF NOT EXISTS identity_edges
(
    project_id  UUID,
    from_type   Enum8('web_visitor' = 1, 'install' = 2, 'account' = 3),
    from_id     String,
    to_type     Enum8('web_visitor' = 1, 'install' = 2, 'account' = 3),
    to_id       String,
    method      Enum8('token' = 1, 'account' = 2, 'estimate' = 3),
    confidence  Float32,
    created_at  DateTime64(3)
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (project_id, method, from_type, from_id, to_type, to_id)

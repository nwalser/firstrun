-- The event store.
--
-- event_time is client-stamped and authoritative. ingest_time is server-stamped
-- and exists for debugging and dedup windows only. Nothing sorts, buckets,
-- windows or retains on ingest_time -- an app that was offline for three days
-- must land in the bucket it happened in, not the bucket it arrived in.
-- See CLAUDE.md rule 2.
--
-- person_id is derived by @firstrun/identity. A client never sends one.
CREATE TABLE IF NOT EXISTS events
(
    project_id      UUID,
    event_id        UUID,
    event_name      LowCardinality(String),
    event_time      DateTime64(3),
    ingest_time     DateTime64(3),
    surface         Enum8('web' = 1, 'app' = 2),

    person_id       UUID,
    web_visitor_id  Nullable(String),
    install_id      Nullable(String),
    account_id      Nullable(String),
    session_id      Nullable(String),

    app_version     LowCardinality(Nullable(String)),
    channel         LowCardinality(Nullable(String)),
    os              LowCardinality(Nullable(String)),
    arch            LowCardinality(Nullable(String)),
    locale          LowCardinality(Nullable(String)),

    url             Nullable(String),
    referrer        Nullable(String),
    utm_source      LowCardinality(Nullable(String)),
    utm_medium      LowCardinality(Nullable(String)),
    utm_campaign    LowCardinality(Nullable(String)),

    props           Map(String, String),

    INDEX idx_install install_id TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_visitor web_visitor_id TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (project_id, event_time, event_id)

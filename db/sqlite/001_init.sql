-- The transactional store. Becomes Postgres later, which is why nothing here
-- uses a SQLite-only feature and why every query goes through
-- db/sqlite/repositories.ts rather than being written inline.

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    asset_name  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
    key         TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id),
    name        TEXT,
    created_at  INTEGER NOT NULL,
    revoked_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id);

-- The token minted at download and claimed on first run. The whole join hangs
-- off this table.
CREATE TABLE IF NOT EXISTS download_tokens (
    token           TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id),
    web_visitor_id  TEXT,
    asset           TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    claimed_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_download_tokens_visitor ON download_tokens(project_id, web_visitor_id);
CREATE INDEX IF NOT EXISTS idx_download_tokens_expiry ON download_tokens(expires_at);

CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL
);

-- Server-side dedup for client-generated event ids. The Tauri SDK replays its
-- disk queue after a crash, so the same event_id arrives more than once by
-- design. ClickHouse MergeTree will not dedup for us, so we do it here, where a
-- primary key is cheap.
--
-- Pruned by age rather than kept forever: a replay that arrives a month after
-- the event is not a retry, it is a new fact, and by then the queue file that
-- held it is long gone.
CREATE TABLE IF NOT EXISTS ingested_events (
    project_id  TEXT NOT NULL,
    event_id    TEXT NOT NULL,
    seen_at     INTEGER NOT NULL,
    PRIMARY KEY (project_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_ingested_events_seen ON ingested_events(seen_at);

-- Fallback matching material for installs that arrive with no token.
--
-- A store, winget or shared-link install never carried a filename, so the only
-- thing linking it to a visit is that the same network downloaded the same OS
-- build a few minutes earlier. That is a guess, so what it produces is an
-- `estimate` edge and never a person merge. See CLAUDE.md rule 1.
--
-- Deliberately not in ClickHouse and deliberately not an IP address:
--   - the events table has no IP column and should not grow one,
--   - a salted hash is enough to match on and useless to browse,
--   - rows are pruned after an hour, because the matching window is 30 minutes
--     and anything older is noise that would only lower confidence.
CREATE TABLE IF NOT EXISTS download_hints (
    project_id      TEXT NOT NULL,
    web_visitor_id  TEXT NOT NULL,
    ip_hash         TEXT NOT NULL,
    os              TEXT,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_download_hints_lookup
    ON download_hints(project_id, ip_hash, created_at);

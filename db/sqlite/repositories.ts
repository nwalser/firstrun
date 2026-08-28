import type { Database } from "bun:sqlite";

/**
 * The thin repository layer.
 *
 * The decision on record is that this store becomes Postgres later. That is
 * only cheap if every statement lives in this file, so it does. Nothing outside
 * `db/` writes SQL against the transactional store.
 */

export interface Project {
  id: string;
  name: string;
  /** Installer basename, e.g. `Themia-Setup`. The token gets appended to it. */
  asset_name: string;
  created_at: number;
}

export interface DownloadToken {
  token: string;
  project_id: string;
  web_visitor_id: string | null;
  asset: string;
  created_at: number;
  expires_at: number;
  claimed_at: number | null;
}

export interface ApiKey {
  key: string;
  project_id: string;
  name: string | null;
  created_at: number;
  revoked_at: number | null;
}

export class ProjectRepo {
  constructor(private readonly db: Database) {}

  create(p: Project): Project {
    this.db
      .query(`INSERT INTO projects (id, name, asset_name, created_at) VALUES (?, ?, ?, ?)`)
      .run(p.id, p.name, p.asset_name, p.created_at);
    return p;
  }

  get(id: string): Project | null {
    return this.db.query<Project, [string]>(`SELECT * FROM projects WHERE id = ?`).get(id) ?? null;
  }

  list(): Project[] {
    return this.db.query<Project, []>(`SELECT * FROM projects ORDER BY created_at`).all();
  }

  upsert(p: Project): Project {
    this.db
      .query(
        `INSERT INTO projects (id, name, asset_name, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, asset_name = excluded.asset_name`
      )
      .run(p.id, p.name, p.asset_name, p.created_at);
    return p;
  }
}

export class ApiKeyRepo {
  constructor(private readonly db: Database) {}

  create(k: ApiKey): ApiKey {
    this.db
      .query(`INSERT INTO api_keys (key, project_id, name, created_at, revoked_at) VALUES (?, ?, ?, ?, ?)`)
      .run(k.key, k.project_id, k.name, k.created_at, k.revoked_at);
    return k;
  }

  /** Returns the project a live key belongs to, or null. */
  projectFor(key: string): string | null {
    const row = this.db
      .query<{ project_id: string }, [string]>(
        `SELECT project_id FROM api_keys WHERE key = ? AND revoked_at IS NULL`
      )
      .get(key);
    return row?.project_id ?? null;
  }
}

export class DownloadTokenRepo {
  constructor(private readonly db: Database) {}

  create(t: DownloadToken): DownloadToken {
    this.db
      .query(
        `INSERT INTO download_tokens (token, project_id, web_visitor_id, asset, created_at, expires_at, claimed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(t.token, t.project_id, t.web_visitor_id, t.asset, t.created_at, t.expires_at, t.claimed_at);
    return t;
  }

  get(token: string): DownloadToken | null {
    return (
      this.db.query<DownloadToken, [string]>(`SELECT * FROM download_tokens WHERE token = ?`).get(token) ??
      null
    );
  }

  /**
   * Marks a token claimed, and reports whether this call is the one that did it.
   *
   * A first run can fire twice -- the NSIS hook wrote the token file and the
   * Downloads-folder fallback found the installer as well. The second claim must
   * be a no-op rather than a second edge, so the update is conditional and the
   * caller keys off the row count.
   */
  claim(token: string, at: number): { claimed: boolean; row: DownloadToken | null } {
    const changes = this.db
      .query(`UPDATE download_tokens SET claimed_at = ? WHERE token = ? AND claimed_at IS NULL`)
      .run(at, token).changes;
    return { claimed: changes > 0, row: this.get(token) };
  }

  expire(now: number): number {
    return this.db
      .query(`DELETE FROM download_tokens WHERE expires_at < ? AND claimed_at IS NULL`)
      .run(now).changes;
  }
}

/**
 * Server-side dedup for client-generated event ids.
 *
 * The Tauri SDK replays its disk queue on launch and cannot know which of its
 * queued events the server already accepted, so duplicates are the normal case,
 * not an error case.
 */
export class EventDedupRepo {
  constructor(private readonly db: Database) {}

  /** Returns the subset of ids not seen before, and records them. */
  filterNew(projectId: string, eventIds: readonly string[], now: number): Set<string> {
    if (eventIds.length === 0) return new Set();
    const insert = this.db.query(
      `INSERT OR IGNORE INTO ingested_events (project_id, event_id, seen_at) VALUES (?, ?, ?)`
    );
    const fresh = new Set<string>();
    const tx = this.db.transaction((ids: readonly string[]) => {
      for (const id of ids) {
        if (insert.run(projectId, id, now).changes > 0) fresh.add(id);
      }
    });
    tx(eventIds);
    return fresh;
  }

  /** A replay a month late is a new fact, not a retry. Keep the table small. */
  prune(olderThan: number): number {
    return this.db.query(`DELETE FROM ingested_events WHERE seen_at < ?`).run(olderThan).changes;
  }
}

export interface DownloadHint {
  project_id: string;
  web_visitor_id: string;
  ip_hash: string;
  os: string | null;
  created_at: number;
}

/**
 * Material for estimated matches only.
 *
 * Everything this table produces is an `estimate` edge with confidence below 1.
 * Nothing here may ever reach `person_overrides`. See CLAUDE.md rule 1.
 */
export class DownloadHintRepo {
  constructor(private readonly db: Database) {}

  record(h: DownloadHint): void {
    this.db
      .query(
        `INSERT INTO download_hints (project_id, web_visitor_id, ip_hash, os, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(h.project_id, h.web_visitor_id, h.ip_hash, h.os, h.created_at);
  }

  /** Candidate visitors who downloaded from the same network, same OS, recently. */
  candidates(
    projectId: string,
    ipHash: string,
    os: string | null,
    since: number,
    until: number
  ): DownloadHint[] {
    return this.db
      .query<DownloadHint, [string, string, number, number, string | null, string | null]>(
        `SELECT * FROM download_hints
          WHERE project_id = ?
            AND ip_hash = ?
            AND created_at >= ?
            AND created_at <= ?
            AND (os IS NULL OR ? IS NULL OR os = ?)
          ORDER BY created_at DESC`
      )
      .all(projectId, ipHash, since, until, os, os);
  }

  prune(olderThan: number): number {
    return this.db.query(`DELETE FROM download_hints WHERE created_at < ?`).run(olderThan).changes;
  }
}

export interface Repositories {
  projects: ProjectRepo;
  apiKeys: ApiKeyRepo;
  downloadTokens: DownloadTokenRepo;
  dedup: EventDedupRepo;
  downloadHints: DownloadHintRepo;
}

export function repositories(db: Database): Repositories {
  return {
    projects: new ProjectRepo(db),
    apiKeys: new ApiKeyRepo(db),
    downloadTokens: new DownloadTokenRepo(db),
    dedup: new EventDedupRepo(db),
    downloadHints: new DownloadHintRepo(db),
  };
}

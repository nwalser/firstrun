import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function sqlitePathFromEnv(env: Record<string, string | undefined> = process.env): string {
  return env.SQLITE_PATH ?? "./data/firstrun.sqlite";
}

/**
 * Opens (and creates) the transactional store.
 *
 * WAL because ingest writes tokens and dedup rows while the dashboard reads
 * project names, and a reader blocking a claim would turn a first run into a
 * lost join.
 */
export function openSqlite(path: string = sqlitePathFromEnv()): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

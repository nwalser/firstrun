import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `<repo>/db` -> `<repo>`. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Relative paths resolve against the repo root, not the current working
 * directory.
 *
 * `bun run dev` starts ingest from `apps/ingest` and migrations from the root.
 * With cwd-relative resolution those are two different databases, and the
 * symptom is "no such table: projects" from a process that is looking at a file
 * nobody migrated.
 */
export function sqlitePathFromEnv(env: Record<string, string | undefined> = process.env): string {
  const configured = env.SQLITE_PATH ?? "./data/firstrun.sqlite";
  if (configured === ":memory:" || isAbsolute(configured)) return configured;
  return join(REPO_ROOT, configured);
}

/**
 * Opens (and creates) the transactional store.
 *
 * WAL because ingest writes tokens and dedup rows while other processes read,
 * and a reader blocking a claim would turn a first run into a lost join.
 */
export function openSqlite(path: string = sqlitePathFromEnv()): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

#!/usr/bin/env bun
import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ClickHouseClient, configFromEnv } from "./clickhouse/client.js";
import { openSqlite, sqlitePathFromEnv } from "./sqlite/client.js";

/**
 * Applies both schemas.
 *
 * Every migration is written to be idempotent (`IF NOT EXISTS`, `CREATE OR
 * REPLACE`), so this is safe to run on every boot and there is no ledger table
 * to drift from reality. That holds only while the schema is additive, which
 * for milestone 1 it is. The first destructive migration is the moment to add
 * a ledger.
 */

const here = import.meta.dir;

function sqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
}

/** ClickHouse takes one statement per request. */
export function statements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)*$/.test(s));
}

export async function waitForClickHouse(ch: ClickHouseClient, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ch.ping()) return;
    await Bun.sleep(500);
  }
  throw new Error("ClickHouse did not come up. Is `docker compose up -d` running?");
}

/**
 * Creates the database if it is not there.
 *
 * The compose file makes it on the container's first start, so this only
 * matters on a hand-rolled server or after someone dropped it -- which is
 * exactly when a migration run that silently assumed it existed is most
 * confusing.
 */
export async function ensureDatabase(ch: ClickHouseClient, database: string): Promise<void> {
  try {
    await ch.withDatabase("default").command(`CREATE DATABASE IF NOT EXISTS ${database}`);
  } catch {
    // Not permitted on a locked-down server. The database already existing is
    // the normal case, so this is not worth failing the run over.
  }
}

/** Exported so tests and the ingest boot path can migrate any database. */
export async function applyClickHouseMigrations(
  ch: ClickHouseClient,
  log: (line: string) => void = () => {}
): Promise<void> {
  await ensureDatabase(ch, ch.database);
  const dir = join(here, "clickhouse");
  for (const file of sqlFiles(dir)) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const stmt of statements(sql)) await ch.command(stmt);
    log(`  clickhouse  ${file}`);
  }
}

export function applySqliteMigrations(db: Database, log: (line: string) => void = () => {}): void {
  const dir = join(here, "sqlite");
  for (const file of sqlFiles(dir)) {
    db.exec(readFileSync(join(dir, file), "utf8"));
    log(`  sqlite      ${file}`);
  }
}

async function migrateClickHouse(): Promise<void> {
  const ch = new ClickHouseClient(configFromEnv());
  await waitForClickHouse(ch);
  await applyClickHouseMigrations(ch, console.log);
}

function migrateSqlite(): void {
  const db = openSqlite(sqlitePathFromEnv());
  applySqliteMigrations(db, console.log);
  db.close();
}

if (import.meta.main) {
  console.log("applying migrations");
  migrateSqlite();
  await migrateClickHouse();
  console.log("done");
}

export { migrateClickHouse, migrateSqlite };

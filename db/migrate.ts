#!/usr/bin/env bun
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
function statements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)*$/.test(s));
}

async function waitForClickHouse(ch: ClickHouseClient, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ch.ping()) return;
    await Bun.sleep(500);
  }
  throw new Error("ClickHouse did not come up. Is `docker compose up -d` running?");
}

async function migrateClickHouse(): Promise<void> {
  const config = configFromEnv();
  const ch = new ClickHouseClient(config);
  await waitForClickHouse(ch);

  // The compose file creates the database, but a hand-rolled server might not.
  try {
    await ch.withDatabase("default").command(`CREATE DATABASE IF NOT EXISTS ${config.database}`);
  } catch {
    // Not permitted on a locked-down server; the database already existing is
    // the normal case, so this is not worth failing the run over.
  }

  const dir = join(here, "clickhouse");
  for (const file of sqlFiles(dir)) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const stmt of statements(sql)) await ch.command(stmt);
    console.log(`  clickhouse  ${file}`);
  }
}

function migrateSqlite(): void {
  const path = sqlitePathFromEnv();
  const db = openSqlite(path);
  const dir = join(here, "sqlite");
  for (const file of sqlFiles(dir)) {
    db.exec(readFileSync(join(dir, file), "utf8"));
    console.log(`  sqlite      ${file}`);
  }
  db.close();
}

if (import.meta.main) {
  console.log("applying migrations");
  migrateSqlite();
  await migrateClickHouse();
  console.log("done");
}

export { migrateClickHouse, migrateSqlite, statements };

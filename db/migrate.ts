#!/usr/bin/env bun
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createStore, databaseUrl, type Store } from "./client.js";

/**
 * Applies the Drizzle migrations, then the analytics views.
 *
 * Called by `bun run db:migrate` and again on server boot: a clean clone should
 * be one `docker compose up` and one `bun run dev` away from working, not one
 * of those plus a command you have to know about. Drizzle's ledger makes
 * re-running a no-op.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

export async function waitForPostgres(url: string = databaseUrl(), timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const probe = createStore(url);
    try {
      await probe.query("select 1");
      await probe.close();
      return;
    } catch (err) {
      await probe.close().catch(() => {});
      if (Date.now() > deadline) {
        throw new Error(
          `Postgres did not come up at ${url.replace(/:\/\/[^@]*@/, "://***@")}. Is \`docker compose up -d\` running?`
        );
      }
      await Bun.sleep(500);
    }
  }
}

/**
 * Views that the analytics queries read.
 *
 * Kept out of the Drizzle schema because Drizzle models tables, and a view
 * whose body is the interesting part would end up as an opaque string in a
 * migration either way. Idempotent, so it is applied on every boot and always
 * matches the file rather than whatever shape it had when it was first created.
 */
export async function applyViews(store: Store): Promise<void> {
  await store.query(await Bun.file(join(HERE, "views.sql")).text());
}

export async function applyMigrations(url: string = databaseUrl()): Promise<void> {
  await waitForPostgres(url);
  const store = createStore(url);
  try {
    await migrate(store.db, { migrationsFolder: join(HERE, "migrations") });
    await applyViews(store);
  } finally {
    await store.close();
  }
}

if (import.meta.main) {
  console.log("applying migrations");
  await applyMigrations();
  console.log("done");
}

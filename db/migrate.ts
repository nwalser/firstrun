#!/usr/bin/env bun
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createStore, databaseUrl } from "./client.js";
import { ensurePartitions } from "./partitions.js";
import { migrationsDir } from "./paths.js";

/**
 * Applies the Drizzle migrations, then makes sure `log_entries` has partitions
 * around today.
 *
 * Called by `bun run db:migrate` and again on server boot: a clean clone should
 * be one `docker compose up` and one `bun run dev` away from working, not one
 * of those plus a command you have to know about. Drizzle's ledger makes
 * re-running a no-op, and so does the partition helper.
 *
 * The partition step is not part of the migration file on purpose. A migration
 * runs ONCE; partitions have to exist every month forever. A deployment that has
 * been up since March needs next month's partition without anyone deploying, and
 * a database restored from a year-old dump needs this month's. Both are the same
 * call, and it runs on every boot because a write that arrives for a partition
 * nobody created is the failure this must not have.
 */

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
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export async function applyMigrations(url: string = databaseUrl()): Promise<void> {
  await waitForPostgres(url);
  const store = createStore(url);
  try {
    await migrate(store.db, { migrationsFolder: migrationsDir() });
    await ensurePartitions(store);
  } finally {
    await store.close();
  }
}

if (import.meta.main) {
  console.log("applying migrations");
  await applyMigrations();
  console.log("done");
}

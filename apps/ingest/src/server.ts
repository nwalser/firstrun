import { applyClickHouseMigrations, applySqliteMigrations, openSqlite, sqlitePathFromEnv, waitForClickHouse } from "@firstrun/db";
import { squash } from "@firstrun/identity";
import { createApp } from "./app.js";
import { createContext } from "./context.js";

const ctx = createContext();

/**
 * Migrations run on boot.
 *
 * Every one of them is idempotent, and the alternative is a clean clone where
 * `docker compose up && bun run dev` produces a server that answers requests
 * and then throws "no such table" at the first one. `bun run migrate` still
 * exists for running them without a server.
 */
await waitForClickHouse(ctx.ch);
await applyClickHouseMigrations(ctx.ch);
{
  const db = openSqlite(sqlitePathFromEnv());
  applySqliteMigrations(db);
  db.close();
}

const app = createApp(ctx);

/**
 * The squash job.
 *
 * Correctness never depends on it: queries read `events_resolved`, which
 * applies `person_overrides` on the way past. This only keeps that table small
 * enough for the join to stay cheap.
 */
const SQUASH_INTERVAL_MS = 60_000;
const PRUNE_INTERVAL_MS = 15 * 60_000;

setInterval(() => {
  squash(ctx.identityStore).then(
    (r) => {
      if (r.overridesDrained > 0) {
        console.log(`squash: ${r.overridesDrained} overrides, ${r.eventsRewritten} events`);
      }
    },
    (err) => console.error("squash failed", err)
  );
}, SQUASH_INTERVAL_MS).unref?.();

setInterval(() => {
  const now = ctx.now();
  ctx.repos.downloadTokens.expire(now);
  ctx.repos.downloadHints.prune(now - 60 * 60 * 1000);
  ctx.repos.dedup.prune(now - 30 * 24 * 60 * 60 * 1000);
}, PRUNE_INTERVAL_MS).unref?.();

const server = Bun.serve({
  port: ctx.config.port,
  fetch(req, srv) {
    // Hand the socket address to the app so estimated matching has something to
    // hash when there is no proxy in front of us.
    return app.fetch(req, { ip: srv.requestIP(req)?.address });
  },
});

console.log(`ingest listening on http://localhost:${server.port}`);

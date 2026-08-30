import { applyMigrations, createStore, loadRootEnv, type Store } from "@firstrun/db";
import { configFromEnv, type Ctx } from "@firstrun/ingest";

/**
 * Server-side singletons.
 *
 * The root `.env` is loaded here, at module scope, before anything reads
 * configuration. `bun run dev` starts this app with its cwd set to apps/web, so
 * Bun's own .env loading looks in the wrong directory and every setting quietly
 * falls back to its default.
 *
 * One pool for the process, built on first use. The ingest handler and the
 * dashboard share it because they share a database and, on Railway, a service
 * -- splitting them later is a routing change, not a rewrite.
 */

loadRootEnv();

let store: Store | null = null;
let ctx: Ctx | null = null;
let ready: Promise<void> | null = null;

export function getStore(): Store {
  if (!store) store = createStore();
  return store;
}

export function getCtx(): Ctx {
  if (!ctx) {
    ctx = { config: configFromEnv(), store: getStore(), now: () => Date.now() };
  }
  return ctx;
}

/**
 * Migrations run on boot, once, and everything else waits for them.
 *
 * A clean clone should be one `docker compose up` and one `bun run dev` away
 * from working, not one of those plus a command you have to know about. Every
 * migration is idempotent, so this is a no-op on every boot after the first.
 */
export function ensureReady(): Promise<void> {
  if (!ready) {
    ready = applyMigrations().then(() => {
      startBackgroundJobs();
    });
  }
  return ready;
}

let jobsStarted = false;

/**
 * One prune, and nothing else.
 *
 * There used to be a squash job here, folding merged identities back into the
 * events table. Nothing is merged any more: `distinct_id` is written once, by
 * the client that owns it, and never rewritten. Expired login sessions are the
 * only rows in this database that go stale on their own.
 */
function startBackgroundJobs(): void {
  if (jobsStarted) return;
  jobsStarted = true;

  const c = getCtx();

  setInterval(async () => {
    try {
      const { pruneSessions } = await import("@firstrun/db/repo");
      await pruneSessions(c.store.db);
    } catch (err) {
      console.error("prune failed", (err as Error)?.message);
    }
  }, 15 * 60_000).unref?.();
}

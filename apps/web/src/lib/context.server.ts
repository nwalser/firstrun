import { applyMigrations, createStore, PostgresIdentityStore, type Store } from "@firstrun/db";
import { IdentityResolver, squash } from "@firstrun/identity";
import { configFromEnv, type Ctx } from "@firstrun/ingest";

/**
 * Server-side singletons.
 *
 * One pool and one resolver for the process, built on first use. The ingest
 * handlers and the dashboard share them because they share a database and, on
 * Railway, a service -- splitting them later is a routing change, not a
 * rewrite.
 */

let store: Store | null = null;
let ctx: Ctx | null = null;
let ready: Promise<void> | null = null;

export function getStore(): Store {
  if (!store) store = createStore();
  return store;
}

export function getCtx(): Ctx {
  if (!ctx) {
    const s = getStore();
    const identityStore = new PostgresIdentityStore(s);
    ctx = {
      config: configFromEnv(),
      store: s,
      identityStore,
      resolver: new IdentityResolver(identityStore),
      now: () => Date.now(),
    };
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
 * The squash job, plus the two prunes.
 *
 * Correctness never depends on squash: queries read `events_resolved`, which
 * applies `person_overrides` on the way past. This only keeps that table small
 * enough for the join to stay cheap.
 */
function startBackgroundJobs(): void {
  if (jobsStarted) return;
  jobsStarted = true;

  const c = getCtx();

  setInterval(() => {
    squash(c.identityStore).then(
      (r) => {
        if (r.overridesDrained > 0) {
          console.log(`squash: ${r.overridesDrained} overrides, ${r.eventsRewritten} events`);
        }
      },
      (err) => console.error("squash failed", err?.message ?? err)
    );
  }, 60_000).unref?.();

  setInterval(async () => {
    const now = new Date();
    try {
      const { expireDownloadTokens, pruneDownloadHints, pruneSessions } = await import("@firstrun/db");
      await expireDownloadTokens(c.store.db, now);
      await pruneDownloadHints(c.store.db, new Date(now.getTime() - 60 * 60 * 1000));
      await pruneSessions(c.store.db);
    } catch (err) {
      console.error("prune failed", (err as Error)?.message);
    }
  }, 15 * 60_000).unref?.();
}

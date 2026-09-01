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
 * A prune, and on the hosted service a meter push.
 *
 * There used to be a squash job here, folding merged identities back into the
 * events table. Nothing is merged any more: an identity is written once, by the
 * client that stated it, and never rewritten. Expired login sessions are the
 * only rows in this database that go stale on their own.
 *
 * The meter push reports yesterday and today to Stripe. Both, because the job
 * runs on an interval rather than at a wall-clock hour, so the run that
 * straddles midnight is the one that would otherwise leave a day unsent. Both
 * are safe to repeat: Stripe deduplicates on the event identifier, which is
 * `${workspace}:${day}`.
 *
 * It is a no-op without `FIRSTRUN_CLOUD` and a Stripe key, so a self-hosted
 * install never reaches the network for this or anything else.
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

  // Partitions, kept ahead of the clock.
  //
  // `applyMigrations` creates them on boot, which covers a redeploy but not a
  // container that has been up since March. Partitions are monthly and created
  // two months ahead, so the window is wide; six hours is margin on margin and
  // costs one function call that returns 0.
  //
  // Ensure only, never drop. `dropExpiredPartitions` stays something a person
  // invokes: deleting a customer's data because a retention default was left
  // alone is not a failure mode this gets to have.
  setInterval(async () => {
    try {
      const { ensurePartitions } = await import("@firstrun/db/partitions");
      await ensurePartitions(c.store);
    } catch (err) {
      // A second replica racing this one loses the CREATE and lands here. The
      // partition it wanted exists either way, which is the whole point.
      console.error("partition maintenance failed", (err as Error)?.message);
    }
  }, 6 * 60 * 60_000).unref?.();

  setInterval(async () => {
    try {
      const { stripeConfigured, pushMeter } = await import("./stripe.server.js");
      if (!stripeConfigured()) return;
      const { utcDay } = await import("@firstrun/db/usage");
      const today = utcDay();
      const yesterday = utcDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
      for (const day of new Set([yesterday, today])) await pushMeter(day);
    } catch (err) {
      console.error("meter push failed", (err as Error)?.message);
    }
  }, 60 * 60_000).unref?.();
}

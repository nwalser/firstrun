import {
  ClickHouseClient,
  ClickHouseIdentityStore,
  applyClickHouseMigrations,
  applySqliteMigrations,
  configFromEnv as chConfigFromEnv,
  openSqlite,
  repositories,
  waitForClickHouse,
} from "@firstrun/db";
import { IdentityResolver } from "@firstrun/identity";
import { createApp } from "../../src/app.js";
import { configFromEnv } from "../../src/config.js";
import type { Ctx } from "../../src/context.js";

/**
 * A whole stack on a throwaway ClickHouse database and an in-memory SQLite.
 *
 * The join tests run against the real routes, the real SQL and the real
 * ClickHouse identity store, because the interesting failures are in the
 * seams -- a resolver that is correct in memory and wrong over HTTP is exactly
 * the bug this product cannot afford.
 *
 * Needs `docker compose up -d`. That is already the documented way to run
 * anything here, so these tests do not skip when it is missing: they fail and
 * say why.
 */
export interface TestStack {
  ctx: Ctx;
  app: ReturnType<typeof createApp>;
  ch: ClickHouseClient;
  projectId: string;
  /** Overridable clock so a test can place an event three days in the past. */
  setNow: (fn: () => number) => void;
  drop: () => Promise<void>;
}

export async function createTestStack(): Promise<TestStack> {
  const base = new ClickHouseClient(chConfigFromEnv());
  if (!(await base.ping(2000))) {
    throw new Error(
      "ClickHouse is not reachable. These tests need the real thing: run `docker compose up -d`."
    );
  }
  await waitForClickHouse(base, 30_000);

  const database = `firstrun_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = base.withDatabase("default");
  await admin.command(`CREATE DATABASE ${database}`);

  const ch = new ClickHouseClient({ ...chConfigFromEnv(), database });
  await applyClickHouseMigrations(ch);

  const sqlite = openSqlite(":memory:");
  applySqliteMigrations(sqlite);
  const repos = repositories(sqlite);

  let nowFn: () => number = () => Date.now();
  const now = () => nowFn();

  const identityStore = new ClickHouseIdentityStore(ch);
  const ctx: Ctx = {
    config: { ...configFromEnv(), publicOrigin: "http://test.local", assetOrigin: null },
    ch,
    repos,
    identityStore,
    resolver: new IdentityResolver(identityStore, now),
    now,
  };

  const projectId = crypto.randomUUID();
  repos.projects.create({
    id: projectId,
    name: "Test",
    asset_name: "Themia-Setup",
    created_at: Date.now(),
  });

  return {
    ctx,
    app: createApp(ctx),
    ch,
    projectId,
    setNow: (fn) => {
      nowFn = fn;
    },
    drop: async () => {
      sqlite.close();
      await admin.command(`DROP DATABASE IF EXISTS ${database}`);
    },
  };
}

/** The env binding Bun's server would normally supply. */
export const FROM_IP = { ip: "203.0.113.10" };

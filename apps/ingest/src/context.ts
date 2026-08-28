import { ClickHouseClient, ClickHouseIdentityStore, openSqlite, repositories } from "@firstrun/db";
import type { Repositories } from "@firstrun/db";
import { IdentityResolver } from "@firstrun/identity";
import type { IdentityStore } from "@firstrun/identity";
import type { IngestConfig } from "./config.js";
import { configFromEnv } from "./config.js";

/**
 * Everything a route needs, passed in rather than imported.
 *
 * The point is that `createApp(ctx)` can be handed an in-memory identity store
 * and a temporary database, so the end-to-end join test exercises the real
 * routes rather than a re-implementation of them.
 */
export interface Ctx {
  config: IngestConfig;
  ch: ClickHouseClient;
  repos: Repositories;
  identityStore: IdentityStore;
  resolver: IdentityResolver;
  now: () => number;
}

export function createContext(overrides: Partial<Ctx> = {}): Ctx {
  const config = overrides.config ?? configFromEnv();
  const ch = overrides.ch ?? new ClickHouseClient();
  const repos = overrides.repos ?? repositories(openSqlite());
  const identityStore = overrides.identityStore ?? new ClickHouseIdentityStore(ch);
  const now = overrides.now ?? (() => Date.now());
  const resolver = overrides.resolver ?? new IdentityResolver(identityStore, now);
  return { config, ch, repos, identityStore, resolver, now };
}

import { createStore, PostgresIdentityStore, type Store } from "@firstrun/db";
import { IdentityResolver } from "@firstrun/identity";
import type { IdentityStore } from "@firstrun/identity";
import type { IngestConfig } from "./config.js";
import { configFromEnv } from "./config.js";

/**
 * Everything a handler needs, passed in rather than imported.
 *
 * The point is that the end-to-end tests exercise the real handlers against a
 * real database on a throwaway schema, rather than a re-implementation of them.
 */
export interface Ctx {
  config: IngestConfig;
  store: Store;
  identityStore: IdentityStore;
  resolver: IdentityResolver;
  now: () => number;
}

export function createContext(overrides: Partial<Ctx> = {}): Ctx {
  const config = overrides.config ?? configFromEnv();
  const store = overrides.store ?? createStore();
  const identityStore = overrides.identityStore ?? new PostgresIdentityStore(store);
  const now = overrides.now ?? (() => Date.now());
  const resolver = overrides.resolver ?? new IdentityResolver(identityStore, now);
  return { config, store, identityStore, resolver, now };
}

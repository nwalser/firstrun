import { createStore, type Store } from "@firstrun/db/client";
import type { IngestConfig } from "./config.js";
import { configFromEnv } from "./config.js";

/**
 * Everything a handler needs, passed in rather than imported.
 *
 * The point is that the end-to-end tests exercise the real handlers against a
 * real database on a real project, rather than a re-implementation of them.
 *
 * Note which module the store comes from: `@firstrun/db/client`, not the
 * `@firstrun/db` barrel. The barrel drags in the analytics query layer, and
 * with it `node:fs` and every `.sql` file behind it. Intake has no use for any
 * of that, and event intake should not be able to break because a dashboard
 * query does.
 */
export interface Ctx {
  config: IngestConfig;
  store: Store;
  now: () => number;
}

export function createContext(overrides: Partial<Ctx> = {}): Ctx {
  return {
    config: overrides.config ?? configFromEnv(),
    store: overrides.store ?? createStore(),
    now: overrides.now ?? (() => Date.now()),
  };
}

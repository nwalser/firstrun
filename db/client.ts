import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

/**
 * One pool, one Drizzle instance, shared by the whole process.
 *
 * The driver is `pg` rather than `postgres.js` for a concrete reason: under
 * Bun, postgres.js cannot serialize a `Date` parameter -- it throws on every
 * timestamp -- and hands timestamps back as strings. `pg` handles both
 * correctly and runs identically on Node, which keeps the deployment target
 * open. Verified, not assumed.
 *
 * Created lazily: importing this file must not open a socket, or a test that
 * never touches the database still needs one running.
 */

export function databaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env.DATABASE_URL ?? "postgres://firstrun:firstrun@localhost:5432/firstrun";
}

/**
 * The narrow surface the analytics queries need.
 *
 * They are hand-written SQL, so they want a way to run text with parameters and
 * nothing else. Keeping that an interface rather than a pool means a test can
 * hand them something else.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface Store extends Queryable {
  pool: pg.Pool;
  db: Database;
  close: () => Promise<void>;
}

export function createStore(url: string = databaseUrl()): Store {
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    // Railway closes idle connections; reconnecting quietly beats a dashboard
    // that fails the first time someone opens it after lunch.
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    // Managed Postgres almost always terminates TLS with a certificate the
    // client cannot chain. Verifying it is the caller's decision, via the URL.
    ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });

  // An idle client erroring out must not take the process with it.
  pool.on("error", (err) => console.error("postgres pool error", err.message));

  return {
    pool,
    db: drizzle(pool, { schema }),
    query: async <T>(text: string, params: readonly unknown[] = []) =>
      (await pool.query(text, params as unknown[])).rows as T[],
    close: () => pool.end(),
  };
}

let shared: Store | null = null;

export function store(): Store {
  if (!shared) shared = createStore();
  return shared;
}

export const db = (): Database => store().db;

export { schema };

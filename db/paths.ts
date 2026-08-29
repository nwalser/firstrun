import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the SQL on disk lives.
 *
 * The migrations and the analytics queries are files, not strings, and that is
 * deliberate -- they are the product and should be readable and diffable. The
 * cost is that something has to find them at runtime, and `import.meta.url` is
 * not that something: the production build inlines this module into
 * `dist/server/server.js`, where it resolves to a directory containing neither.
 *
 * So: try the module's own directory first (works unbundled, in tests and in
 * `bun run`), then the places the bundled server is actually started from.
 * `FIRSTRUN_DB_DIR` overrides everything for a layout none of these predict.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  process.env.FIRSTRUN_DB_DIR,
  HERE,
  resolve(process.cwd(), "db"),
  resolve(process.cwd(), "..", "..", "db"),
  resolve(HERE, "..", "..", "..", "db"),
].filter((x): x is string => Boolean(x));

let resolved: string | null = null;

export function dbDir(): string {
  if (resolved) return resolved;
  for (const candidate of CANDIDATES) {
    // views.sql is the cheapest thing to probe for and is always present.
    if (existsSync(join(candidate, "views.sql"))) {
      resolved = candidate;
      return resolved;
    }
  }
  throw new Error(
    `Could not find the db directory (looked in: ${CANDIDATES.join(", ")}). ` +
      "Set FIRSTRUN_DB_DIR to the folder containing views.sql, migrations/ and queries/."
  );
}

export const migrationsDir = (): string => join(dbDir(), "migrations");
export const queriesDir = (): string => join(dbDir(), "queries");
export const viewsFile = (): string => join(dbDir(), "views.sql");

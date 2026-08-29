import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dbDir } from "./paths.js";

/**
 * Loads the repo-root `.env` into `process.env`.
 *
 * Bun reads `.env` from the current working directory, and `bun run dev` starts
 * the web app with its cwd set to `apps/web`. The root `.env` is therefore
 * invisible to the process that needs it, and the symptom is not an error --
 * it is `GITHUB_CLIENT_ID` being quietly undefined and the login page saying
 * OAuth is not configured.
 *
 * Real environment variables always win. On Railway there is no `.env` at all
 * and this does nothing, which is the point: one file that is authoritative in
 * development and irrelevant in production.
 */

let loaded = false;

export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;

  // db/ sits directly under the repo root, and paths.ts already knows how to
  // find it from any working directory or bundle layout.
  let path: string;
  try {
    path = join(dbDir(), "..", ".env");
  } catch {
    return;
  }
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;

    let value = trimmed.slice(eq + 1).trim();
    // Strip one layer of matching quotes, the way every other .env reader does.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

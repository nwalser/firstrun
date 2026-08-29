import { join } from "node:path";
import { readFile } from "node:fs/promises";

/**
 * Serves the built tag from a path a customer can put behind their own CNAME.
 *
 * Read from disk rather than bundled so `bun run build:web-tag` shows up
 * without restarting the server, and so the size budget stays a property of the
 * tag's own build rather than of this one.
 */
const CANDIDATES = [
  join(process.cwd(), "..", "..", "packages", "web-tag", "dist", "tag.js"),
  join(process.cwd(), "packages", "web-tag", "dist", "tag.js"),
];

let cached: string | null = null;

export async function readWebTag(): Promise<string | null> {
  if (cached && process.env.NODE_ENV === "production") return cached;
  for (const path of CANDIDATES) {
    try {
      cached = await readFile(path, "utf8");
      return cached;
    } catch {
      // Try the next candidate; the working directory differs between `vite
      // dev` in apps/web and the built server started from the repo root.
    }
  }
  return null;
}

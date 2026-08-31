import { join } from "node:path";
import { readFile } from "node:fs/promises";

/**
 * Serves the built tag from a path a customer can put behind their own CNAME.
 *
 * Read from disk rather than bundled so `bun run build:web-tag` shows up
 * without restarting the server, and so the size budget stays a property of the
 * tag's own build rather than of this one.
 *
 * One file comes off that build, `tag.js`, and it is the whole of `/t.js` for
 * everybody: the same bytes for every source, with nothing composed per request.
 */
function candidates(file: string): string[] {
  // The working directory differs between `vite dev` in apps/web and the built
  // server started from the repo root, so both are tried in that order.
  return [
    join(process.cwd(), "..", "..", "packages", "web-tag", "dist", file),
    join(process.cwd(), "packages", "web-tag", "dist", file),
  ];
}

const cache = new Map<string, string>();

async function read(file: string): Promise<string | null> {
  const hit = cache.get(file);
  if (hit && process.env.NODE_ENV === "production") return hit;
  for (const path of candidates(file)) {
    try {
      const js = await readFile(path, "utf8");
      cache.set(file, js);
      return js;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function readWebTag(): Promise<string | null> {
  return read("tag.js");
}

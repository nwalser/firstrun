import { join } from "node:path";

const TAG_PATH = join(import.meta.dir, "..", "..", "..", "packages", "web-tag", "dist", "tag.js");

let cached: string | null = null;

/**
 * Reads the built tag off disk.
 *
 * Cached after the first read in production, re-read every time in development
 * so `bun run build:web-tag` shows up without a restart.
 */
export async function readWebTag(): Promise<string | null> {
  if (cached && process.env.NODE_ENV === "production") return cached;
  const file = Bun.file(TAG_PATH);
  if (!(await file.exists())) return null;
  cached = await file.text();
  return cached;
}

#!/usr/bin/env bun
import { createSession, upsertGithubUser } from "./repo.js";
import { createStore } from "./client.js";
import { applyMigrations } from "./migrate.js";
import { eq } from "drizzle-orm";
import { users } from "./schema.js";

/**
 * Mints a session for a local user and prints the cookie.
 *
 * Deliberately a CLI and not a route. An "if NODE_ENV !== production, let
 * anyone in" branch is an auth bypass that ships to production the first time
 * an environment variable is set wrong; a command someone has to run on the
 * machine that owns the database is not reachable over HTTP at all.
 *
 *   bun run dev:login seed
 */

const login = process.argv[2] ?? "seed";

if (process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  console.error(
    "Refusing to mint a session against a non-local DATABASE_URL.\n" +
      "This exists for local development. Sign in with GitHub instead."
  );
  process.exit(1);
}

await applyMigrations();
const store = createStore();

try {
  const existing = await store.db.select().from(users).where(eq(users.login, login)).limit(1);

  const user =
    existing[0] ??
    (await upsertGithubUser(store.db, {
      // Negative ids cannot collide with a real GitHub account.
      githubId: -Math.abs(hash(login)),
      login,
      name: `${login} (local)`,
      email: null,
      avatarUrl: null,
    }));

  const session = await createSession(store.db, user.id);

  console.log(`\n  signed in as ${user.login}\n`);
  console.log("  Paste this into the browser console on http://localhost:3000, then reload:\n");
  console.log(`    document.cookie = "fr_session=${session.token}; path=/"\n`);
  console.log("  Or with curl:\n");
  console.log(`    curl -H 'Cookie: fr_session=${session.token}' http://localhost:3000/\n`);
} finally {
  await store.close();
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h || 1;
}

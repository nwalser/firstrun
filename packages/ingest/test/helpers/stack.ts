import {
  applyMigrations,
  createStore,
  createSource,
  createProject,
  createWorkspace,
  PostgresIdentityStore,
  upsertGithubUser,
  type Store,
} from "@firstrun/db";
import { IdentityResolver } from "@firstrun/identity";
import { configFromEnv, type Ctx } from "../../src/index.js";

/**
 * A real project in a real database, torn down afterwards.
 *
 * Every query in this system is project-scoped, so a project IS the
 * isolation boundary -- there is no need for a throwaway database, and using
 * the real one means the tests exercise the real indexes and the real planner.
 * Deleting the project cascades to everything it owns.
 *
 * Needs `docker compose up -d`. That is already how you run anything here, so
 * these do not skip when it is missing: they fail and say why.
 */
export interface TestStack {
  ctx: Ctx;
  store: Store;
  projectId: string;
  webKey: string;
  appKey: string;
  setNow: (fn: () => number) => void;
  drop: () => Promise<void>;
}

let migrated = false;

export async function createTestStack(): Promise<TestStack> {
  if (!migrated) {
    await applyMigrations();
    migrated = true;
  }

  const store = createStore();
  const suffix = crypto.randomUUID().slice(0, 8);

  const user = await upsertGithubUser(store.db, {
    githubId: -Math.floor(Math.random() * 1_000_000_000),
    login: `test-${suffix}`,
    name: null,
    email: null,
    avatarUrl: null,
  });
  const workspace = await createWorkspace(store.db, `Test WS ${suffix}`, user.id);
  const project = await createProject(store.db, workspace.id, `Test ${suffix}`);
  const web = await createSource(store.db, project.id, "site", "web", null);
  const app = await createSource(store.db, project.id, "app", "desktop", "Themia-Setup");

  let nowFn: () => number = () => Date.now();
  const now = () => nowFn();
  const identityStore = new PostgresIdentityStore(store);

  const ctx: Ctx = {
    config: { ...configFromEnv(), publicOrigin: "http://test.local", assetOrigin: null },
    store,
    identityStore,
    resolver: new IdentityResolver(identityStore, now),
    now,
  };

  return {
    ctx,
    store,
    projectId: project.id,
    webKey: web.ingestKey,
    appKey: app.ingestKey,
    setNow: (fn) => {
      nowFn = fn;
    },
    drop: async () => {
      await store.query(`DELETE FROM workspaces WHERE id = $1`, [workspace.id]);
      await store.query(`DELETE FROM users WHERE id = $1`, [user.id]);
      await store.close();
    },
  };
}

/** The socket address the server would normally supply. */
export const FROM_IP = "203.0.113.10";

export const jsonRequest = (url: string, body: unknown, init: RequestInit = {}) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });

export const beacon = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(body),
  });

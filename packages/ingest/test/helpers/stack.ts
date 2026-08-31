import { createStore, type Store } from "@firstrun/db/client";
import { applyMigrations } from "@firstrun/db/migrate";
import { createProject, createSource, createWorkspace, upsertGithubUser } from "@firstrun/db/repo";
import { configFromEnv, type Ctx } from "../../src/index.js";

/**
 * A real project in a real database, torn down afterwards.
 *
 * Every query in this system is project-scoped, so a project IS the isolation
 * boundary -- there is no need for a throwaway database, and using the real one
 * means the tests exercise the real constraints and the real primary key.
 * Deleting the workspace cascades to everything it owns.
 *
 * Needs `docker compose up -d`. That is already how you run anything here, so
 * these do not skip when it is missing: they fail and say why.
 *
 * Imported from `@firstrun/db/client` and `/repo` rather than the barrel for
 * the same reason the handlers do it: intake does not depend on the analytics
 * query layer, and its tests should not either.
 */
export interface TestStack {
  ctx: Ctx;
  store: Store;
  projectId: string;
  /** Two source keys, and the ids the edge stamps from them. */
  webKey: string;
  appKey: string;
  webSourceId: string;
  appSourceId: string;
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
  const web = await createSource(store.db, project.id, "site");
  const app = await createSource(store.db, project.id, "app");

  let nowFn: () => number = () => Date.now();

  const ctx: Ctx = {
    config: { ...configFromEnv(), publicOrigin: "http://test.local" },
    store,
    now: () => nowFn(),
  };

  return {
    ctx,
    store,
    projectId: project.id,
    webKey: web.ingestKey,
    appKey: app.ingestKey,
    webSourceId: web.id,
    appSourceId: app.id,
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

/**
 * How the browser tag posts: `text/plain` so the request is preflight-free.
 * Nothing on the server branches on the content type, and this is here so the
 * tests send what the tag actually sends.
 */
export const beacon = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(body),
  });

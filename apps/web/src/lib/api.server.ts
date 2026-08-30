import {
  QueryError,
  addMemberByLogin,
  clearWorkspaceLogo,
  createDashboard as createDashboardRecord,
  createProject,
  createSource,
  createWorkspace,
  dashboardById,
  dashboardBySlug,
  defaultDashboard,
  deleteDashboard as deleteDashboardRecord,
  deleteProject,
  deleteSource,
  deleteWorkspace,
  listDashboards,
  listMembers,
  listProjectsWithStats,
  listSources,
  listWorkspaces,
  listWorkspaceSources,
  MAX_LOGO_BYTES,
  projectForUser,
  removeMember,
  saveLayout,
  renameDashboard as renameDashboardRecord,
  duplicateDashboard as duplicateDashboardRecord,
  renameProject as renameProjectRecord,
  renameWorkspace as renameWorkspaceRecord,
  reorderDashboards as reorderDashboardRecords,
  runQueries,
  setMemberRole,
  setWorkspaceLogo,
  sourceLastSeen,
  workspaceForUser,
  type LogQuery as CompilerQuery,
  type QueryRow as CompilerRow,
} from "@firstrun/db";
import { configFromEnv } from "@firstrun/ingest";
import {
  OVERVIEW_COMPARISON,
  OVERVIEW_RANGE,
  defaultBoard,
  overviewRequests,
  resolveComparison,
  resolveRange,
  templateByKey,
  type Comparison,
  type DateRange,
  type ResolvedWindow,
  type Surface,
} from "@firstrun/schema";
import { getRequest } from "@tanstack/solid-start/server";
import {
  boardRequests,
  type Board as BoardValue,
  type BoardRequest,
} from "@firstrun/schema/board";
import {
  LogQuery,
  type BoardSnapshot,
  type DiscoveredAttribute,
  type Discovery,
  type QueryResult,
} from "@firstrun/schema/query";
import type {
  MemberRole,
  ProjectNav,
  ProjectView,
  Result,
  SessionInfo,
  WikiContext,
  WorkspaceView,
} from "./api.js";
import { currentUser, oauthConfig } from "./auth.server.js";
import { ensureReady, getStore } from "./context.server.js";

/**
 * The zod mirror and the compiler's own type, checked against each other.
 *
 * `packages/schema/src/query.ts` cannot import the compiler's types as values
 * (it runs in the browser, and a value import from `@firstrun/db` puts Postgres
 * in the client graph), so the AST is written twice: once as a TypeScript type
 * beside the compiler, once as a zod schema in the contract package. This assignment
 * is the only thing keeping the two honest, and it is a build error the day one
 * of them grows a case the other does not have.
 */
const _mirrorsCompilerAst: (parsed: LogQuery) => CompilerQuery = (parsed) => parsed;
void _mirrorsCompilerAst;

/**
 * The server side of every UI call.
 *
 * Access is resolved here, once, by `workspaceForUser` and `projectForUser`.
 * Nothing below this file re-checks it and nothing above it may skip it: a
 * route that forgets gets `null` and renders a not-found, which is the safe
 * direction to fail in.
 *
 * `requireAdmin` is separate from `requireAccess` on purpose. Reading and
 * changing are different questions, and answering them with the same call is
 * how a read-only member ends up able to POST.
 */

const denied = <T = Record<string, never>>(error: string): Result<T> => ({ ok: false, error });

/**
 * A success carrying nothing.
 *
 * `Result`'s empty case is `{ ok: true } & Record<string, never>`, which no
 * object literal satisfies -- the index signature and the discriminant
 * contradict each other. The cast is an artefact of that type, not of anything
 * happening at runtime, and it lives here once rather than at every return.
 */
const ok = (): Result => ({ ok: true }) as Result;

export async function loadSession(): Promise<SessionInfo> {
  await ensureReady();
  const request = getRequest();
  const user = await currentUser(request);
  const loginConfigured = oauthConfig(request) !== null;

  if (!user) return { user: null, workspaces: [], loginConfigured };

  const workspaces = await listWorkspaces(getStore().db, user.id);
  return {
    user: { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl },
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      role: w.role,
      logoUpdatedAt: w.logoUpdatedAt?.toISOString() ?? null,
    })),
    loginConfigured,
  };
}

/**
 * The wiki's context, and the one read in this file that never denies.
 *
 * Every other read here returns null for a stranger. The wiki is public on
 * purpose -- installation instructions are the thing somebody reads BEFORE they
 * have an account, and putting them behind a login is how a product becomes
 * impossible to evaluate. Signed out, this is simply an empty source list and a
 * public origin.
 */
export async function loadWikiContext(): Promise<WikiContext> {
  await ensureReady();
  const publicOrigin = configFromEnv().publicOrigin;

  const user = await currentUser(getRequest());
  if (!user) return { signedIn: false, sources: [], publicOrigin };

  const db = getStore().db;
  const workspaces = await listWorkspaces(db, user.id);

  const perWorkspace = await Promise.all(
    workspaces.map(async (w) => {
      const rows = await listWorkspaceSources(db, w.id);
      return rows.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        assetName: s.assetName,
        ingestKey: s.ingestKey,
        projectName: s.projectName,
        projectSlug: s.projectSlug,
        workspaceSlug: w.slug,
        workspaceName: w.name,
      }));
    })
  );

  return { signedIn: true, sources: perWorkspace.flat(), publicOrigin };
}

async function requireAccess(workspaceSlug: string) {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return null;
  const workspace = await workspaceForUser(getStore().db, workspaceSlug, user.id);
  if (!workspace) return null;
  return { user, workspace };
}

/** Read access is not enough here. Returns null for a reader, same as for a stranger. */
async function requireAdmin(workspaceSlug: string) {
  const access = await requireAccess(workspaceSlug);
  if (!access || access.workspace.role !== "admin") return null;
  return access;
}

/**
 * `requireAdmin`, plus the project the mutation is about.
 *
 * A convenience over the two calls, not a third kind of check: it still goes
 * through `requireAdmin`, and it keeps "you are not an admin" and "there is no
 * such project" as two different sentences, because they are two different
 * problems for whoever is reading them.
 */
async function adminOnProject(workspaceSlug: string, projectSlug: string, action: string) {
  const access = await requireAdmin(workspaceSlug);
  if (!access) {
    return { ok: false as const, error: `You need admin access to ${action}.` };
  }
  const project = await projectForUser(
    getStore().db,
    workspaceSlug,
    projectSlug,
    access.user.id
  );
  if (!project) return { ok: false as const, error: "No such project." };
  return { ok: true as const, access, project };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function loadWorkspace(slug: string): Promise<WorkspaceView | null> {
  const access = await requireAccess(slug);
  if (!access) return null;

  const db = getStore().db;
  const [projects, members] = await Promise.all([
    listProjectsWithStats(db, access.workspace.id),
    listMembers(db, access.workspace.id),
  ]);

  return {
    workspace: {
      id: access.workspace.id,
      name: access.workspace.name,
      slug: access.workspace.slug,
      role: access.workspace.role,
      logoUpdatedAt: access.workspace.logoUpdatedAt?.toISOString() ?? null,
    },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      sourceCount: p.sourceCount,
      lastEventAt: p.lastEventAt?.toISOString() ?? null,
    })),
    members,
    currentUserId: access.user.id,
  };
}

export async function loadProjectNav(
  workspaceSlug: string,
  projectSlug: string
): Promise<ProjectNav | null> {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return null;

  const store = getStore();
  const project = await projectForUser(store.db, workspaceSlug, projectSlug, user.id);
  if (!project) return null;

  // No snapshot, and no dashboard resolution -- see the note on ProjectNav.
  const [boards, sources, lastSeen] = await Promise.all([
    listDashboards(store.db, project.id),
    listSources(store.db, project.id),
    sourceLastSeen(store.db, project.id),
  ]);

  return {
    workspace: {
      id: project.workspaceId,
      name: project.workspaceName,
      slug: project.workspaceSlug,
      role: project.role,
      logoUpdatedAt: project.workspaceLogoUpdatedAt?.toISOString() ?? null,
    },
    project: { id: project.id, name: project.name, slug: project.slug },
    role: project.role,
    dashboards: boards.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      position: b.position,
    })),
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      assetName: s.assetName,
      ingestKey: s.ingestKey,
      lastSeenAt: lastSeen.get(s.id)?.toISOString() ?? null,
    })),
  };
}

export async function loadProject(
  workspaceSlug: string,
  projectSlug: string,
  dashboardSlug: string | null
): Promise<ProjectView | null> {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return null;

  const store = getStore();
  const project = await projectForUser(store.db, workspaceSlug, projectSlug, user.id);
  if (!project) return null;

  // A slug naming no board falls back to the first one rather than 404ing. A
  // board can be renamed or deleted while somebody has its link open, and the
  // honest answer to a stale tab is the project's first board, not an error.
  const row = await boardRow(project.id, dashboardSlug);
  if (!row) return null;

  const board = row.layout;

  const [boards, sources, lastSeen, discovery, snapshot] = await Promise.all([
    listDashboards(store.db, project.id),
    listSources(store.db, project.id),
    sourceLastSeen(store.db, project.id),
    discoverIn(project.id, board.range),
    measureBoard(project.id, board),
  ]);

  return {
    workspace: {
      id: project.workspaceId,
      name: project.workspaceName,
      slug: project.workspaceSlug,
      role: project.role,
      logoUpdatedAt: project.workspaceLogoUpdatedAt?.toISOString() ?? null,
    },
    project: { id: project.id, name: project.name, slug: project.slug },
    role: project.role,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      assetName: s.assetName,
      ingestKey: s.ingestKey,
      lastSeenAt: lastSeen.get(s.id)?.toISOString() ?? null,
    })),
    dashboards: boards.map((d) => ({
      id: d.id,
      name: d.name,
      slug: d.slug,
      position: d.position,
    })),
    dashboard: { id: row.id, name: row.name, slug: row.slug, position: row.position },
    layout: board,
    snapshot,
    discovery,
    publicOrigin: configFromEnv().publicOrigin,
  };
}

/**
 * The numbers behind the project overview.
 *
 * The snapshot and nothing else. The project's name, its sources and its boards
 * are already on screen from the layout route's nav, so fetching them a second
 * time to draw one page would be a round trip for facts the page is holding.
 *
 * Read access is enough: this reads and changes nothing.
 */
export async function loadProjectOverview(
  workspaceSlug: string,
  projectSlug: string
): Promise<BoardSnapshot | null> {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return null;

  const store = getStore();
  const project = await projectForUser(store.db, workspaceSlug, projectSlug, user.id);
  if (!project) return null;

  return measureRequests(
    project.id,
    overviewRequests(),
    OVERVIEW_RANGE,
    OVERVIEW_COMPARISON,
    new Date()
  );
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

/**
 * The stored board, by slug, or the project's first one.
 *
 * A slug naming no board falls back rather than 404ing: a board can be renamed
 * or deleted while somebody has its link open, and the honest answer to a stale
 * tab is the project's first board. Both lookups are scoped to the project, so
 * a slug belonging to a board somewhere else is a not-found rather than a read.
 *
 * `dashboardBySlug` and `defaultDashboard` return the board already migrated:
 * the repo reads every stored layout through `parseBoard`, which is the same
 * reader this file used to have to reach around when the contract package still
 * described a board as a closed union of card types.
 */
async function boardRow(projectId: string, slug: string | null) {
  const store = getStore();
  const found = slug ? await dashboardBySlug(store.db, projectId, slug) : null;
  return found ?? (await defaultDashboard(store.db, projectId));
}

/**
 * Every answer on a board, from one call.
 *
 * The layout is known before any SQL runs, so the queries are deduplicated up
 * front rather than one per card as each one mounts. `boardRequests` derives
 * the keys, and `runQueries` deduplicates a second time on the COMPILED
 * statement, which catches two queries that differ only in an explicit default
 * somebody wrote out longhand.
 *
 * The comparison window is measured only for the cards that actually ask to be
 * compared: a board with one comparing number card runs one extra query, not a
 * second whole snapshot.
 */
export async function measureBoard(
  projectId: string,
  board: BoardValue,
  now: Date = new Date()
): Promise<BoardSnapshot> {
  return measureRequests(projectId, boardRequests(board), board.range, board.comparison, now);
}

/**
 * The same measurement, over a request list somebody else derived.
 *
 * The project overview is not a board -- nobody arranges it and nobody saves it
 * -- but it asks the same kind of question in the same shape, so it measures
 * through this rather than growing a second path that drifts from this one.
 */
async function measureRequests(
  projectId: string,
  requests: readonly BoardRequest[],
  window: DateRange,
  comparison: Comparison,
  now: Date
): Promise<BoardSnapshot> {
  const range = resolveRange(window, now);
  const compare = resolveComparison(window, comparison, now);

  const comparing = requests.filter((r) => r.compare);
  const measuresCompare = compare !== null && comparing.length > 0;

  const [results, previous] = await Promise.all([
    run(projectId, requests, range),
    measuresCompare ? run(projectId, comparing, compare) : Promise.resolve(null),
  ]);

  return {
    from: range.from,
    to: range.to,
    results,
    compare: measuresCompare ? { from: compare.from, to: compare.to } : null,
    previous,
  };
}

async function run(
  projectId: string,
  requests: readonly BoardRequest[],
  window: ResolvedWindow
): Promise<Record<string, CompilerRow[]>> {
  if (requests.length === 0) return {};
  return runQueries(
    getStore(),
    requests.map((r) => ({ key: r.key, query: r.query })),
    { projectId, from: window.from, to: window.to }
  );
}

/**
 * Save a board.
 *
 * Parsed here rather than trusted: this arrives as a POST body, and a query is
 * the difference between a card asking a question and a card asking the
 * database to do arbitrary work.
 */
export async function persistBoard(
  workspaceSlug: string,
  projectSlug: string,
  dashboardId: string,
  board: BoardValue
): Promise<Result> {
  const found = await adminOnProject(workspaceSlug, projectSlug, "change this dashboard");
  if (!found.ok) return denied(found.error);

  const store = getStore();
  const owned = await dashboardById(store.db, found.project.id, dashboardId);
  if (!owned) return denied("No such dashboard.");

  await saveLayout(store.db, owned.id, board);
  return ok();
}

// ---------------------------------------------------------------------------
// One query, run on its own
// ---------------------------------------------------------------------------

export type QueryOutcome = { ok: true; result: QueryResult } | { ok: false; error: string };

/**
 * The explore screen's own query.
 *
 * Read access is enough: this reads and changes nothing. The AST has already
 * been through `LogQuery` in the server function's validator, and the compiler
 * checks the same bounds again on the way past -- a `QueryError` here is a
 * sentence for the builder to show, not a 500, because the person who caused it
 * is looking at the form that produced it.
 */
export async function runExplore(input: {
  workspace: string;
  project: string;
  query: LogQuery;
  range: DateRange;
}): Promise<QueryOutcome> {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return { ok: false, error: "Not signed in." };

  const store = getStore();
  const project = await projectForUser(store.db, input.workspace, input.project, user.id);
  if (!project) return { ok: false, error: "No such project." };

  const window = resolveRange(input.range);
  try {
    const answers = await runQueries(store, [{ key: "q", query: input.query }], {
      projectId: project.id,
      from: window.from,
      to: window.to,
    });
    return {
      ok: true,
      result: { rows: answers.q ?? [], from: window.from, to: window.to },
    };
  } catch (err) {
    if (err instanceof QueryError) return { ok: false, error: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Attribute discovery
// ---------------------------------------------------------------------------

/**
 * How many entries discovery looks at.
 *
 * A sample, not a census, and bounded so this can never become a full scan of a
 * partition: the most recent entries in the window, read straight off the
 * primary key. Twenty thousand is enough to have seen every key a client sends
 * on almost every entry, and cheap enough to run beside a board's own queries.
 */
const DISCOVERY_SAMPLE = 20_000;

/** How many example values one key offers. Enough to recognise a vocabulary. */
const DISCOVERY_VALUES = 8;

/** How many keys and names come back, so the payload is bounded too. */
const DISCOVERY_KEYS = 200;

interface DiscoveryRow {
  kind: "name" | "type" | "value" | "sampled";
  a: string | null;
  b: string | null;
  n: string | number;
}

/**
 * What a project has actually written, in the visible window.
 *
 * Attributes are discovered rather than declared: there is no registration step
 * and no schema to keep in step with the code. A key nobody has sent is not an
 * error, it is a filter that matches nothing, and the pickers accept a typed
 * key that appears in no list for exactly that reason.
 *
 * One statement, one sample, three answers off it. Splitting them into three
 * queries would read the same rows three times.
 */
export async function discoverIn(projectId: string, range: DateRange): Promise<Discovery> {
  const window = resolveRange(range);
  const rows = await getStore().query<DiscoveryRow>(
    `WITH sample AS (
         SELECT name, attributes
           FROM log_entries
          WHERE project_id = $1::uuid AND time >= $2 AND time < $3
          ORDER BY time DESC
          LIMIT $4
     ),
     pairs AS (
         SELECT kv.key AS key, kv.value AS value
           FROM sample s, LATERAL jsonb_each(s.attributes) kv
     ),
     types AS (
         SELECT key, jsonb_typeof(value) AS t, count(*) AS n FROM pairs GROUP BY 1, 2
     ),
     vals AS (
         SELECT key, left(value #>> '{}', 120) AS v, count(*) AS n
           FROM pairs
          WHERE jsonb_typeof(value) IN ('string', 'number', 'boolean')
          GROUP BY 1, 2
     ),
     ranked AS (
         SELECT key, v, n, row_number() OVER (PARTITION BY key ORDER BY n DESC, v ASC) AS r
           FROM vals
     )
     SELECT 'name'::text AS kind, name AS a, NULL::text AS b, count(*)::bigint AS n
       FROM sample GROUP BY name
     UNION ALL
     SELECT 'type'::text, key, t, n::bigint FROM types
     UNION ALL
     SELECT 'value'::text, key, v, n::bigint FROM ranked WHERE r <= $5
     UNION ALL
     SELECT 'sampled'::text, NULL, NULL, count(*)::bigint FROM sample`,
    [projectId, window.from, window.to, DISCOVERY_SAMPLE, DISCOVERY_VALUES]
  );

  return foldDiscovery(rows);
}

const asCount = (v: string | number): number => Number(v ?? 0);

function foldDiscovery(rows: readonly DiscoveryRow[]): Discovery {
  const attributes = new Map<string, DiscoveredAttribute>();
  const names: Array<{ name: string; entries: number }> = [];
  let sampled = 0;

  const at = (key: string): DiscoveredAttribute => {
    let found = attributes.get(key);
    if (!found) {
      found = { key, types: [], entries: 0, samples: [] };
      attributes.set(key, found);
    }
    return found;
  };

  for (const row of rows) {
    const n = asCount(row.n);
    switch (row.kind) {
      case "sampled":
        sampled = n;
        break;
      case "name":
        if (row.a) names.push({ name: row.a, entries: n });
        break;
      case "type": {
        if (!row.a) break;
        const attr = at(row.a);
        attr.types.push({ type: (row.b ?? "null") as DiscoveredAttribute["types"][number]["type"], count: n });
        attr.entries += n;
        break;
      }
      case "value":
        if (row.a && row.b !== null) at(row.a).samples.push(row.b);
        break;
    }
  }

  for (const attr of attributes.values()) attr.types.sort((a, b) => b.count - a.count);

  return {
    // Most common first: a picker that leads with what this project actually
    // sends is the difference between choosing a key and remembering one.
    attributes: [...attributes.values()]
      .sort((a, b) => b.entries - a.entries || a.key.localeCompare(b.key))
      .slice(0, DISCOVERY_KEYS),
    names: names.sort((a, b) => b.entries - a.entries).slice(0, DISCOVERY_KEYS),
    sampled,
    truncated: sampled >= DISCOVERY_SAMPLE,
  };
}

/** Discovery on its own, for the explore screen's own range picker. */
export async function loadDiscovery(input: {
  workspace: string;
  project: string;
  range: DateRange;
}): Promise<Discovery | null> {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return null;
  const project = await projectForUser(getStore().db, input.workspace, input.project, user.id);
  if (!project) return null;
  return discoverIn(project.id, input.range);
}

// ---------------------------------------------------------------------------
// Writes. Every one of these is admin-only.
// ---------------------------------------------------------------------------

export async function addDashboard(input: {
  workspace: string;
  project: string;
  name: string;
  template?: string;
}): Promise<Result<{ slug: string }>> {
  const found = await adminOnProject(input.workspace, input.project, "add a dashboard");
  if (!found.ok) return denied(found.error);

  const name = input.name.trim().slice(0, 60);
  if (!name) return denied("A dashboard needs a name.");

  const layout = templateByKey(input.template ?? "")?.build() ?? defaultBoard();
  const created = await createDashboardRecord(getStore().db, found.project.id, name, layout);
  return { ok: true, slug: created.slug };
}

export async function renameDashboard(input: {
  workspace: string;
  project: string;
  dashboardId: string;
  name: string;
}): Promise<Result<{ slug: string }>> {
  const found = await adminOnProject(input.workspace, input.project, "rename a dashboard");
  if (!found.ok) return denied(found.error);

  const name = input.name.trim().slice(0, 60);
  if (!name) return denied("A dashboard needs a name.");

  const store = getStore();
  const board = await dashboardById(store.db, found.project.id, input.dashboardId);
  if (!board) return denied("No such dashboard.");

  const updated = await renameDashboardRecord(store.db, board.id, name);
  return { ok: true, slug: updated.slug };
}

/**
 * Copy a board onto the end of the strip.
 *
 * One call rather than create-then-save from the client: that shape reads the
 * source board, creates a blank one and writes the layout into it, and a
 * failure between the last two steps strands an empty board named after the one
 * somebody meant to copy.
 */
export async function duplicateDashboard(input: {
  workspace: string;
  project: string;
  dashboardId: string;
}): Promise<Result<{ slug: string }>> {
  const found = await adminOnProject(input.workspace, input.project, "duplicate a dashboard");
  if (!found.ok) return denied(found.error);

  const copy = await duplicateDashboardRecord(getStore().db, found.project.id, input.dashboardId);
  if (!copy) return denied("No such dashboard.");
  return { ok: true, slug: copy.slug };
}

export async function removeDashboard(input: {
  workspace: string;
  project: string;
  dashboardId: string;
}): Promise<Result> {
  const found = await adminOnProject(input.workspace, input.project, "delete a dashboard");
  if (!found.ok) return denied(found.error);

  const result = await deleteDashboardRecord(
    getStore().db,
    found.project.id,
    input.dashboardId
  );
  return "error" in result ? denied(result.error) : ok();
}

export async function reorderDashboards(input: {
  workspace: string;
  project: string;
  ids: string[];
}): Promise<Result> {
  const found = await adminOnProject(input.workspace, input.project, "reorder dashboards");
  if (!found.ok) return denied(found.error);

  await reorderDashboardRecords(getStore().db, found.project.id, input.ids);
  return ok();
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export async function addWorkspace(name: string): Promise<Result<{ slug: string }>> {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return denied("Not signed in.");
  if (!name) return denied("A workspace needs a name.");
  const created = await createWorkspace(getStore().db, name, user.id);
  return { ok: true, slug: created.slug };
}

export async function renameWorkspace(
  workspaceSlug: string,
  name: string
): Promise<Result<{ slug: string }>> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to rename this workspace.");

  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return denied("A workspace needs a name.");

  const slug = await renameWorkspaceRecord(getStore().db, access.workspace.id, trimmed);
  return { ok: true, slug };
}

export async function removeWorkspace(workspaceSlug: string, confirm: string): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to delete this workspace.");

  // Typed, not clicked. This takes every project, every event and every
  // identity in the workspace with it and there is no undo -- a destructive
  // action confirmed by a click is confirmed by an accident.
  if (confirm.trim() !== access.workspace.name) {
    return denied(`Type the workspace name exactly to delete it: ${access.workspace.name}`);
  }

  await deleteWorkspace(getStore().db, access.workspace.id);
  return ok();
}

/**
 * `data:image/...;base64,...`, decoded and checked here.
 *
 * The browser downscales to 256px before this is called, so the usual payload
 * is tens of kilobytes. The size is re-checked on the DECODED bytes anyway: a
 * client-side limit is a convenience, not a constraint, and base64 is a third
 * larger than what it carries, so checking the string would be checking the
 * wrong number.
 */
const LOGO_DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i;

export async function putWorkspaceLogo(
  workspaceSlug: string,
  dataUrl: string
): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to change the logo.");

  const match = LOGO_DATA_URL.exec(dataUrl.trim());
  if (!match) return denied("That does not look like an image.");

  const mimeType = (match[1] ?? "").toLowerCase();
  // No SVG. An SVG is a document that can carry script, and this one is served
  // back from our own origin -- an uploaded logo would be same-origin
  // JavaScript running against a signed-in session. Raster formats only.
  if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) {
    return denied("Logos must be a PNG, JPEG or WebP.");
  }

  const bytes = Buffer.from(match[2] ?? "", "base64");
  if (bytes.byteLength === 0) return denied("That image could not be read.");
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    return denied(`That image is too large (max ${Math.round(MAX_LOGO_BYTES / 1024)}KB).`);
  }

  const result = await setWorkspaceLogo(
    getStore().db,
    access.workspace.id,
    bytes,
    mimeType
  );
  return "error" in result ? denied(result.error) : ok();
}

export async function dropWorkspaceLogo(workspaceSlug: string): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to change the logo.");
  await clearWorkspaceLogo(getStore().db, access.workspace.id);
  return ok();
}

// ---------------------------------------------------------------------------
// Projects and sources
// ---------------------------------------------------------------------------

export async function addProject(input: {
  workspace: string;
  name: string;
  template?: string;
}): Promise<Result<{ slug: string }>> {
  const access = await requireAdmin(input.workspace);
  if (!access) return denied("You need admin access to add a project.");

  const name = input.name.trim().slice(0, 60);
  if (!name) return denied("A project needs a name.");

  const layout = templateByKey(input.template ?? "")?.build() ?? defaultBoard();
  const created = await createProject(getStore().db, access.workspace.id, name, layout);
  return { ok: true, slug: created.slug };
}

export async function renameProject(input: {
  workspace: string;
  project: string;
  name: string;
}): Promise<Result<{ slug: string }>> {
  const found = await adminOnProject(input.workspace, input.project, "rename this project");
  if (!found.ok) return denied(found.error);

  const name = input.name.trim().slice(0, 60);
  if (!name) return denied("A project needs a name.");

  const slug = await renameProjectRecord(
    getStore().db,
    found.access.workspace.id,
    found.project.id,
    name
  );
  return { ok: true, slug };
}

export async function removeProject(input: {
  workspace: string;
  project: string;
  confirm: string;
}): Promise<Result> {
  const found = await adminOnProject(input.workspace, input.project, "delete this project");
  if (!found.ok) return denied(found.error);

  // Same rule as a workspace, and for the same reason: deleting a project
  // deletes every event ever sent into it, and no client can resend what it
  // has already flushed. Confirmed by typing, because confirmed by a click is
  // confirmed by an accident.
  if (input.confirm.trim() !== found.project.name) {
    return denied(`Type the project name exactly to delete it: ${found.project.name}`);
  }

  await deleteProject(getStore().db, found.project.id);
  return ok();
}

/**
 * Key order is not part of a layout, so a comparison of two of them cannot be
 * a comparison of two JSON strings as they happen to have been built.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((k) => [k, canonical(record[k])])
    );
  }
  return value;
}

const sameLayout = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export async function addSource(input: {
  workspace: string;
  project: string;
  name: string;
  kind: Surface;
  assetName?: string;
  template?: string;
}): Promise<Result<{ sourceId: string; ingestKey: string }>> {
  const found = await adminOnProject(input.workspace, input.project, "add a source");
  if (!found.ok) return denied(found.error);

  const store = getStore();
  const name = input.name.trim().slice(0, 60) || "Untitled";
  const source = await createSource(
    store.db,
    found.project.id,
    name,
    input.kind,
    input.kind === "desktop" ? input.assetName?.trim() || "Setup" : null
  );

  // A board for the new source, named after it -- unless the project already
  // has that exact board. A new project starts life with one of these
  // templates on it, and handing somebody a second copy of the screen they are
  // already looking at is not a feature.
  const template = templateByKey(input.template ?? "");
  if (template) {
    const layout = template.build();
    // The STORED json, not a parsed board: a board somebody has since edited is
    // saved in the current shape and can never equal a freshly built template,
    // which is the right answer. Comparing parsed boards would read every
    // edited board back through a migration and could suppress the new board
    // over a coincidence.
    const existing = await store.query<{ layout: unknown }>(
      `SELECT layout FROM dashboards WHERE project_id = $1::uuid`,
      [found.project.id]
    );
    if (!existing.some((d) => sameLayout(d.layout, layout))) {
      await createDashboardRecord(store.db, found.project.id, name, layout);
    }
  }

  return { ok: true, sourceId: source.id, ingestKey: source.ingestKey };
}

export async function removeSource(
  workspaceSlug: string,
  projectSlug: string,
  sourceId: string
): Promise<Result> {
  const found = await adminOnProject(workspaceSlug, projectSlug, "remove a source");
  if (!found.ok) return denied(found.error);

  await deleteSource(getStore().db, found.project.id, sourceId);
  return ok();
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export async function inviteMember(
  workspaceSlug: string,
  login: string,
  role: MemberRole
): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to add people.");

  const trimmed = login.trim().replace(/^@/, "");
  if (!trimmed) return denied("Enter a GitHub username.");

  const result = await addMemberByLogin(getStore().db, access.workspace.id, trimmed, role);
  return "error" in result ? denied(result.error) : ok();
}

export async function changeMemberRole(
  workspaceSlug: string,
  userId: string,
  role: MemberRole
): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to change roles.");
  const result = await setMemberRole(getStore().db, access.workspace.id, userId, role);
  return "error" in result ? denied(result.error) : ok();
}

export async function kickMember(workspaceSlug: string, userId: string): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to remove people.");
  const result = await removeMember(getStore().db, access.workspace.id, userId);
  return "error" in result ? denied(result.error) : ok();
}

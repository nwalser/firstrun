import {
  QueryError,
  addMemberByLogin,
  feedEntries,
  feedEntry,
  type FeedRow,
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
  entriesPerHour,
  listDashboards,
  listMembers,
  listProjects,
  listProjectsWithStats,
  projectEntryCounts,
  listSources,
  listWorkspaces,
  listWorkspaceSources,
  MAX_LOGO_BYTES,
  clearProjectLogo,
  projectDailyCounts,
  projectForUser,
  removeMember,
  saveLayout,
  sourceDailyCounts,
  renameDashboard as renameDashboardRecord,
  duplicateDashboard as duplicateDashboardRecord,
  renameProject as renameProjectRecord,
  renameWorkspace as renameWorkspaceRecord,
  reorderDashboards as reorderDashboardRecords,
  runQueries,
  setMemberRole,
  setProjectLogo,
  setWorkspaceLogo,
  sourceLastSeen,
  workspaceForUser,
  histogramWindow,
  workspaceSourceLastSeen,
  workspaceUsage,
  type LogQuery as CompilerQuery,
  type QueryRow as CompilerRow,
} from "@firstrun/db";
import { configFromEnv } from "@firstrun/ingest";
import { isPlanId } from "@firstrun/schema/plan";
import { loadBilling } from "./billing.server.js";
import { ATTR } from "@firstrun/schema/conventions";
import {
  SEVERITY_LABELS,
  severityBand,
  type SeverityBand,
} from "@firstrun/schema/severity";
import {
  FEED_PAGE,
  feedWindow,
  severityFloor,
  type FeedEntry,
  type FeedPage,
  type FeedRequest,
} from "@firstrun/schema/feed";
import {
  OVERVIEW_COMPARISON,
  OVERVIEW_RANGE,
  defaultBoard,
  overviewRequests,
  resolveComparison,
  resolveRange,
  scopedToSource,
  sourceIs,
  templateByKey,
  type Comparison,
  type DateRange,
  type ResolvedWindow,
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
  emptyDiscovery,
  type Discovery,
  type Filter,
  type QueryResult,
} from "@firstrun/schema/query";
import type {
  MemberRole,
  UsageSlice,
  ProjectNav,
  ProjectView,
  Result,
  SessionInfo,
  DocsContext,
  SourceDetailView,
  WorkspaceSourcesView,
  WorkspaceUsageView,
  WorkspaceView,
} from "./api.js";
import { currentUser, oauthConfig, publicOrigin } from "./auth.server.js";
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

/**
 * The origin this deployment answers on, read once in the root loader.
 *
 * There for the one job the browser cannot do for itself: writing an ABSOLUTE
 * canonical and `og:url` into the document. A route's `head()` runs outside the
 * component tree and outside the request, so it has no way to ask; the value
 * rides down on the root's loader data and `lib/seo.ts` reads it back off the
 * match list.
 *
 * Deliberately not `req.url`. Behind Railway's edge that is an internal
 * hostname, and a canonical pointing at `web.railway.internal` tells a crawler
 * the real page is somewhere it cannot reach. `publicOrigin` prefers the
 * configured origin and falls back through the forwarding headers, which is the
 * same answer the OAuth callback is built from.
 *
 * No database, so it costs nothing beyond the object it returns.
 */
export function loadPublicOrigin(): string {
  return publicOrigin(getRequest());
}

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
 * The documentation's context, and the one read in this file that never denies.
 *
 * Every other read here returns null for a stranger. The documentation is public on
 * purpose -- installation instructions are the thing somebody reads BEFORE they
 * have an account, and putting them behind a login is how a product becomes
 * impossible to evaluate. Signed out, this is simply an empty source list and a
 * public origin.
 */
export async function loadDocsContext(): Promise<DocsContext> {
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
  // Billing rides along here rather than on each page inside the workspace: the
  // layout route loads this once and every page under it can warn without a
  // second query. Self hosted answers without touching the database at all.
  const [projects, members, billing] = await Promise.all([
    listProjectsWithStats(db, access.workspace.id),
    listMembers(db, access.workspace.id),
    loadBilling(access.workspace),
  ]);

  // After the projects, because it is asked for exactly the ids that came back:
  // a project deleted between the two statements draws no chart rather than a
  // chart the list has no row for.
  const daily = await projectDailyCounts(
    db,
    access.workspace.id,
    projects.map((p) => p.id)
  );

  return {
    workspace: {
      id: access.workspace.id,
      name: access.workspace.name,
      slug: access.workspace.slug,
      role: access.workspace.role,
      logoUpdatedAt: access.workspace.logoUpdatedAt?.toISOString() ?? null,
    },
    projects: projects.map((p) => {
      const series = daily.get(p.id) ?? [];
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        logoUpdatedAt: p.logoUpdatedAt?.toISOString() ?? null,
        sourceCount: p.sourceCount,
        lastEventAt: p.lastEventAt?.toISOString() ?? null,
        daily: series,
        // Derived from the series, not counted again, so the rate and the bars
        // under it are the same measurement.
        perHour: entriesPerHour(series),
      };
    }),
    members,
    currentUserId: access.user.id,
    billing,
  };
}

/**
 * Every source in a workspace, with its last thirty days.
 *
 * Three statements rather than one per project: the sources come back in one
 * list, and the two rollups behind them are each one grouped scan over the same
 * window. A page that drew a chart per row by asking per row would be a round
 * trip per source.
 *
 * The histogram and the last-seen stamp are both on `time` (rule 5), so a
 * desktop app that uploaded a week of queued entries this morning draws them on
 * the days it was actually used and reads as last active then.
 *
 * Read access is enough: this reads and changes nothing.
 */
export async function loadWorkspaceSources(
  slug: string,
  projectSlug: string | null = null
): Promise<WorkspaceSourcesView | null> {
  const access = await requireAccess(slug);
  if (!access) return null;

  const db = getStore().db;
  const all = await listWorkspaceSources(db, access.workspace.id);

  /*
   * One statement for the whole workspace, then narrowed in memory.
   *
   * A project's own list is the same list with a `where` on it, and a workspace
   * has tens of sources, not thousands: a second query shape to filter a list
   * this size would be two things to keep in step for no measurable read. The
   * two ROLLUPS below are still asked for exactly the ids that came back, so
   * the expensive half is already scoped.
   */
  const sources = projectSlug ? all.filter((s) => s.projectSlug === projectSlug) : all;

  // After the sources, and asked for exactly the ids that came back, so a
  // source deleted between the two statements draws no chart rather than a
  // chart with no row.
  const [lastSeen, daily] = await Promise.all([
    workspaceSourceLastSeen(db, access.workspace.id),
    sourceDailyCounts(
      db,
      access.workspace.id,
      sources.map((s) => s.id)
    ),
  ]);

  return {
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      assetName: s.assetName,
      ingestKey: s.ingestKey,
      lastSeenAt: lastSeen.get(s.id)?.toISOString() ?? null,
      perHour: entriesPerHour(daily.get(s.id) ?? []),
      projectId: s.projectId,
      projectName: s.projectName,
      projectSlug: s.projectSlug,
      daily: daily.get(s.id) ?? [],
    })),
  };
}

/** How many of a source's own entries its page shows before "see all". */

/** How many distinct names a source's page lists. */
const SOURCE_NAMES = 8;

/**
 * One entry, by id, for its own page.
 *
 * Scoped by `requireAccess` and by the workspace join inside the lookup, so an
 * id belonging to somebody else's workspace is a not-found rather than a read.
 * Read access is enough.
 */
export async function loadEvent(
  slug: string,
  entryId: string,
  at: string | null
): Promise<FeedEntry | null> {
  const access = await requireAccess(slug);
  if (!access) return null;

  // A hint that is not a date is dropped rather than refused: the fallback
  // still finds the entry, and a broken link should cost a scan, not an error.
  const parsed = at ? new Date(at) : null;
  const hint = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;

  const row = await feedEntry(getStore().db, {
    workspaceId: access.workspace.id,
    entryId,
    at: hint,
  });
  return row ? toWire(row) : null;
}

/**
 * One source, and what it has been sending for the last month.
 *
 * Four questions, asked together because the page asks them together: the
 * shape of its month, the last few entries it wrote, what it calls them, and
 * how bad they were.
 *
 * The last two go through the QUERY COMPILER rather than through SQL written
 * here, filtered on the attribute the edge stamps. That is the point of the
 * query layer: "what does this source send" is a group by on `name` with a
 * filter, which is a question a customer can also build on a card. Nothing on
 * this page reaches a number they could not have asked for themselves.
 */
export async function loadSourceDetail(
  workspaceSlug: string,
  projectSlug: string,
  sourceId: string
): Promise<SourceDetailView | null> {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return null;

  const store = getStore();
  const project = await projectForUser(store.db, workspaceSlug, projectSlug, user.id);
  if (!project) return null;

  // From the project's own list, so a source id belonging to another project is
  // a not-found rather than a read of somebody else's row.
  const sources = await listSources(store.db, project.id);
  const source = sources.find((s) => s.id === sourceId);
  if (!source) return null;

  // The SAME window the histogram buckets, so the bars, the names and the
  // severity mix all describe one thirty days. Read off
  // `histogramWindow` rather than computed here: a second copy of the
  // midnight-UTC rule is a second thing to get wrong, and the page would state
  // a range its own bars did not cover.
  const { from, until: to } = histogramWindow();

  /** Everything this source wrote, as a filter the query layer understands. */
  const written: Filter = sourceIs(source.id);

  const [lastSeen, daily, answers] = await Promise.all([
    sourceLastSeen(store.db, project.id),
    sourceDailyCounts(store.db, project.workspaceId, [source.id]),
    runQueries(
      store,
      [
        {
          key: "names",
          query: {
            filter: written,
            groupBy: [{ kind: "column", column: "name" }],
            aggregations: [{ fn: "count" }],
            orderBy: [{ key: { aggregate: 0 }, direction: "desc" }],
            limit: SOURCE_NAMES,
          },
        },
        {
          key: "severities",
          query: {
            filter: written,
            groupBy: [{ kind: "column", column: "severity" }],
            aggregations: [{ fn: "count" }],
            orderBy: [{ key: { aggregate: 0 }, direction: "desc" }],
            limit: 24,
          },
        },
      ],
      { projectId: project.id, from, to }
    ),
  ]);

  const names = (answers.names ?? [])
    .map((row) => ({ name: row.group[0] ?? "", entries: row.value[0] ?? 0 }))
    .filter((row) => row.name !== "");

  // Folded to bands here rather than grouped as bands in SQL: the ladder is
  // twenty-four numbers and the band is a reading of them, so the compiler
  // returns what is stored and this decides how it reads.
  const bands = new Map<string, number>();
  for (const row of answers.severities ?? []) {
    const raw = row.group[0];
    const band = raw === null || raw === undefined ? null : severityBand(Number(raw));
    const key = band ?? "NONE";
    bands.set(key, (bands.get(key) ?? 0) + (row.value[0] ?? 0));
  }

  return {
    id: source.id,
    name: source.name,
    assetName: source.assetName,
    ingestKey: source.ingestKey,
    projectName: project.name,
    projectSlug: project.slug,
    lastSeenAt: lastSeen.get(source.id)?.toISOString() ?? null,
    daily: daily.get(source.id) ?? [],
    createdAt: source.createdAt.toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    names,
    severities: [...bands.entries()]
      .map(([band, entries]) => ({
        band,
        label: band === "NONE" ? "Unclassified" : SEVERITY_LABELS[band as SeverityBand],
        entries,
      }))
      .sort((a, b) => b.entries - a.entries),
  };
}

/**
 * One row, as the wire carries it.
 *
 * Instants become ISO strings because this crosses a server-function boundary,
 * and it is written once so the list and the single-entry lookup cannot
 * disagree about what an entry is.
 */
function toWire(r: FeedRow): FeedEntry {
  return {
    projectId: r.projectId,
    projectName: r.projectName,
    projectSlug: r.projectSlug,
    entryId: r.entryId,
    time: r.time.toISOString(),
    ingestedAt: r.ingestedAt.toISOString(),
    distinctId: r.distinctId,
    severity: r.severity,
    name: r.name,
    attributes: r.attributes,
  };
}

/**
 * What the log can offer to filter on, at whichever scope it is open.
 *
 * The keys and values a picker lists are DISCOVERED, never declared (rule 2):
 * there is no schema to register and a key nobody has sent yet is not an error,
 * it is a filter that matches nothing. So this reads what the workspace has
 * actually written, narrowed to one project when the log is.
 *
 * Read access is enough.
 */
export async function loadFeedDiscovery(input: {
  workspace: string;
  project?: string | null;
  hours: number;
}): Promise<Discovery | null> {
  const access = await requireAccess(input.workspace);
  if (!access) return null;

  const all = await listProjects(getStore().db, access.workspace.id);
  const scoped = input.project ? all.filter((p) => p.slug === input.project) : all;

  // Whole days, because `DateRange` is a calendar range and the sample only
  // has to cover roughly the window the reader is looking at. A log window of
  // a few hours still discovers against today.
  const days = Math.max(1, Math.ceil(input.hours / 24));
  return discoverAcross(
    scoped.map((p) => p.id),
    { kind: "last", days }
  );
}

/**
 * One page of the log.
 *
 * The scope is resolved here and nowhere else: `requireAccess` says which
 * workspace, and the project slugs the caller sent are resolved against that
 * workspace's own projects before anything reaches SQL. A slug naming a project
 * in somebody else's workspace resolves to nothing and therefore matches
 * nothing, which is the safe direction to fail in.
 *
 * `more` is "the page came back full", not a second COUNT. A Load more button
 * that occasionally appears over an empty page is a better trade than a second
 * query on every page of every log view.
 */
export async function loadFeed(input: {
  workspace: string;
  filter: FeedRequest;
}): Promise<FeedPage | null> {
  const access = await requireAccess(input.workspace);
  if (!access) return null;

  const db = getStore().db;
  // Rolling from now for the log itself, pinned when a card asked for the rows
  // behind its number: see `feedWindow`. Bounded either way, so the read still
  // prunes to the partitions it touches (rule 4).
  const window = feedWindow(input.filter);
  const limit = input.filter.limit ?? FEED_PAGE;
  const empty = {
    entries: [],
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    more: false,
  };

  const wanted = input.filter.projects ?? [];
  let projectIds: string[] = [];
  if (wanted.length > 0) {
    const all = await listProjects(db, access.workspace.id);
    projectIds = all.filter((p) => wanted.includes(p.slug)).map((p) => p.id);
    // Every slug named a project this reader cannot see. An empty answer, not
    // an unfiltered one: dropping the filter would widen the query instead.
    if (projectIds.length === 0) return empty;
  }

  const rows = await feedEntries(db, {
    workspaceId: access.workspace.id,
    from: window.from,
    to: window.to,
    projectIds,
    sourceIds: input.filter.sources ?? [],
    minSeverity: severityFloor(input.filter.severity),
    search: input.filter.search ?? null,
    filter: input.filter.filter ?? null,
    before: input.filter.before
      ? { time: new Date(input.filter.before.time), entryId: input.filter.before.entryId }
      : null,
    limit,
  });

  const entries: FeedEntry[] = rows.map((r) => ({
    projectId: r.projectId,
    projectName: r.projectName,
    projectSlug: r.projectSlug,
    entryId: r.entryId,
    time: r.time.toISOString(),
    ingestedAt: r.ingestedAt.toISOString(),
    distinctId: r.distinctId,
    severity: r.severity,
    name: r.name,
    attributes: r.attributes,
  }));

  return { ...empty, entries, more: entries.length >= limit };
}

/** A day, in the milliseconds every bucket boundary here is counted in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The usage page, in one call.
 *
 * Two statements: the grouping-set roll-up over this window, and a flat count
 * per project over the baseline. Everything else is labelling, which needs the
 * projects and the sources and gets them from tables measured in tens of rows.
 *
 * The day axis is built here rather than inferred from the answer, so a day
 * nothing arrived on is a zero bar instead of a missing one. A window with a
 * hole in it reads as a shorter window.
 *
 * Read access is enough: this reads and changes nothing.
 */
export async function loadWorkspaceUsage(
  slug: string,
  days: number,
  projectSlug: string | null
): Promise<WorkspaceUsageView | null> {
  const access = await requireAccess(slug);
  if (!access) return null;

  const db = getStore().db;
  const range: DateRange = { kind: "last", days: Math.min(365, Math.max(1, Math.trunc(days))) };
  const now = new Date();
  const window = resolveRange(range, now);
  // Always "the window before this one", because usage is read as "more or less
  // than last time" and the same length is the only baseline that answers it.
  const baseline = resolveComparison(range, { kind: "previous" }, now) ?? window;

  const [allProjects, allSources] = await Promise.all([
    listProjects(db, access.workspace.id),
    listWorkspaceSources(db, access.workspace.id),
  ]);

  // A slug naming no project the reader can see narrows to nothing rather than
  // widening back out to the whole workspace.
  const chosen = projectSlug ? allProjects.filter((p) => p.slug === projectSlug) : [];
  const ids = chosen.map((p) => p.id);
  if (projectSlug && ids.length === 0) {
    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      compare: { from: baseline.from.toISOString(), to: baseline.to.toISOString() },
      days: [],
      total: 0,
      previousTotal: 0,
      byProject: [],
      bySource: [],
      bySeverity: [],
    };
  }

  const [usage, previous] = await Promise.all([
    workspaceUsage(db, access.workspace.id, window.from, window.to, ids),
    projectEntryCounts(db, access.workspace.id, baseline.from, baseline.to, ids),
  ]);

  const buckets = Math.max(1, Math.round((window.to.getTime() - window.from.getTime()) / DAY_MS));
  const axis = Array.from({ length: buckets }, (_, i) =>
    new Date(window.from.getTime() + i * DAY_MS).toISOString()
  );
  const indexOf = (day: Date) => Math.floor((day.getTime() - window.from.getTime()) / DAY_MS);

  /**
   * Fold one dimension's day rows into one row per value.
   *
   * `label` decides both the name and the identity: two severity NUMBERS in one
   * band are one row, which is the whole reason a band is what people filter
   * on. `null` from the query means the dimension is absent on those entries,
   * and the caller names that absence rather than the query pretending to.
   */
  const fold = (
    slices: readonly { key: string | null; day: Date; entries: number }[],
    describe: (key: string | null) => { key: string; label: string; projectSlug?: string | null }
  ): UsageSlice[] => {
    const out = new Map<string, UsageSlice>();
    for (const slice of slices) {
      const described = describe(slice.key);
      let row = out.get(described.key);
      if (!row) {
        row = {
          key: described.key,
          label: described.label,
          projectSlug: described.projectSlug ?? null,
          entries: 0,
          previous: null,
          daily: new Array<number>(buckets).fill(0),
        };
        out.set(described.key, row);
      }
      row.entries += slice.entries;
      const at = indexOf(slice.day);
      if (at >= 0 && at < buckets) row.daily[at] = (row.daily[at] ?? 0) + slice.entries;
    }
    return [...out.values()].sort((a, b) => b.entries - a.entries || a.label.localeCompare(b.label));
  };

  const projectById = new Map(allProjects.map((p) => [p.id, p]));
  const sourceById = new Map(allSources.map((s) => [s.id, s]));

  const byProject = fold(usage.byProject, (key) => {
    const project = key ? projectById.get(key) : undefined;
    return project
      ? { key: project.id, label: project.name, projectSlug: project.slug }
      : { key: "unknown", label: "Deleted project", projectSlug: null };
  });

  // The baseline is per project, so it is grafted on here and nowhere else.
  for (const row of byProject) row.previous = previous.get(row.key) ?? 0;

  const bySource = fold(usage.bySource, (key) => {
    const source = key ? sourceById.get(key) : undefined;
    if (source) return { key: source.id, label: `${source.projectName} / ${source.name}` };
    // Entries written before the edge stamped a source, and entries whose
    // source has since been deleted. One row, because both answer "we cannot
    // tell you which of your sources this was".
    return { key: "unattributed", label: "Unattributed" };
  });

  const bySeverity = fold(usage.bySeverity, (key) => {
    if (key === null) return { key: "none", label: "Unclassified" };
    const band = severityBand(Number(key));
    return { key: band, label: SEVERITY_LABELS[band] };
  });

  return {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    compare: { from: baseline.from.toISOString(), to: baseline.to.toISOString() },
    days: axis,
    total: byProject.reduce((sum, row) => sum + row.entries, 0),
    previousTotal: [...previous.values()].reduce((sum, n) => sum + n, 0),
    byProject,
    bySource,
    bySeverity,
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
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      logoUpdatedAt: project.logoUpdatedAt?.toISOString() ?? null,
    },
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
  //
  // No board at all is not an error either: it is a project nobody has made one
  // in yet. The three board-shaped fields go null together and the route that
  // wanted a board sends the reader to the quickstart. Nothing is measured,
  // because there is nothing arranged to measure.
  const row = await boardRow(project.id, dashboardSlug);
  const board = row?.layout ?? null;

  const [boards, sources, lastSeen, discovery, snapshot] = await Promise.all([
    listDashboards(store.db, project.id),
    listSources(store.db, project.id),
    sourceLastSeen(store.db, project.id),
    board ? discoverIn(project.id, board.range) : Promise.resolve(emptyDiscovery()),
    board ? measureBoard(project.id, board) : Promise.resolve(null),
  ]);

  return {
    workspace: {
      id: project.workspaceId,
      name: project.workspaceName,
      slug: project.workspaceSlug,
      role: project.role,
      logoUpdatedAt: project.workspaceLogoUpdatedAt?.toISOString() ?? null,
    },
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      logoUpdatedAt: project.logoUpdatedAt?.toISOString() ?? null,
    },
    role: project.role,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
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
    dashboard: row ? { id: row.id, name: row.name, slug: row.slug, position: row.position } : null,
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
 * The stored board, by slug, or the project's first one, or null.
 *
 * A slug naming no board falls back rather than 404ing: a board can be renamed
 * or deleted while somebody has its link open, and the honest answer to a stale
 * tab is the project's first board. Both lookups are scoped to the project, so
 * a slug belonging to a board somewhere else is a not-found rather than a read.
 *
 * NULL when the project has no boards at all, which is what every project is
 * until somebody makes one. This used to be impossible because the fallback
 * CREATED a board; now the caller says what an empty project looks like, and
 * the route sends the reader to the quickstart.
 *
 * `dashboardBySlug` and `defaultDashboard` return the board already parsed:
 * the repo reads every stored layout through `parseBoard`, so nothing in this
 * file handles raw stored JSON.
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
  return discoverAcross([projectId], range);
}

/**
 * The same sample, over several projects.
 *
 * The log is workspace-wide, so its pickers have to be: a filter on
 * `url.path` is useless if the only keys on offer came from one project. The
 * scope is a list of ids the caller has already checked access on, which is
 * also what keeps this one query rather than one per project.
 *
 * Still a SAMPLE and still bounded by `DISCOVERY_SAMPLE`, for the reason on
 * that constant: opening a picker must never become the most expensive thing
 * on the page. Over several projects the cap is shared, so the busiest project
 * contributes most of it -- which is the right bias for a list whose job is
 * "what does this workspace actually write".
 */
export async function discoverAcross(
  projectIds: readonly string[],
  range: DateRange
): Promise<Discovery> {
  if (projectIds.length === 0) return emptyDiscovery();
  const window = resolveRange(range);
  const rows = await getStore().query<DiscoveryRow>(
    `WITH sample AS (
         SELECT name, attributes
           FROM log_entries
          WHERE project_id = ANY($1::uuid[]) AND time >= $2 AND time < $3
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
    [[...projectIds], window.from, window.to, DISCOVERY_SAMPLE, DISCOVERY_VALUES]
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

/**
 * A board: a name, a starting arrangement, and optionally one source it is
 * about.
 *
 * `sourceId` becomes the board's PERMANENT filter, which is the difference
 * between a board called *Marketing site* and a board you re-filter on every
 * visit. It is checked against the project's own sources rather than trusted,
 * so an id from another project narrows nothing instead of naming a row the
 * caller cannot see.
 */
export async function addDashboard(input: {
  workspace: string;
  project: string;
  name: string;
  template?: string;
  sourceId?: string;
}): Promise<Result<{ slug: string }>> {
  const found = await adminOnProject(input.workspace, input.project, "add a dashboard");
  if (!found.ok) return denied(found.error);

  const name = input.name.trim().slice(0, 60);
  if (!name) return denied("A dashboard needs a name.");

  const store = getStore();
  const built = templateByKey(input.template ?? "")?.build() ?? defaultBoard();

  let layout = built;
  if (input.sourceId) {
    const sources = await listSources(store.db, found.project.id);
    if (!sources.some((s) => s.id === input.sourceId)) return denied("No such source.");
    layout = scopedToSource(built, input.sourceId);
  }

  const created = await createDashboardRecord(store.db, found.project.id, name, layout);
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

/**
 * Sends an admin to Stripe Checkout for one tier.
 *
 * Admin only, re-checked here: the UI hides the button from a reader, and
 * hiding a button is a courtesy rather than a permission check.
 *
 * The plan is validated against the closed set rather than passed through. It
 * chooses a price id, and a price id is money.
 *
 * Returns a URL for the caller to navigate to. Stripe Checkout is a hosted page
 * on Stripe's own origin, which is the point: no card number, no billing
 * address and no tax id ever reaches this codebase.
 */
export async function startCheckout(
  workspaceSlug: string,
  plan: string
): Promise<Result<{ url: string }>> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return { ok: false, error: "You need admin access to change the plan." };

  const { stripeConfigured, checkoutUrl } = await import("./stripe.server.js");
  if (!stripeConfigured()) return { ok: false, error: "Billing is not enabled here." };
  if (!isPlanId(plan) || plan === "free") return { ok: false, error: "No such plan." };

  try {
    const url = await checkoutUrl(
      {
        id: access.workspace.id,
        name: access.workspace.name,
        slug: access.workspace.slug,
        stripeCustomerId: access.workspace.stripeCustomerId,
      },
      plan,
      configFromEnv().publicOrigin
    );
    return { ok: true, url };
  } catch (err) {
    console.error("checkout failed", (err as Error)?.message);
    return { ok: false, error: "Could not reach Stripe. Try again in a moment." };
  }
}

/** The Billing Portal: card, plan changes, cancellation and invoices, all on Stripe. */
export async function openBillingPortal(
  workspaceSlug: string
): Promise<Result<{ url: string }>> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return { ok: false, error: "You need admin access to change the plan." };

  const { stripeConfigured, portalUrl } = await import("./stripe.server.js");
  if (!stripeConfigured()) return { ok: false, error: "Billing is not enabled here." };

  try {
    const url = await portalUrl(
      {
        id: access.workspace.id,
        name: access.workspace.name,
        slug: access.workspace.slug,
        stripeCustomerId: access.workspace.stripeCustomerId,
      },
      configFromEnv().publicOrigin
    );
    return { ok: true, url };
  } catch (err) {
    console.error("portal failed", (err as Error)?.message);
    return { ok: false, error: "Could not reach Stripe. Try again in a moment." };
  }
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

/**
 * The decode and the two checks, shared by both logos.
 *
 * One function so a project image can never end up with looser rules than a
 * workspace image: the SVG refusal in particular is a security decision, and
 * the way it stops holding is somebody adding a second upload path that forgot
 * about it.
 */
function decodeLogo(dataUrl: string): { bytes: Buffer; mimeType: string } | { error: string } {
  const match = LOGO_DATA_URL.exec(dataUrl.trim());
  if (!match) return { error: "That does not look like an image." };

  const mimeType = (match[1] ?? "").toLowerCase();
  // No SVG. An SVG is a document that can carry script, and this one is served
  // back from our own origin -- an uploaded logo would be same-origin
  // JavaScript running against a signed-in session. Raster formats only.
  if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) {
    return { error: "Logos must be a PNG, JPEG or WebP." };
  }

  const bytes = Buffer.from(match[2] ?? "", "base64");
  if (bytes.byteLength === 0) return { error: "That image could not be read." };
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    return { error: `That image is too large (max ${Math.round(MAX_LOGO_BYTES / 1024)}KB).` };
  }
  return { bytes, mimeType };
}

export async function putWorkspaceLogo(
  workspaceSlug: string,
  dataUrl: string
): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to change the logo.");

  const image = decodeLogo(dataUrl);
  if ("error" in image) return denied(image.error);

  const result = await setWorkspaceLogo(
    getStore().db,
    access.workspace.id,
    image.bytes,
    image.mimeType
  );
  return "error" in result ? denied(result.error) : ok();
}

export async function dropWorkspaceLogo(workspaceSlug: string): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to change the logo.");
  await clearWorkspaceLogo(getStore().db, access.workspace.id);
  return ok();
}

/**
 * A project's picture, changed by an admin of the workspace it is in.
 *
 * `adminOnProject` rather than `requireAdmin` alone: membership is per
 * workspace, so the role answers "may this person change things here" and the
 * project lookup answers "is this project actually in that workspace". Skipping
 * the second is how a slug from another workspace gets written by someone who
 * is an admin of neither.
 */
export async function putProjectLogo(
  workspaceSlug: string,
  projectSlug: string,
  dataUrl: string
): Promise<Result> {
  const found = await adminOnProject(workspaceSlug, projectSlug, "change the logo");
  if (!found.ok) return denied(found.error);

  const image = decodeLogo(dataUrl);
  if ("error" in image) return denied(image.error);

  const result = await setProjectLogo(
    getStore().db,
    found.project.id,
    image.bytes,
    image.mimeType
  );
  return "error" in result ? denied(result.error) : ok();
}

export async function dropProjectLogo(
  workspaceSlug: string,
  projectSlug: string
): Promise<Result> {
  const found = await adminOnProject(workspaceSlug, projectSlug, "change the logo");
  if (!found.ok) return denied(found.error);
  await clearProjectLogo(getStore().db, found.project.id);
  return ok();
}

// ---------------------------------------------------------------------------
// Projects and sources
// ---------------------------------------------------------------------------

/**
 * A project: a name, and nothing else made on anybody's behalf.
 *
 * No source, no board. Both used to be created here -- a source because the
 * create form asked for one, a board because `createProject` built one from a
 * template -- and both were things the reader then had to evaluate rather than
 * things they had chosen. What they get instead is an empty project whose own
 * page lists what is left to do and links to the page that does each part.
 */
export async function addProject(input: {
  workspace: string;
  name: string;
}): Promise<Result<{ slug: string }>> {
  const access = await requireAdmin(input.workspace);
  if (!access) return denied("You need admin access to add a project.");

  const name = input.name.trim().slice(0, 60);
  if (!name) return denied("A project needs a name.");

  const created = await createProject(getStore().db, access.workspace.id, name);
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
 * A source, and only a source.
 *
 * It used to create a board from a template at the same time, deduplicating
 * against the boards the project already had so it did not hand somebody a
 * second copy of the screen they were looking at. That whole mechanism is gone
 * with the autogeneration it existed to make tolerable: a board is made on the
 * page that makes boards, where it can be named, given a template AND scoped to
 * a source. One page per thing, each in full, none of it duplicated.
 */
export async function addSource(input: {
  workspace: string;
  project: string;
  name: string;
  assetName?: string;
}): Promise<Result<{ sourceId: string; ingestKey: string }>> {
  const found = await adminOnProject(input.workspace, input.project, "add a source");
  if (!found.ok) return denied(found.error);

  const name = input.name.trim().slice(0, 60) || "Untitled";
  // The asset name is whatever the customer typed, or nothing. It used to be
  // forced to "Setup" for a desktop source and forced to null for every other
  // kind; there are no kinds, so it is simply an optional field again.
  const source = await createSource(
    getStore().db,
    found.project.id,
    name,
    input.assetName?.trim() || null
  );

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

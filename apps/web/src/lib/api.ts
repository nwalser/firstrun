import { DateRange } from "@firstrun/schema";
import { FeedRequest, type FeedEntry, type FeedPage } from "@firstrun/schema/feed";
import { createServerFn } from "@tanstack/solid-start";
import { Board, type Board as BoardValue } from "@firstrun/schema/board";
import {
  LogQuery,
  type BoardSnapshot,
  type Discovery,
  type QueryResult,
} from "@firstrun/schema/query";

/**
 * Everything the UI asks the server for.
 *
 * Each handler pulls its implementation in with a dynamic import so the
 * server-only modules -- the pool, the session cookie, the SQL -- never enter
 * the client graph. Start strips handler bodies from the browser bundle, but a
 * top-level import of a `.server` module would still be traced.
 *
 * Every mutation re-checks the caller's role on the server. The UI hides what a
 * reader cannot do, but hiding a button is a courtesy, not a permission check.
 *
 * Every POST body that carries structure is PARSED in the validator rather than
 * trusted. A board carries saved queries and a query is compiled into SQL, so
 * the difference between parsing here and casting here is the difference
 * between a query layer and an open database.
 */

export type MemberRole = "admin" | "read";

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: MemberRole;
  /** When the logo last changed, so its URL can be cache-busted. Null: no logo. */
  logoUpdatedAt: string | null;
}

export interface SessionInfo {
  user: SessionUser | null;
  workspaces: WorkspaceSummary[];
  /** False when GitHub OAuth is not configured, so /login can say so. */
  loginConfigured: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  /**
   * When the project's picture last changed, so its URL can be cache-busted.
   * Null means no picture, and the initials are drawn instead.
   */
  logoUpdatedAt: string | null;
}

/**
 * A project as the workspace index lists it.
 *
 * "Is this thing actually receiving anything" is the question that page opens
 * to answer, and the shape of the last month plus a rate is how it answers it.
 *
 * `sourceCount` and `lastEventAt` are no longer DRAWN on the row. They stay
 * because the filter chips are built on them, and a chip is worth more than the
 * caption it replaced: "Sources: Connected" plus "Activity: Nothing yet" asks
 * for the interesting failure, which is a question no amount of reading rows
 * answers.
 */
export interface ProjectListItem extends ProjectSummary {
  sourceCount: number;
  /** On `time`, not `ingested_at`. Null when nothing has ever arrived. */
  lastEventAt: string | null;
  /**
   * Entries per day for the last thirty days, oldest first, zero-filled.
   *
   * Thirty numbers rather than thirty labelled points: the row draws one bar per
   * day with no axis, so a date per bar would be thirty strings nothing reads.
   * Bucketed in UTC, on `time` -- see `projectDailyCounts`.
   */
  daily: number[];
  /**
   * The same window read as a rate, entries per hour.
   *
   * Computed server-side from `daily` over the hours that have actually elapsed,
   * so it never disagrees with the bars beside it and the client does no date
   * arithmetic that SSR and hydration could answer differently.
   */
  perHour: number;
}

export interface MemberSummary {
  userId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  role: MemberRole;
}

export interface WorkspaceView {
  workspace: WorkspaceSummary;
  projects: ProjectListItem[];
  members: MemberSummary[];
  currentUserId: string;
}

export interface SourceSummary {
  id: string;
  name: string;
  assetName: string | null;
  ingestKey: string;
  /** On `time`, not `ingested_at`: last active, not last heard from. */
  lastSeenAt: string | null;
}

/**
 * A source as the workspace-wide list draws it.
 *
 * The project travels with it, because at workspace scope "which product is
 * this reporting into" is the first thing a reader needs and the second is the
 * shape of its last month. Nowhere else pays for the histogram.
 */
export interface WorkspaceSourceSummary extends SourceSummary {
  projectId: string;
  projectName: string;
  projectSlug: string;
  /**
   * Events per day for the last thirty days, oldest first, zero-filled.
   *
   * The same window, the same units and the same chart as the project rows on
   * the workspace overview: two lists whose bars mean different things is a
   * comparison somebody will make anyway and get wrong.
   */
  daily: number[];
  /**
   * The same window read as a rate, events per hour.
   *
   * Computed server-side from `daily` by the same `entriesPerHour` a project
   * row uses, so a source's figure and its project's are the same measurement
   * over the same hours and can honestly be read against each other.
   */
  perHour: number;
}

/**
 * One source, and everything its own page says about it.
 *
 * A source has a page because it is the thing a customer installs, and
 * "installed it last Tuesday, is it working" is a question about ONE source
 * that no list answers: a list says when it was last seen, and this says what
 * it has been sending, at what severities, and what the last few actually
 * looked like.
 */
export interface SourceDetailView {
  id: string;
  name: string;
  assetName: string | null;
  ingestKey: string;
  projectName: string;
  projectSlug: string;
  /** On `time`, not `ingested_at`: last active, not last heard from. */
  lastSeenAt: string | null;
  /** Entries per day for the last thirty days, oldest first, zero-filled. */
  daily: number[];
  /** When the source row was created, which is not when it first reported. */
  createdAt: string;
  /** The window `names`, `severities` and `daily` were all measured over. */
  from: string;
  to: string;
  /** What it sends, most first. Straight out of the query layer. */
  names: Array<{ name: string; entries: number }>;
  /** The severity mix, folded to bands: how much of the volume is noise. */
  severities: Array<{ band: string; label: string; entries: number }>;
  /** The last few entries from this source, newest first. */
  recent: FeedEntry[];
}

export interface WorkspaceSourcesView {
  sources: WorkspaceSourceSummary[];
}

/**
 * One row of a usage breakdown: a project, a source, or a severity band.
 *
 * The same shape whichever dimension is being read, because the page draws them
 * with one table and one chart. A dimension is a way of slicing one number, not
 * three different pages.
 */
export interface UsageSlice {
  /** Stable across renders and unique within its dimension. */
  key: string;
  label: string;
  /** Set only on a project slice, so a row can lead into the project. */
  projectSlug: string | null;
  entries: number;
  /**
   * The same slice over the comparison window, or null where there is nothing
   * to compare against.
   *
   * Only projects carry one. A delta needs a baseline measured the same way,
   * and reading the previous window three ways as well would double the cost of
   * the page to put a percentage on a row nobody is billed for.
   */
  previous: number | null;
  /** Entries per day of the window, oldest first, zero-filled. */
  daily: number[];
}

/**
 * What a workspace has ingested, and where it came from.
 *
 * Usage here is ENTRIES. One row in the table is one unit, whatever it is
 * called and whatever severity it carries: an exception, a page view and a
 * measurement cost the same, because they are the same row (rule 1). There is
 * no plan and no quota in this product, so the page reports volume and its
 * shape rather than a bill.
 */
export interface WorkspaceUsageView {
  from: string;
  to: string;
  compare: { from: string; to: string };
  /** Midnight UTC of each bucket, oldest first. One per bar. */
  days: string[];
  total: number;
  previousTotal: number;
  byProject: UsageSlice[];
  bySource: UsageSlice[];
  bySeverity: UsageSlice[];
}

export interface DashboardSummary {
  id: string;
  name: string;
  slug: string;
  position: number;
}

/**
 * Everything that stays put while you move around inside one project.
 *
 * No board and no numbers: this is the sidebar, the tab strip and the source
 * list, and it is loaded by the project layout route. Putting a snapshot in it
 * would make every settings page pay for SQL it never draws.
 */
export interface ProjectNav {
  workspace: WorkspaceSummary;
  project: ProjectSummary;
  role: MemberRole;
  dashboards: DashboardSummary[];
  sources: SourceSummary[];
}

/**
 * One board, and every answer on it.
 *
 * The whole board arrives in one call: its saved queries are known before any
 * SQL runs, so they are deduplicated up front rather than one request per card.
 */
export interface ProjectView {
  workspace: WorkspaceSummary;
  project: ProjectSummary;
  role: MemberRole;
  sources: SourceSummary[];
  dashboards: DashboardSummary[];
  dashboard: DashboardSummary;
  /** The board itself: an arrangement of saved queries. */
  layout: BoardValue;
  snapshot: BoardSnapshot;
  /** What this project has actually written, so the pickers offer real options. */
  discovery: Discovery;
  /** Absolute origin the tag and SDK should talk to. */
  publicOrigin: string;
}

export interface DocsSource {
  id: string;
  name: string;
  assetName: string | null;
  ingestKey: string;
  projectName: string;
  projectSlug: string;
  workspaceSlug: string;
  workspaceName: string;
}

export interface DocsContext {
  signedIn: boolean;
  sources: DocsSource[];
  publicOrigin: string;
}

export type Result<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionInfo> => {
    const { loadSession } = await import("./api.server.js");
    return loadSession();
  }
);

export const getDocsContext = createServerFn({ method: "GET" }).handler(
  async (): Promise<DocsContext> => {
    const { loadDocsContext } = await import("./api.server.js");
    return loadDocsContext();
  }
);

export const getWorkspace = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(async ({ data }): Promise<WorkspaceView | null> => {
    const { loadWorkspace } = await import("./api.server.js");
    return loadWorkspace(data);
  });

export const getProjectNav = createServerFn({ method: "GET" })
  .validator((input: { workspace: string; project: string }) => input)
  .handler(async ({ data }): Promise<ProjectNav | null> => {
    const { loadProjectNav } = await import("./api.server.js");
    return loadProjectNav(data.workspace, data.project);
  });

/**
 * The overview's numbers, on their own.
 *
 * A snapshot rather than a view: everything else the page draws (the project,
 * its sources, its boards) is already loaded by the project layout route, and
 * the answers are keyed by `queryKey`, so the page looks each one up by
 * deriving the same key from the same query rather than being handed a name.
 */
export const getProjectOverview = createServerFn({ method: "GET" })
  .validator((input: { workspace: string; project: string }) => input)
  .handler(async ({ data }): Promise<BoardSnapshot | null> => {
    const { loadProjectOverview } = await import("./api.server.js");
    return loadProjectOverview(data.workspace, data.project);
  });

/**
 * Every source in the workspace, with the shape of its last thirty days.
 *
 * A read of its own rather than a widening of `getWorkspace`: the workspace
 * layout route loads on every page under it, and a histogram per source is work
 * that only one page draws.
 */
export const getWorkspaceSources = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(async ({ data }): Promise<WorkspaceSourcesView | null> => {
    const { loadWorkspaceSources } = await import("./api.server.js");
    return loadWorkspaceSources(data);
  });

/**
 * One page of the log, newest first.
 *
 * A POST because it carries a filter and a cursor, and the filter is PARSED
 * here rather than trusted: it reaches SQL, and "the browser built it" is not a
 * reason to believe anything about its shape. It returns rows rather than
 * numbers, which is why it is not the query layer and not reachable from a
 * saved card. See `packages/schema/src/feed.ts`.
 */
export const getEventFeed = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; filter: unknown }) => ({
    workspace: input.workspace,
    filter: FeedRequest.parse(input.filter),
  }))
  .handler(async ({ data }): Promise<FeedPage | null> => {
    const { loadFeed } = await import("./api.server.js");
    return loadFeed(data);
  });

/**
 * The usage breakdown, over one window.
 *
 * A read of its own: three roll-ups and a baseline, which is real work and
 * which only this page draws. `project` narrows every number on it to one
 * project without changing which page you are on, so the scope switcher can
 * stay where it is.
 */
export const getWorkspaceUsage = createServerFn({ method: "GET" })
  .validator((input: { workspace: string; days: number; project?: string | null }) => input)
  .handler(async ({ data }): Promise<WorkspaceUsageView | null> => {
    const { loadWorkspaceUsage } = await import("./api.server.js");
    return loadWorkspaceUsage(data.workspace, data.days, data.project ?? null);
  });

/**
 * One entry, by id.
 *
 * `at` is the entry's own timestamp, carried in the link so the lookup can hit
 * the primary key instead of scanning a window. It is a HINT, not a
 * requirement: a link without it, or with a stale one, still resolves inside
 * the bounded fallback. See `db/feed.ts`.
 */
export const getEvent = createServerFn({ method: "GET" })
  .validator((input: { workspace: string; entryId: string; at?: string | null }) => input)
  .handler(async ({ data }): Promise<FeedEntry | null> => {
    const { loadEvent } = await import("./api.server.js");
    return loadEvent(data.workspace, data.entryId, data.at ?? null);
  });

/** One source, with what it has been sending. */
export const getSourceDetail = createServerFn({ method: "GET" })
  .validator((input: { workspace: string; project: string; sourceId: string }) => input)
  .handler(async ({ data }): Promise<SourceDetailView | null> => {
    const { loadSourceDetail } = await import("./api.server.js");
    return loadSourceDetail(data.workspace, data.project, data.sourceId);
  });

export const getProject = createServerFn({ method: "GET" })
  .validator((input: { workspace: string; project: string; dashboard?: string | null }) => input)
  .handler(async ({ data }): Promise<ProjectView | null> => {
    const { loadProject } = await import("./api.server.js");
    return loadProject(data.workspace, data.project, data.dashboard ?? null);
  });

// ---------------------------------------------------------------------------
// The query layer
// ---------------------------------------------------------------------------

/**
 * One query, run on its own.
 *
 * The AST is parsed here, before it reaches the compiler. This arrives as a
 * POST body from a form anybody signed in can open, so "the browser built it"
 * is not a reason to trust its shape: the parse is what turns an arbitrary
 * object into one of the queries this product can answer.
 */
export const runQueryFn = createServerFn({ method: "POST" })
  .validator(
    (input: { workspace: string; project: string; query: unknown; range: unknown }) => ({
      workspace: input.workspace,
      project: input.project,
      query: LogQuery.parse(input.query),
      range: DateRange.parse(input.range),
    })
  )
  .handler(
    async ({ data }): Promise<{ ok: true; result: QueryResult } | { ok: false; error: string }> => {
      const { runExplore } = await import("./api.server.js");
      return runExplore(data);
    }
  );

/**
 * What this project has actually written, over one window.
 *
 * Bounded on the server: it samples the most recent entries rather than
 * scanning the window, so opening the picker cannot become the most expensive
 * thing on the page.
 */
export const getDiscoveryFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; project: string; range: unknown }) => ({
    workspace: input.workspace,
    project: input.project,
    range: DateRange.parse(input.range),
  }))
  .handler(async ({ data }): Promise<Discovery | null> => {
    const { loadDiscovery } = await import("./api.server.js");
    return loadDiscovery(data);
  });

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export const saveDashboard = createServerFn({ method: "POST" })
  .validator(
    (input: { workspace: string; project: string; dashboardId: string; layout: unknown }) => ({
      workspace: input.workspace,
      project: input.project,
      dashboardId: input.dashboardId,
      layout: Board.parse(input.layout),
    })
  )
  .handler(async ({ data }): Promise<Result> => {
    const { persistBoard } = await import("./api.server.js");
    return persistBoard(data.workspace, data.project, data.dashboardId, data.layout);
  });

export const createDashboardFn = createServerFn({ method: "POST" })
  .validator(
    (input: { workspace: string; project: string; name: string; template?: string }) => input
  )
  .handler(async ({ data }): Promise<Result<{ slug: string }>> => {
    const { addDashboard } = await import("./api.server.js");
    return addDashboard(data);
  });

export const renameDashboardFn = createServerFn({ method: "POST" })
  .validator(
    (input: { workspace: string; project: string; dashboardId: string; name: string }) => input
  )
  .handler(async ({ data }): Promise<Result<{ slug: string }>> => {
    const { renameDashboard } = await import("./api.server.js");
    return renameDashboard(data);
  });

export const duplicateDashboardFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; project: string; dashboardId: string }) => input)
  .handler(async ({ data }): Promise<Result<{ slug: string }>> => {
    const { duplicateDashboard } = await import("./api.server.js");
    return duplicateDashboard(data);
  });

export const deleteDashboardFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; project: string; dashboardId: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { removeDashboard } = await import("./api.server.js");
    return removeDashboard(data);
  });

export const reorderDashboardsFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; project: string; ids: string[] }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { reorderDashboards } = await import("./api.server.js");
    return reorderDashboards(data);
  });

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export const createWorkspaceFn = createServerFn({ method: "POST" })
  .validator((name: string) => name.trim().slice(0, 60))
  .handler(async ({ data }): Promise<Result<{ slug: string }>> => {
    const { addWorkspace } = await import("./api.server.js");
    return addWorkspace(data);
  });

export const renameWorkspaceFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; name: string }) => input)
  .handler(async ({ data }): Promise<Result<{ slug: string }>> => {
    const { renameWorkspace } = await import("./api.server.js");
    return renameWorkspace(data.workspace, data.name);
  });

export const deleteWorkspaceFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; confirm: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { removeWorkspace } = await import("./api.server.js");
    return removeWorkspace(data.workspace, data.confirm);
  });

export const setWorkspaceLogoFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; dataUrl: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { putWorkspaceLogo } = await import("./api.server.js");
    return putWorkspaceLogo(data.workspace, data.dataUrl);
  });

export const clearWorkspaceLogoFn = createServerFn({ method: "POST" })
  .validator((slug: string) => slug)
  .handler(async ({ data }): Promise<Result> => {
    const { dropWorkspaceLogo } = await import("./api.server.js");
    return dropWorkspaceLogo(data);
  });

export const setProjectLogoFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; project: string; dataUrl: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { putProjectLogo } = await import("./api.server.js");
    return putProjectLogo(data.workspace, data.project, data.dataUrl);
  });

export const clearProjectLogoFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; project: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { dropProjectLogo } = await import("./api.server.js");
    return dropProjectLogo(data.workspace, data.project);
  });

// ---------------------------------------------------------------------------
// Projects and sources
// ---------------------------------------------------------------------------

export const createProjectFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; name: string; template?: string }) => input)
  .handler(async ({ data }): Promise<Result<{ slug: string }>> => {
    const { addProject } = await import("./api.server.js");
    return addProject(data);
  });

export const renameProjectFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; project: string; name: string }) => input)
  .handler(async ({ data }): Promise<Result<{ slug: string }>> => {
    const { renameProject } = await import("./api.server.js");
    return renameProject(data);
  });

export const deleteProjectFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; project: string; confirm: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { removeProject } = await import("./api.server.js");
    return removeProject(data);
  });

export const createSourceFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      workspace: string;
      project: string;
      name: string;
      assetName?: string;
      template?: string;
    }) => input
  )
  .handler(async ({ data }): Promise<Result<{ sourceId: string; ingestKey: string }>> => {
    const { addSource } = await import("./api.server.js");
    return addSource(data);
  });

export const deleteSourceFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; project: string; sourceId: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { removeSource } = await import("./api.server.js");
    return removeSource(data.workspace, data.project, data.sourceId);
  });

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const addMemberFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; login: string; role: MemberRole }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { inviteMember } = await import("./api.server.js");
    return inviteMember(data.workspace, data.login, data.role);
  });

export const setMemberRoleFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; userId: string; role: MemberRole }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { changeMemberRole } = await import("./api.server.js");
    return changeMemberRole(data.workspace, data.userId, data.role);
  });

export const removeMemberFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; userId: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { kickMember } = await import("./api.server.js");
    return kickMember(data.workspace, data.userId);
  });

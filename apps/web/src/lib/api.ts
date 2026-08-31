import { DateRange } from "@firstrun/schema";
import type { BillingStatus, Entitlements, PlanId } from "@firstrun/schema/plan";
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
  /**
   * Whether this account operates the DEPLOYMENT, which is a different question
   * from administering a workspace and is answered by `FIRSTRUN_ADMINS` rather
   * than by any row. Here only so the nav can show the link; `/admin` re-checks
   * server-side on every call.
   */
  admin: boolean;
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

/**
 * What this workspace is allowed, and how close it is to it.
 *
 * Present in both editions and empty in one of them. Self hosted answers
 * `cloud: false` with every entitlement `null`, and `null` means NO LIMIT, not
 * zero: every meter, banner and upsell is conditioned on a ceiling existing, so
 * a self hoster sees none of them and there is nothing to unlock. See
 * `lib/billing.server.ts`, which is the only file that knows the difference.
 *
 * `period.entries` is counted on ARRIVAL, not on the entries' own `time`. It
 * will not match the usage page's chart to the row, and that is correct: one is
 * what was billed this month, the other is when things happened. Both say which
 * they are on screen.
 */
export interface BillingView {
  cloud: boolean;
  plan: PlanId;
  status: BillingStatus;
  entitlements: Entitlements;
  period: { from: string; to: string; entries: number };
}

/**
 * One workspace as the operator sees it: what it is on, and what it is using.
 *
 * A plan belongs to a WORKSPACE and to nothing else. Not to a project, not to a
 * person, not to a source. Everything on this row is therefore counted across
 * every project inside it, and `entriesThisMonth` is the same number the
 * workspace's own meter draws.
 *
 * `entriesLimit` and `projectsLimit` are the EFFECTIVE ceilings with the
 * per-workspace override already applied, not the tier's published numbers.
 * `overridden` says whether the two differ.
 */
export interface AdminWorkspaceView {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  plan: string;
  billingStatus: string;
  /** Whether this workspace has ever been through Stripe. The id stays server-side. */
  hasStripeCustomer: boolean;
  overridden: boolean;
  members: number;
  projects: number;
  sources: number;
  entriesThisMonth: number;
  entriesLastMonth: number;
  entriesLimit: number | null;
  projectsLimit: number | null;
  /** The last day anything ARRIVED. Null for a workspace that has never sent. */
  lastBilledDay: string | null;
}

export interface AdminView {
  /** False on a self-hosted install, where every row is uncapped and unbilled. */
  cloud: boolean;
  period: { from: string; to: string };
  workspaces: AdminWorkspaceView[];
}

/**
 * What every operator page needs before it draws anything.
 *
 * Loaded once by the `/admin` layout route, because the shell around those
 * pages says which edition this is and who is operating it, and a page that
 * re-answered that per route would let the two disagree mid-navigation.
 *
 * Null means "not an operator of this deployment", which the layout renders as
 * a not-found rather than as a denial: the page does not confirm its own
 * existence to somebody guessing at the URL.
 */
export interface AdminContext {
  /** False on a self-hosted install, where nothing below is enforced or billed. */
  cloud: boolean;
  /** The GitHub login this session is operating as, shown in the shell. */
  login: string;
}

/** One table, as the catalogue describes it. Sizes are heap plus indexes plus toast. */
export interface AdminRelationView {
  name: string;
  partitioned: boolean;
  partitions: number;
  totalBytes: number;
  tableBytes: number;
  indexBytes: number;
  rows: number;
  /** False when `rows` is the planner's estimate rather than a count. */
  exact: boolean;
  deadRows: number;
  lastVacuum: string | null;
  lastAnalyze: string | null;
}

/**
 * The deployment at a glance: what it is running on, and how much of it there is.
 *
 * `entriesStored` is an ESTIMATE and the page says so. It is `reltuples` summed
 * across every partition of `log_entries`, which costs a catalogue read;
 * counting the rows would read the whole table, which is the one thing an
 * operator page about storage must not do.
 */
export interface AdminInstanceView {
  cloud: boolean;
  server: {
    database: string;
    bytes: number;
    version: string;
    startedAt: string | null;
    now: string;
  };
  /** Exact counts for the small tables, keyed by table name. */
  counts: Record<string, number>;
  entriesStored: number;
  /** Entries that ARRIVED in the current billing month, across every workspace. */
  entriesThisMonth: number;
  period: { from: string; to: string };
  /** The last 30 days of arrivals, one entry per day, zeroes included. */
  arrivals: { day: string; entries: number }[];
  workspaces: number;
  paying: number;
}

export interface AdminDatabaseView {
  server: AdminInstanceView["server"];
  relations: AdminRelationView[];
  connections: {
    total: number;
    active: number;
    idle: number;
    idleInTransaction: number;
    max: number;
  };
  activity: {
    commits: number;
    rollbacks: number;
    blocksRead: number;
    blocksHit: number;
    cacheHitRatio: number | null;
    tempFiles: number;
    tempBytes: number;
    deadlocks: number;
    statsReset: string | null;
  };
}

/** One partition of `log_entries`. `rows` is the planner's estimate, never a count. */
export interface AdminPartitionView {
  name: string;
  /** Null for the default partition, which has no bound. */
  from: string | null;
  to: string | null;
  rows: number;
  bytes: number;
}

/**
 * Retention, as it actually works: dropping a partition, never a bulk DELETE.
 *
 * The three numbers are the policy constants the maintenance job runs on, sent
 * to the page so the operator reads the deployment's own settings rather than
 * the documentation's example of them.
 */
export interface AdminPartitionsView {
  partitions: AdminPartitionView[];
  monthsBack: number;
  monthsAhead: number;
  retentionMonths: number;
}

export interface WorkspaceView {
  workspace: WorkspaceSummary;
  projects: ProjectListItem[];
  members: MemberSummary[];
  currentUserId: string;
  billing: BillingView;
}

export interface SourceSummary {
  id: string;
  name: string;
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
 * no severity, name or kind that is billed differently, because they are all
 * the same row. The plan meter above this on the page is a separate number with
 * a separate contract: see `BillingView`.
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
  /**
   * The board this view is of, or null when the project has none.
   *
   * Null is the state every project starts in: nothing is created on anybody's
   * behalf, so "no boards yet" is ordinary rather than exceptional. `dashboard`,
   * `layout` and `snapshot` are null together -- there is no board, so there is
   * no arrangement and nothing was measured.
   */
  dashboard: DashboardSummary | null;
  /** The board itself: an arrangement of saved queries. */
  layout: BoardValue | null;
  snapshot: BoardSnapshot | null;
  /** What this project has actually written, so the pickers offer real options. */
  discovery: Discovery;
  /** Absolute origin the tag and SDK should talk to. */
  publicOrigin: string;
}

export interface DocsSource {
  id: string;
  name: string;
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

/**
 * The origin the document is being served from, for canonical and `og:url`.
 *
 * Read in the root loader beside the session and the language, and for the same
 * reason: it is a fact about the REQUEST, so the only place it exists is on the
 * server, and a page that waited for hydration to learn it would have shipped
 * its head tags without it -- which for a crawler means shipped without them.
 */
export const getPublicOrigin = createServerFn({ method: "GET" }).handler(
  async (): Promise<string> => {
    const { loadPublicOrigin } = await import("./api.server.js");
    return loadPublicOrigin();
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
  .validator((input: { workspace: string; project?: string | null }) => input)
  .handler(async ({ data }): Promise<WorkspaceSourcesView | null> => {
    const { loadWorkspaceSources } = await import("./api.server.js");
    return loadWorkspaceSources(data.workspace, data.project ?? null);
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

/**
 * What the log's own pickers can offer, at whichever scope it is open.
 *
 * A GET beside the page's own load rather than folded into it: the feed is
 * re-read on every filter change and on every poll, and the vocabulary behind
 * the pickers changes on neither.
 */
export const getFeedDiscovery = createServerFn({ method: "GET" })
  .validator((input: { workspace: string; project?: string | null; hours: number }) => input)
  .handler(async ({ data }): Promise<Discovery | null> => {
    const { loadFeedDiscovery } = await import("./api.server.js");
    return loadFeedDiscovery(data);
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
    (input: {
      workspace: string;
      project: string;
      name: string;
      template?: string;
      /** One source to narrow the whole board to, permanently. Optional. */
      sourceId?: string;
    }) => input
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

/**
 * The operator's view of every workspace on this deployment.
 *
 * Answers null for anybody who is not named in `FIRSTRUN_ADMINS`, including an
 * admin of every workspace on the box. Administering a workspace and operating
 * the deployment are two different questions with two different mechanisms.
 */
export const getAdminOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminView | null> => {
    const { loadAdminOverview } = await import("./api.server.js");
    return loadAdminOverview();
  }
);

/**
 * The three operator reads: the shell's context, the deployment, the database.
 *
 * Split rather than one call, so a page pays for what it draws. Each one
 * re-checks `requireInstanceAdmin` on the server: the layout's guard is what
 * stops the pages being reachable, not what makes them safe.
 */
export const getAdminContext = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminContext | null> => {
    const { loadAdminContext } = await import("./api.server.js");
    return loadAdminContext();
  }
);

export const getAdminInstance = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminInstanceView | null> => {
    const { loadAdminInstance } = await import("./api.server.js");
    return loadAdminInstance();
  }
);

export const getAdminDatabase = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminDatabaseView | null> => {
    const { loadAdminDatabase } = await import("./api.server.js");
    return loadAdminDatabase();
  }
);

export const getAdminPartitions = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminPartitionsView | null> => {
    const { loadAdminPartitions } = await import("./api.server.js");
    return loadAdminPartitions();
  }
);

/**
 * Force a plan with no payment, or move a workspace's ceiling.
 *
 * By workspace id rather than slug: a slug can be renamed out from under an
 * open page, and forcing the plan of the wrong workspace is not a mistake worth
 * leaving reachable.
 */
export const forceWorkspacePlanFn = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; plan: string; status: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { forceWorkspacePlan } = await import("./api.server.js");
    return forceWorkspacePlan(data);
  });

export const overrideWorkspaceLimitFn = createServerFn({ method: "POST" })
  .validator((input: { workspaceId: string; entriesPerMonth: number | null }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { overrideWorkspaceLimit } = await import("./api.server.js");
    return overrideWorkspaceLimit(data);
  });

/**
 * Start a subscription, or manage an existing one.
 *
 * Both answer with a URL rather than redirecting, so the caller decides when to
 * leave the page and can show its own error if Stripe is unreachable. Both are
 * no-ops on a self-hosted install, where there is no plan to change.
 */
export const startCheckoutFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; plan: string }) => input)
  .handler(async ({ data }): Promise<Result<{ url: string }>> => {
    const { startCheckout } = await import("./api.server.js");
    return startCheckout(data.workspace, data.plan);
  });

export const openBillingPortalFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string }) => input)
  .handler(async ({ data }): Promise<Result<{ url: string }>> => {
    const { openBillingPortal } = await import("./api.server.js");
    return openBillingPortal(data.workspace);
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
  .validator(
    (input: { workspace: string; name: string }) => input
  )
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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TIMESERIES_EVENT,
  type DashboardLayout,
  type TimeseriesMetric,
} from "@firstrun/schema";
import type { Queryable } from "./client.js";
import { queriesDir } from "./paths.js";

/**
 * The analytics queries are real SQL files, not an ORM.
 *
 * They are the product. Someone who knows SQL and nothing about this codebase
 * should be able to read them, and when a number on the screen changes the diff
 * should say why. Drizzle owns the schema; it does not own these.
 */

const cache = new Map<string, string>();

export function sqlText(name: string): string {
  let text = cache.get(name);
  if (!text) {
    text = readFileSync(join(queriesDir(), `${name}.sql`), "utf8");
    cache.set(name, text);
  }
  return text;
}

export interface Window {
  workspaceId: string;
  from: Date;
  to: Date;
  /** null means the whole workspace, across every source. */
  sourceId?: string | null;
}

const num = (v: unknown): number => Number(v ?? 0);

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export interface FunnelCounts {
  visited: number;
  downloaded: number;
  first_run: number;
  paid: number;
}

export interface FunnelResult {
  /** People we can prove walked the chain. */
  exact: FunnelCounts;
  /**
   * The same chain, allowing estimated matches to bridge web and app.
   * Always reported next to `exact`, never folded into it.
   */
  estimated: FunnelCounts;
}

const EMPTY_FUNNEL: FunnelCounts = { visited: 0, downloaded: 0, first_run: 0, paid: 0 };

/**
 * 90 days by default: "visited in January, finally installed in March" is a real
 * customer, not noise.
 */
export const DEFAULT_FUNNEL_WINDOW = "90 days";

export async function funnel(
  sql: Queryable,
  w: Window,
  windowInterval = DEFAULT_FUNNEL_WINDOW
): Promise<FunnelResult> {
  const rows = await sql.query<any>(sqlText("funnel"), [
    w.workspaceId,
    w.from,
    w.to,
    windowInterval,
    w.sourceId ?? null,
  ]);

  const pick = (kind: string): FunnelCounts => {
    const r = rows.find((x: any) => x.kind === kind);
    if (!r) return { ...EMPTY_FUNNEL };
    return {
      visited: num(r.visited),
      downloaded: num(r.downloaded),
      first_run: num(r.first_run),
      paid: num(r.paid),
    };
  };

  return { exact: pick("exact"), estimated: pick("estimated") };
}

// ---------------------------------------------------------------------------
// Day 7
// ---------------------------------------------------------------------------

export interface Day7Counts {
  /** The cohort: people with both a download and a first run. */
  first_run: number;
  day7: number;
}

export interface Day7Result {
  exact: Day7Counts;
  estimated: Day7Counts;
}

export async function day7(sql: Queryable, w: Window): Promise<Day7Result> {
  const rows = await sql.query<any>(sqlText("day7"), [
    w.workspaceId,
    w.from,
    w.to,
    w.sourceId ?? null,
  ]);
  const pick = (kind: string): Day7Counts => {
    const r = rows.find((x: any) => x.kind === kind);
    return { first_run: num(r?.first_run), day7: num(r?.day7) };
  };
  return { exact: pick("exact"), estimated: pick("estimated") };
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export interface VersionRow {
  app_version: string;
  installs: number;
  people: number;
  active: number;
  quiet: number;
  newest_activity: Date | null;
}

export async function versions(
  sql: Queryable,
  workspaceId: string,
  now: Date,
  quietDays = 14,
  sourceId: string | null = null
): Promise<VersionRow[]> {
  const rows = await sql.query<any>(sqlText("versions"), [workspaceId, now, quietDays, sourceId]);
  return rows.map((r: any) => ({
    app_version: r.app_version,
    installs: num(r.installs),
    people: num(r.people),
    active: num(r.active),
    quiet: num(r.quiet),
    newest_activity: r.newest_activity ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

export interface SeriesPoint {
  day: Date;
  people: number;
}

export async function timeseries(
  sql: Queryable,
  w: Window,
  metric: TimeseriesMetric
): Promise<SeriesPoint[]> {
  const rows = await sql.query<any>(sqlText("timeseries"), [
    w.workspaceId,
    w.from,
    w.to,
    TIMESERIES_EVENT[metric],
    w.sourceId ?? null,
  ]);
  return rows.map((r: any) => ({ day: r.day, people: num(r.people) }));
}

// ---------------------------------------------------------------------------
// Retention curve
// ---------------------------------------------------------------------------

export interface RetentionPoint {
  day: number;
  eligible: number;
  retained: number;
}

export async function retention(sql: Queryable, w: Window, maxDay = 30): Promise<RetentionPoint[]> {
  const rows = await sql.query<any>(sqlText("retention"), [
    w.workspaceId,
    w.from,
    w.to,
    maxDay,
    w.sourceId ?? null,
  ]);
  return rows.map((r: any) => ({
    day: num(r.day),
    eligible: num(r.eligible),
    retained: num(r.retained),
  }));
}

// ---------------------------------------------------------------------------
// The snapshot a dashboard renders from
// ---------------------------------------------------------------------------

export interface Snapshot {
  from: Date;
  to: Date;
  funnel: FunnelResult;
  day7: Day7Result;
  versions: VersionRow[];
  series: Record<string, SeriesPoint[]>;
  retention: RetentionPoint[];
  /** The same funnel and day 7 over the window before this one, for deltas. */
  previous: { funnel: FunnelResult; day7: Day7Result } | null;
}

/**
 * Runs only what the layout actually asks for, once.
 *
 * A configurable dashboard invites one query per widget, which is how a screen
 * with eight cards ends up making eight round trips for numbers that mostly
 * came from the same three queries. The layout is known before any SQL runs, so
 * the work is deduplicated up front instead.
 */
export async function snapshot(
  sql: Queryable,
  workspaceId: string,
  layout: DashboardLayout,
  now: Date = new Date()
): Promise<Snapshot> {
  const day = 24 * 60 * 60 * 1000;
  const to = new Date(now.getTime() + day);
  const from = new Date(to.getTime() - layout.rangeDays * day);
  const w: Window = { workspaceId, from, to, sourceId: layout.sourceId };

  const types = new Set(layout.widgets.map((x) => x.type));
  const wantsFunnel = types.has("funnel") || types.has("metric") || types.has("join_health");
  const wantsDay7 = types.has("funnel") || types.has("metric") || types.has("join_health");
  const wantsVersions = types.has("versions") || types.has("metric");
  const wantsCompare = layout.widgets.some((x) => x.type === "metric" && x.compare);

  const seriesMetrics = [
    ...new Set(
      layout.widgets.flatMap((x) => (x.type === "timeseries" ? [x.metric] : []))
    ),
  ];
  const maxRetentionDay = Math.max(
    0,
    ...layout.widgets.map((x) => (x.type === "retention" ? x.days : 0))
  );
  const quietDays = Math.max(
    14,
    ...layout.widgets.map((x) => (x.type === "versions" ? x.quietDays : 0))
  );

  const previousWindow: Window = {
    ...w,
    from: new Date(from.getTime() - layout.rangeDays * day),
    to: from,
  };

  const [f, d7, v, seriesResults, ret, prevFunnel, prevDay7] = await Promise.all([
    wantsFunnel ? funnel(sql, w) : Promise.resolve({ exact: { ...EMPTY_FUNNEL }, estimated: { ...EMPTY_FUNNEL } }),
    wantsDay7
      ? day7(sql, w)
      : Promise.resolve({ exact: { first_run: 0, day7: 0 }, estimated: { first_run: 0, day7: 0 } }),
    wantsVersions ? versions(sql, workspaceId, now, quietDays, layout.sourceId) : Promise.resolve([]),
    Promise.all(seriesMetrics.map((m) => timeseries(sql, w, m))),
    maxRetentionDay > 0 ? retention(sql, w, maxRetentionDay) : Promise.resolve([]),
    wantsCompare ? funnel(sql, previousWindow) : Promise.resolve(null),
    wantsCompare ? day7(sql, previousWindow) : Promise.resolve(null),
  ]);

  const series: Record<string, SeriesPoint[]> = {};
  seriesMetrics.forEach((m, i) => {
    series[m] = seriesResults[i] ?? [];
  });

  return {
    from,
    to,
    funnel: f,
    day7: d7,
    versions: v,
    series,
    retention: ret,
    previous: prevFunnel && prevDay7 ? { funnel: prevFunnel, day7: prevDay7 } : null,
  };
}

/** Resolves a metric widget's number out of an already-computed snapshot. */
export function metricValue(
  snap: Pick<Snapshot, "funnel" | "day7" | "versions">,
  metric: string
): { exact: number; estimated: number } {
  switch (metric) {
    case "visited":
      return { exact: snap.funnel.exact.visited, estimated: snap.funnel.estimated.visited };
    case "downloaded":
      return { exact: snap.funnel.exact.downloaded, estimated: snap.funnel.estimated.downloaded };
    case "first_run":
      return { exact: snap.funnel.exact.first_run, estimated: snap.funnel.estimated.first_run };
    case "day7":
      return { exact: snap.day7.exact.day7, estimated: snap.day7.estimated.day7 };
    case "paid":
      return { exact: snap.funnel.exact.paid, estimated: snap.funnel.estimated.paid };
    case "active_installs": {
      const n = snap.versions.reduce((sum, r) => sum + r.active, 0);
      return { exact: n, estimated: n };
    }
    case "quiet_installs": {
      const n = snap.versions.reduce((sum, r) => sum + r.quiet, 0);
      return { exact: n, estimated: n };
    }
    default:
      return { exact: 0, estimated: 0 };
  }
}

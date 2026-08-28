import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClickHouseClient, toChDateTime } from "./clickhouse/client.js";

/**
 * The funnel queries are real SQL files, not an ORM.
 *
 * They are the product. They should be readable by someone who knows ClickHouse
 * and nothing about this codebase, and diffable when a number on the screen
 * changes.
 */

// Resolved from this module's own URL rather than `import.meta.dir` so the
// same file works under Bun and under Node.
const QUERY_DIR = join(dirname(fileURLToPath(import.meta.url)), "clickhouse", "queries");
const cache = new Map<string, string>();

export function sql(name: string): string {
  let text = cache.get(name);
  if (!text) {
    text = readFileSync(join(QUERY_DIR, `${name}.sql`), "utf8");
    cache.set(name, text);
  }
  return text;
}

export interface Window {
  projectId: string;
  from: number;
  to: number;
}

/** ClickHouse hands UInt64 back as a string in JSONEachRow. */
const n = (v: string | number): number => Number(v);

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

const EMPTY: FunnelCounts = { visited: 0, downloaded: 0, first_run: 0, paid: 0 };

/**
 * How long the whole chain is allowed to take.
 *
 * 90 days because "visited in January, finally installed in March" is a real
 * customer, not noise. Milliseconds because that is what the query's
 * windowFunnel is given.
 */
export const DEFAULT_FUNNEL_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export async function funnel(
  ch: ClickHouseClient,
  w: Window,
  windowMs = DEFAULT_FUNNEL_WINDOW_MS
): Promise<FunnelResult> {
  const rows = await ch.query<{
    kind: "exact" | "estimated";
    visited: string;
    downloaded: string;
    first_run: string;
    paid: string;
  }>(sql("funnel"), {
    project: w.projectId,
    from: toChDateTime(w.from),
    to: toChDateTime(w.to),
    window: windowMs,
  });

  const pick = (kind: "exact" | "estimated"): FunnelCounts => {
    const r = rows.find((x) => x.kind === kind);
    if (!r) return { ...EMPTY };
    return {
      visited: n(r.visited),
      downloaded: n(r.downloaded),
      first_run: n(r.first_run),
      paid: n(r.paid),
    };
  };

  return { exact: pick("exact"), estimated: pick("estimated") };
}

export interface Day7Counts {
  /** The cohort: people with both a download and a first run. */
  first_run: number;
  day7: number;
}

export interface Day7Result {
  exact: Day7Counts;
  estimated: Day7Counts;
}

export async function day7(ch: ClickHouseClient, w: Window): Promise<Day7Result> {
  const rows = await ch.query<{
    kind: "exact" | "estimated";
    first_run: string;
    day7: string;
  }>(sql("day7"), {
    project: w.projectId,
    from: toChDateTime(w.from),
    to: toChDateTime(w.to),
  });

  const pick = (kind: "exact" | "estimated"): Day7Counts => {
    const r = rows.find((x) => x.kind === kind);
    return { first_run: n(r?.first_run ?? 0), day7: n(r?.day7 ?? 0) };
  };

  return { exact: pick("exact"), estimated: pick("estimated") };
}

export interface VersionRow {
  app_version: string;
  installs: number;
  people: number;
  active: number;
  quiet: number;
  newest_activity: string;
}

export async function versions(
  ch: ClickHouseClient,
  projectId: string,
  now: number,
  quietDays = 14
): Promise<VersionRow[]> {
  const rows = await ch.query<{
    app_version: string;
    installs: string;
    people: string;
    active: string;
    quiet: string;
    newest_activity: string;
  }>(sql("versions"), {
    project: projectId,
    now: toChDateTime(now),
    quiet_days: quietDays,
  });
  return rows.map((r) => ({
    app_version: r.app_version,
    installs: n(r.installs),
    people: n(r.people),
    active: n(r.active),
    quiet: n(r.quiet),
    newest_activity: r.newest_activity,
  }));
}

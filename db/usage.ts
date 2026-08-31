import type { Queryable } from "./client.js";

/**
 * The billing meter: writing it, and reading it back.
 *
 * Plain SQL through `Queryable` rather than the Drizzle builder, for the same
 * reason ingest imports `@firstrun/db/client` and not the barrel: the write
 * below sits in the hot path of the public data plane, and that path should not
 * be able to break because a dashboard query pulled a file in behind it.
 *
 * Every statement here is parameter-bound. Nothing is concatenated.
 *
 * ## Arrival, not `time`
 *
 * The day a row is filed under is the day it ARRIVED. Rule 5 forbids bucketing
 * on `ingested_at`, and it is right about every number the product draws: a
 * laptop that was offline for a week belongs on the days it was used. Billing
 * is the other question, and it has to be counted the other way:
 *
 *  - `time` is the client's. A client stamping last year would land outside
 *    every open period and ingest for free, permanently.
 *  - A period counted on `time` never closes, because entries for last month
 *    keep arriving after the invoice went out.
 *  - Arrival is when the row cost us the page it is written on.
 *
 * The usage page keeps bucketing on `time` and says so; the meter counts
 * arrivals and says so. They are two questions and two numbers.
 */

/**
 * The UTC calendar month a moment falls in, as `[from, to)` date literals.
 *
 * Calendar months rather than a per-workspace anchor, so that the Stripe cycle
 * anchor is the only thing that has to agree with this and there is no period
 * column to drift. Dates rather than timestamps because `usage_daily.day` is a
 * `date`: there is no zone to get wrong once it is written.
 */
export function monthWindow(now: Date = new Date()): { from: string; to: string; month: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (year: number, month: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return {
    from: iso(y, m),
    to: m === 11 ? iso(y + 1, 0) : iso(y, m + 1),
    month: `${y}-${String(m + 1).padStart(2, "0")}`,
  };
}

/**
 * The month before the one starting at `from`, as a `date` literal.
 *
 * Derived from the window rather than from `now`, so a caller that has already
 * resolved a month cannot end up with a baseline belonging to a different one.
 */
export function previousMonthStart(from: string): string {
  const [year, month] = from.split("-").map(Number) as [number, number];
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** The UTC day a moment falls on, as a `date` literal. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Adds a batch's accepted entries to today's meter.
 *
 * `accepted`, not the batch length: `insertLogEntries` returns the rows the
 * primary key had not already seen, and every client replays its durable queue
 * after a crash. Billing somebody for their own replay is both wrong and
 * visible to them.
 *
 * The workspace is resolved inside the statement rather than fetched first, so
 * this stays one round trip and `sourceByKey` does not have to grow a join for
 * it. If the project has been deleted mid-flight the `select` yields no row and
 * the insert is a no-op, which is the right outcome and not an error.
 *
 * `(now() at time zone 'utc')::date` rather than `current_date`, because
 * `current_date` follows the session's TimeZone setting and the meter has to
 * mean the same thing on every deployment.
 *
 * ## This must never fail a request
 *
 * By the time it runs the entries are already durable. Rule 7: a client that
 * gets a 5xx retries a batch that would only deduplicate, and no telemetry
 * failure is worth touching the customer's software. Callers wrap it.
 */
export async function recordUsage(
  q: Queryable,
  projectId: string,
  sourceId: string,
  accepted: number
): Promise<void> {
  if (accepted <= 0) return;
  await q.query(
    `insert into usage_daily (workspace_id, day, project_id, source_id, entries)
     select p.workspace_id, (now() at time zone 'utc')::date, p.id, $2::uuid, $3::bigint
       from projects p
      where p.id = $1::uuid
     on conflict (workspace_id, day, project_id, source_id)
     do update set entries = usage_daily.entries + excluded.entries`,
    [projectId, sourceId, accepted]
  );
}

/** Entries billed to a workspace in one window. The number the meter draws. */
export async function usageBetween(
  q: Queryable,
  workspaceId: string,
  from: string,
  to: string
): Promise<number> {
  const rows = await q.query<{ n: string | number }>(
    `select coalesce(sum(entries), 0) as n
       from usage_daily
      where workspace_id = $1::uuid and day >= $2::date and day < $3::date`,
    [workspaceId, from, to]
  );
  return Number(rows[0]?.n ?? 0);
}

/** Entries billed to a workspace in the calendar month containing `now`. */
export function usageThisMonth(q: Queryable, workspaceId: string, now?: Date): Promise<number> {
  const { from, to } = monthWindow(now);
  return usageBetween(q, workspaceId, from, to);
}

export interface BilledDay {
  day: string;
  entries: number;
}

/**
 * The per-day billed series for one workspace, oldest first.
 *
 * Deliberately not broken down by project: this is the meter's own history, and
 * the usage page already has a breakdown drawn from `log_entries` on `time`.
 * Two charts of the same shape cut two different ways would read as a bug.
 */
export async function billedDaily(
  q: Queryable,
  workspaceId: string,
  from: string,
  to: string
): Promise<BilledDay[]> {
  // `day::text`, not the bare column. `pg` decodes a `date` into a Date at
  // LOCAL midnight, so a row stored as 2026-08-31 comes back as
  // 2026-08-30T22:00Z in Zurich and reading the ISO string off it loses a day.
  // Postgres formats it correctly and there is nothing left to get wrong.
  const rows = await q.query<{ day: string; n: string | number }>(
    `select day::text as day, sum(entries) as n
       from usage_daily
      where workspace_id = $1::uuid and day >= $2::date and day < $3::date
      group by day
      order by day`,
    [workspaceId, from, to]
  );
  return rows.map((r) => ({ day: r.day, entries: Number(r.n ?? 0) }));
}

export interface WorkspaceDayTotal {
  workspaceId: string;
  entries: number;
}

/**
 * Every workspace's total for one day. What the nightly Stripe push reads.
 *
 * One statement for the whole instance rather than one per workspace, because
 * the job runs over all of them and the table is small enough that the group by
 * is cheaper than the round trips.
 */
export async function totalsForDay(q: Queryable, day: string): Promise<WorkspaceDayTotal[]> {
  const rows = await q.query<{ workspace_id: string; n: string | number }>(
    `select workspace_id, sum(entries) as n
       from usage_daily
      where day = $1::date
      group by workspace_id
      having sum(entries) > 0`,
    [day]
  );
  return rows.map((r) => ({ workspaceId: r.workspace_id, entries: Number(r.n ?? 0) }));
}

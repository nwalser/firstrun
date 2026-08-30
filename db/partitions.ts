import type { Queryable } from "./client.js";

/**
 * Partition maintenance for `log_entries`.
 *
 * The SQL lives in the database as three functions, created by
 * migrations/0000_initial.sql, and this file is the thin thing that calls
 * them. That split is deliberate: partition management has to be runnable by a
 * person with a psql prompt at two in the morning, and a policy that only exists
 * as TypeScript inside a web server is a policy you cannot apply when the web
 * server is the thing that is broken.
 *
 *   log_entries_create_partition(month)   idempotent, drains the default into
 *                                         the new partition first
 *   log_entries_ensure_partitions(b, a)   b months back through a months ahead
 *   log_entries_drop_expired(months)      retention, as DROP TABLE
 */

/**
 * How far ahead partitions are created.
 *
 * Two months, not one. One month ahead means the last hour of the last day of
 * the month is the moment everything depends on a job having run, and a write
 * that arrives for a partition nobody created is the failure this must not
 * have. Two months is a spare tyre that costs an empty table.
 */
export const MONTHS_AHEAD = 2;

/**
 * How far back `ensure` reaches.
 *
 * One month, because entries arrive late: a laptop that was shut for three
 * weeks replays its queue on the next launch, and those entries belong in the
 * month they happened in. Anything older than this still lands, in the default
 * partition, and moves into a real one the moment somebody creates that month.
 */
export const MONTHS_BACK = 1;

/**
 * The default retention, in months.
 *
 * Not applied by anything automatically. Dropping a customer's data is not a
 * thing that should happen because a default was left alone, so
 * `dropExpiredPartitions` is called explicitly or not at all.
 */
export const DEFAULT_RETENTION_MONTHS = 13;

/**
 * Creates the partitions around now, and returns how many were new.
 *
 * Called from `applyMigrations`, so a fresh clone works with no manual step and
 * a long-running deployment rolls into a new month without one either. Cheap
 * and idempotent: on almost every boot it creates nothing and returns 0.
 */
export async function ensurePartitions(
  sql: Queryable,
  monthsBack: number = MONTHS_BACK,
  monthsAhead: number = MONTHS_AHEAD
): Promise<number> {
  const rows = await sql.query<{ created: number }>(
    "SELECT log_entries_ensure_partitions($1::int, $2::int) AS created",
    [monthsBack, monthsAhead]
  );
  return Number(rows[0]?.created ?? 0);
}

/**
 * Retention. Drops every partition entirely older than `retainMonths`, and
 * returns their names.
 *
 * This is the whole retention implementation. There is no DELETE anywhere: a
 * bulk delete over tens of millions of rows takes a lock, writes as much WAL as
 * the rows it removes, leaves the space to autovacuum, and does all of it on the
 * database that is also serving the dashboard.
 *
 * A month is dropped only when the WHOLE month is older than the cutoff, so a
 * thirteen-month retention keeps between thirteen and fourteen months rather
 * than cutting a partition in half. Retention granularity is the partition
 * width, and that is the honest way to describe it to a customer.
 */
export async function dropExpiredPartitions(
  sql: Queryable,
  retainMonths: number = DEFAULT_RETENTION_MONTHS
): Promise<string[]> {
  const rows = await sql.query<{ log_entries_drop_expired: string }>(
    "SELECT log_entries_drop_expired($1::int)",
    [retainMonths]
  );
  return rows.map((r) => r.log_entries_drop_expired);
}

export interface PartitionInfo {
  name: string;
  /** Null for the default partition, which has no bound. */
  from: Date | null;
  to: Date | null;
  rows: number;
  /** Heap plus indexes, in bytes. */
  bytes: number;
}

/**
 * What partitions exist, with their bounds and their size.
 *
 * `rows` is the planner's estimate from `pg_class.reltuples`, not a count. An
 * exact count means reading every partition, which is the one thing a page
 * about storage should not do.
 */
export async function listPartitions(sql: Queryable): Promise<PartitionInfo[]> {
  const rows = await sql.query<{
    name: string;
    bound: string | null;
    rows: string;
    bytes: string;
  }>(
    `SELECT c.relname                              AS name,
            pg_get_expr(c.relpartbound, c.oid)     AS bound,
            greatest(c.reltuples, 0)::bigint       AS rows,
            pg_total_relation_size(c.oid)          AS bytes
       FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'log_entries'
      ORDER BY c.relname`
  );

  return rows.map((r) => {
    const bounds = parseBound(r.bound);
    return {
      name: r.name,
      from: bounds?.from ?? null,
      to: bounds?.to ?? null,
      rows: Number(r.rows),
      bytes: Number(r.bytes),
    };
  });
}

/**
 * `FOR VALUES FROM ('2026-08-01') TO ('2026-09-01')` -> two dates.
 *
 * Reads the catalogue's own rendering rather than the partition's name, because
 * this one is a display and being wrong about a bound on a storage page is
 * worse than showing nothing. `DEFAULT` has no bound and returns null.
 */
function parseBound(bound: string | null): { from: Date; to: Date } | null {
  if (!bound) return null;
  const m = /FROM \('([^']+)'\) TO \('([^']+)'\)/.exec(bound);
  if (!m) return null;
  return { from: new Date(m[1]!), to: new Date(m[2]!) };
}

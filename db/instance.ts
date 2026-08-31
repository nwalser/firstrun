import type { Queryable } from "./client.js";

/**
 * What the deployment itself is doing, as opposed to what a customer is doing
 * on it.
 *
 * The operator's questions are the ones no workspace can answer: how big the
 * database has got, which table is holding it, whether autovacuum is keeping
 * up, how many connections are open and how much of the pool is left. None of
 * that is product state, so none of it is in `schema.ts`: it is read out of
 * `pg_catalog` and `pg_stat_*`, which is where Postgres already keeps it.
 *
 * ## Nothing here reads a customer's entries
 *
 * Sizes and row counts come out of the catalogue, never out of the table.
 * `reltuples` is the planner's own estimate and costs a catalogue read;
 * `count(*)` over `log_entries` reads every partition of the largest table in
 * the database, which is the one thing a page about storage must not do. The
 * small tables ARE counted exactly, because they are measured in rows rather
 * than in millions and an operator comparing "workspaces" against a list wants
 * the real number.
 *
 * Rule 8 still holds above this file: `requireInstanceAdmin` is the guard, and
 * nothing here widens `requireAccess`. Reading INSIDE somebody's entries is
 * still a support conversation rather than a button.
 *
 * Plain SQL through `Queryable`, like `usage.ts` and `admin.ts`. Drizzle has no
 * model of the system catalogues and would not make any of this shorter.
 */

/** The tables counted exactly, because they are small and an operator compares them to a list. */
const COUNTED = [
  "users",
  "sessions",
  "workspaces",
  "workspace_members",
  "projects",
  "sources",
  "dashboards",
  "usage_daily",
] as const;

export interface ServerInfo {
  database: string;
  /** `pg_database_size`, so indexes and toast are included. */
  bytes: number;
  version: string;
  /** When the postmaster came up, which is the deployment's own uptime. */
  startedAt: string | null;
  /** The database's clock, so the page can say how stale a reading is. */
  now: string;
}

export interface RelationStats {
  name: string;
  /** True for `log_entries`, which is a partitioned parent rather than a heap. */
  partitioned: boolean;
  /** How many partitions hang off it. Zero for an ordinary table. */
  partitions: number;
  /** Heap, indexes and toast together, summed across partitions. */
  totalBytes: number;
  tableBytes: number;
  indexBytes: number;
  rows: number;
  /** False when `rows` is the planner's estimate rather than a count. */
  exact: boolean;
  /** Dead tuples awaiting vacuum: the number that says whether autovacuum is keeping up. */
  deadRows: number;
  lastVacuum: string | null;
  lastAnalyze: string | null;
}

export interface ConnectionStats {
  total: number;
  active: number;
  idle: number;
  idleInTransaction: number;
  /** `max_connections`, so the count above means something. */
  max: number;
}

export interface ActivityStats {
  commits: number;
  rollbacks: number;
  blocksRead: number;
  blocksHit: number;
  /** Hits over hits plus reads. Null before anything has been read at all. */
  cacheHitRatio: number | null;
  tempFiles: number;
  tempBytes: number;
  deadlocks: number;
  /** When these counters were last zeroed. They are cumulative from that moment. */
  statsReset: string | null;
}

export interface ArrivalDay {
  day: string;
  entries: number;
}

/**
 * The whole deployment in one shape.
 *
 * Assembled from five statements run together rather than one join across five
 * unrelated catalogues, because they answer five different questions and a
 * failure in any of them should be legible as itself.
 */
export interface InstanceSnapshot {
  server: ServerInfo;
  relations: RelationStats[];
  connections: ConnectionStats;
  activity: ActivityStats;
  /** Exact counts for the small tables, keyed by table name. */
  counts: Record<string, number>;
  /** The estimated number of rows in `log_entries`, across every partition. */
  entriesStored: number;
}

const num = (v: unknown): number => Number(v ?? 0);

const iso = (v: Date | string | null | undefined): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(v).toISOString();

export async function serverInfo(q: Queryable): Promise<ServerInfo> {
  const rows = await q.query<{
    database: string;
    bytes: string;
    version: string;
    started_at: Date | string | null;
    now: Date | string;
  }>(
    `SELECT current_database()                   AS database,
            pg_database_size(current_database()) AS bytes,
            current_setting('server_version')    AS version,
            pg_postmaster_start_time()           AS started_at,
            now()                                AS now`
  );
  const r = rows[0];
  return {
    database: r?.database ?? "",
    bytes: num(r?.bytes),
    version: r?.version ?? "",
    startedAt: iso(r?.started_at ?? null),
    now: iso(r?.now ?? new Date()) ?? new Date().toISOString(),
  };
}

/**
 * Every table in `public`, with its size and its vacuum state.
 *
 * `pg_partition_tree` is why `log_entries` reports as one row rather than
 * fourteen: the parent holds no data and `pg_total_relation_size` on it answers
 * zero, so the sizes are summed across the tree.
 *
 * It is UNIONed with the table's own oid rather than used alone, because
 * `pg_partition_tree` returns NO ROWS for a relation that is neither a
 * partition nor partitioned. Used alone it silently drops every ordinary table
 * from the result and leaves a storage page that lists exactly one thing. The
 * UNION also de-duplicates, so the parent of a partitioned table is still
 * counted once.
 *
 * The row count filters the parent OUT, and that is not symmetry with the
 * sizes. `ANALYZE` on a partitioned table writes the TOTAL of its partitions
 * onto the parent's `reltuples`, so summing the tree counts every row twice:
 * once on the leaf it is in and once on the parent that adds them up. Sizes do
 * not have that problem, because the parent genuinely occupies nothing.
 *
 * Ordered by size, because the question is always which table IS the database.
 */
export async function relationStats(q: Queryable): Promise<RelationStats[]> {
  const rows = await q.query<{
    name: string;
    partitioned: boolean;
    partitions: string;
    total_bytes: string;
    table_bytes: string;
    index_bytes: string;
    rows: string;
    dead_rows: string;
    last_vacuum: Date | string | null;
    last_analyze: Date | string | null;
  }>(
    `WITH roots AS (
       SELECT c.oid, c.relname, c.relkind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND NOT c.relispartition
     )
     SELECT r.relname                                         AS name,
            r.relkind = 'p'                                   AS partitioned,
            count(*) FILTER (WHERE t.relid <> r.oid)          AS partitions,
            coalesce(sum(pg_total_relation_size(t.relid)), 0) AS total_bytes,
            coalesce(sum(pg_table_size(t.relid)), 0)          AS table_bytes,
            coalesce(sum(pg_indexes_size(t.relid)), 0)        AS index_bytes,
            coalesce(
              sum(greatest(c2.reltuples, 0)) FILTER (WHERE c2.relkind <> 'p'),
              0
            )::bigint                                         AS rows,
            coalesce(sum(s.n_dead_tup), 0)                    AS dead_rows,
            max(greatest(s.last_vacuum, s.last_autovacuum))   AS last_vacuum,
            max(greatest(s.last_analyze, s.last_autoanalyze)) AS last_analyze
       FROM roots r
       CROSS JOIN LATERAL (
         SELECT pt.relid
           FROM pg_partition_tree(r.oid) AS pt(relid, parentrelid, isleaf, level)
         UNION
         SELECT r.oid
       ) AS t
       JOIN pg_class c2 ON c2.oid = t.relid
       LEFT JOIN pg_stat_all_tables s ON s.relid = t.relid
      GROUP BY r.relname, r.relkind
      ORDER BY total_bytes DESC, name`
  );

  return rows.map((r) => ({
    name: r.name,
    partitioned: r.partitioned === true,
    partitions: num(r.partitions),
    totalBytes: num(r.total_bytes),
    tableBytes: num(r.table_bytes),
    indexBytes: num(r.index_bytes),
    rows: num(r.rows),
    exact: false,
    deadRows: num(r.dead_rows),
    lastVacuum: iso(r.last_vacuum),
    lastAnalyze: iso(r.last_analyze),
  }));
}

/**
 * Exact counts for the tables small enough to count.
 *
 * A static UNION over a fixed list, not a name built from anything a caller
 * passed: `COUNTED` is a constant in this file and `log_entries` is
 * deliberately not in it.
 */
export async function exactCounts(q: Queryable): Promise<Record<string, number>> {
  const sql = COUNTED.map(
    (table) => `SELECT '${table}' AS name, count(*)::bigint AS rows FROM ${table}`
  ).join(" UNION ALL ");

  const rows = await q.query<{ name: string; rows: string }>(sql);
  const out: Record<string, number> = {};
  for (const row of rows) out[row.name] = num(row.rows);
  return out;
}

/**
 * What is connected right now, against the ceiling.
 *
 * Scoped to this database rather than the cluster: a managed Postgres runs its
 * own maintenance connections on other databases, and counting those against
 * our pool would make the number lie in the direction that causes a false
 * alarm.
 */
export async function connectionStats(q: Queryable): Promise<ConnectionStats> {
  const rows = await q.query<{
    total: string;
    active: string;
    idle: string;
    idle_in_transaction: string;
    max: string;
  }>(
    `SELECT count(*)                                              AS total,
            count(*) FILTER (WHERE state = 'active')              AS active,
            count(*) FILTER (WHERE state = 'idle')                AS idle,
            count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_transaction,
            current_setting('max_connections')::int               AS max
       FROM pg_stat_activity
      WHERE datname = current_database()`
  );
  const r = rows[0];
  return {
    total: num(r?.total),
    active: num(r?.active),
    idle: num(r?.idle),
    idleInTransaction: num(r?.idle_in_transaction),
    max: num(r?.max),
  };
}

/**
 * The cumulative counters, including the one that matters most.
 *
 * A cache hit ratio below about 0.99 on a database this size means the working
 * set no longer fits in shared buffers, which is the first thing to look at
 * when the dashboard has got slow and nothing about the queries has changed.
 * They are cumulative since `statsReset`, which is why that is returned beside
 * them rather than left for somebody to wonder about.
 */
export async function activityStats(q: Queryable): Promise<ActivityStats> {
  const rows = await q.query<{
    commits: string;
    rollbacks: string;
    blks_read: string;
    blks_hit: string;
    temp_files: string;
    temp_bytes: string;
    deadlocks: string;
    stats_reset: Date | string | null;
  }>(
    `SELECT xact_commit   AS commits,
            xact_rollback AS rollbacks,
            blks_read,
            blks_hit,
            temp_files,
            temp_bytes,
            deadlocks,
            stats_reset
       FROM pg_stat_database
      WHERE datname = current_database()`
  );
  const r = rows[0];
  const read = num(r?.blks_read);
  const hit = num(r?.blks_hit);
  return {
    commits: num(r?.commits),
    rollbacks: num(r?.rollbacks),
    blocksRead: read,
    blocksHit: hit,
    cacheHitRatio: read + hit === 0 ? null : hit / (read + hit),
    tempFiles: num(r?.temp_files),
    tempBytes: num(r?.temp_bytes),
    deadlocks: num(r?.deadlocks),
    statsReset: iso(r?.stats_reset ?? null),
  };
}

/**
 * Entries that ARRIVED on each of the last `days` days, across every workspace.
 *
 * Off `usage_daily`, the one table in the repo filed by arrival rather than by
 * the entry's own timestamp (rule 5's single exception). That is the right axis
 * here: this is the operator asking what the deployment is being asked to
 * write, not a customer asking when their users did something. It is also
 * cheap, because the roll-up is a handful of rows per source per day.
 *
 * `generate_series` on the left, so a day nothing arrived on is a zero in the
 * series rather than a gap the chart closes up.
 */
export async function arrivalsByDay(q: Queryable, days = 30): Promise<ArrivalDay[]> {
  const rows = await q.query<{ day: string; entries: string }>(
    `SELECT d.day::date::text                    AS day,
            coalesce(sum(u.entries), 0)::bigint AS entries
       FROM generate_series(
              current_date - ($1::int - 1),
              current_date,
              interval '1 day'
            ) AS d(day)
       LEFT JOIN usage_daily u ON u.day = d.day::date
      GROUP BY d.day
      ORDER BY d.day`,
    [days]
  );
  return rows.map((r) => ({ day: r.day, entries: num(r.entries) }));
}

/**
 * Everything above, in one round of parallel statements.
 *
 * `Promise.all` rather than a sequence: five independent reads of five
 * catalogues, and the pool has room for them. The exact counts are merged onto
 * the size rows here rather than in SQL, so `relationStats` stays a statement
 * about storage and this stays the only place that knows which tables are small
 * enough to count.
 */
export async function instanceSnapshot(q: Queryable): Promise<InstanceSnapshot> {
  const [server, relations, connections, activity, counts] = await Promise.all([
    serverInfo(q),
    relationStats(q),
    connectionStats(q),
    activityStats(q),
    exactCounts(q),
  ]);

  const merged = relations.map((row) => {
    const exact = counts[row.name];
    return exact === undefined ? row : { ...row, rows: exact, exact: true };
  });

  return {
    server,
    relations: merged,
    connections,
    activity,
    counts,
    entriesStored: merged.find((r) => r.name === "log_entries")?.rows ?? 0,
  };
}

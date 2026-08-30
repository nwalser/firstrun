import type { Queryable } from "./client.js";

/**
 * The one place a log entry becomes a row. There is no second write path.
 *
 * An error, an event and a metric sample all arrive here, and nothing in this
 * file branches on which is which. It does not read `name`, it does not read
 * `severity`, and it does not look inside `attributes`. Ingest validates shape
 * and writes; that is the whole job, and the moment something here starts
 * treating one name differently the backend has grown a special case.
 *
 * Dedup is the primary key doing its job. Every client replays its durable queue
 * after a crash, so the same entry id arriving twice is the normal case rather
 * than an error case: `ON CONFLICT DO NOTHING` absorbs it and the returned count
 * says how many rows were genuinely new.
 *
 * `time` is the client's and is written as it arrived. `ingested_at` is ours.
 * Nothing sorts, buckets, windows or retains on the second one.
 */

export type AttributeValue =
  | string
  | number
  | boolean
  | null
  | AttributeValue[]
  | { [key: string]: AttributeValue };

/**
 * One entry, in the shape the table has.
 *
 * Structural rather than imported from `@firstrun/schema`, so that `db` depends
 * on the SHAPE of an entry and not on the package's parse step. The edge has
 * already validated; asking this layer to re-derive the contract's types would
 * make a write path that cannot be exercised without the whole validator.
 *
 * Timestamps accept a `Date`, epoch milliseconds, or an ISO string, because the
 * wire carries milliseconds and the seed carries `Date`s and neither should
 * have to convert before calling this.
 */
export interface LogEntryInput {
  project_id: string;
  entry_id: string;
  /** OTel `timestamp`. Client-stamped and authoritative. */
  time: Date | number | string;
  /**
   * OTel `observed_timestamp`. Server-stamped. Left out means "now", which is
   * the truth when the row is being written as it arrives.
   */
  observed_timestamp?: Date | number | string | null;
  distinct_id: string;
  /** The OTel 1..24 ladder. Null is unclassified, and unclassified is allowed. */
  severity?: number | null;
  name: string;
  attributes?: Record<string, AttributeValue>;
}

const COLUMNS = [
  "project_id",
  "time",
  "entry_id",
  "ingested_at",
  "distinct_id",
  "severity",
  "name",
  "attributes",
] as const;

/** Casts for the columns Postgres cannot infer from a bare parameter. */
const CASTS: Partial<Record<(typeof COLUMNS)[number], string>> = {
  project_id: "::uuid",
  entry_id: "::uuid",
  severity: "::smallint",
  attributes: "::jsonb",
};

const asDate = (v: Date | number | string): Date => (v instanceof Date ? v : new Date(v));

function valuesFor(e: LogEntryInput, now: Date): unknown[] {
  return [
    e.project_id,
    asDate(e.time),
    e.entry_id,
    e.observed_timestamp === undefined || e.observed_timestamp === null
      ? now
      : asDate(e.observed_timestamp),
    e.distinct_id,
    e.severity ?? null,
    e.name,
    JSON.stringify(e.attributes ?? {}),
  ];
}

/**
 * How many entries go in one statement.
 *
 * Postgres caps a statement at 65535 parameters and each entry is eight, so the
 * hard ceiling is 8191. This sits well under it: a partitioned insert that spans
 * several months touches several tables, and a smaller statement that succeeds
 * beats a larger one that has to be retried whole.
 */
const CHUNK = 500;

/**
 * Writes entries and returns how many were new.
 *
 * Chunked rather than one statement, because a desktop client coming back from
 * a fortnight offline sends its whole queue at once.
 *
 * `ON CONFLICT DO NOTHING` with no conflict target named, deliberately: the only
 * unique constraint on this table is the primary key, and naming it here would
 * mean this file has an opinion about which columns dedup uses. It does not; the
 * schema does. See the primary key comment in db/schema.ts for why `time` is
 * part of it and what that costs.
 */
export async function insertLogEntries(
  sql: Queryable,
  entries: readonly LogEntryInput[]
): Promise<number> {
  if (entries.length === 0) return 0;

  const now = new Date();
  let inserted = 0;

  for (let start = 0; start < entries.length; start += CHUNK) {
    const chunk = entries.slice(start, start + CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((e) => {
      const base = params.length;
      params.push(...valuesFor(e, now));
      return `(${COLUMNS.map((col, i) => `$${base + i + 1}${CASTS[col] ?? ""}`).join(", ")})`;
    });

    const rows = await sql.query<{ entry_id: string }>(
      `INSERT INTO log_entries (${COLUMNS.map((c) => `"${c}"`).join(", ")})
       VALUES ${tuples.join(", ")}
       ON CONFLICT DO NOTHING
       RETURNING entry_id`,
      params
    );
    inserted += rows.length;
  }

  return inserted;
}

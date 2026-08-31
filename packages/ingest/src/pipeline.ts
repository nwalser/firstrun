import { insertLogEntries } from "@firstrun/db/log-entries";
import { recordUsage } from "@firstrun/db/usage";
import type { LogEntry } from "@firstrun/schema/log";
import type { Ctx } from "./context.js";

export interface IngestResult {
  /** Rows that did not exist before this call. */
  accepted: number;
  /** Rows the primary key already had. A replayed queue, not an error. */
  duplicates: number;
}

/** Which source the batch arrived under, for the meter. Taken from the key's row. */
export interface MeterTarget {
  projectId: string;
  sourceId: string;
}

/**
 * The one path every entry takes: store, and let the primary key dedup.
 *
 * There is nothing else to DECIDE. Nothing branches on the name, nothing
 * branches on the severity, nothing derives one entry from another, and nothing
 * here knows that `exception` is different from `page_view`. Ingest validates
 * shape and writes; assigning meaning is the query layer's job, at read time,
 * where it can be changed without a migration.
 *
 * That is worth stating as a rule rather than an observation, because this is
 * exactly where a special case gets added: "errors should also go to X" is one
 * `if` away, and the moment it exists there are two pipelines and two places
 * for a row to be lost.
 *
 * Dedup is the primary key refusing the row, which costs nothing, cannot drift,
 * and cannot be forgotten by a new caller. A desktop queue replaying a week of
 * entries after being offline sends the same entry ids again on purpose: that
 * is the normal case, not an error case.
 *
 * ## The meter is the one thing that happens afterwards
 *
 * It counts, and counting is not branching: every entry adds one, whatever it
 * is called and whatever severity it carries, which is the same rule the rest
 * of this file follows. It reads no plan and enforces no limit, in either
 * edition. Nothing on this path knows whether it is running on the hosted
 * service or on somebody's own box, and nothing here can refuse an entry for
 * commercial reasons.
 *
 * It also cannot fail the request. The rows are durable before it runs, so a
 * throw here would earn a 5xx for work that already succeeded, and every client
 * would retry a batch that can now only deduplicate. Rule 7 outranks the
 * invoice: losing a day of meter is a billing question, and dropping a
 * customer's telemetry is a product one.
 */
export async function ingestEntries(
  ctx: Ctx,
  entries: readonly LogEntry[],
  meter?: MeterTarget
): Promise<IngestResult> {
  if (entries.length === 0) return { accepted: 0, duplicates: 0 };

  const accepted = await insertLogEntries(ctx.store, entries);

  if (meter && accepted > 0) {
    try {
      await recordUsage(ctx.store, meter.projectId, meter.sourceId, accepted);
    } catch (err) {
      console.error("usage meter failed", (err as Error)?.message);
    }
  }

  return { accepted, duplicates: entries.length - accepted };
}

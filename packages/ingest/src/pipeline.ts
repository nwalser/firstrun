import { insertLogEntries } from "@firstrun/db/log-entries";
import type { LogEntry } from "@firstrun/schema/log";
import type { Ctx } from "./context.js";

export interface IngestResult {
  /** Rows that did not exist before this call. */
  accepted: number;
  /** Rows the primary key already had. A replayed queue, not an error. */
  duplicates: number;
}

/**
 * The one path every entry takes: store, and let the primary key dedup.
 *
 * There is nothing else to do. Nothing branches on the name, nothing branches
 * on the severity, nothing derives one entry from another, and nothing here
 * knows that `exception` is different from `page_view`. Ingest validates shape
 * and writes; assigning meaning is the query layer's job, at read time, where
 * it can be changed without a migration.
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
 */
export async function ingestEntries(
  ctx: Ctx,
  entries: readonly LogEntry[]
): Promise<IngestResult> {
  if (entries.length === 0) return { accepted: 0, duplicates: 0 };

  const accepted = await insertLogEntries(ctx.store, entries);
  return { accepted, duplicates: entries.length - accepted };
}

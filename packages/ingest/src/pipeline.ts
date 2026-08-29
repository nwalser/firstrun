import { insertEvents } from "@firstrun/db";
import type { EventEnvelope, StoredEvent } from "@firstrun/schema";
import type { Ctx } from "./context.js";

export interface IngestResult {
  /** Rows that did not exist before this call. */
  accepted: number;
  /** Rows the primary key already had. A replayed queue, not an error. */
  duplicates: number;
  /** Events with no distinct to attribute them to. */
  dropped: number;
}

/**
 * The one path every event takes: resolve, store, dedup.
 *
 * Dedup used to be a lookup against a table of every event id ever seen. It is
 * now the events primary key refusing the row, which means it costs nothing,
 * cannot drift, and cannot be forgotten by a new caller.
 *
 * Resolution is memoised per batch. A desktop queue replaying 200 events after
 * a week offline carries the same install id 200 times, and asking the database
 * who that is 200 times would make the replay the slowest thing in the system.
 */
export async function ingestEnvelopes(
  ctx: Ctx,
  envelopes: readonly EventEnvelope[]
): Promise<IngestResult> {
  if (envelopes.length === 0) return { accepted: 0, duplicates: 0, dropped: 0 };

  const persons = new Map<string, string>();
  const stored: StoredEvent[] = [];
  let dropped = 0;

  for (const e of envelopes) {
    if (!e.web_visitor_id && !e.install_id && !e.account_id) {
      // Consent was never given, or a malformed beacon. There is nothing to
      // attribute it to, and an event with no person is not analytics.
      dropped++;
      continue;
    }

    const key = [e.workspace_id, e.web_visitor_id, e.install_id, e.account_id].join(" ");
    let personId = persons.get(key);
    if (!personId) {
      personId = await ctx.resolver.observe({
        workspace_id: e.workspace_id,
        web_visitor_id: e.web_visitor_id,
        install_id: e.install_id,
        account_id: e.account_id,
      });
      persons.set(key, personId);
    }
    stored.push({ ...e, person_id: personId });
  }

  const accepted = await insertEvents(ctx.store, stored);
  return { accepted, duplicates: stored.length - accepted, dropped };
}

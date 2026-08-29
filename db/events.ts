import type { StoredEvent } from "@firstrun/schema";
import type { Queryable } from "./client.js";

/**
 * The one place an envelope becomes a row.
 *
 * Both timestamps are written. `event_time` came from the client and is what
 * every query buckets on; `ingest_time` is ours and is only read while
 * debugging. See CLAUDE.md rule 2.
 *
 * Dedup is the primary key doing its job. The desktop SDK replays its disk
 * queue after a crash, so the same event id arriving twice is the normal case,
 * not an error case -- `ON CONFLICT DO NOTHING` absorbs it and the returned
 * count says how many were genuinely new. This used to require a side table of
 * every event id ever seen; now it requires nothing.
 */

const COLUMNS = [
  "workspace_id",
  "event_id",
  "source_id",
  "event_name",
  "event_time",
  "ingest_time",
  "surface",
  "person_id",
  "web_visitor_id",
  "install_id",
  "account_id",
  "session_id",
  "app_version",
  "channel",
  "os",
  "arch",
  "locale",
  "url",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "props",
] as const;

/** Casts for the columns Postgres cannot infer from a bare parameter. */
const CASTS: Partial<Record<(typeof COLUMNS)[number], string>> = {
  workspace_id: "::uuid",
  event_id: "::uuid",
  source_id: "::uuid",
  surface: "::surface",
  person_id: "::uuid",
  props: "::jsonb",
};

function valuesFor(e: StoredEvent): unknown[] {
  return [
    e.workspace_id,
    e.event_id,
    e.source_id,
    e.event_name,
    new Date(e.event_time),
    new Date(e.ingest_time),
    e.surface,
    e.person_id,
    e.web_visitor_id,
    e.install_id,
    e.account_id,
    e.session_id,
    e.app_version,
    e.channel,
    e.os,
    e.arch,
    e.locale,
    e.url,
    e.referrer,
    e.utm_source,
    e.utm_medium,
    e.utm_campaign,
    JSON.stringify(e.props ?? {}),
  ];
}

export async function insertEvents(sql: Queryable, events: readonly StoredEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  const params: unknown[] = [];
  const tuples = events.map((e) => {
    const base = params.length;
    params.push(...valuesFor(e));
    const placeholders = COLUMNS.map((col, i) => `$${base + i + 1}${CASTS[col] ?? ""}`);
    return `(${placeholders.join(", ")})`;
  });

  const rows = await sql.query<{ event_id: string }>(
    `INSERT INTO events (${COLUMNS.join(", ")})
     VALUES ${tuples.join(", ")}
     ON CONFLICT (workspace_id, event_id) DO NOTHING
     RETURNING event_id`,
    params
  );
  return rows.length;
}

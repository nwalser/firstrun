import { sql as raw } from "drizzle-orm";
import { ATTR } from "@firstrun/schema/conventions";
import type { Database } from "./client.js";
import { logEntries, projects } from "./schema.js";

/**
 * Reading entries back out, one row at a time.
 *
 * Everything else that reads `log_entries` aggregates: the query compiler
 * answers the five-part question a card is written in, and every number on
 * every board comes out of it. This does not aggregate at all. It is the log
 * view -- the newest entries across a workspace, in the order they happened,
 * with the attributes they carry -- and that is a different question rather
 * than a query the compiler was refusing to answer.
 *
 * It is deliberately NOT reachable from the query AST. A card that could return
 * ten thousand raw rows is a card that can page a project's whole month into a
 * browser, and the AST is compiled from something a customer can save and
 * share. This is one page at a time, bounded, and never saved.
 *
 * Two rules from CLAUDE.md apply to every statement here.
 *
 * Rule 5: the order, the window and the cursor are all on `time`, never on
 * `ingested_at`. A desktop app that replayed a week-old queue this morning
 * belongs where it happened, not at the top of the page. `ingested_at` travels
 * with each row so the difference is READABLE -- that is what it is for -- and
 * nothing sorts by it.
 *
 * Rule 4: every statement carries a `time` range, so the planner prunes to the
 * partitions the window actually touches instead of opening all of them.
 */

/** One entry, as the log view draws it. */
export interface FeedRow {
  projectId: string;
  projectName: string;
  projectSlug: string;
  entryId: string;
  time: Date;
  /** Ours, for debugging. Shown beside `time`, never sorted or bucketed on. */
  ingestedAt: Date;
  distinctId: string;
  severity: number | null;
  name: string;
  attributes: Record<string, unknown>;
}

export interface FeedParams {
  workspaceId: string;
  /** Inclusive. Always set: this is what prunes the partitions. */
  from: Date;
  /** Exclusive, so an entry is never counted into two windows. */
  to: Date;
  /** Narrow to these projects. Empty means every project in the workspace. */
  projectIds?: readonly string[];
  /** Narrow to these sources, by the id the edge stamps as an attribute. */
  sourceIds?: readonly string[];
  /** On the 1..24 ladder. Unclassified entries fall out when this is set. */
  minSeverity?: number | null;
  /** Substring, case-insensitive. See `SEARCHED` below for where it looks. */
  search?: string | null;
  /** Keyset, not an offset: the entry the previous page ended on. */
  before?: { time: Date; entryId: string } | null;
  limit: number;
}

/**
 * The most a single page may carry.
 *
 * A cap here as well as in the contract's parse, because this is the thing that
 * actually reads rows and a caller that skipped the parse still cannot ask for
 * a million of them.
 */
export const FEED_MAX_ROWS = 200;

/**
 * Where a search looks: the name, the client id, and the two attributes that
 * carry a human-readable message.
 *
 * Not the whole attribute map. `attributes::text ILIKE` would match a key as
 * happily as a value and forces every row in the window through a JSON
 * serialisation, and the fields below are the ones somebody typing into this
 * box is actually looking for. A search for any other attribute value is a
 * filter on a card, which is a different tool and an indexed one.
 *
 * `body` is spelled rather than taken from `ATTR`: it is OTel's own field name,
 * it is stored as an attribute like every other non-promoted thing (see
 * `packages/schema/src/log.ts`), and no client of ours emits it, so there is no
 * convention entry to point at.
 */
const SEARCHED = [ATTR.EXCEPTION_MESSAGE, "body"] as const;

export async function feedEntries(db: Database, params: FeedParams): Promise<FeedRow[]> {
  const limit = Math.min(FEED_MAX_ROWS, Math.max(1, Math.trunc(params.limit)));

  const conditions = [
    raw`${logEntries.time} >= ${params.from}`,
    raw`${logEntries.time} < ${params.to}`,
  ];

  // Ids rather than a slug: the caller has already resolved which projects the
  // reader may see, and a slug reaching SQL here would be a second place that
  // decides scope. Bound one parameter per id (drizzle's own `inArray` shape)
  // rather than cast an array, so nothing about this depends on how the driver
  // serialises a JS array.
  const ids = params.projectIds ?? [];
  if (ids.length > 0) {
    conditions.push(raw`${logEntries.projectId} in (${raw.join(ids.map((id) => raw`${id}`), raw`, `)})`);
  }

  const sourceIds = params.sourceIds ?? [];
  if (sourceIds.length > 0) {
    conditions.push(
      raw`${logEntries.attributes} ->> ${ATTR.SOURCE_ID} in (${raw.join(
        sourceIds.map((id) => raw`${id}`),
        raw`, `
      )})`
    );
  }

  // `>=`, so "errors" means ERROR and everything worse rather than the first
  // step of the band. Unclassified entries have a null severity and drop out,
  // which is the honest answer: nothing said they were errors.
  if (params.minSeverity != null) {
    conditions.push(raw`${logEntries.severity} >= ${params.minSeverity}`);
  }

  const needle = params.search?.trim();
  if (needle) {
    // Escaped, because `%` and `_` are wildcards in LIKE and a person typing a
    // key like `page_view` means the underscore literally.
    const pattern = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const fields = [
      raw`${logEntries.name}`,
      raw`${logEntries.distinctId}`,
      ...SEARCHED.map((key) => raw`${logEntries.attributes} ->> ${key}`),
    ];
    conditions.push(
      raw`(${raw.join(
        fields.map((field) => raw`${field} ilike ${pattern} escape '\\'`),
        raw` or `
      )})`
    );
  }

  // The cursor is the pair the order is on, so a page boundary that lands in
  // the middle of a second cannot repeat or skip an entry. An offset would do
  // both the moment anything arrived while somebody was reading.
  if (params.before) {
    conditions.push(
      raw`(${logEntries.time}, ${logEntries.entryId}) <
          (${params.before.time}::timestamptz, ${params.before.entryId}::uuid)`
    );
  }

  const rows = await db.execute<{
    project_id: string;
    project_name: string;
    project_slug: string;
    entry_id: string;
    time: string;
    ingested_at: string;
    distinct_id: string;
    severity: number | string | null;
    name: string;
    attributes: Record<string, unknown> | null;
  }>(raw`
    select ${logEntries.projectId}   as project_id,
           ${projects.name}          as project_name,
           ${projects.slug}          as project_slug,
           ${logEntries.entryId}     as entry_id,
           ${logEntries.time}        as time,
           ${logEntries.ingestedAt}  as ingested_at,
           ${logEntries.distinctId}  as distinct_id,
           ${logEntries.severity}    as severity,
           ${logEntries.name}        as name,
           ${logEntries.attributes}  as attributes
      from ${logEntries}
      join ${projects} on ${projects.id} = ${logEntries.projectId}
     where ${projects.workspaceId} = ${params.workspaceId}
       and ${raw.join(conditions, raw` and `)}
     order by ${logEntries.time} desc, ${logEntries.entryId} desc
     limit ${limit}
  `);

  return rows.rows.map((r) => ({
    projectId: r.project_id,
    projectName: r.project_name,
    projectSlug: r.project_slug,
    entryId: r.entry_id,
    // Selected as an alias rather than as a column, so drizzle hands back
    // whatever `pg` parsed rather than applying the column's decoder. Same trap
    // as `max(time)` in `sourceLastSeen`.
    time: new Date(r.time),
    ingestedAt: new Date(r.ingested_at),
    distinctId: r.distinct_id,
    severity: r.severity === null ? null : Number(r.severity),
    attributes: r.attributes ?? {},
    name: r.name,
  }));
}

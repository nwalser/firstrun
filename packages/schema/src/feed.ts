import { z } from "zod";
import { DateRange } from "./range.js";
import { SEVERITY_BANDS, SEVERITY_RANGE, type SeverityBand } from "./severity.js";

/**
 * What the log view asks for, and what it gets back.
 *
 * The event log is not a board card and this is not the query AST. A card
 * answers the five-part question in `query.ts` and returns numbers; this returns
 * ROWS, one page at a time, and is never saved, never shared and never
 * compiled into a widget. Keeping the two apart is what stops a saved card
 * being a way to page a project's whole month into a browser.
 *
 * It lives in the contract package for the usual reason: the browser builds the
 * request, the server parses it, and both sides have to agree about what a
 * cursor is. The parse is not a formality -- this arrives as a POST body from
 * anybody signed in, so the difference between parsing here and casting here is
 * the difference between a bounded page and an open table.
 */

/** How many entries a page carries. One screenful and a bit, so scrolling pages. */
export const FEED_PAGE = 50;

/** The most any one request may ask for, whatever it claims to want. */
export const FEED_MAX_PAGE = 200;

/**
 * Where a page continues from: the entry the previous page ended on.
 *
 * A keyset, never an offset. The newest entries arrive while somebody is
 * reading, and an offset would silently repeat or skip a row every time one
 * did. The pair is exactly the sort order, so the boundary is unambiguous even
 * when two entries share a millisecond.
 */
export const FeedCursor = z.object({
  /** The entry's `time`, as an ISO instant. Client-stamped, like the sort. */
  time: z.string().datetime({ offset: true }),
  entryId: z.string().uuid(),
});

export type FeedCursor = z.infer<typeof FeedCursor>;

export const FeedRequest = z.object({
  /** The window, in the same vocabulary a board's range is written in. */
  range: DateRange,
  /** Project slugs. Empty means every project the reader can see. */
  projects: z.array(z.string().max(120)).max(100).optional(),
  /** Source ids. Empty means every source. */
  sources: z.array(z.string().uuid()).max(200).optional(),
  /**
   * The floor on the severity ladder, as a band.
   *
   * A band rather than a number, because a band is what a person reads and
   * filters on, and `>=` on its first step is what "errors and worse" means.
   * Null is no constraint at all, which also keeps the unclassified entries:
   * nothing said they were errors, and nothing said they were not.
   */
  severity: z.enum(SEVERITY_BANDS).nullable().optional(),
  /** Substring. The server decides which fields it looks at, and bounds it. */
  search: z.string().max(200).nullable().optional(),
  before: FeedCursor.nullable().optional(),
  limit: z.number().int().min(1).max(FEED_MAX_PAGE).optional(),
});

export type FeedRequest = z.infer<typeof FeedRequest>;

/** The floor a band filter puts on the 1..24 ladder, or null for no floor. */
export const severityFloor = (band: SeverityBand | null | undefined): number | null =>
  band ? SEVERITY_RANGE[band].min : null;

/** The window the log view opens on. A day, because a log is read from the top. */
export const FEED_RANGE: DateRange = { kind: "last", days: 1 };

/** The windows the log view offers, shortest first. */
export const FEED_RANGES: DateRange[] = [
  { kind: "last", days: 1 },
  { kind: "last", days: 7 },
  { kind: "last", days: 30 },
];

/**
 * One entry, as the wire carries it.
 *
 * Instants are ISO strings rather than `Date`s: this crosses a server function
 * boundary, and a shape that survives JSON is one fewer thing to get wrong than
 * a shape that happens to survive the current serialiser.
 *
 * `attributes` arrives whole. Bounded at write time (`attributes.ts`), so
 * "whole" is a known size, and a log view that hid half of what an entry
 * carries would send people to psql.
 */
export interface FeedEntry {
  projectId: string;
  projectName: string;
  projectSlug: string;
  entryId: string;
  /** OTel `timestamp`. What everything here sorts, windows and pages on. */
  time: string;
  /** OTel `observed_timestamp`. Shown so a late entry is readable AS late. */
  ingestedAt: string;
  distinctId: string;
  severity: number | null;
  name: string;
  attributes: Record<string, unknown>;
}

export interface FeedPage {
  entries: FeedEntry[];
  /** The resolved window, so the page can state what it is showing. */
  from: string;
  to: string;
  /**
   * True when the page filled up, so there is probably more behind it.
   *
   * "Probably" is the honest word: a page that comes back exactly full may or
   * may not have a row after it, and asking is one more query than a Load more
   * button is worth.
   */
  more: boolean;
}

export const emptyFeedPage = (): FeedPage => ({
  entries: [],
  from: new Date(0).toISOString(),
  to: new Date(0).toISOString(),
  more: false,
});

/**
 * Two pages merged, newest first, with each entry appearing once.
 *
 * The live refresh re-reads the HEAD of the feed rather than asking for
 * everything after a cursor: a poll that missed more than one page would
 * otherwise leave a hole in the middle of the list with nothing on screen
 * saying so. Merging by identity makes the poll idempotent, and the identity is
 * `(project, entry)` because an entry id is minted by a client and is only
 * unique inside the project it was written to.
 *
 * When the fresh head does not reach the top of what is already loaded, the old
 * rows are dropped rather than left below a gap: a list with a silent hole in it
 * is worse than a shorter list.
 */
export function mergeFeed(head: readonly FeedEntry[], existing: readonly FeedEntry[]): FeedEntry[] {
  if (head.length === 0) return [...existing];

  const id = (e: FeedEntry) => `${e.projectId}:${e.entryId}`;
  const seen = new Set(head.map(id));
  const overlaps = existing.some((e) => seen.has(id(e)));
  if (!overlaps) return [...head];

  const merged = [...head];
  for (const entry of existing) {
    if (seen.has(id(entry))) continue;
    seen.add(id(entry));
    merged.push(entry);
  }
  return merged;
}

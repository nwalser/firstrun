import { z } from "zod";
import type { Attributes } from "./attributes.js";
import { FilterSchema, type Filter } from "./query.js";
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

/**
 * The windows the log offers, as hours back from NOW.
 *
 * Hours rather than a `DateRange`, and this is the one place in the product
 * where that is right. A board's range is a range of CALENDAR DAYS on purpose
 * (`range.ts`): "the 3rd to the 9th" has to stay the 3rd to the 9th for whoever
 * opens it, so `{ kind: "last", days: 1 }` resolves to today's midnight and not
 * to a rolling twenty-four hours.
 *
 * A log is read from the top and answers "what just happened". Resolved the
 * calendar way, its shortest window says "nothing received" at 00:30 to
 * somebody whose app was busy an hour earlier, which is both true and useless.
 * So the log rolls, and its labels say hours.
 */
export const FEED_WINDOWS = [24, 24 * 7, 24 * 30] as const;

/** How far back the log opens. One day, because a log is read from the top. */
export const FEED_HOURS = 24;

/**
 * The longest window any read of this table may open, however it is asked for.
 *
 * Rule 4: every statement carries a `time` range so the planner prunes to the
 * partitions it touches. A window is bounded here rather than trusted, because
 * both ways of asking for one arrive from a browser.
 */
export const FEED_MAX_HOURS = 24 * 90;

/**
 * A pinned window, in place of the rolling one.
 *
 * The log itself rolls (see `FEED_WINDOWS`), and that is right for "what just
 * happened". The rows behind a card are a different question: a card's number
 * is its board's whole range, which may be pinned to calendar dates in the
 * past, so the drill-down states its window instead of counting back from now.
 * A rolling window there would page a different set of entries than the number
 * was measured over, which is precisely the thing somebody opened it to check.
 */
export const FeedWindow = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

export type FeedWindow = z.infer<typeof FeedWindow>;

export const FeedRequest = z.object({
  /** How many hours back from now. Bounded: every read prunes partitions. */
  hours: z
    .number()
    .int()
    .min(1)
    .max(FEED_MAX_HOURS)
    .optional(),
  /** A pinned window instead of the rolling one. Wins over `hours` when set. */
  window: FeedWindow.nullable().optional(),
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
  /**
   * The entries behind one number, as the filter that number was measured with.
   *
   * The same tree a card is written in, parsed by the same schema and compiled
   * by the same compiler, because "url.path starts with /pricing" has to select
   * the same entries here as it does on the board. A card that shows a total
   * nobody can check is the reason this exists: the number and the rows behind
   * it now come from one definition rather than two.
   *
   * This still returns rows, one bounded page at a time, and is still never
   * saved. A filter arriving here is a question asked once, not a widget.
   */
  filter: FilterSchema.nullable().optional(),
  before: FeedCursor.nullable().optional(),
  limit: z.number().int().min(1).max(FEED_MAX_PAGE).optional(),
});

export type FeedRequest = z.infer<typeof FeedRequest>;

/**
 * The window one request opens, whichever way it asked for one.
 *
 * One function rather than two branches at the call site, because the bound is
 * the point: a pinned window is clamped to the same span a rolling one is
 * capped at, and a `to` before its `from` collapses to an empty window rather
 * than to an unbounded scan.
 */
export function feedWindow(request: FeedRequest, now: Date = new Date()): {
  from: Date;
  to: Date;
} {
  const cap = FEED_MAX_HOURS * 3_600_000;

  if (request.window) {
    const to = new Date(request.window.to);
    const from = new Date(request.window.from);
    if (!Number.isFinite(to.getTime()) || !Number.isFinite(from.getTime())) {
      return { from: new Date(now.getTime() - FEED_HOURS * 3_600_000), to: now };
    }
    if (from >= to) return { from: to, to };
    const floor = new Date(to.getTime() - cap);
    return { from: from < floor ? floor : from, to };
  }

  return { from: new Date(now.getTime() - (request.hours ?? FEED_HOURS) * 3_600_000), to: now };
}

/**
 * The rows behind one card, as a request.
 *
 * The card's own filter over the card's own window, scoped to the card's own
 * project. Built here, in the contract, so the drawer that asks and the server
 * that answers cannot disagree about what "the entries behind this number"
 * means.
 */
export const drillRequest = (options: {
  window: FeedWindow;
  project: string;
  filter: Filter;
}): FeedRequest => ({
  window: options.window,
  projects: [options.project],
  filter: options.filter,
  limit: FEED_PAGE,
});

/** The floor a band filter puts on the 1..24 ladder, or null for no floor. */
export const severityFloor = (band: SeverityBand | null | undefined): number | null =>
  band ? SEVERITY_RANGE[band].min : null;

/**
 * One entry, as the wire carries it.
 *
 * Instants are ISO strings rather than `Date`s: this crosses a server function
 * boundary, and a shape that survives JSON is one fewer thing to get wrong than
 * a shape that happens to survive the current serialiser.
 *
 * `attributes` arrives whole, typed as the contract's own `Attributes` rather
 * than as `Record<string, unknown>`. Two reasons, and only one of them is
 * tidiness: the map is bounded at write time (`attributes.ts`), so "whole" is a
 * known size; and a server function's return type is checked for
 * serialisability, which `unknown` fails -- correctly, because nothing would
 * then stop a `Date` or a `Map` being put in one.
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
  attributes: Attributes;
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

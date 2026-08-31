import {
  CANVAS_WIDTH,
  MAX_WIDGETS,
  MAX_WIDGET_H,
  MAX_WIDGET_Y,
  MIN_WIDGET_H,
  MIN_WIDGET_W,
  normaliseRect,
  type Rect,
} from "./canvas.js";
import { Comparison, DateRange } from "./range.js";
import { ATTR } from "./conventions.js";
import { z } from "zod";
import {
  FilterSchema,
  LogQuery,
  Visualisation,
  emptyFilter,
  queryKey,
  type Filter,
} from "./query.js";
import { allOf } from "./recipes.js";

/**
 * A board is an arrangement of saved queries.
 *
 * A widget is a query and a way of drawing its answer, and that is the whole
 * definition: there is no catalogue of card kinds behind it and nothing in this
 * file branches on what a card is "for". The presets in the web app and the
 * templates in `templates.ts` are starting points somebody then edits, so no
 * card on a board can reach a question the customer could not have built
 * themselves.
 *
 * ## Keys are derived, never passed
 *
 * `boardRequests` keys what it fetches by `queryKey(effectiveQuery(...))`, and
 * the component that draws an answer looks it up by calling the same two
 * functions on the same widget. That is what stops fetch and render
 * disagreeing, and it is why two cards asking the same question share one query
 * and one result for free.
 */

// ---------------------------------------------------------------------------
// The widgets
// ---------------------------------------------------------------------------

/**
 * Bumped when a stored board can no longer be read as it stands.
 *
 * A board that does not carry the current stamp is not read: `parseBoard`
 * returns an empty one. There is no reader for an older shape, and adding one
 * is a decision to keep two descriptions of a board alive at once.
 */
export const BOARD_VERSION = 1;

/**
 * Where a card sits. Not a setting.
 *
 * These four numbers are edited by dragging the card and its edges, never by
 * typing into a drawer, and the canvas owns them. A settings surface that grows
 * a width box has reintroduced the flow layout one input at a time.
 */
const geometry = {
  x: z.number().int().min(0).max(CANVAS_WIDTH).default(0),
  y: z.number().int().min(0).max(MAX_WIDGET_Y).default(0),
  w: z.number().int().min(MIN_WIDGET_W).max(CANVAS_WIDTH).default(400),
  h: z.number().int().min(MIN_WIDGET_H).max(MAX_WIDGET_H).default(220),
};

const base = {
  ...geometry,
  /** Stable within a board. Lets the editor move things without remounting. */
  id: z.string().min(1).max(64),
  title: z.string().max(60).optional(),
};

export const QueryWidget = z.object({
  ...base,
  kind: z.literal("query"),
  viz: Visualisation,
  query: LogQuery,
  /** Draw the change against the board's comparison window. */
  compare: z.boolean().default(false),
  /**
   * A small daily series behind a single number.
   *
   * Keyed identically to a chart card asking the same question, so a board with
   * one page-view chart and five page-view sparklines runs the series once.
   */
  sparkline: z.boolean().default(false),
});

export type QueryWidget = z.infer<typeof QueryWidget>;

/** A note on the board. The one widget with no query behind it. */
export const NoteWidget = z.object({
  ...base,
  kind: z.literal("note"),
  body: z.string().max(2000).default(""),
});

export type NoteWidget = z.infer<typeof NoteWidget>;

export const BoardWidget = z.discriminatedUnion("kind", [QueryWidget, NoteWidget]);
export type BoardWidget = z.infer<typeof BoardWidget>;

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * Filters that belong to the board rather than to the person looking at it.
 *
 * "Only the marketing site" is a property of a board called *Marketing site*:
 * it should survive a reload, a link sent to a colleague, and the next person
 * to open it. It is a filter tree like any other, ANDed into every card's query
 * before the key is derived, so two boards with different permanent filters
 * never share a cached answer.
 *
 * An empty AND means no constraint, never "nothing": a board that started empty
 * and hid everything would be a board that opens blank.
 */
const BoardFilter = FilterSchema.default(() => emptyFilter());

export const Board = z.object({
  version: z.literal(BOARD_VERSION).default(BOARD_VERSION),
  range: DateRange.default({ kind: "last", days: 30 }),
  comparison: Comparison.default({ kind: "previous" }),
  filter: BoardFilter,
  /**
   * Which of the two worlds this board is looking at. False is production.
   *
   * It sits beside `range` rather than inside `filter` because it is the same
   * kind of statement: not a condition somebody built, but the frame the whole
   * board is read in. Putting it in the filter tree would let a picker delete it
   * by accident and would make "this board shows test data" a thing you have to
   * read a filter chip to discover.
   *
   * Defaulted rather than versioned. A board that does not say means
   * production, which is the only thing it could have meant, so there is
   * nothing for a version bump to decide. `BOARD_VERSION` is for a board that
   * can no longer be READ as it stands; a board missing this field still can.
   */
  testMode: z.boolean().default(false),
  widgets: z.array(BoardWidget).max(MAX_WIDGETS).default([]),
});

export type Board = z.infer<typeof Board>;

export const emptyBoard = (): Board => ({
  version: BOARD_VERSION,
  range: { kind: "last", days: 30 },
  comparison: { kind: "previous" },
  filter: emptyFilter(),
  testMode: false,
  widgets: [],
});

// ---------------------------------------------------------------------------
// Reading one
// ---------------------------------------------------------------------------

/**
 * Read a board from storage or from a POST body.
 *
 * Anything unreadable becomes an empty board rather than an error, and one
 * unreadable card is dropped on its own rather than taking the arrangement with
 * it: a board that will not render because one stored widget lost an argument
 * is a board somebody has to rebuild from memory. Each part falls back
 * separately, so a corrupt range cannot also cost the board its cards.
 *
 * The version stamp is checked FIRST, and that order is load-bearing. Every
 * geometry field has a default, so a widget from a shape this file no longer
 * describes validates as a perfectly good placed widget at 0,0 with the default
 * size; trying the schema first would therefore never fail and would silently
 * stack every card of a saved board in the top-left corner. A board that does
 * not carry the current stamp is not readable, and an empty board somebody can
 * rebuild beats a plausible-looking one that means something else.
 */
export function parseBoard(raw: unknown): Board {
  if (!raw || typeof raw !== "object") return emptyBoard();
  const stored = raw as Record<string, unknown>;
  if (stored.version !== BOARD_VERSION) return emptyBoard();

  return {
    version: BOARD_VERSION,
    range: or(DateRange.safeParse(stored.range), { kind: "last", days: 30 }),
    comparison: or(Comparison.safeParse(stored.comparison), { kind: "previous" }),
    filter: or(BoardFilter.safeParse(stored.filter), emptyFilter()),
    // Anything but a stored `true` is production: showing test data to somebody
    // who did not ask for it is the worse of the two failures.
    testMode: stored.testMode === true,
    widgets: readWidgets(stored.widgets),
  };
}

const or = <T>(result: z.SafeParseReturnType<unknown, T>, fallback: T): T =>
  result.success ? result.data : fallback;

function readWidgets(raw: unknown): BoardWidget[] {
  if (!Array.isArray(raw)) return [];
  const out: BoardWidget[] = [];
  for (const stored of raw) {
    if (out.length >= MAX_WIDGETS) break;
    const parsed = BoardWidget.safeParse(stored);
    if (parsed.success) out.push(withRect(parsed.data, normaliseRect(parsed.data)));
  }
  return out;
}

const withRect = <T extends BoardWidget>(widget: T, rect: Rect): T => ({ ...widget, ...rect });

// ---------------------------------------------------------------------------
// What a board asks
// ---------------------------------------------------------------------------

const hasConstraint = (filter: Filter | undefined): boolean =>
  filter !== undefined && !(filter.op === "and" && filter.filters.length === 0);

/** The frame a board is read in: production, or test. Never both. */
export type BoardFrame = Pick<Board, "filter" | "testMode">;

/**
 * Entries a board in this mode is allowed to see.
 *
 * Both directions compile to a plain boolean over one GIN lookup, which is the
 * whole reason the attribute is only ever written as `true`:
 *
 *   test        `attributes @> '{"firstrun.test": true}'`
 *   production  `NOT (attributes @> '{"firstrun.test": true}')`
 *
 * The negation is the case worth being careful about. `@>` returns false for a
 * row without the key rather than NULL, so `NOT` of it is TRUE and production
 * rows match. Had this been written as `ne` over an extracted value, absent
 * would have extracted to NULL, `NOT NULL` would be NULL, and every production
 * row in the database would have quietly failed the filter. The regression test
 * in `packages/schema/test/test-mode.test.ts` is that sentence, executable.
 */
export const testFrameFilter = (testMode: boolean): Filter => {
  const isTest: Filter = {
    op: "eq",
    field: { kind: "attribute", path: [ATTR.TEST] },
    value: true,
  };
  return testMode ? isTest : { op: "not", filter: isTest };
};

/**
 * A card's query with the board's frame and permanent filter folded in.
 *
 * Both the planner and the card call this before deriving a key, so a board
 * filtered to one source and the same board unfiltered are two different
 * questions with two different keys, and two cards on ONE board asking the same
 * thing are one question with one key.
 *
 * The frame goes in FIRST and unconditionally. That it is unconditional is what
 * makes the toggle trustworthy: there is no arrangement of widget, board filter
 * or missing field that produces a query which sees both worlds at once. It
 * also means flipping the toggle re-derives every key on the board, so the
 * production answers already in the snapshot can never be drawn under the test
 * heading while the new ones are still in flight.
 */
export function effectiveQuery(board: BoardFrame, widget: QueryWidget): LogQuery {
  const parts: Filter[] = [testFrameFilter(board.testMode)];
  if (hasConstraint(board.filter)) parts.push(board.filter!);
  const own = widget.query.filter;
  if (hasConstraint(own)) parts.push(own!);
  return { ...widget.query, filter: parts.length === 1 ? parts[0]! : allOf(parts) };
}

/**
 * The zone a derived series is bucketed in. Fixed, and shared, on purpose.
 *
 * A sparkline is not a chart somebody built, so nobody chose a zone for it. It
 * has to be the same one on both sides of the wire and the same one for two
 * colleagues, or the key derived from it stops matching and one question
 * becomes two answers.
 */
const SPARKLINE_TZ = "UTC";

/**
 * The daily series behind a single number.
 *
 * The same question with a bucket on it, so it keys identically to a chart card
 * asking the same thing and the two share one round trip.
 *
 * A sparkline is ONE filled series, so the four parts that would make it more
 * than one go: `groupBy`, `withTotal`, `orderBy` and `limit`. A filled series
 * cannot also be grouped or totalled -- the compiler refuses both pairs, and it
 * refuses them for the whole board rather than for the one card that asked --
 * and the other two are silently wrong rather than loud: a limit of 10 carried
 * onto a series truncates it to ten days, and an order by an aggregate stops a
 * chart drawn left to right from being chronological.
 *
 * They are DELETED rather than set to a default. An explicit default written
 * out longhand compiles to the same statement but canonicalises to a different
 * key, and a key that differs where the question does not is a second entry in
 * the plan for one answer.
 *
 * The zone is fixed rather than the reader's, and it has to be: this runs on
 * both sides to derive a key, and a key computed from the server's timezone and
 * looked up under the browser's would never match. A chart the reader builds
 * stores whichever zone they chose, and then genuinely is a different question
 * from a UTC one, because its days start somewhere else.
 */
export function sparklineQuery(query: LogQuery): LogQuery {
  const { withTotal: _total, groupBy: _groups, orderBy: _order, limit: _limit, ...rest } = query;
  return { ...rest, bucket: { unit: "day", timezone: SPARKLINE_TZ }, fill: true };
}

/**
 * Whether a card draws a daily shape behind its number.
 *
 * Shared, because `boardRequests` decides what to FETCH and
 * `widgetSparklineKey` decides what to LOOK UP. A predicate written out twice
 * that drifts leaves a card drawing an empty line, or a query nobody reads.
 *
 * A GROUPED question has none. The number a grouped card shows is the first
 * row, which is one group's answer, and a series over every group is not that
 * number drawn over time: it is a different question under the same heading.
 * `sparklineQuery` would flatten it into an honest series of the total, and
 * that is honest about itself and dishonest about the number above it.
 */
const hasSparkline = (widget: QueryWidget): boolean =>
  widget.viz === "number" && widget.sparkline && (widget.query.groupBy ?? []).length === 0;

export interface BoardRequest {
  key: string;
  query: LogQuery;
  /** True when at least one card asking this wants it measured twice. */
  compare: boolean;
}

/**
 * Every query a board needs, deduplicated, in one list.
 *
 * The layout is known before any SQL runs, so this is decided up front rather
 * than one query per card as each one mounts. The compiler deduplicates a
 * second time on the compiled statement, which catches two queries that differ
 * only in an explicit default somebody wrote out longhand.
 */
export function boardRequests(board: Board): BoardRequest[] {
  const seen = new Map<string, BoardRequest>();

  const want = (query: LogQuery, compare: boolean) => {
    const key = queryKey(query);
    const found = seen.get(key);
    if (found) found.compare ||= compare;
    else seen.set(key, { key, query, compare });
  };

  for (const widget of board.widgets) {
    if (widget.kind !== "query") continue;
    const query = effectiveQuery(board, widget);
    want(query, widget.compare);
    // A number card's sparkline is the same question with a bucket on it, and
    // it is never compared: a delta is drawn from the number, not the series.
    if (hasSparkline(widget)) want(sparklineQuery(query), false);
  }

  return [...seen.values()];
}

/** The key a card's own answer is filed under. Derived on both sides, never stored. */
export const widgetKey = (board: BoardFrame, widget: QueryWidget): string =>
  queryKey(effectiveQuery(board, widget));

/** The key a card's sparkline is filed under, or null when it has none. */
export const widgetSparklineKey = (
  board: BoardFrame,
  widget: QueryWidget
): string | null =>
  hasSparkline(widget) ? queryKey(sparklineQuery(effectiveQuery(board, widget))) : null;

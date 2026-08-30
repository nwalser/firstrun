import {
  CANVAS_WIDTH,
  MAX_WIDGETS,
  MIN_WIDGET_H,
  MIN_WIDGET_W,
  normaliseRect,
  snapToGrid,
  type Rect,
} from "./canvas.js";
import { Comparison, DateRange } from "./range.js";
import { ATTR, NAME } from "./conventions.js";
import { z } from "zod";
import {
  FilterSchema,
  LogQuery,
  Visualisation,
  emptyFilter,
  queryKey,
  uniquesAggregation,
  type Filter,
  type Scalar,
} from "./query.js";

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

/** Bumped when a stored board can no longer be read as it stands. */
export const BOARD_VERSION = 4;

/**
 * Where a card sits. Not a setting.
 *
 * These four numbers are edited by dragging the card and its edges, never by
 * typing into a drawer, and the canvas owns them. A settings surface that grows
 * a width box has reintroduced the flow layout one input at a time.
 */
const geometry = {
  x: z.number().int().min(0).max(CANVAS_WIDTH).default(0),
  y: z.number().int().min(0).max(40000).default(0),
  w: z.number().int().min(MIN_WIDGET_W).max(CANVAS_WIDTH).default(400),
  h: z.number().int().min(MIN_WIDGET_H).max(3000).default(220),
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
   * Defaulted rather than versioned. Every stored board predates this field and
   * every one of them meant production, which is exactly what the default says,
   * so there is nothing for a migration to decide. `BOARD_VERSION` is for a
   * board that can no longer be READ as it stands; this one still can.
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
 * is a board somebody has to rebuild from memory.
 *
 * The version stamp is checked FIRST, and that order is load-bearing. Every
 * geometry field has a default, so an older widget validates as a perfectly
 * good placed widget at 0,0 with the default size; trying the current schema
 * first would therefore never fail, never reach the migration, and silently
 * stack every card of a saved board in the top-left corner.
 */
export function parseBoard(raw: unknown): Board {
  if (raw && typeof raw === "object") {
    const stored = raw as Record<string, unknown>;
    if (stored.version === BOARD_VERSION) {
      return {
        version: BOARD_VERSION,
        range: or(DateRange.safeParse(stored.range), { kind: "last", days: 30 }),
        comparison: or(Comparison.safeParse(stored.comparison), { kind: "previous" }),
        filter: or(BoardFilter.safeParse(stored.filter), emptyFilter()),
        // Anything but a stored `true` is production, which is what a board
        // written before this field existed meant and what a corrupt value
        // should fall back to: showing test data to somebody who did not ask
        // for it is the worse of the two failures.
        testMode: stored.testMode === true,
        widgets: readWidgets(stored.widgets),
      };
    }
  }
  return fromLegacy(raw);
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
// The old catalogue, read once
// ---------------------------------------------------------------------------

/**
 * The stored columns the old breakdown dimensions meant, as attribute paths.
 *
 * They were columns when a board could only group by seven things. They are
 * attributes now, reached by path, and the conventional key for each is what
 * the clients have always written.
 */
const LEGACY_DIMENSIONS: Record<string, string> = {
  path: ATTR.URL_PATH,
  referrer_host: ATTR.REFERRER_HOST,
  utm_source: ATTR.UTM_SOURCE,
  utm_campaign: ATTR.UTM_CAMPAIGN,
  os: ATTR.OS_TYPE,
  locale: ATTR.BROWSER_LANGUAGE,
  app_version: ATTR.SERVICE_VERSION,
};

/**
 * The timezone a migrated bucket is drawn in.
 *
 * UTC rather than the reader's own zone, because a stored board is shared: a
 * migration that stamped whichever browser happened to open it first would give
 * two colleagues two different daily charts of the same data, and neither of
 * them would know why. New buckets pick up the builder's suggestion, which the
 * person choosing it can see.
 */
const MIGRATED_TZ = "UTC";

const attr = (key: string, as?: "number") => ({ kind: "attribute" as const, path: [key], ...(as ? { as } : {}) });

const nameIs = (name: string): Filter => ({
  op: "eq",
  field: { kind: "column", column: "name" },
  value: name,
});

const oneOf = (key: string, values: readonly string[]): Filter => ({
  op: "in",
  field: attr(key),
  values: [...values] as Scalar[],
});

const and = (parts: Filter[]): Filter => ({ op: "and", filters: parts });

/** `events` counts rows, `uniques` counts people. The old two units, as aggregations. */
const unitAggregation = (unit: string) =>
  unit === "events" ? ({ fn: "count" } as const) : uniquesAggregation();

const rankByFirst = [{ key: { aggregate: 0 }, direction: "desc" } as const];

/**
 * A stored card from before the query layer, normalised.
 *
 * The old catalogue is deleted, so this is the only description of it left, and
 * it is deliberately loose: every field is read defensively out of whatever
 * JSON is stored, because the thing being read was by definition written by a
 * version of the code that no longer exists.
 */
interface LegacyWidget {
  id: string;
  title?: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  event: string;
  unit: "events" | "uniques";
  chart: Visualisation;
  dimension: string;
  limit: number;
  compare: boolean;
  sparkline: boolean;
  body: string;
}

/**
 * What the old closed metric list meant, as an entry name and a unit.
 *
 * The three nulls had no entry behind them: `quiet_installs` was a negation
 * ("no launch in N days"), `bounce_rate` and `avg_duration` were ratios over
 * `page_leave` attributes. None is a count of an entry, so none survives as
 * one, and those cards are dropped rather than turned into a number that means
 * something else.
 */
const LEGACY_METRICS: Record<string, { event: string; unit: "events" | "uniques" } | null> = {
  visited: { event: NAME.PAGE_VIEW, unit: "uniques" },
  downloaded: { event: "download_started", unit: "uniques" },
  first_run: { event: NAME.APP_INSTALL, unit: "uniques" },
  day7: { event: NAME.APP_LAUNCH, unit: "uniques" },
  paid: { event: "purchase", unit: "uniques" },
  active_installs: { event: NAME.APP_LAUNCH, unit: "uniques" },
  quiet_installs: null,
  page_views: { event: NAME.PAGE_VIEW, unit: "events" },
  sessions: { event: NAME.SESSION_START, unit: "events" },
  bounce_rate: null,
  avg_duration: null,
};

/** What those cards were called, kept as a title so a migrated board reads the same. */
const LEGACY_LABELS: Record<string, string> = {
  visited: "Visited",
  downloaded: "Downloaded",
  first_run: "First run",
  day7: "Day 7",
  paid: "Paid",
  active_installs: "Active installs",
  page_views: "Page views",
  sessions: "Sessions",
};

/** Entry names renamed by an earlier pivot. Applied wherever one is stored. */
const LEGACY_RENAMES: Record<string, string> = { app_first_run: NAME.APP_INSTALL };

const str = (v: unknown, fallback: string): string => (typeof v === "string" && v ? v : fallback);

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const legacyChart = (v: unknown): Visualisation => (v === "bar" || v === "area" ? v : "line");

/** `people` was the old name for `uniques`. Anything but `events` counts people. */
const legacyUnit = (v: unknown): "events" | "uniques" => (v === "events" ? "events" : "uniques");

/**
 * One stored card, as a `LegacyWidget`, or null when nothing is left of it.
 *
 * v2 cards named a metric out of a closed list; v3 cards name an entry. Both go
 * down this path, and every step is idempotent, so a v3 card reads as itself
 * rather than through a second code path nobody exercises.
 */
function readLegacyWidget(input: unknown): LegacyWidget | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const id = str(raw.id, "");
  if (!id) return null;

  const type = str(raw.type, "");
  const rect = normaliseRect({
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: num(raw.w, 400),
    h: num(raw.h, 220),
  });

  let event = LEGACY_RENAMES[str(raw.event, "")] ?? str(raw.event, "");
  let unit = legacyUnit(raw.unit);
  let title = typeof raw.title === "string" && raw.title ? raw.title : undefined;

  if (!event) {
    const key = str(raw.metric, "") || str(raw.step, "");
    const target = LEGACY_METRICS[key];
    if (target) {
      event = target.event;
      unit = target.unit;
      title = title ?? LEGACY_LABELS[key];
    } else if (type === "metric" || type === "timeseries" || type === "funnel_step") {
      // A counting card with nothing left to count. `versions`, `web_vitals`
      // and `text` never named an entry, so they are unaffected.
      return null;
    }
  }

  return {
    id,
    title,
    // A lone funnel step was a count of one entry, which is what a number is.
    type: type === "funnel_step" ? "metric" : type,
    ...rect,
    event: event || NAME.PAGE_VIEW,
    unit,
    chart: legacyChart(raw.chart),
    dimension: str(raw.dimension, "path"),
    limit: Math.min(50, Math.max(1, Math.round(num(raw.limit, 10)))),
    compare: raw.compare !== false,
    sparkline: raw.sparkline !== false,
    body: typeof raw.body === "string" ? raw.body : "",
  };
}

/**
 * One card of the old catalogue, as a query and a visualisation, or null.
 *
 * `funnel` and `retention` return null and their cards are dropped. Neither is
 * expressible in a filter, a group by, an aggregation, a bucket and a limit:
 * both need a self-join on the entries of one unique in a particular order,
 * which is a different shape of question and not one this query layer answers.
 * Turning them into a number that means something else would be worse than
 * losing the card, because nobody would notice.
 */
function fromLegacyWidget(w: LegacyWidget): BoardWidget | null {
  const at = { id: w.id, title: w.title, x: w.x, y: w.y, w: w.w, h: w.h };

  switch (w.type) {
    case "metric":
      return {
        ...at,
        kind: "query",
        viz: "number",
        compare: w.compare,
        sparkline: w.sparkline,
        query: { filter: nameIs(w.event), aggregations: [unitAggregation(w.unit)] },
      };

    case "timeseries":
      return {
        ...at,
        kind: "query",
        viz: w.chart,
        compare: w.compare,
        sparkline: false,
        query: {
          filter: nameIs(w.event),
          aggregations: [unitAggregation(w.unit)],
          bucket: { unit: "day", timezone: MIGRATED_TZ },
          fill: true,
        },
      };

    case "breakdown":
      return {
        ...at,
        kind: "query",
        viz: "list",
        compare: false,
        sparkline: false,
        query: {
          filter: nameIs(w.event),
          groupBy: [attr(LEGACY_DIMENSIONS[w.dimension] ?? ATTR.URL_PATH)],
          aggregations: [unitAggregation(w.unit)],
          orderBy: rankByFirst,
          limit: w.limit,
          withTotal: true,
        },
      };

    // Installs per version was a breakdown with a bespoke query behind it. The
    // "quiet cohort" half of that card measured silence, which is the absence
    // of entries and not something a filter over entries can express, so what
    // survives is the half that was a ranking.
    case "versions":
      return {
        ...at,
        kind: "query",
        viz: "list",
        compare: false,
        sparkline: false,
        query: {
          groupBy: [attr(ATTR.SERVICE_VERSION)],
          aggregations: [uniquesAggregation()],
          orderBy: rankByFirst,
          limit: 20,
          withTotal: true,
        },
      };

    case "web_vitals":
      return {
        ...at,
        kind: "query",
        viz: "table",
        compare: false,
        sparkline: false,
        query: {
          filter: nameIs(NAME.WEB_VITAL),
          groupBy: [attr(ATTR.METRIC)],
          aggregations: [
            { fn: "percentile", field: attr(ATTR.VALUE, "number"), p: 0.75 },
            { fn: "count" },
          ],
          orderBy: [{ key: { group: 0 }, direction: "asc" }],
          limit: 10,
        },
      };

    case "text":
      return { ...at, kind: "note", body: w.body };

    // `funnel`, `retention`, the deleted `join_health` card, and anything a
    // version we never shipped happened to write.
    default:
      return null;
  }
}

/** The board's permanent filters, as one filter tree. */
function fromLegacyFilters(raw: unknown): Filter {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

  const parts: Filter[] = [];
  const add = (key: string, values: string[]) => {
    if (values.length) parts.push(oneOf(key, values));
  };
  add(ATTR.SOURCE_ID, list(f.sourceIds));
  add(ATTR.OS_TYPE, list(f.os));
  add(ATTR.CHANNEL, list(f.channel));
  add(ATTR.SERVICE_VERSION, list(f.appVersion));
  return and(parts);
}

/**
 * v1 laid cards out in a three-column flow. v2 and v3 place them.
 *
 * The migration reproduces what the flow was already showing (same order, same
 * relative widths, packed into rows of three) so a board somebody arranged does
 * not rearrange itself the first time they open it after a deploy. The column
 * is 400 with a 40px gutter rather than 413 with 20, because three columns and
 * two gaps have to add up to 1280 with all five numbers on the 20px grid, and
 * that is the only division that does.
 */
function placeV1(widgets: readonly unknown[]): unknown[] {
  const gap = 40;
  const col = (CANVAS_WIDTH - gap * 2) / 3;
  const heightFor = (type: string) =>
    type === "funnel" ? 200 : type === "metric" || type === "join_health" ? 160 : 300;

  let x = 0;
  let y = 0;
  let rowHeight = 0;
  const placed: unknown[] = [];

  for (const stored of widgets) {
    const raw = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
    const span = Math.min(3, Math.max(1, Math.round(num(raw.width, 1))));
    const width = snapToGrid(col * span + gap * (span - 1));
    if (x + width > CANVAS_WIDTH) {
      x = 0;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    const height = heightFor(str(raw.type, ""));
    placed.push({ ...raw, x, y, w: width, h: height });
    x += width + gap;
    rowHeight = Math.max(rowHeight, height);
  }
  return placed;
}

/**
 * Everything a stored v1, v2 or v3 board still means.
 *
 * Anything unreadable becomes an empty board rather than an error, and one
 * unreadable card is dropped on its own: a board that will not render because
 * one stored widget lost an argument is a board somebody has to rebuild from
 * memory. Each part of the board falls back separately, so a corrupt range
 * cannot also cost the board its cards.
 */
function fromLegacy(raw: unknown): Board {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const isV1 = stored.version === undefined;
  const storedWidgets = Array.isArray(stored.widgets) ? stored.widgets : [];
  const placed = isV1 ? placeV1(storedWidgets) : storedWidgets;

  const widgets: BoardWidget[] = [];
  for (const card of placed) {
    if (widgets.length >= MAX_WIDGETS) break;
    const legacy = readLegacyWidget(card);
    if (!legacy) continue;
    const migrated = fromLegacyWidget(legacy);
    if (!migrated) continue;
    const parsed = BoardWidget.safeParse(withRect(migrated, normaliseRect(migrated)));
    if (parsed.success) widgets.push(parsed.data);
  }

  // A v1 board carried its window as a day count and its one filter as a
  // source id.
  const v1Days = Math.min(365, Math.max(1, Math.round(num(stored.rangeDays, 30))));
  const v1Source = typeof stored.sourceId === "string" ? [stored.sourceId] : [];

  return {
    version: BOARD_VERSION,
    range: or(DateRange.safeParse(stored.range), { kind: "last", days: v1Days }),
    comparison: or(Comparison.safeParse(stored.comparison), { kind: "previous" }),
    filter: isV1 ? fromLegacyFilters({ sourceIds: v1Source }) : fromLegacyFilters(stored.filters),
    // No board old enough to reach this function has ever seen test data:
    // nothing was writing the attribute when they were saved.
    testMode: false,
    widgets,
  };
}

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
  return { ...widget.query, filter: parts.length === 1 ? parts[0]! : and(parts) };
}

/**
 * The daily series behind a single number.
 *
 * The same question with a bucket on it, so it keys identically to a chart card
 * asking the same thing and the two share one round trip.
 *
 * `withTotal` is DELETED rather than set to false. An explicit default written
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
  const { withTotal: _total, ...rest } = query;
  return { ...rest, bucket: { unit: "day", timezone: MIGRATED_TZ }, fill: true };
}

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
    if (widget.viz === "number" && widget.sparkline) want(sparklineQuery(query), false);
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
  widget.viz === "number" && widget.sparkline
    ? queryKey(sparklineQuery(effectiveQuery(board, widget)))
    : null;

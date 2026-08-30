import { sparklineQuery, type BoardRequest } from "./board.js";
import {
  queryKey,
  uniquesAggregation,
  type Filter,
  type LogQuery,
} from "./query.js";
import type { Comparison, DateRange } from "./range.js";
import { SEVERITY } from "./severity.js";

/**
 * What the project overview asks.
 *
 * The overview is a fixed page, not a board: nobody arranges it, nothing on it
 * is dragged and none of it is saved. What it has in common with a board is
 * everything that matters -- every question below is written in the same five
 * parts a customer's own card is written in, so there is nothing here the query
 * builder could not have produced. The overview is a starting point, not a
 * capability.
 *
 * The questions live in the contract package because BOTH sides need them. The
 * server derives the keys it files answers under; the page derives the same
 * keys to look them up. Neither passes one to the other, which is what stops
 * fetch and render disagreeing.
 */

/**
 * A week, against the week before it. Fixed, because this page has no picker.
 *
 * A board is where a range is a choice. The overview answers "is this thing
 * alive, and what is it saying" and that question has one sensible window.
 */
export const OVERVIEW_RANGE: DateRange = { kind: "last", days: 7 };
export const OVERVIEW_COMPARISON: Comparison = { kind: "previous" };

/** How many names the ranked card lists before it says "+n more". */
export const OVERVIEW_NAME_LIMIT = 5;

/**
 * Anything at ERROR or worse.
 *
 * A filter on the severity column, which is all "errors" has ever meant here:
 * there is no error table, no error pipeline and nothing on the server that
 * branches on this number. A customer whose crash reporter logs at WARN edits
 * the same filter on a card of their own.
 */
const atLeastError: Filter = {
  op: "gte",
  field: { kind: "column", column: "severity" },
  value: SEVERITY.ERROR,
};

export interface OverviewQuestions {
  /** Every entry in the window. The headline figure. */
  entries: LogQuery;
  /**
   * The daily shape of that same question.
   *
   * `sparklineQuery` rather than a hand-written bucket, so the hero chart and
   * the sparkline under the headline are ONE question with one key and one
   * round trip, instead of two that happen to draw the same line.
   */
  series: LogQuery;
  /** Uniques, by the one definition of a unique. Never summed across surfaces. */
  uniques: LogQuery;
  errors: LogQuery;
  /** What is being sent, most first. A group by on the name column, bounded. */
  names: LogQuery;
}

export function overviewQuestions(): OverviewQuestions {
  const entries: LogQuery = { aggregations: [{ fn: "count" }] };
  return {
    entries,
    series: sparklineQuery(entries),
    uniques: { aggregations: [uniquesAggregation()] },
    errors: { filter: atLeastError, aggregations: [{ fn: "count" }] },
    names: {
      groupBy: [{ kind: "column", column: "name" }],
      aggregations: [{ fn: "count" }],
      orderBy: [{ key: { aggregate: 0 }, direction: "desc" }],
      limit: OVERVIEW_NAME_LIMIT,
      withTotal: true,
    },
  };
}

/**
 * Every query the overview needs, deduplicated, in one list.
 *
 * The same shape `boardRequests` returns and for the same reason: the page is
 * known before any SQL runs, so the queries are decided up front rather than
 * one per card as each one mounts. The entries sparkline and the hero chart
 * collapse into a single request here, which is the dedup earning its keep on a
 * page of six cards.
 */
export function overviewRequests(): BoardRequest[] {
  const q = overviewQuestions();
  const seen = new Map<string, BoardRequest>();

  const want = (query: LogQuery, compare: boolean) => {
    const key = queryKey(query);
    const found = seen.get(key);
    if (found) found.compare ||= compare;
    else seen.set(key, { key, query, compare });
  };

  // Each headline is measured twice (this window and the last) and drawn with
  // its own daily shape behind it. A sparkline is never compared: the delta is
  // read off the number, not the series.
  for (const measure of [q.entries, q.uniques, q.errors]) {
    want(measure, true);
    want(sparklineQuery(measure), false);
  }

  // The hero chart is the entries sparkline with a comparison line on it, so
  // this raises `compare` on a request that already exists rather than adding
  // one.
  want(q.series, true);
  want(q.names, false);

  return [...seen.values()];
}

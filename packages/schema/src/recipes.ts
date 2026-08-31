import { ATTR } from "./conventions.js";
import { SEVERITY, type SeverityBand } from "./severity.js";
import {
  uniquesAggregation,
  type Aggregation,
  type Bucket,
  type EntryColumn,
  type Field,
  type Filter,
  type LogQuery,
  type Order,
  type Scalar,
} from "./query.js";

/**
 * The small vocabulary every starting point is written in.
 *
 * A preset and a board template both build the same handful of query shapes:
 * "one name, counted", "one attribute, ranked", "errors, per day". Each used to
 * keep its own private copy of `attr`, `nameIs` and `rankByFirst`, and two
 * copies of a query builder is a chance for two starting points to mean subtly
 * different things by the same words. They live here instead.
 *
 * Nothing in this file is a capability. Every function returns a `LogQuery` the
 * builder can produce and a customer can edit, which is the rule the whole
 * catalogue is held to: a starting point that needed a special case in the
 * query layer would be a starting point that lied about what the product does.
 *
 * It deliberately knows nothing about boards, cards or geometry. A recipe is
 * the QUESTION; where the answer is drawn and how big it is are the caller's,
 * and that is why this can be shared by the contract package's own templates
 * and by the app's palette without either importing the other.
 */

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/** A top-level attribute key as a field. Dots in the key are part of the key. */
export const attr = (key: string, as?: "number"): Field => ({
  kind: "attribute",
  path: [key],
  ...(as ? { as } : {}),
});

/** A promoted column as a field. */
export const column = (name: EntryColumn): Field => ({ kind: "column", column: name });

/** The `name` column, which is what nearly every starting point filters on. */
export const NAME_FIELD: Field = { kind: "column", column: "name" };

/** The severity column. A number on the 1..24 ladder, never a band name. */
export const SEVERITY_FIELD: Field = { kind: "column", column: "severity" };

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const nameIs = (name: string): Filter => ({ op: "eq", field: NAME_FIELD, value: name });

export const nameIn = (names: readonly string[]): Filter => ({
  op: "in",
  field: NAME_FIELD,
  values: [...names] as Scalar[],
});

export const attrIn = (key: string, values: readonly string[]): Filter => ({
  op: "in",
  field: attr(key),
  values: [...values] as Scalar[],
});

/**
 * Everything one source wrote.
 *
 * The id the edge stamps, never the ingest key and never the name: a key can be
 * rotated and a name can be changed, and a board that narrowed itself by either
 * would silently start matching nothing. Written once here because a board
 * scoped to a source, the source overview and any card somebody builds by hand
 * must all mean the same thing by "only this source".
 */
export const sourceIs = (sourceId: string): Filter => ({
  op: "eq",
  field: attr(ATTR.SOURCE_ID),
  value: sourceId,
});

/** An AND of parts. An empty one is "no constraint", which is what AND means. */
export const allOf = (parts: Filter[]): Filter => ({ op: "and", filters: parts });

/**
 * At or above a band on the ladder.
 *
 * `>=` on the band's FIRST step, so "errors" means ERROR and everything worse
 * rather than the one unqualified number. This is the whole of what "an error"
 * has ever meant here: a filter on a column. There is no error table and
 * nothing on the server branches on this value.
 */
export const atLeast = (band: SeverityBand): Filter => ({
  op: "gte",
  field: SEVERITY_FIELD,
  value: SEVERITY[band],
});

// ---------------------------------------------------------------------------
// Ordering and bucketing
// ---------------------------------------------------------------------------

/** Biggest first, by the query's first aggregation. What "ranked" means. */
export const RANK_BY_FIRST: Order[] = [{ key: { aggregate: 0 }, direction: "desc" }];

/** The group values in their own order, for a table nobody wants re-sorted. */
export const BY_FIRST_GROUP: Order[] = [{ key: { group: 0 }, direction: "asc" }];

export const dailyIn = (timezone: string): Bucket => ({ unit: "day", timezone });

/** Entries, or the people behind them. The two units every starting point picks between. */
export const COUNT: Aggregation = { fn: "count" };
export const UNIQUES = (): Aggregation => uniquesAggregation();

export type Unit = "entries" | "uniques";

export const unitAggregation = (unit: Unit): Aggregation =>
  unit === "entries" ? COUNT : uniquesAggregation();

// ---------------------------------------------------------------------------
// Whole questions
// ---------------------------------------------------------------------------

/** One number: how much of something happened in the window. */
export const totalQuery = (unit: Unit, filter?: Filter): LogQuery => ({
  ...(filter ? { filter } : {}),
  aggregations: [unitAggregation(unit)],
});

/**
 * The same number, drawn over time.
 *
 * `fill` so an empty day is a gap in the line rather than a day the chart skips,
 * which is why it cannot also be grouped: the compiler refuses that pair and so
 * does the validator.
 */
export const seriesQuery = (unit: Unit, timezone: string, filter?: Filter): LogQuery => ({
  ...(filter ? { filter } : {}),
  aggregations: [unitAggregation(unit)],
  bucket: dailyIn(timezone),
  fill: true,
});

/** One attribute or column, ranked, with the total behind the visible rows. */
export const rankingQuery = (options: {
  by: Field;
  unit?: Unit;
  filter?: Filter;
  limit?: number;
  /** A second column, so a ranking can show both units side by side. */
  also?: Aggregation;
}): LogQuery => ({
  ...(options.filter ? { filter: options.filter } : {}),
  groupBy: [options.by],
  aggregations: [
    unitAggregation(options.unit ?? "uniques"),
    ...(options.also ? [options.also] : []),
  ],
  orderBy: RANK_BY_FIRST,
  limit: options.limit ?? 10,
  withTotal: true,
});

/**
 * Every Core Web Vital at the 75th percentile.
 *
 * The one recipe that reads an attribute as a NUMBER, which is required before
 * any numeric aggregation will touch it: a percentile over values that were
 * sometimes text is a number nobody can defend.
 */
export const vitalsQuery = (name: string): LogQuery => ({
  filter: nameIs(name),
  groupBy: [attr(ATTR.METRIC)],
  aggregations: [{ fn: "percentile", field: attr(ATTR.VALUE, "number"), p: 0.75 }, COUNT],
  orderBy: BY_FIRST_GROUP,
  limit: 10,
});

/** A percentile of one numeric attribute per group. Durations, sizes, depths. */
export const percentileQuery = (options: {
  by: Field;
  value: string;
  p: number;
  filter?: Filter;
  limit?: number;
}): LogQuery => ({
  ...(options.filter ? { filter: options.filter } : {}),
  groupBy: [options.by],
  aggregations: [
    { fn: "percentile", field: attr(options.value, "number"), p: options.p },
    COUNT,
  ],
  orderBy: RANK_BY_FIRST,
  limit: options.limit ?? 15,
});

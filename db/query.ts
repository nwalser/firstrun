import { ATTR_SEGMENT_RE, MAX_ATTR_PATH } from "@firstrun/schema/attributes";
import { ATTR } from "@firstrun/schema/conventions";
import type { Queryable } from "./client.js";

/**
 * The query layer. One compiler, from a query AST to parameterised SQL.
 *
 * A dashboard widget is a saved query plus a visualisation: a filter tree, a
 * group by, aggregations, an optional time bucket, an order and a limit. This
 * file is the only thing that turns one into SQL, and it is the only thing that
 * needs auditing for injection.
 *
 * ## The safety rule, and it has no exceptions
 *
 * EVERY value and EVERY attribute path is a bound parameter. Every identifier
 * is generated here from a closed set. Nothing a caller supplies is ever
 * concatenated into the statement text -- not a column name, not a path
 * segment, not a limit, not the timezone, not the bucket unit.
 *
 *   - column names come from `ENTRY_COLUMNS` and are matched, not interpolated
 *   - attribute paths bind as ONE `text[]` parameter and Postgres walks it,
 *     so a segment made entirely of quotes and semicolons is looked up as a key
 *     that does not exist and yields null
 *   - output aliases (`bucket`, `g0`, `a0`) are generated from indexes
 *   - `GROUP BY` uses ordinals, which are integers this file produced
 *   - `LIMIT`, the percentile fraction, the bucket unit and the timezone are
 *     all bound
 *
 * The path regex below is belt and braces rather than the defence itself. If a
 * future change builds an expression by concatenation instead of by binding,
 * the guarantee is gone and no regex puts it back.
 *
 * ## What the GIN index can actually use
 *
 * `log_entries.attributes` carries a GIN index with the DEFAULT `jsonb_ops`
 * operator class. Three predicate forms are index-eligible, and the compiler
 * reaches for them whenever the shape of the filter allows:
 *
 *   INDEX-ELIGIBLE
 *     `attributes @> $n::jsonb`   equality on a path of object keys, and each
 *                                 branch of an `in` over such a path
 *     `attributes ? $n`           existence of a TOP-LEVEL key
 *     `attributes ?| $n::text[]`  existence of any of several top-level keys
 *
 *   NOT INDEX-ELIGIBLE, and honestly so
 *     `attributes #>> $n::text[] <op> $m`   every comparison that is not
 *                                 equality: ordering, prefix, substring, and
 *                                 anything on a path with an array index in it
 *     negation of any of the above -- `ne`, `not_in`, `not_exists`, `not`
 *     numeric comparison on an attribute, which has to extract before it can
 *     compare
 *
 * A query built only out of the second list still runs; it just scans whatever
 * the promoted columns narrowed it to first. That is the trade the schema
 * makes, written down where it can be checked rather than assumed: put the
 * project, the name, the severity and the window in the filter and the btrees
 * do the narrowing, and the GIN index only has to finish the job.
 *
 * `jsonb_path_ops` would make the containment cases smaller and faster and
 * would drop `?` and `?|` entirely. See the index comment in
 * migrations/0000_initial.sql for why that trade went the other way.
 */

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * The promoted columns a query may name. Closed, and closed here.
 *
 * `project_id` is deliberately absent: it is the scope every query is run
 * inside, not a thing a query chooses. A caller cannot widen out of its own
 * project by writing a filter.
 */
export const ENTRY_COLUMNS = [
  "time",
  "name",
  "severity",
  "entry_id",
  "ingested_at",
] as const;

export type EntryColumn = (typeof ENTRY_COLUMNS)[number];

const isEntryColumn = (s: unknown): s is EntryColumn =>
  typeof s === "string" && (ENTRY_COLUMNS as readonly string[]).includes(s);

/**
 * The only attribute keys this file names, because the unique definition names
 * them. `ATTR_SEGMENT_RE` and `MAX_ATTR_PATH` come from the contract too: the
 * compiler and the validator have to agree on what a path is, and two copies of
 * a regex is how they stop agreeing.
 *
 * Order matters and is the definition: best available identity first.
 */
const UNIQUE_ATTRS = [ATTR.USER_ID, ATTR.DEVICE_ID, ATTR.SESSION_ID] as const;

export type Scalar = string | number | boolean | null;

/**
 * Where a value comes from.
 *
 * `unique` is not a column and not an attribute: it is the ONE definition of a
 * unique in this product, `coalesce` over `user.id`, `device.id` and
 * `session.id` in that order. Best available identity wins: an identified
 * client folds into its user, an anonymous one falls back on its machine, and a
 * client that knows neither is counted once per visit. Nothing else ever merges
 * two ids, and two sources are never folded together at all.
 *
 * An entry carrying none of the three yields NULL and is counted in no unique.
 * `count(distinct ...)` already ignores nulls, so a server that never set an
 * identity reports zero uniques on however many entries, which is the truth.
 *
 * It is a case in the AST rather than something a caller assembles, because a
 * caller who assembled it slightly differently would produce a number that
 * looked like a unique count and was not.
 */
export type Field =
  | { kind: "column"; column: EntryColumn }
  /**
   * A path into `attributes`. The first segment is a whole top-level key and
   * may contain dots -- `exception.type` is ONE key, because the OTel semantic
   * conventions are flat dotted names. Later segments walk nested JSON, or an
   * array by numeric string.
   *
   * `as` says how the leaf is read. `text` is the default and is what a filter
   * or a group by wants. `number` is required before a numeric aggregation will
   * touch it, and reads only entries where the leaf is genuinely a JSON number:
   * a leaf holding the string "12" yields null rather than twelve, because a
   * percentile computed over values that were sometimes text and sometimes
   * numbers is a number nobody can defend.
   */
  | { kind: "attribute"; path: readonly string[]; as?: "text" | "number" }
  | { kind: "unique" };

export type Filter =
  | { op: "and"; filters: readonly Filter[] }
  | { op: "or"; filters: readonly Filter[] }
  | { op: "not"; filter: Filter }
  | { op: "eq" | "ne"; field: Field; value: Scalar }
  | { op: "in" | "not_in"; field: Field; values: readonly Scalar[] }
  | { op: "lt" | "lte" | "gt" | "gte"; field: Field; value: string | number }
  | { op: "contains" | "starts_with" | "ends_with"; field: Field; value: string }
  | { op: "exists" | "not_exists"; field: Field };

/**
 * There is no regex operator, and that is a decision rather than an omission.
 * `~` on a caller-supplied pattern is a denial of service with a friendly face:
 * one nested quantifier and a backtracking scan over a partition is a wedged
 * connection. `contains` covers what people actually reach for.
 */

export const AGGREGATE_FNS = [
  "count",
  "count_distinct",
  "sum",
  "avg",
  "min",
  "max",
  "percentile",
] as const;

export type AggregateFn = (typeof AGGREGATE_FNS)[number];

/**
 * Every aggregation returns a NUMBER, which is why `min`/`max`/`sum`/`avg` and
 * `percentile` take only numeric fields: an attribute read `as: "number"`, the
 * `severity` column, or `time`. `min(time)` comes back as epoch milliseconds so
 * "last seen" is one number in the same array as everything else rather than a
 * second shape the caller has to branch on.
 */
export type Aggregation =
  | { fn: "count" }
  | { fn: "count_distinct"; field: Field }
  | { fn: "sum" | "avg" | "min" | "max"; field: Field }
  /** `p` is a fraction: 0.75 is the 75th percentile. Interpolated, not nearest. */
  | { fn: "percentile"; field: Field; p: number };

export const BUCKET_UNITS = ["minute", "hour", "day", "week", "month"] as const;
export type BucketUnit = (typeof BUCKET_UNITS)[number];

export interface Bucket {
  unit: BucketUnit;
  /**
   * An IANA name. Buckets are drawn in somebody's local reckoning or they are
   * drawn wrong: "yesterday" in Zurich is not "yesterday" in UTC, and a daily
   * chart that silently splits an evening across two bars is a chart people
   * learn to distrust.
   */
  timezone: string;
}

/** What an order clause points at. Indexes into the query's own arrays. */
export type OrderKey =
  | { bucket: true }
  | { group: number }
  | { aggregate: number };

export interface Order {
  key: OrderKey;
  direction: "asc" | "desc";
}

export const MAX_LIMIT = 10_000;
export const MAX_GROUPS = 4;
export const MAX_AGGREGATIONS = 8;
/** How many branches an `in` may carry before it stops being a filter. */
export const MAX_IN_VALUES = 200;
/** How deep a filter tree may nest. Guards the compiler's own recursion. */
export const MAX_FILTER_DEPTH = 8;

export interface LogQuery {
  filter?: Filter;
  /** Nothing here means one row for the whole window (or one row per bucket). */
  groupBy?: readonly Field[];
  /** At least one. A query that measures nothing has no answer to return. */
  aggregations: readonly Aggregation[];
  bucket?: Bucket;
  orderBy?: readonly Order[];
  limit?: number;
  /**
   * Adds `total`: the first aggregation summed over EVERY group, computed
   * before the limit is applied.
   *
   * A share has to be a share of the traffic, not a share of the top ten. This
   * is a window function over the grouped rows, so it costs one pass and not a
   * second query.
   */
  withTotal?: boolean;
  /**
   * Emits a row for every bucket in the window, including the ones nothing
   * happened in.
   *
   * A line chart that closes its own gaps turns a two-day outage into a gentle
   * slope. Done in SQL rather than in TypeScript because only the database can
   * step a bucket correctly: "one day later" in a zone that observed a DST
   * change is twenty-three or twenty-five hours, and a millisecond walk in the
   * client produces a bucket that matches nothing the database grouped.
   *
   * Requires `bucket`, and refuses `groupBy`: filling a grouped query means
   * inventing the cross product of buckets and groups, which is a decision
   * about which groups exist that this compiler cannot make.
   */
  fill?: boolean;
}

/** The window and the project a query runs inside. Never part of the AST. */
export interface QueryScope {
  projectId: string;
  /** Inclusive. */
  from: Date;
  /** EXCLUSIVE, so no bucket is ever half-counted. */
  to: Date;
}

export interface QueryRow {
  /** Null when the query is not bucketed. */
  bucket: Date | null;
  /**
   * One entry per `groupBy`, in order. Null is a real answer: the entry does
   * not carry that attribute. It is not folded into a string, because "no
   * campaign" and the campaign literally named "null" are different rows.
   */
  group: Array<string | null>;
  /** One entry per aggregation, in order. Null when nothing was measurable. */
  value: Array<number | null>;
  /** Only present when `withTotal` was set. */
  total?: number | null;
}

export interface CompiledQuery {
  text: string;
  params: unknown[];
}

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}

// ---------------------------------------------------------------------------
// Parameter binding
// ---------------------------------------------------------------------------

/**
 * The only way a value reaches the statement.
 *
 * `bind` returns the placeholder text and keeps the value. There is no other
 * path from a caller's data into `text`, and every function below takes this
 * rather than building strings, which is what makes the safety rule checkable
 * by reading the file instead of by trusting it.
 */
class Params {
  readonly values: unknown[] = [];

  /**
   * What every column reference in this statement is prefixed with.
   *
   * Empty for the query compiler's own statements, which select from
   * `log_entries` and nothing else, so a bare `"name"` is unambiguous. The log
   * view joins `projects` -- which has a `name` column of its own -- so a
   * fragment spliced into that statement has to say which `name` it means.
   * Postgres does not guess, and a filter that resolved to the wrong table
   * would be worse than one that failed to parse.
   *
   * A table NAME, not caller text: it is quoted here and nothing else about the
   * fragment is built by concatenation.
   */
  readonly qualify: string;

  constructor(table?: string) {
    this.qualify = table ? `"${table}".` : "";
  }

  bind(value: unknown, cast = ""): string {
    this.values.push(value);
    return `$${this.values.length}${cast}`;
  }

  /** One promoted column, qualified for the statement being built. */
  col(column: EntryColumn): string {
    return `${this.qualify}${COLUMN_SQL[column]}`;
  }

  /** The attribute map, qualified likewise. */
  get attributes(): string {
    return `${this.qualify}"attributes"`;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function checkPath(path: readonly string[]): readonly string[] {
  if (path.length === 0) throw new QueryError("attribute path is empty");
  if (path.length > MAX_ATTR_PATH) {
    throw new QueryError(`attribute path is deeper than ${MAX_ATTR_PATH} segments`);
  }
  for (const seg of path) {
    if (typeof seg !== "string" || !ATTR_SEGMENT_RE.test(seg)) {
      throw new QueryError(`invalid attribute path segment: ${JSON.stringify(seg)}`);
    }
  }
  return path;
}

function checkField(field: Field): Field {
  switch (field?.kind) {
    case "column":
      if (!isEntryColumn(field.column)) {
        throw new QueryError(`unknown column: ${JSON.stringify(field.column)}`);
      }
      return field;
    case "attribute":
      checkPath(field.path);
      if (field.as !== undefined && field.as !== "text" && field.as !== "number") {
        throw new QueryError(`unknown attribute reading: ${JSON.stringify(field.as)}`);
      }
      return field;
    case "unique":
      return field;
    default:
      throw new QueryError(`unknown field kind: ${JSON.stringify((field as { kind?: unknown })?.kind)}`);
  }
}

/** Whether a field yields a number, which is what the numeric aggregations need. */
function isNumericField(field: Field): boolean {
  if (field.kind === "attribute") return field.as === "number";
  if (field.kind === "column") return field.column === "severity" || field.column === "time" ||
    field.column === "ingested_at";
  return false;
}

// ---------------------------------------------------------------------------
// Field expressions
// ---------------------------------------------------------------------------

const COLUMN_SQL: Record<EntryColumn, string> = {
  time: `"time"`,
  name: `"name"`,
  severity: `"severity"`,
  entry_id: `"entry_id"`,
  ingested_at: `"ingested_at"`,
};

/**
 * A field as text: what a filter compares and what a group by groups on.
 *
 * The attribute case binds the whole path as ONE `text[]` and lets Postgres do
 * the walk. There is nowhere in `attributes #>> $1::text[]` for a segment to
 * become syntax.
 */
function textExpr(field: Field, p: Params): string {
  switch (field.kind) {
    case "column":
      // `::text` on every column, including the timestamps: a group by has to
      // produce one comparable type, and a caller that wanted an instant asked
      // for a bucket instead.
      return `${p.col(field.column)}::text`;
    case "attribute":
      return `${p.attributes} #>> ${p.bind(field.path, "::text[]")}`;
    case "unique": {
      const reads = UNIQUE_ATTRS.map((key) => `${p.attributes} ->> ${p.bind(key)}`);
      return `coalesce(${reads.join(", ")})`;
    }
  }
}

/**
 * A field as a number.
 *
 * The attribute case reads the leaf as jsonb and casts only when it IS a JSON
 * number. Postgres has no try-cast, and the alternative -- extracting text and
 * casting -- throws the whole query away the first time one entry in ten
 * million carries "n/a" where a duration was expected. A null is a row that did
 * not measure anything, which every aggregate here already ignores.
 *
 * Timestamps come back as epoch MILLISECONDS, so a `min(time)` lands in the
 * same numeric array as a count and the caller does not branch on which
 * aggregation it asked for.
 */
function numberExpr(field: Field, p: Params): string {
  switch (field.kind) {
    case "column":
      if (field.column === "severity") return `${p.col("severity")}::numeric`;
      if (field.column === "time" || field.column === "ingested_at") {
        return `(extract(epoch from ${p.col(field.column)}) * 1000)`;
      }
      throw new QueryError(`column ${field.column} is not numeric`);
    case "attribute": {
      const path = p.bind(field.path, "::text[]");
      return `(CASE WHEN jsonb_typeof(${p.attributes} #> ${path}) = 'number'
                    THEN (${p.attributes} #> ${path})::numeric END)`;
    }
    case "unique":
      throw new QueryError("the unique key is not numeric");
  }
}

/** Text or number, by the field's own declaration. */
const valueExpr = (field: Field, p: Params): string =>
  isNumericField(field) && field.kind === "attribute" ? numberExpr(field, p) : textExpr(field, p);

// ---------------------------------------------------------------------------
// Containment: the index-eligible shape
// ---------------------------------------------------------------------------

/**
 * Whether a path can be expressed as containment.
 *
 * Containment walks OBJECT keys. A segment that is all digits might be an array
 * index -- `items.0.sku` -- and `@> {"items":{"0":...}}` would silently fail to
 * match the array form. Falling back to extraction is slower and right; using
 * containment here would be fast and wrong.
 */
const containable = (path: readonly string[]): boolean =>
  path.every((seg, i) => i === 0 || !/^\d+$/.test(seg));

/** `["http","route"], "/x"` -> `{"http":{"route":"/x"}}`. */
function nest(path: readonly string[], value: Scalar): Record<string, unknown> {
  let acc: unknown = value;
  for (let i = path.length - 1; i >= 0; i--) acc = { [path[i]!]: acc };
  return acc as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The filter tree
// ---------------------------------------------------------------------------

const TRUE = "TRUE";
const FALSE = "FALSE";

function compileFilter(filter: Filter, p: Params, depth = 0): string {
  if (depth > MAX_FILTER_DEPTH) {
    throw new QueryError(`filter nests deeper than ${MAX_FILTER_DEPTH}`);
  }

  switch (filter?.op) {
    case "and":
    case "or": {
      const parts = filter.filters.map((f) => compileFilter(f, p, depth + 1));
      // An empty AND is "no constraint" and an empty OR is "match nothing".
      // Both are what the words mean, and both are what a half-built filter
      // in a picker should do while somebody is still building it.
      if (parts.length === 0) return filter.op === "and" ? TRUE : FALSE;
      return `(${parts.join(filter.op === "and" ? " AND " : " OR ")})`;
    }

    case "not":
      return `(NOT ${compileFilter(filter.filter, p, depth + 1)})`;

    case "eq":
    case "ne": {
      const field = checkField(filter.field);
      const positive = eqExpr(field, filter.value, p);
      return filter.op === "eq" ? positive : `(NOT ${positive})`;
    }

    case "in":
    case "not_in": {
      const field = checkField(filter.field);
      if (filter.values.length > MAX_IN_VALUES) {
        throw new QueryError(`in takes at most ${MAX_IN_VALUES} values`);
      }
      if (filter.values.length === 0) {
        // Empty means "match nothing", not "no constraint". A caller that meant
        // the second leaves the filter out; a caller that built an empty list
        // from an empty selection means the first, and quietly widening it to
        // everything is how a board shows numbers nobody asked for.
        return filter.op === "in" ? FALSE : TRUE;
      }
      const positive = inExpr(field, filter.values, p);
      return filter.op === "in" ? positive : `(NOT ${positive})`;
    }

    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const field = checkField(filter.field);
      const sqlOp = { lt: "<", lte: "<=", gt: ">", gte: ">=" }[filter.op];
      // Ordering on the promoted columns keeps the column's own type, so the
      // btree can be used. Everything else extracts first and cannot.
      if (field.kind === "column") {
        return `(${p.col(field.column)} ${sqlOp} ${p.bind(columnValue(field.column, filter.value))})`;
      }
      if (isNumericField(field)) {
        return `(${numberExpr(field, p)} ${sqlOp} ${p.bind(filter.value)}::numeric)`;
      }
      return `(${textExpr(field, p)} ${sqlOp} ${p.bind(String(filter.value))})`;
    }

    case "contains":
    case "starts_with":
    case "ends_with": {
      const field = checkField(filter.field);
      // The pattern is built from the caller's text with LIKE's own
      // metacharacters escaped, then BOUND. The caller cannot smuggle a `%`
      // that turns "starts with foo" into "contains foo", let alone SQL.
      const escaped = escapeLike(filter.value);
      const pattern =
        filter.op === "contains"
          ? `%${escaped}%`
          : filter.op === "starts_with"
            ? `${escaped}%`
            : `%${escaped}`;
      return `(${textExpr(field, p)} LIKE ${p.bind(pattern)} ESCAPE '\\')`;
    }

    case "exists":
    case "not_exists": {
      const field = checkField(filter.field);
      const positive = existsExpr(field, p);
      return filter.op === "exists" ? positive : `(NOT ${positive})`;
    }

    default:
      throw new QueryError(`unknown filter op: ${JSON.stringify((filter as { op?: unknown })?.op)}`);
  }
}

/**
 * Equality, reaching for containment whenever the shape allows it.
 *
 * Containment is the index-eligible form, and it is also the more truthful one:
 * `@> {"http.response.status_code": 500}` matches the JSON number 500 and not
 * the string "500", where `->>` compares both as text and cannot tell them
 * apart. Two entries that disagreed about whether a status code is a number
 * should not silently group together.
 */
function eqExpr(field: Field, value: Scalar, p: Params): string {
  if (field.kind === "attribute" && field.as !== "number" && containable(field.path)) {
    return `(${p.attributes} @> ${p.bind(JSON.stringify(nest(field.path, value)), "::jsonb")})`;
  }
  if (value === null) return `(${valueExpr(field, p)} IS NULL)`;
  if (field.kind === "column") {
    return `(${p.col(field.column)} = ${p.bind(columnValue(field.column, value))})`;
  }
  if (isNumericField(field)) {
    return `(${numberExpr(field, p)} = ${p.bind(value)}::numeric)`;
  }
  return `(${textExpr(field, p)} = ${p.bind(String(value))})`;
}

/**
 * `in`, as a disjunction rather than `= ANY(...)`.
 *
 * On an attribute path this matters: a chain of `@>` is a BitmapOr over the GIN
 * index, and `@> ANY($1::jsonb[])` is not indexable at all. On a promoted
 * column `= ANY` is the better form and is what this emits.
 */
function inExpr(field: Field, values: readonly Scalar[], p: Params): string {
  if (field.kind === "column") {
    const bound = values.map((v) => columnValue(field.column, v));
    return `(${p.col(field.column)} = ANY(${p.bind(bound)}))`;
  }
  return `(${values.map((v) => eqExpr(field, v, p)).join(" OR ")})`;
}

/**
 * "Is set".
 *
 * A single-segment path is `?`, which the GIN index answers directly. A deeper
 * one has to walk, and says so. A promoted column is a plain NOT NULL, and
 * `name`, `time` and `entry_id` are NOT NULL in the schema, so asking whether
 * they exist is always true -- left as written rather than folded to TRUE,
 * because a filter that vanished would be harder to debug than one that reads
 * as trivially satisfied in the plan.
 *
 * `unique` is the interesting case: it is nullable now, so "is set" over it
 * really does ask whether this entry carries any identity at all.
 */
function existsExpr(field: Field, p: Params): string {
  if (field.kind === "attribute") {
    if (field.path.length === 1) {
      return `(${p.attributes} ? ${p.bind(field.path[0])})`;
    }
    return `(${p.attributes} #> ${p.bind(field.path, "::text[]")} IS NOT NULL)`;
  }
  return `(${textExpr(field, p)} IS NOT NULL)`;
}

/** LIKE's metacharacters, escaped with a backslash the statement declares. */
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The value bound against a promoted column, in the type the column has.
 *
 * `pg` sends a JS string as text and lets Postgres infer, which is right for
 * `name` and wrong for `time`: a filter on time wants a
 * timestamp so the btree is usable rather than a string comparison that is not.
 */
function columnValue(column: EntryColumn, value: unknown): unknown {
  if (column === "time" || column === "ingested_at") {
    if (value instanceof Date) return value;
    if (typeof value === "number") return new Date(value);
    return new Date(String(value));
  }
  if (column === "severity") return value === null ? null : Number(value);
  return value === null ? null : String(value);
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

function compileAggregation(agg: Aggregation, p: Params): string {
  switch (agg?.fn) {
    case "count":
      return `count(*)::double precision`;

    case "count_distinct": {
      const field = checkField(agg.field);
      return `count(DISTINCT ${textExpr(field, p)})::double precision`;
    }

    case "sum":
    case "avg":
    case "min":
    case "max": {
      const field = checkField(agg.field);
      if (!isNumericField(field)) {
        throw new QueryError(
          `${agg.fn} needs a numeric field: read the attribute with as: "number"`
        );
      }
      return `${agg.fn}(${numberExpr(field, p)})::double precision`;
    }

    case "percentile": {
      const field = checkField(agg.field);
      if (!isNumericField(field)) {
        throw new QueryError(`percentile needs a numeric field: read it with as: "number"`);
      }
      if (!(typeof agg.p === "number") || !(agg.p >= 0) || !(agg.p <= 1)) {
        throw new QueryError(`percentile fraction must be between 0 and 1, got ${String(agg.p)}`);
      }
      // Interpolated rather than discrete: a p75 that can only ever be a value
      // somebody actually sent jumps around on small samples.
      return `(percentile_cont(${p.bind(agg.p, "::double precision")})
                 WITHIN GROUP (ORDER BY ${numberExpr(field, p)}))::double precision`;
    }

    default:
      throw new QueryError(`unknown aggregation: ${JSON.stringify((agg as { fn?: unknown })?.fn)}`);
  }
}

/** The same aggregate, wrapped so `withTotal` sums it over every group. */
function compileTotal(agg: Aggregation, p: Params): string {
  const inner = compileAggregation(agg, p);
  // A window over an aggregate is evaluated after GROUP BY and before LIMIT,
  // which is exactly the window a share needs: every group, not the top n.
  return `sum(${inner}) OVER ()`;
}

// ---------------------------------------------------------------------------
// Time bucketing
// ---------------------------------------------------------------------------

/**
 * `date_trunc(unit, time AT TIME ZONE tz) AT TIME ZONE tz`.
 *
 * Not the three-argument `date_trunc(unit, ts, tz)`, which is a Postgres 16
 * feature: this form is identical, has been correct since 9.x, and keeps the
 * minimum server version a deployment decision rather than a query-compiler
 * one. Both arguments are bound, so a timezone name is data.
 *
 * Buckets on `time`, never on `ingested_at`. A laptop shut for a week uploads
 * Tuesday's entries on Friday, and they happened on Tuesday.
 */
function bucketExpr(bucket: Bucket, p: Params): string {
  if (!(BUCKET_UNITS as readonly string[]).includes(bucket.unit)) {
    throw new QueryError(`unknown bucket unit: ${JSON.stringify(bucket.unit)}`);
  }
  if (typeof bucket.timezone !== "string" || bucket.timezone.length === 0 ||
      bucket.timezone.length > 64) {
    throw new QueryError(`invalid timezone: ${JSON.stringify(bucket.timezone)}`);
  }
  const unit = p.bind(bucket.unit);
  const tz = p.bind(bucket.timezone);
  return `(date_trunc(${unit}, ${p.col("time")} AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
}

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

/**
 * A query AST and a scope, as one parameterised statement.
 *
 * The scope's three values are bound first and always, so every compiled
 * statement starts with the predicate that prunes partitions and drives the
 * primary key's btree: `project_id = $1 AND time >= $2 AND time < $3`. A caller
 * cannot omit it and a filter cannot widen past it.
 */
export function compile(query: LogQuery, scope: QueryScope): CompiledQuery {
  if (!Array.isArray(query.aggregations) || query.aggregations.length === 0) {
    throw new QueryError("a query needs at least one aggregation");
  }
  if (query.aggregations.length > MAX_AGGREGATIONS) {
    throw new QueryError(`at most ${MAX_AGGREGATIONS} aggregations`);
  }
  const groupBy = query.groupBy ?? [];
  if (groupBy.length > MAX_GROUPS) {
    throw new QueryError(`at most ${MAX_GROUPS} group-by fields`);
  }
  if (query.fill) {
    if (!query.bucket) throw new QueryError("fill needs a bucket");
    if (groupBy.length > 0) throw new QueryError("fill cannot be combined with group by");
    if (query.withTotal) throw new QueryError("fill cannot be combined with withTotal");
  }

  const p = new Params();

  // Parameters are numbered as they BIND, and `bind` hands back the
  // placeholder, so the order things are emitted in below does not have to
  // match the order they appear in the statement. It only has to be
  // deterministic, which is what makes two identical queries compile to two
  // identical statements and share one round trip.
  const scopeSql =
    `"project_id" = ${p.bind(scope.projectId, "::uuid")}\n` +
    `       AND "time" >= ${p.bind(scope.from)}\n` +
    `       AND "time" <  ${p.bind(scope.to)}`;

  const select: string[] = [];
  const groupOrdinals: number[] = [];

  if (query.bucket) {
    select.push(`${bucketExpr(query.bucket, p)} AS bucket`);
    groupOrdinals.push(select.length);
  }

  groupBy.forEach((field, i) => {
    select.push(`${textExpr(checkField(field), p)} AS g${i}`);
    groupOrdinals.push(select.length);
  });

  query.aggregations.forEach((agg, i) => {
    select.push(`${compileAggregation(agg, p)} AS a${i}`);
  });

  if (query.withTotal) {
    select.push(`${compileTotal(query.aggregations[0]!, p)} AS total`);
  }

  const where = query.filter ? compileFilter(query.filter, p) : null;
  const limit = query.limit === undefined ? null : checkLimit(query.limit);

  const measured =
    `SELECT ${select.join(",\n           ")}\n` +
    `      FROM "log_entries"\n` +
    `     WHERE ${scopeSql}` +
    (where ? `\n       AND ${where}` : "") +
    (groupOrdinals.length > 0 ? `\n     GROUP BY ${groupOrdinals.join(", ")}` : "");

  if (query.fill) {
    return { text: fillText(measured, query, scope, p, limit), params: p.values };
  }

  const order = compileOrder(query.orderBy ?? [], query, groupBy.length);

  const text =
    measured +
    (order ? `\n     ORDER BY ${order}` : "") +
    (limit === null ? "" : `\n     LIMIT ${p.bind(limit)}`);

  return { text, params: p.values };
}

/** How wide one bucket is, as an interval literal Postgres will accept. */
const BUCKET_STEP: Record<BucketUnit, string> = {
  minute: "1 minute",
  hour: "1 hour",
  day: "1 day",
  week: "1 week",
  month: "1 month",
};

/** The aggregations whose answer over nothing is genuinely zero. */
const ZERO_OVER_NOTHING = new Set<AggregateFn>(["count", "count_distinct", "sum"]);

/**
 * The measured query, left joined onto every bucket in the window.
 *
 * The series is generated in LOCAL time -- `date_trunc(unit, from AT TIME ZONE
 * tz)` stepped by one unit -- and each boundary is converted back with the same
 * `AT TIME ZONE`. That is exactly the expression the grouped query buckets on,
 * so the join is on identical instants, and it stays correct across a DST
 * change where a fixed number of milliseconds would not.
 *
 * A missing count is 0 and a missing average is NULL. Zero is the honest answer
 * to "how many" and a lie in answer to "how long did it take": an empty day
 * plotted as a 0ms p75 is a chart claiming the fastest day on record was the
 * one nobody used it.
 */
function fillText(
  measured: string,
  query: LogQuery,
  scope: QueryScope,
  p: Params,
  limit: number | null
): string {
  const bucket = query.bucket!;
  const unit = p.bind(bucket.unit);
  const tz = p.bind(bucket.timezone);
  const step = p.bind(BUCKET_STEP[bucket.unit], "::interval");
  const from = p.bind(scope.from);
  const to = p.bind(scope.to);

  const columns = query.aggregations
    .map((agg, i) =>
      ZERO_OVER_NOTHING.has(agg.fn)
        ? `coalesce(m.a${i}, 0) AS a${i}`
        : `m.a${i} AS a${i}`
    )
    .join(",\n       ");

  // Descending is allowed here too, but the default stays chronological: a
  // filled series exists to be drawn, and a chart reads left to right.
  const order = compileOrder(query.orderBy ?? [], query, 0);

  return (
    `WITH buckets AS (\n` +
    `    SELECT generate_series(\n` +
    `             date_trunc(${unit}, ${from}::timestamptz AT TIME ZONE ${tz}),\n` +
    `             date_trunc(${unit}, (${to}::timestamptz - interval '1 microsecond') AT TIME ZONE ${tz}),\n` +
    `             ${step}\n` +
    `           ) AT TIME ZONE ${tz} AS bucket\n` +
    `),\n` +
    `measured AS (\n` +
    `    ${measured}\n` +
    `)\n` +
    `SELECT b.bucket AS bucket,\n` +
    `       ${columns}\n` +
    `  FROM buckets b\n` +
    `  LEFT JOIN measured m ON m.bucket = b.bucket\n` +
    (order ? ` ORDER BY ${order.replace(/\bbucket\b/g, "b.bucket")}\n` : "") +
    (limit === null ? "" : ` LIMIT ${p.bind(limit)}`)
  );
}

function checkLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new QueryError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

/**
 * `ORDER BY` over the output aliases this file generated.
 *
 * A caller points at a position in its own arrays -- the bucket, group 2,
 * aggregate 0 -- and never supplies text. `NULLS LAST` on every key, because a
 * breakdown whose first page is thirty rows of "attribute not set" is not a
 * ranking.
 */
function compileOrder(orders: readonly Order[], query: LogQuery, groups: number): string | null {
  if (orders.length === 0) {
    // Bucketed queries default to chronological, which is the only order a
    // chart can draw. Everything else is left to the caller.
    return query.bucket ? "bucket ASC" : null;
  }

  return orders
    .map(({ key, direction }) => {
      if (direction !== "asc" && direction !== "desc") {
        throw new QueryError(`unknown order direction: ${JSON.stringify(direction)}`);
      }
      const dir = direction === "asc" ? "ASC" : "DESC";

      if ("bucket" in key) {
        if (!query.bucket) throw new QueryError("cannot order by bucket: the query has none");
        return `bucket ${dir}`;
      }
      if ("group" in key) {
        if (!Number.isInteger(key.group) || key.group < 0 || key.group >= groups) {
          throw new QueryError(`no group at index ${String(key.group)}`);
        }
        return `g${key.group} ${dir} NULLS LAST`;
      }
      if (!Number.isInteger(key.aggregate) || key.aggregate < 0 ||
          key.aggregate >= query.aggregations.length) {
        throw new QueryError(`no aggregation at index ${String(key.aggregate)}`);
      }
      return `a${key.aggregate} ${dir} NULLS LAST`;
    })
    .join(", ");
}

// ---------------------------------------------------------------------------
// Running one
// ---------------------------------------------------------------------------

const numeric = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

function decode(raw: Record<string, unknown>, query: LogQuery): QueryRow {
  const groups = query.groupBy ?? [];
  const row: QueryRow = {
    bucket: query.bucket ? ((raw.bucket as Date | null) ?? null) : null,
    group: groups.map((_, i) => {
      const v = raw[`g${i}`];
      return v === null || v === undefined ? null : String(v);
    }),
    value: query.aggregations.map((_, i) => numeric(raw[`a${i}`])),
  };
  if (query.withTotal) row.total = numeric(raw.total);
  return row;
}

/**
 * One filter, compiled on its own, for a statement this file does not build.
 *
 * The log view asks a different question -- rows, not numbers -- and the query
 * layer is deliberately not reachable from it. What the two DO share is what a
 * condition means: "url.path starts with /pricing" has to select the same
 * entries whether it is narrowing a card or narrowing a page of the log, and
 * two compilers would be two chances for it not to.
 *
 * So the filter half is exported and the rest is not. The caller passes the
 * table its statement selects from, splices the text into its own WHERE, and
 * renumbers the placeholders against its own parameter list. Every value is
 * still bound: `params` is the whole of what the caller's data becomes, and
 * `text` contains no literal `$` other than the placeholders that index it.
 */
export function compileFilterFragment(filter: Filter, table?: string): CompiledQuery {
  const p = new Params(table);
  return { text: compileFilter(filter, p), params: p.values };
}

export async function runQuery(
  sql: Queryable,
  query: LogQuery,
  scope: QueryScope
): Promise<QueryRow[]> {
  const { text, params } = compile(query, scope);
  const rows = await sql.query<Record<string, unknown>>(text, params);
  return rows.map((r) => decode(r, query));
}

// ---------------------------------------------------------------------------
// One board, one round of queries
// ---------------------------------------------------------------------------

/**
 * A request is a key somebody will read the answer back by, and a query.
 *
 * The key comes from the caller -- the widget's own key -- so what gets fetched
 * and what gets read cannot drift apart. Two widgets asking the same question
 * hand over two keys and one query.
 */
export interface QueryRequest {
  key: string;
  query: LogQuery;
}

/**
 * Runs a board's queries, deduplicated, and files each answer under every key
 * that asked for it.
 *
 * The dedup is on the COMPILED statement, not on the AST. Two ASTs that
 * differ only in a field order, or in an explicit default a caller wrote out,
 * compile to the same text and the same parameters and share one round trip.
 * Comparing the SQL is also the only comparison that cannot be wrong: if the
 * statements and the parameters are identical then the answers are identical,
 * whatever the ASTs looked like.
 *
 * One `Promise.all` over the distinct statements, because they are independent
 * and running a twelve-card board in sequence is twelve round trips deep.
 */
export async function runQueries(
  sql: Queryable,
  requests: readonly QueryRequest[],
  scope: QueryScope
): Promise<Record<string, QueryRow[]>> {
  const distinct = new Map<string, { compiled: CompiledQuery; query: LogQuery; keys: string[] }>();

  for (const { key, query } of requests) {
    const compiled = compile(query, scope);
    const id = `${compiled.text} :: ${JSON.stringify(compiled.params)}`;
    const found = distinct.get(id);
    if (found) found.keys.push(key);
    else distinct.set(id, { compiled, query, keys: [key] });
  }

  const jobs = [...distinct.values()];
  const answers = await Promise.all(
    jobs.map(async (job) => {
      const rows = await sql.query<Record<string, unknown>>(job.compiled.text, job.compiled.params);
      return rows.map((r) => decode(r, job.query));
    })
  );

  const out: Record<string, QueryRow[]> = {};
  jobs.forEach((job, i) => {
    for (const key of job.keys) out[key] = answers[i]!;
  });
  return out;
}

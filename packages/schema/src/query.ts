import { z } from "zod";
import { AttrPath, AttrSegment, MAX_ATTR_PATH } from "./attributes.js";

/**
 * The query a card saves, as data the browser can build and the server can
 * trust.
 *
 * `db/query.ts` owns the compiler and the TypeScript shape of the AST. It has
 * no validator, because it is reached from two directions: the seed and the
 * board planner hand it values TypeScript already checked, while the explore
 * screen hands it a POST body somebody could have written by hand. This file is
 * the second door, and it is a zod mirror of that shape rather than a second
 * definition of it.
 *
 * The mirror is checked, not trusted: `api.server.ts` asserts that what parses
 * here is assignable to the compiler's own `LogQuery`, so the two drifting
 * apart is a type error at build time rather than a runtime surprise. It has to
 * be a mirror at all because this module runs in the BROWSER: a value import
 * from the db package pulls `pg`, `drizzle-orm` and `node:fs` into the client
 * graph, Vite serves them as external stubs and nothing hydrates. Types are
 * erased; the closed lists below are not, so they live here.
 *
 * Every bound in this file matches a bound the compiler enforces. Where the
 * compiler throws a `QueryError`, this rejects with a message a picker can
 * show, which is the whole reason for validating before compiling rather than
 * catching afterwards.
 */

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * The promoted columns a query may name.
 *
 * `project_id` is absent deliberately: it is the scope a query runs inside, not
 * a thing a query chooses, so a caller cannot widen out of its own project by
 * writing a filter.
 */
export const ENTRY_COLUMNS = [
  "time",
  "name",
  "severity",
  "entry_id",
  "ingested_at",
] as const;

export type EntryColumn = (typeof ENTRY_COLUMNS)[number];

export const EntryColumnSchema = z.enum(ENTRY_COLUMNS);

/** How a promoted column reads in a picker. */
export const COLUMN_LABELS: Record<EntryColumn, string> = {
  time: "Time",
  name: "Name",
  severity: "Severity",
  entry_id: "Entry id",
  ingested_at: "Received at",
};

/**
 * A path segment, shaped.
 *
 * `ATTR_SEGMENT_RE` and `MAX_ATTR_PATH` come from `attributes.ts`, which is the
 * one definition: the compiler in `db/query.ts` reads them from there too, and
 * two copies of that regex is how the compiler and the validator stop agreeing.
 *
 * The check is belt and braces rather than the defence itself. The compiler
 * binds a path as one `text[]` parameter and lets Postgres walk it, so a
 * segment made entirely of quotes and semicolons is looked up as a key that
 * does not exist. This exists so a path that could only have come from a
 * mistake or an attack is rejected with a message instead of quietly matching
 * nothing.
 */
export { AttrPath, AttrSegment, MAX_ATTR_PATH };

/** How a path reads in a header or a chip. Display only, never an identity. */
export const pathLabel = (path: readonly string[]): string => path.join(".");

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * `unique` is not a column and not an attribute: it is the ONE definition of a
 * unique in this product,
 * `coalesce(attributes ->> 'user.id', 'device.id', 'session.id')`. Best
 * available identity wins: a named user is one person, a device is one install,
 * a session is one visit. An entry carrying none of the three is not a unique
 * of any kind and is counted in no unique, which is the honest answer when the
 * developer never told us who or what sent it.
 *
 * It is a case in the AST rather than something a picker assembles, because a
 * picker that assembled it slightly differently would produce a number that
 * looked like a unique count and was not.
 */
export const Field = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("column"), column: EntryColumnSchema }),
  z.object({
    kind: z.literal("attribute"),
    path: AttrPath,
    /**
     * How the leaf is read. `text` is the default and is what a filter or a
     * group by wants. `number` reads only entries whose leaf is genuinely a
     * JSON number, and is required before any numeric aggregation will touch
     * it: a percentile over values that were sometimes text is a number nobody
     * can defend.
     */
    as: z.enum(["text", "number"]).optional(),
  }),
  z.object({ kind: z.literal("unique") }),
]);

export type Field = z.infer<typeof Field>;

/** The kinds of value a field yields, which is what decides its operators. */
export type ValueType = "text" | "number" | "boolean" | "time" | "severity";

export function fieldType(field: Field): ValueType {
  if (field.kind === "unique") return "text";
  if (field.kind === "attribute") return field.as === "number" ? "number" : "text";
  switch (field.column) {
    case "time":
    case "ingested_at":
      return "time";
    case "severity":
      return "severity";
    default:
      return "text";
  }
}

/** Whether an aggregation that needs a number will accept this field. */
export const isNumericField = (field: Field): boolean => {
  const t = fieldType(field);
  return t === "number" || t === "severity" || t === "time";
};

/** How a field reads on an axis, in a column header or on a chip. */
export function fieldLabel(field: Field): string {
  switch (field.kind) {
    case "column":
      return COLUMN_LABELS[field.column];
    case "attribute":
      return pathLabel(field.path);
    case "unique":
      return "Unique";
  }
}

/** The same field, as a stable string. Used only for comparing two pickers. */
export function fieldId(field: Field): string {
  switch (field.kind) {
    case "column":
      return `c:${field.column}`;
    case "attribute":
      return `a:${field.path.join(">")}:${field.as ?? "text"}`;
    case "unique":
      return "u:";
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const Scalar = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]);
export type Scalar = z.infer<typeof Scalar>;

export const COMPARISON_OPS = [
  "eq",
  "ne",
  "in",
  "not_in",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "starts_with",
  "ends_with",
  "exists",
  "not_exists",
] as const;

export type ComparisonOp = (typeof COMPARISON_OPS)[number];

export const OP_LABELS: Record<ComparisonOp, string> = {
  eq: "is",
  ne: "is not",
  in: "is one of",
  not_in: "is none of",
  lt: "is before/less than",
  lte: "is at most",
  gt: "is after/greater than",
  gte: "is at least",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  exists: "is set",
  not_exists: "is not set",
};

/**
 * Which operators a field's type can actually answer.
 *
 * Ordering on text is legal SQL and almost never what somebody means, so it is
 * left off the text list: "campaign > foo" sorts lexically and reads as a
 * mistake. There is no regex operator anywhere, and that is a decision rather
 * than an omission: a caller-supplied pattern with a nested quantifier is a
 * wedged connection with a friendly face.
 */
export const OPS_FOR_TYPE: Record<ValueType, readonly ComparisonOp[]> = {
  text: ["eq", "ne", "in", "not_in", "contains", "starts_with", "ends_with", "exists", "not_exists"],
  number: ["eq", "ne", "in", "not_in", "lt", "lte", "gt", "gte", "exists", "not_exists"],
  boolean: ["eq", "ne", "exists", "not_exists"],
  time: ["lt", "lte", "gt", "gte"],
  severity: ["eq", "ne", "in", "not_in", "lt", "lte", "gt", "gte", "exists", "not_exists"],
};

/** How many branches an `in` may carry before it stops being a filter. */
export const MAX_IN_VALUES = 200;
/** How deep a filter tree may nest. Matches the compiler's own guard. */
export const MAX_FILTER_DEPTH = 8;
/** How many conditions one and/or node may hold. Bounds the tree's width too. */
export const MAX_FILTER_BRANCHES = 32;

export type Filter =
  | { op: "and"; filters: Filter[] }
  | { op: "or"; filters: Filter[] }
  | { op: "not"; filter: Filter }
  | { op: "eq" | "ne"; field: Field; value: Scalar }
  | { op: "in" | "not_in"; field: Field; values: Scalar[] }
  | { op: "lt" | "lte" | "gt" | "gte"; field: Field; value: string | number }
  | { op: "contains" | "starts_with" | "ends_with"; field: Field; value: string }
  | { op: "exists" | "not_exists"; field: Field };

const leafFilters = [
  z.object({ op: z.enum(["eq", "ne"]), field: Field, value: Scalar }),
  z.object({
    op: z.enum(["in", "not_in"]),
    field: Field,
    values: z.array(Scalar).max(MAX_IN_VALUES),
  }),
  z.object({
    op: z.enum(["lt", "lte", "gt", "gte"]),
    field: Field,
    value: z.union([z.string().max(4096), z.number().finite()]),
  }),
  z.object({
    op: z.enum(["contains", "starts_with", "ends_with"]),
    field: Field,
    value: z.string().max(4096),
  }),
  z.object({ op: z.enum(["exists", "not_exists"]), field: Field }),
] as const;

/**
 * Depth is bounded by BUILDING a schema per level rather than by `z.lazy` with
 * a counter, so the limit is structural and a document deeper than the limit is
 * rejected without being walked to the bottom first. The same trick, and the
 * same reason, as `Attributes` in packages/schema/src/attributes.ts.
 */
function filterAtDepth(depth: number): z.ZodType<Filter> {
  if (depth <= 1) return z.union(leafFilters) as unknown as z.ZodType<Filter>;
  const inner = filterAtDepth(depth - 1);
  return z.union([
    ...leafFilters,
    z.object({
      op: z.enum(["and", "or"]),
      filters: z.array(inner).max(MAX_FILTER_BRANCHES),
    }),
    z.object({ op: z.literal("not"), filter: inner }),
  ]) as unknown as z.ZodType<Filter>;
}

export const FilterSchema: z.ZodType<Filter> = filterAtDepth(MAX_FILTER_DEPTH);

/** An empty AND is "no constraint", which is what a half-built filter means. */
export const emptyFilter = (): Filter => ({ op: "and", filters: [] });

export const isGroupOp = (op: Filter["op"]): op is "and" | "or" => op === "and" || op === "or";

/**
 * How many leaf conditions a filter tree holds.
 *
 * What a toolbar means by "3 filters": the conditions somebody actually wrote,
 * not the nodes it took to arrange them. A group counts as its children and
 * `not` counts as what it negates, so wrapping two conditions in an `or` does
 * not make the button say three.
 *
 * Here rather than beside either caller, because both the board and the log
 * carry the same tree and put the same number on the same control. Two copies
 * of this drifted once already.
 */
export function countConditions(filter: Filter | undefined): number {
  if (!filter) return 0;
  if (filter.op === "and" || filter.op === "or") {
    return filter.filters.reduce((n, child) => n + countConditions(child), 0);
  }
  if (filter.op === "not") return countConditions(filter.filter);
  return 1;
}

/**
 * The condition a PRINTED VALUE stands for.
 *
 * A group value arrives from the compiler as text or as null, because that is
 * what a row carries: the value the entries were grouped by, and null for the
 * entries that did not have one. Null is not the string "null" and is not a
 * missing answer, so it becomes `not_exists` rather than an equality against
 * nothing. That is the same distinction the row itself draws when it prints
 * "(not set)".
 *
 * Numeric fields are read back as numbers, because the value is text on the way
 * out and `severity = "17"` is not a filter the compiler will take. Anything
 * that does not parse stays text and matches nothing, which is the honest
 * answer for a value that was never a number.
 */
export function conditionFor(field: Field, value: string | null): Filter {
  if (value === null) return { op: "not_exists", field };
  const type = fieldType(field);
  if (type === "number" || type === "severity") {
    const number = Number(value);
    if (value.trim() !== "" && Number.isFinite(number)) return { op: "eq", field, value: number };
  }
  return { op: "eq", field, value };
}

/**
 * The same filter with more conditions ANDed onto it, or the SAME OBJECT when
 * there is nothing to add.
 *
 * Identity is the signal, not a boolean: a caller compares references to decide
 * whether anything happened, so clicking the value a board is already filtered
 * by writes no board and starts no refetch. Duplicates are found by comparing
 * canonical JSON, the same normalisation `queryKey` uses, so two conditions that
 * differ only in key order are one condition.
 *
 * It refuses rather than truncates at both bounds the schema enforces. A filter
 * this cannot extend without breaking `FilterSchema` is one the save would
 * reject, and a board that silently dropped half a drill-down would be showing
 * numbers for a question nobody asked.
 */
export function withConditions(filter: Filter, conditions: readonly Filter[]): Filter {
  if (conditions.length === 0) return filter;

  // A top-level AND takes them as siblings. Anything else is wrapped, which
  // costs a level, so the wrap is only allowed where there is one to spend.
  const held = filter.op === "and" ? filter.filters : [filter];
  if (filter.op !== "and" && filterDepth(filter) >= MAX_FILTER_DEPTH) return filter;

  const seen = new Set(held.map((child) => JSON.stringify(canonical(child))));
  const additions = conditions.filter((condition) =>
    !seen.has(JSON.stringify(canonical(condition)))
  );
  if (additions.length === 0) return filter;
  if (held.length + additions.length > MAX_FILTER_BRANCHES) return filter;

  return { op: "and", filters: [...held, ...additions] };
}

/** How many levels of grouping a filter tree is, counting itself as one. */
export function filterDepth(filter: Filter): number {
  if (filter.op === "and" || filter.op === "or") {
    return 1 + Math.max(0, ...filter.filters.map(filterDepth));
  }
  if (filter.op === "not") return 1 + filterDepth(filter.filter);
  return 1;
}

/** Whether an operator carries a value, a list of values, or nothing at all. */
export function operatorArity(op: ComparisonOp): "none" | "one" | "many" {
  if (op === "exists" || op === "not_exists") return "none";
  if (op === "in" || op === "not_in") return "many";
  return "one";
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

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

export const AGGREGATE_LABELS: Record<AggregateFn, string> = {
  count: "Count of entries",
  count_distinct: "Count of distinct",
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
  percentile: "Percentile",
};

export const Aggregation = z.discriminatedUnion("fn", [
  z.object({ fn: z.literal("count") }),
  z.object({ fn: z.literal("count_distinct"), field: Field }),
  z.object({ fn: z.enum(["sum", "avg", "min", "max"]), field: Field }),
  /** A fraction: 0.75 is the 75th percentile. Interpolated, not nearest. */
  z.object({ fn: z.literal("percentile"), field: Field, p: z.number().min(0).max(1) }),
]);

export type Aggregation = z.infer<typeof Aggregation>;

/** The one definition of a unique, as the aggregation that counts them. */
export const uniquesAggregation = (): Aggregation => ({
  fn: "count_distinct",
  field: { kind: "unique" },
});

/** How an aggregation reads in a legend or a column header. */
export function aggregationLabel(agg: Aggregation): string {
  switch (agg.fn) {
    case "count":
      return "Entries";
    case "count_distinct":
      return agg.field.kind === "unique" ? "Uniques" : `Distinct ${fieldLabel(agg.field)}`;
    case "percentile":
      return `p${Math.round(agg.p * 100)} ${fieldLabel(agg.field)}`;
    default:
      return `${AGGREGATE_LABELS[agg.fn]} of ${fieldLabel(agg.field)}`;
  }
}

// ---------------------------------------------------------------------------
// Bucketing and ordering
// ---------------------------------------------------------------------------

export const BUCKET_UNITS = ["minute", "hour", "day", "week", "month"] as const;
export type BucketUnit = (typeof BUCKET_UNITS)[number];

export const BUCKET_LABELS: Record<BucketUnit, string> = {
  minute: "By minute",
  hour: "By hour",
  day: "By day",
  week: "By week",
  month: "By month",
};

/**
 * An IANA name, bounded and shaped. Buckets are drawn in somebody's local
 * reckoning or they are drawn wrong: "yesterday" in Zurich is not "yesterday"
 * in UTC, and a daily chart that splits an evening across two bars is a chart
 * people learn to distrust.
 */
export const Timezone = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_+\-/]+$/, "not an IANA timezone name");

export const Bucket = z.object({ unit: z.enum(BUCKET_UNITS), timezone: Timezone });
export type Bucket = z.infer<typeof Bucket>;

export const MAX_GROUPS = 4;
export const MAX_AGGREGATIONS = 8;
export const MAX_ORDERS = 4;
export const MAX_LIMIT = 10_000;

/** What an order clause points at. Indexes into the query's own arrays. */
export const OrderKey = z.union([
  z.object({ bucket: z.literal(true) }),
  z.object({ group: z.number().int().min(0).max(MAX_GROUPS - 1) }),
  z.object({ aggregate: z.number().int().min(0).max(MAX_AGGREGATIONS - 1) }),
]);

export const Order = z.object({ key: OrderKey, direction: z.enum(["asc", "desc"]) });
export type Order = z.infer<typeof Order>;

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

/**
 * The five parts, and nothing else: a filter, a group by, aggregations, a time
 * bucket and a limit. Order, `withTotal` and `fill` are how those five are
 * drawn rather than a sixth question.
 */
export const LogQuery = z
  .object({
    filter: FilterSchema.optional(),
    groupBy: z.array(Field).max(MAX_GROUPS).optional(),
    aggregations: z.array(Aggregation).min(1).max(MAX_AGGREGATIONS),
    bucket: Bucket.optional(),
    orderBy: z.array(Order).max(MAX_ORDERS).optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
    /** Adds `total`: the first aggregation summed over EVERY group, before the limit. */
    withTotal: z.boolean().optional(),
    /** A row for every bucket in the window, including the empty ones. */
    fill: z.boolean().optional(),
  })
  // The compiler refuses all three of these too. Refusing them here as well
  // means a half-built query in a picker gets a sentence instead of a 500.
  .refine((q) => !q.fill || q.bucket !== undefined, {
    message: "filling gaps needs a time bucket",
    path: ["fill"],
  })
  .refine((q) => !q.fill || (q.groupBy ?? []).length === 0, {
    message: "a filled series cannot also be grouped",
    path: ["fill"],
  })
  .refine((q) => !q.fill || !q.withTotal, {
    message: "a filled series has no total",
    path: ["fill"],
  })
  .refine((q) => (q.orderBy ?? []).every((o) => !("bucket" in o.key) || q.bucket !== undefined), {
    message: "cannot order by bucket: the query has none",
    path: ["orderBy"],
  })
  .refine(
    (q) =>
      (q.orderBy ?? []).every(
        (o) => !("group" in o.key) || o.key.group < (q.groupBy ?? []).length
      ),
    { message: "ordering by a group the query does not have", path: ["orderBy"] }
  )
  .refine(
    (q) =>
      (q.orderBy ?? []).every(
        (o) => !("aggregate" in o.key) || o.key.aggregate < q.aggregations.length
      ),
    { message: "ordering by an aggregation the query does not have", path: ["orderBy"] }
  )
  .refine(
    (q) =>
      q.aggregations.every(
        (a) => a.fn === "count" || a.fn === "count_distinct" || isNumericField(a.field)
      ),
    {
      message: 'that aggregation needs a numeric field: read the attribute as a number',
      path: ["aggregations"],
    }
  );

export type LogQuery = z.infer<typeof LogQuery>;

// ---------------------------------------------------------------------------
// Visualisation
// ---------------------------------------------------------------------------

/**
 * How an answer is drawn. Six ways, and every one of them reads the same rows.
 *
 * This is deliberately not a widget type: the query decides what the numbers
 * are and this decides what they look like, so changing a chart from bars to a
 * line does not re-run anything.
 */
export const VISUALISATIONS = ["number", "line", "bar", "area", "table", "list"] as const;

export const Visualisation = z.enum(VISUALISATIONS);
export type Visualisation = z.infer<typeof Visualisation>;

export const VISUALISATION_LABELS: Record<Visualisation, string> = {
  number: "Single number",
  line: "Line",
  bar: "Bars",
  area: "Area",
  table: "Table",
  list: "Ranked list",
};

/**
 * Whether a visualisation can honestly draw this query.
 *
 * A line needs a bucket to have an x axis; a single number wants one row. This
 * returns a sentence rather than a boolean so the builder can say WHY a chart
 * type is greyed out, which is the difference between a disabled control and a
 * broken one.
 */
export function visualisationProblem(viz: Visualisation, query: LogQuery): string | null {
  const grouped = (query.groupBy ?? []).length > 0;
  switch (viz) {
    case "number":
      if (query.bucket) return "A single number cannot show a series. Drop the time bucket.";
      if (grouped) return "A single number cannot show groups. Drop the group by.";
      return null;
    case "line":
    case "bar":
    case "area":
      if (!query.bucket && !grouped) {
        return "A chart needs a time bucket or a group by to have an axis.";
      }
      return null;
    case "table":
    case "list":
      return null;
  }
}

// ---------------------------------------------------------------------------
// The saved query
// ---------------------------------------------------------------------------

/** A saved query and the way of drawing its answer. This is what a card is. */
export const SavedQuery = z.object({
  query: LogQuery,
  viz: Visualisation,
});

export type SavedQuery = z.infer<typeof SavedQuery>;

/**
 * The key an answer is filed under.
 *
 * Derived from the query and NEVER from the card, so two cards asking the same
 * question share one round trip and one result for free. Both sides call this:
 * the planner keys what it fetches by it, and the component that draws the
 * answer looks it up by it, which is what stops fetch and render disagreeing.
 * Never hand-write one of these and never store one.
 *
 * Canonical rather than `JSON.stringify` of the object as it happens to have
 * been built: key order is not part of a query, so two queries that differ only
 * in the order a picker set their fields must produce one key. The compiler
 * deduplicates a second time on the compiled statement, which catches the cases
 * this cannot see (an explicit default written out longhand).
 */
export function queryKey(query: LogQuery): string {
  return JSON.stringify(canonical(query));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort()
        .map((k) => [k, canonical(record[k])])
    );
  }
  return value;
}

/** What a card is called when nobody has titled it. */
export function describeQuery(query: LogQuery): string {
  const measure = aggregationLabel(query.aggregations[0] ?? { fn: "count" });
  const groups = query.groupBy ?? [];
  if (groups.length > 0) return `${measure} by ${groups.map(fieldLabel).join(", ")}`;
  if (query.bucket) return `${measure} over time`;
  return measure;
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

/**
 * One row of an answer, in the shape `db/query.ts` decodes into.
 *
 * `bucket` is null when the query is not bucketed. A null in `group` is a real
 * answer: the entry does not carry that attribute. It is not folded into a
 * string, because "no campaign" and the campaign literally named "null" are
 * different rows.
 */
export interface QueryRow {
  bucket: Date | null;
  group: Array<string | null>;
  value: Array<number | null>;
  total?: number | null;
}

/** An answer, and the window it was measured over. */
export interface QueryResult {
  rows: QueryRow[];
  from: Date;
  to: Date;
}

/** A window with nothing in it, so a card can render before its answer lands. */
export const emptyResult = (): QueryResult => ({ rows: [], from: new Date(0), to: new Date(0) });

/**
 * Every answer on a board, keyed by `queryKey`, plus the same shape measured
 * over the comparison window.
 *
 * `previous` has the SAME shape as the current window, so computing a delta is
 * one accessor run twice. Null whenever there is no comparison: a baseline
 * nothing was measured against is a date range with no meaning.
 */
export interface BoardSnapshot {
  from: Date;
  to: Date;
  results: Record<string, QueryRow[]>;
  compare: { from: Date; to: Date } | null;
  previous: Record<string, QueryRow[]> | null;
}

export const emptySnapshot = (): BoardSnapshot => ({
  from: new Date(0),
  to: new Date(0),
  results: {},
  compare: null,
  previous: null,
});

/** A missing key is an empty answer, never undefined and never a throw. */
export const rowsAt = (results: Record<string, QueryRow[]>, key: string): QueryRow[] =>
  results[key] ?? [];

/** The first aggregation of the first row, which is what a single number is. */
export function scalarOf(rows: readonly QueryRow[], index = 0): number | null {
  const row = rows[0];
  if (!row) return null;
  return row.value[index] ?? null;
}

/**
 * The change between two numbers, or null when there is nothing to compare.
 *
 * Null rather than zero: "no comparison" and "no change" are different things
 * and a card that draws 0% for the first is lying about the second. A baseline
 * of zero is also null, because every increase from nothing is infinite.
 */
export function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

// ---------------------------------------------------------------------------
// Attribute discovery
// ---------------------------------------------------------------------------

/**
 * What a project has actually written, so the pickers can offer real options
 * rather than a free-text box.
 *
 * Attributes are DISCOVERED, not declared. There is no registration step and no
 * schema to keep in step with the code, and a key nobody has sent yet is not an
 * error: it is a filter that matches nothing.
 */
export interface AttributeType {
  type: "string" | "number" | "boolean" | "object" | "array" | "null";
  count: number;
}

export interface DiscoveredAttribute {
  /** A top-level key of the attribute map. Dots inside it are part of the key. */
  key: string;
  /** Most common first, so a picker can say "usually a number". */
  types: AttributeType[];
  /** How many sampled entries carried it. */
  entries: number;
  /** A few values that were actually written, for the value input to offer. */
  samples: string[];
}

export interface DiscoveredName {
  name: string;
  entries: number;
}

export interface Discovery {
  attributes: DiscoveredAttribute[];
  names: DiscoveredName[];
  /** How many entries were looked at. Bounded, so this is a sample not a census. */
  sampled: number;
  /** True when the cap was reached: the lists are what we saw, not all there is. */
  truncated: boolean;
}

export const emptyDiscovery = (): Discovery => ({
  attributes: [],
  names: [],
  sampled: 0,
  truncated: false,
});

/** The value type a discovered key most often holds, for the operator picker. */
export function discoveredType(attr: DiscoveredAttribute): ValueType {
  const top = attr.types[0]?.type;
  if (top === "number") return "number";
  if (top === "boolean") return "boolean";
  return "text";
}

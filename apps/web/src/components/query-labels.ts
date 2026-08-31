import {
  pathLabel,
  type Aggregation,
  type AggregateFn,
  type BucketUnit,
  type ComparisonOp,
  type EntryColumn,
  type Field,
  type LogQuery,
  type Visualisation,
} from "@firstrun/schema/query";
import type { I18n, SimpleKey } from "../lib/i18n/index.js";

/**
 * The vocabulary of a query, in the reader's language.
 *
 * `packages/schema/src/query.ts` already answers every one of these questions
 * (`COLUMN_LABELS`, `OP_LABELS`, `aggregationLabel`, `describeQuery`,
 * `visualisationProblem`), and every answer is an English constant. The schema
 * is the contract: it is imported by the clients and by the server, it has no
 * dependency on the UI, and threading a locale through it would put words in
 * the one package that is deliberately free of them. So the words move here,
 * where a translator can reach them, and the schema keeps the shapes.
 *
 * Two rules hold this together.
 *
 * A value never becomes a key by concatenation. Every lookup below goes through
 * a `Record` of literal keys, so the closed union in `TranslationKey` still
 * checks and a column added to the schema is a compile error here rather than a
 * key printed raw on a card.
 *
 * A composed label is one whole sentence with a placeholder in it. "Sum of X"
 * and "Summe von X" happen to share a word order; "{measure} by {groups}" and
 * "{measure} nach {groups}" happen to as well. The first language that
 * disagrees breaks every call site at once if these are joined at the call site
 * instead.
 *
 * Build this inside a component, never at module scope: every method reads
 * `i18n.t` when it is called, so a live locale switch re-renders through it.
 */

const COLUMN_KEYS: Record<EntryColumn, SimpleKey> = {
  time: "explore.column_time",
  name: "explore.column_name",
  severity: "explore.column_severity",
  entry_id: "explore.column_event_id",
  ingested_at: "explore.column_ingested_at",
};

const FN_KEYS: Record<AggregateFn, SimpleKey> = {
  count: "explore.fn_count",
  count_distinct: "explore.fn_count_distinct",
  sum: "explore.fn_sum",
  avg: "explore.fn_avg",
  min: "explore.fn_min",
  max: "explore.fn_max",
  percentile: "explore.fn_percentile",
};

/** The four aggregations that read one field and name it in their own label. */
const OF_FIELD_KEYS: Record<"sum" | "avg" | "min" | "max", SimpleKey> = {
  sum: "explore.agg_sum_of",
  avg: "explore.agg_avg_of",
  min: "explore.agg_min_of",
  max: "explore.agg_max_of",
};

const OP_KEYS: Record<ComparisonOp, SimpleKey> = {
  eq: "explore.op_eq",
  ne: "explore.op_ne",
  in: "explore.op_in",
  not_in: "explore.op_not_in",
  lt: "explore.op_lt",
  lte: "explore.op_lte",
  gt: "explore.op_gt",
  gte: "explore.op_gte",
  contains: "explore.op_contains",
  starts_with: "explore.op_starts_with",
  ends_with: "explore.op_ends_with",
  exists: "explore.op_exists",
  not_exists: "explore.op_not_exists",
};

const BUCKET_KEYS: Record<BucketUnit, SimpleKey> = {
  minute: "explore.bucket_minute",
  hour: "explore.bucket_hour",
  day: "explore.bucket_day",
  week: "explore.bucket_week",
  month: "explore.bucket_month",
};

const VIZ_KEYS: Record<Visualisation, SimpleKey> = {
  number: "explore.viz_number",
  line: "explore.viz_line",
  bar: "explore.viz_bar",
  area: "explore.viz_area",
  table: "explore.viz_table",
  list: "explore.viz_list",
};

export interface QueryLabels {
  column: (column: EntryColumn) => string;
  /** An attribute path is customer data and is printed as written. */
  field: (field: Field) => string;
  aggregation: (agg: Aggregation) => string;
  aggregateFn: (fn: AggregateFn) => string;
  operator: (op: ComparisonOp) => string;
  bucket: (unit: BucketUnit) => string;
  visualisation: (viz: Visualisation) => string;
  /** A whole query as one line: what a card is called before anyone names it. */
  describe: (query: LogQuery) => string;
  /** Why this chart type cannot honestly draw this query, or null. */
  vizProblem: (viz: Visualisation, query: LogQuery) => string | null;
}

export function queryLabels(i18n: I18n): QueryLabels {
  const field = (f: Field): string => {
    switch (f.kind) {
      case "column":
        return i18n.t(COLUMN_KEYS[f.column]);
      case "attribute":
        return pathLabel(f.path);
      case "unique":
        return i18n.t("explore.field_unique");
    }
  };

  const aggregation = (agg: Aggregation): string => {
    switch (agg.fn) {
      case "count":
        return i18n.t("explore.agg_events");
      case "count_distinct":
        return agg.field.kind === "unique"
          ? i18n.t("explore.agg_uniques")
          : i18n.t("explore.agg_distinct_of", { field: field(agg.field) });
      case "percentile":
        return i18n.t("explore.agg_percentile_of", {
          p: Math.round(agg.p * 100),
          field: field(agg.field),
        });
      default:
        return i18n.t(OF_FIELD_KEYS[agg.fn], { field: field(agg.field) });
    }
  };

  const describe = (query: LogQuery): string => {
    const measure = aggregation(query.aggregations[0] ?? { fn: "count" });
    const groups = query.groupBy ?? [];
    if (groups.length > 0) {
      return i18n.t("explore.query_by", { measure, groups: i18n.list(groups.map(field)) });
    }
    if (query.bucket) return i18n.t("explore.query_over_time", { measure });
    return measure;
  };

  const vizProblem = (viz: Visualisation, query: LogQuery): string | null => {
    const grouped = (query.groupBy ?? []).length > 0;
    switch (viz) {
      case "number":
        if (query.bucket) return i18n.t("explore.viz_problem_number_series");
        if (grouped) return i18n.t("explore.viz_problem_number_groups");
        return null;
      case "line":
      case "bar":
      case "area":
        if (!query.bucket && !grouped) return i18n.t("explore.viz_problem_chart_axis");
        return null;
      case "table":
      case "list":
        return null;
    }
  };

  return {
    column: (column) => i18n.t(COLUMN_KEYS[column]),
    field,
    aggregation,
    aggregateFn: (fn) => i18n.t(FN_KEYS[fn]),
    operator: (op) => i18n.t(OP_KEYS[op]),
    bucket: (unit) => i18n.t(BUCKET_KEYS[unit]),
    visualisation: (viz) => i18n.t(VIZ_KEYS[viz]),
    describe,
    vizProblem,
  };
}

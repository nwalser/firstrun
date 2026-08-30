import type { Namespaced } from "./namespace.js";

/**
 * The query builder, the results panel beside it, and the vocabulary of a query.
 *
 * The second half of this file is the vocabulary: what a column is called, what
 * an operator reads as, how an aggregation names itself. Those words live here
 * rather than in `packages/schema` because the schema is the contract and has no
 * language in it: `COLUMN_LABELS`, `OP_LABELS`, `aggregationLabel` and friends
 * are English constants, and a Record of literal keys in the UI is the only way
 * to reach them without a locale argument threaded through the AST.
 *
 * Every composed label is one whole sentence with a placeholder in it, never two
 * fragments joined at the call site. "Summe von X" and "Sum of X" put the parts
 * in the same order only by luck, and the first language that disagrees would
 * break every one of them at once.
 */
export const explore = {
  "explore.title": "Explore",
  "explore.run": "Run",
  "explore.running": "Running…",

  "explore.filter": "Filter",
  "explore.add_filter": "Add filter",
  "explore.group_by": "Group by",
  "explore.aggregate": "Aggregate",
  "explore.time_bucket": "Time bucket",
  "explore.limit": "Limit",
  "explore.attribute_placeholder": "Attribute or column…",

  "explore.no_results": "No entries match this query",
  "explore.results_one": "{count} group",
  "explore.results_other": "{count} groups",
  "explore.save_as_widget": "Save as widget",

  // The promoted columns. A closed list: see rule 3 in CLAUDE.md.
  "explore.column_time": "Time",
  "explore.column_name": "Name",
  "explore.column_severity": "Severity",
  "explore.column_distinct_id": "Client id",
  "explore.column_entry_id": "Entry id",
  "explore.column_ingested_at": "Received at",

  "explore.field_unique": "Unique",
  "explore.field_unique_option": "Unique (user id, else client id)",
  "explore.field_label": "Field",
  "explore.field_placeholder": "Pick a field",
  "explore.field_custom": "Another attribute…",

  // What an aggregation is called once it has a field in it.
  "explore.agg_entries": "Entries",
  "explore.agg_uniques": "Uniques",
  "explore.agg_distinct_of": "Distinct {field}",
  "explore.agg_percentile_of": "p{p} {field}",
  "explore.agg_sum_of": "Sum of {field}",
  "explore.agg_avg_of": "Average of {field}",
  "explore.agg_min_of": "Minimum of {field}",
  "explore.agg_max_of": "Maximum of {field}",

  // The aggregation as a choice in a picker, before it has a field.
  "explore.fn_count": "Count of entries",
  "explore.fn_count_distinct": "Count of distinct",
  "explore.fn_sum": "Sum",
  "explore.fn_avg": "Average",
  "explore.fn_min": "Minimum",
  "explore.fn_max": "Maximum",
  "explore.fn_percentile": "Percentile",

  // A whole query, read back as one line: a card's title before anyone names it.
  "explore.query_by": "{measure} by {groups}",
  "explore.query_over_time": "{measure} over time",

  "explore.op_eq": "is",
  "explore.op_ne": "is not",
  "explore.op_in": "is one of",
  "explore.op_not_in": "is none of",
  "explore.op_lt": "is before/less than",
  "explore.op_lte": "is at most",
  "explore.op_gt": "is after/greater than",
  "explore.op_gte": "is at least",
  "explore.op_contains": "contains",
  "explore.op_starts_with": "starts with",
  "explore.op_ends_with": "ends with",
  "explore.op_exists": "is set",
  "explore.op_not_exists": "is not set",

  "explore.bucket_none": "No bucket",
  "explore.bucket_minute": "By minute",
  "explore.bucket_hour": "By hour",
  "explore.bucket_day": "By day",
  "explore.bucket_week": "By week",
  "explore.bucket_month": "By month",

  "explore.viz_number": "Single number",
  "explore.viz_line": "Line",
  "explore.viz_bar": "Bars",
  "explore.viz_area": "Area",
  "explore.viz_table": "Table",
  "explore.viz_list": "Ranked list",
  "explore.viz_label": "Visualisation",

  // A chart type that cannot honestly draw this query says why, rather than
  // being greyed out. The difference between a disabled control and a broken
  // one is a sentence.
  "explore.viz_problem_number_series": "A single number cannot show a series. Drop the time bucket.",
  "explore.viz_problem_number_groups": "A single number cannot show groups. Drop the group by.",
  "explore.viz_problem_chart_axis": "A chart needs a time bucket or a group by to have an axis.",

  "explore.value_placeholder": "Value",
  "explore.values_placeholder": "One value per line",
  "explore.operator_label": "Operator",

  "explore.all_of": "All of",
  "explore.any_of": "Any of",
  "explore.no_constraint": "no constraint",
  "explore.matches_nothing": "matches nothing",
  "explore.conditions_one": "{count} condition",
  "explore.conditions_other": "{count} conditions",
  "explore.remove_group": "Remove group",
  "explore.remove_condition": "Remove condition",
  "explore.remove_measure": "Remove measure",
  "explore.add_condition": "Condition",
  "explore.add_group": "Group",
  "explore.add_measure": "Measure",

  "explore.section_viz": "Draw it as",
  "explore.section_measure": "Measure",
  "explore.section_measure_hint":
    "Count of entries, count of distinct uniques, or a number out of an attribute.",
  "explore.section_filter_hint": "Empty means no constraint, never nothing.",
  "explore.section_group_hint":
    "A column or an attribute path. Each one splits the answer further.",
  "explore.section_bucket_hint":
    "Always on when the entry happened, never on when it arrived.",
  "explore.section_limit_hint": "How many groups come back. The ranking decides which.",

  "explore.aggregation_label": "Aggregation",
  "explore.percentile": "Percentile",
  "explore.bucket_timezone":
    "Drawn in {zone}. A day is a day where the board's readers are, not in UTC.",
  "explore.fill_label": "Show empty buckets",
  "explore.fill_hint":
    "A line that closes its own gaps turns a two-day outage into a gentle slope.",

  "explore.rows_one": "{count} row",
  "explore.rows_other": "{count} rows",

  "explore.nothing_title": "Nothing has arrived yet",
  "explore.nothing_body":
    "There are no entries in this window, so there is nothing to discover and nothing to " +
    "filter on. Every client has the same five calls, and one of them is enough: an entry is " +
    "a name, a severity and an attribute map, and it is queryable the moment it lands.",
  "explore.nothing_cta": "How to send a first entry",
  "explore.nothing_widen":
    "Widen the range too: entries are stamped by the client, and an app that was offline " +
    "reports days it has already lived through.",
} satisfies Namespaced<"explore">;

export type ExploreMessages = typeof explore;

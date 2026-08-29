import { z } from "zod";

/**
 * The widget catalogue.
 *
 * The dashboard is arrangeable, not programmable. Every widget here answers a
 * question this product exists to answer -- where the visit-to-install handoff
 * leaks, which version cohort went quiet, how much of the funnel we can prove
 * versus guess. None of them let you assemble an arbitrary query.
 *
 * That distinction is the whole design constraint. A generic explore view is
 * the failure mode for this project: anything you could get by pointing Grafana
 * at the same Postgres in an afternoon does not belong here. Adding a widget
 * means adding a question worth answering, with SQL written for it, not a new
 * knob on a query builder.
 */

export const WIDGET_TYPES = [
  "funnel",
  "metric",
  "timeseries",
  "versions",
  "join_health",
  "retention",
] as const;

export const WidgetType = z.enum(WIDGET_TYPES);
export type WidgetType = z.infer<typeof WidgetType>;

/** Columns out of three. Kept coarse so no layout can look broken. */
export const WidgetWidth = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type WidgetWidth = z.infer<typeof WidgetWidth>;

/** The single numbers a metric or timeseries widget can show. */
export const METRIC_KEYS = [
  "visited",
  "downloaded",
  "first_run",
  "day7",
  "paid",
  "active_installs",
  "quiet_installs",
] as const;

export const MetricKey = z.enum(METRIC_KEYS);
export type MetricKey = z.infer<typeof MetricKey>;

export const METRIC_LABELS: Record<MetricKey, string> = {
  visited: "Visited",
  downloaded: "Downloaded",
  first_run: "First run",
  day7: "Day 7",
  paid: "Paid",
  active_installs: "Active installs",
  quiet_installs: "Quiet installs",
};

const base = {
  /** Stable within a dashboard. Lets the editor reorder without remounting. */
  id: z.string().min(1).max(64),
  title: z.string().max(60).optional(),
  width: WidgetWidth.default(1),
};

export const FunnelWidget = z.object({
  ...base,
  type: z.literal("funnel"),
  width: WidgetWidth.default(3),
});

export const MetricWidget = z.object({
  ...base,
  type: z.literal("metric"),
  metric: MetricKey,
  /** Show the change against the preceding window of the same length. */
  compare: z.boolean().default(true),
});

/**
 * Only the metrics that are a countable event on a given day.
 *
 * Day 7, active installs and quiet installs are all "as of now" figures derived
 * from a whole window -- there is no honest way to put them on a daily axis, and
 * a chart that pretended otherwise would be worse than no chart.
 */
export const TIMESERIES_METRICS = ["visited", "downloaded", "first_run", "paid"] as const;

export const TimeseriesMetric = z.enum(TIMESERIES_METRICS);
export type TimeseriesMetric = z.infer<typeof TimeseriesMetric>;

/** Which event backs each daily metric. */
export const TIMESERIES_EVENT: Record<TimeseriesMetric, string> = {
  visited: "page_view",
  downloaded: "download_started",
  first_run: "app_first_run",
  paid: "purchase",
};

export const TimeseriesWidget = z.object({
  ...base,
  type: z.literal("timeseries"),
  metric: TimeseriesMetric,
  width: WidgetWidth.default(2),
});

export const VersionsWidget = z.object({
  ...base,
  type: z.literal("versions"),
  /** Days of silence before an install counts as quiet. */
  quietDays: z.number().int().min(1).max(90).default(14),
  width: WidgetWidth.default(2),
});

export const JoinHealthWidget = z.object({
  ...base,
  type: z.literal("join_health"),
});

export const RetentionWidget = z.object({
  ...base,
  type: z.literal("retention"),
  days: z.number().int().min(7).max(60).default(30),
  width: WidgetWidth.default(2),
});

export const Widget = z.discriminatedUnion("type", [
  FunnelWidget,
  MetricWidget,
  TimeseriesWidget,
  VersionsWidget,
  JoinHealthWidget,
  RetentionWidget,
]);

export type Widget = z.infer<typeof Widget>;

export const DashboardLayout = z.object({
  /** How far back every widget looks. One range for the whole board. */
  rangeDays: z.number().int().min(1).max(365).default(30),
  /** Only show events from this source. `null` is the whole project. */
  sourceId: z.string().uuid().nullish().transform((v) => v ?? null),
  widgets: z.array(Widget).max(24).default([]),
});

export type DashboardLayout = z.infer<typeof DashboardLayout>;

/** What the "add widget" palette offers, and what each one starts as. */
export interface CatalogueEntry {
  type: WidgetType;
  label: string;
  description: string;
  create: (id: string) => Widget;
}

export const WIDGET_CATALOGUE: CatalogueEntry[] = [
  {
    type: "funnel",
    label: "Funnel",
    description: "Visited to paid, with exact and estimated counted separately.",
    create: (id) => ({ id, type: "funnel", width: 3 }),
  },
  {
    type: "metric",
    label: "Single number",
    description: "One figure, with the change against the previous period.",
    create: (id) => ({ id, type: "metric", metric: "first_run", compare: true, width: 1 }),
  },
  {
    type: "timeseries",
    label: "Over time",
    description: "One metric per day, bucketed on when it happened.",
    create: (id) => ({ id, type: "timeseries", metric: "downloaded", width: 2 }),
  },
  {
    type: "versions",
    label: "Versions",
    description: "Installs per app version, and which cohort has gone quiet.",
    create: (id) => ({ id, type: "versions", quietDays: 14, width: 2 }),
  },
  {
    type: "join_health",
    label: "Join health",
    description: "How much of the handoff we can prove versus estimate.",
    create: (id) => ({ id, type: "join_health", width: 1 }),
  },
  {
    type: "retention",
    label: "Retention curve",
    description: "Share of installs still launching, by day since first run.",
    create: (id) => ({ id, type: "retention", days: 30, width: 2 }),
  },
];

/**
 * What a project gets before anyone has touched it.
 *
 * The funnel first, because it is the reason this product exists. Everything
 * below it is context for the drop-off the funnel just showed you.
 */
export function defaultLayout(): DashboardLayout {
  return {
    rangeDays: 30,
    sourceId: null,
    widgets: [
      { id: "funnel", type: "funnel", width: 3 },
      { id: "join", type: "join_health", width: 1 },
      { id: "series", type: "timeseries", metric: "first_run", width: 2 },
      { id: "versions", type: "versions", quietDays: 14, width: 2 },
      { id: "retention", type: "retention", days: 30, width: 2 },
    ],
  };
}

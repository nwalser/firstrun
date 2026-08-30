import { SEVERITY } from "@firstrun/schema/severity";
import { ATTR, NAME } from "@firstrun/schema/conventions";
import type { Surface } from "@firstrun/schema";
import type { BoardWidget } from "@firstrun/schema/board";
import {
  uniquesAggregation,
  type Field,
  type Filter,
  type LogQuery,
  type Visualisation,
} from "@firstrun/schema/query";
import type { I18n, SimpleKey } from "../../lib/i18n/index.js";

/**
 * Starting points, not a catalogue.
 *
 * Every preset below is a query and a chart type that a customer could have
 * built themselves in the builder, and each one opens in that builder the
 * moment it lands on a board. Adding one here adds a good default; it does not
 * add a capability, and a preset that could only be expressed by a special case
 * in the query layer does not belong in this list.
 *
 * The names and keys they use are CONVENTIONS from `packages/schema`. A project
 * that spells its own differently gets a preset that matches nothing, which is
 * a filter to edit rather than an error: that is the trade for offering
 * anything at all before a project has sent its first entry.
 */

/**
 * The timezone a new bucket is drawn in.
 *
 * The reader's own, because they are the one choosing it and can see the
 * answer. It is then STORED on the query, so a colleague opening the same board
 * sees the same days rather than their own idea of where a day starts. A
 * migrated board keeps UTC, because nobody chose anything there.
 */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const attr = (key: string, as?: "number"): Field => ({
  kind: "attribute",
  path: [key],
  ...(as ? { as } : {}),
});

const nameIs = (name: string): Filter => ({
  op: "eq",
  field: { kind: "column", column: "name" },
  value: name,
});

const rankByFirst = [{ key: { aggregate: 0 }, direction: "desc" } as const];

const daily = () => ({ unit: "day" as const, timezone: localTimezone() });

export interface Preset {
  key: string;
  /**
   * The words are keys rather than strings.
   *
   * This list is evaluated once, when the module is first imported, so a
   * translated string here would be frozen in whichever language happened to be
   * active at that moment and would not follow a switch. Keys are language-free,
   * and `presetLabel` resolves them inside the component that draws the row.
   */
  labelKey: SimpleKey;
  hintKey: SimpleKey;
  /** What it looks like before anyone resizes it. */
  size: { w: number; h: number };
  /** Only worth offering on a board whose project has a source of this kind. */
  surface?: Surface;
  build: () => Omit<BoardWidget, "id" | "x" | "y" | "w" | "h">;
}

const query = (
  viz: Visualisation,
  q: LogQuery,
  extra: { compare?: boolean; sparkline?: boolean } = {}
) => ({
  kind: "query" as const,
  viz,
  query: q,
  compare: extra.compare ?? false,
  sparkline: extra.sparkline ?? false,
});

export const PRESETS: Preset[] = [
  {
    key: "uniques",
    labelKey: "dashboard.preset_uniques",
    hintKey: "dashboard.preset_uniques_hint",
    size: { w: 300, h: 160 },
    build: () =>
      query("number", { aggregations: [uniquesAggregation()] }, { compare: true, sparkline: true }),
  },
  {
    key: "entries-over-time",
    labelKey: "dashboard.preset_over_time",
    hintKey: "dashboard.preset_over_time_hint",
    size: { w: 620, h: 300 },
    build: () =>
      query("line", { aggregations: [{ fn: "count" }], bucket: daily(), fill: true }, { compare: true }),
  },
  {
    key: "names",
    labelKey: "dashboard.preset_names",
    hintKey: "dashboard.preset_names_hint",
    size: { w: 440, h: 320 },
    build: () =>
      query("list", {
        groupBy: [{ kind: "column", column: "name" }],
        aggregations: [{ fn: "count" }],
        orderBy: rankByFirst,
        limit: 20,
        withTotal: true,
      }),
  },
  {
    key: "errors",
    labelKey: "dashboard.preset_errors",
    hintKey: "dashboard.preset_errors_hint",
    size: { w: 620, h: 300 },
    build: () =>
      query("bar", {
        filter: {
          op: "gte",
          field: { kind: "column", column: "severity" },
          value: SEVERITY.ERROR,
        },
        aggregations: [{ fn: "count" }],
        bucket: daily(),
        fill: true,
      }),
  },
  {
    key: "exception-types",
    labelKey: "dashboard.preset_exceptions",
    hintKey: "dashboard.preset_exceptions_hint",
    size: { w: 440, h: 320 },
    build: () =>
      query("list", {
        filter: nameIs(NAME.EXCEPTION),
        groupBy: [attr(ATTR.EXCEPTION_TYPE)],
        aggregations: [{ fn: "count" }, uniquesAggregation()],
        orderBy: rankByFirst,
        limit: 10,
        withTotal: true,
      }),
  },
  {
    key: "pages",
    labelKey: "dashboard.preset_pages",
    hintKey: "dashboard.preset_pages_hint",
    size: { w: 440, h: 320 },
    surface: "web",
    build: () =>
      query("list", {
        filter: nameIs(NAME.PAGE_VIEW),
        groupBy: [attr(ATTR.URL_PATH)],
        aggregations: [uniquesAggregation()],
        orderBy: rankByFirst,
        limit: 10,
        withTotal: true,
      }),
  },
  {
    key: "referrers",
    labelKey: "dashboard.preset_referrers",
    hintKey: "dashboard.preset_referrers_hint",
    size: { w: 440, h: 320 },
    surface: "web",
    build: () =>
      query("list", {
        filter: nameIs(NAME.PAGE_VIEW),
        groupBy: [attr(ATTR.REFERRER_HOST)],
        aggregations: [uniquesAggregation()],
        orderBy: rankByFirst,
        limit: 10,
        withTotal: true,
      }),
  },
  {
    key: "vitals",
    labelKey: "dashboard.preset_vitals",
    hintKey: "dashboard.preset_vitals_hint",
    size: { w: 440, h: 240 },
    surface: "web",
    build: () =>
      query("table", {
        filter: nameIs(NAME.WEB_VITAL),
        groupBy: [attr(ATTR.METRIC)],
        aggregations: [
          { fn: "percentile", field: attr(ATTR.VALUE, "number"), p: 0.75 },
          { fn: "count" },
        ],
        orderBy: [{ key: { group: 0 }, direction: "asc" }],
        limit: 10,
      }),
  },
  {
    key: "versions",
    labelKey: "dashboard.preset_versions",
    hintKey: "dashboard.preset_versions_hint",
    size: { w: 620, h: 300 },
    surface: "desktop",
    build: () =>
      query("list", {
        groupBy: [attr(ATTR.SERVICE_VERSION)],
        aggregations: [uniquesAggregation()],
        orderBy: rankByFirst,
        limit: 20,
        withTotal: true,
      }),
  },
  {
    key: "slow-routes",
    labelKey: "dashboard.preset_slow_routes",
    hintKey: "dashboard.preset_slow_routes_hint",
    size: { w: 620, h: 300 },
    surface: "server",
    build: () =>
      query("table", {
        filter: nameIs(NAME.HTTP_REQUEST),
        groupBy: [attr(ATTR.HTTP_ROUTE)],
        aggregations: [
          { fn: "percentile", field: attr(ATTR.DURATION_MS, "number"), p: 0.95 },
          { fn: "count" },
        ],
        orderBy: rankByFirst,
        limit: 15,
      }),
  },
  {
    key: "note",
    labelKey: "dashboard.preset_note",
    hintKey: "dashboard.preset_note_hint",
    size: { w: 300, h: 120 },
    build: () => ({ kind: "note", body: "" }),
  },
];

/** The row's own words, resolved where a locale switch can re-render them. */
export const presetLabel = (i18n: I18n, preset: Preset): string => i18n.t(preset.labelKey);

/** The `title` on the row: a 36px popover row has no second line for it. */
export const presetHint = (i18n: I18n, preset: Preset): string => i18n.t(preset.hintKey);

export const presetByKey = (key: string): Preset | undefined =>
  PRESETS.find((preset) => preset.key === key);

/** The palette for a board whose project has these surfaces on it. */
export const presetsFor = (surfaces: readonly Surface[]): Preset[] =>
  PRESETS.filter((preset) => !preset.surface || surfaces.includes(preset.surface));

/**
 * A blank query, for the "start from nothing" case.
 *
 * Count of entries with no filter is the one query that is always meaningful
 * and always has an answer, which is what an empty builder should open on.
 */
export const blankQuery = (): LogQuery => ({ aggregations: [{ fn: "count" }] });

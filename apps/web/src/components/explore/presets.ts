import { ATTR, NAME } from "@firstrun/schema/conventions";
import type { BoardWidget } from "@firstrun/schema/board";
import type { Discovery, LogQuery, Visualisation } from "@firstrun/schema/query";
import {
  atLeast,
  attr,
  nameIs,
  percentileQuery,
  rankingQuery,
  seriesQuery,
  totalQuery,
  vitalsQuery,
  type Unit,
} from "@firstrun/schema/recipes";
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
 * The queries are written in the shared recipe vocabulary
 * (`packages/schema/src/recipes.ts`), which is the same one the board templates
 * use. Two private copies of `nameIs` was a chance for two starting points to
 * mean subtly different things by the same words.
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
 * sees the same days rather than their own idea of where a day starts. A series
 * nobody chose a zone for (a sparkline, a template) is UTC instead.
 */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * What the palette knows about the project it is offering presets for.
 *
 * Only one thing so far, and it earns its place: the two most common questions
 * anybody asks a log are "how many of THIS happened" and "how many people did
 * it". Both need an entry name, and a preset that landed with an empty name
 * filter would be a card showing every entry in the project under a title
 * promising one of them. The most-sent name is a guess the builder opens on
 * immediately, so it is a guess somebody corrects in one click.
 */
export interface PresetContext {
  /** The most-sent entry name in the visible window, or null before anything arrives. */
  topName: string | null;
}

export const presetContext = (discovery: Discovery): PresetContext => ({
  topName: discovery.names[0]?.name ?? null,
});

/**
 * The name a "count one thing" preset lands on.
 *
 * The project's own most-sent name when there is one. Before a project has sent
 * anything there is nothing to be right about, so it falls back to a convention
 * rather than to nothing: a filter that matches nothing is a filter somebody
 * can see and edit, and an absent filter is a card quietly counting everything.
 */
const subject = (ctx: PresetContext): string => ctx.topName ?? NAME.PAGE_VIEW;

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
  build: (ctx: PresetContext) => Omit<BoardWidget, "id" | "x" | "y" | "w" | "h">;
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

/** A headline number over one entry name, with its own daily sparkline. */
const counter = (ctx: PresetContext, unit: Unit) =>
  query("number", totalQuery(unit, nameIs(subject(ctx))), { compare: true, sparkline: true });

export const PRESETS: Preset[] = [
  {
    key: "event-count",
    labelKey: "dashboard.preset_event_count",
    hintKey: "dashboard.preset_event_count_hint",
    size: { w: 300, h: 160 },
    build: (ctx) => counter(ctx, "entries"),
  },
  {
    key: "event-uniques",
    labelKey: "dashboard.preset_event_uniques",
    hintKey: "dashboard.preset_event_uniques_hint",
    size: { w: 300, h: 160 },
    build: (ctx) => counter(ctx, "uniques"),
  },
  {
    key: "uniques",
    labelKey: "dashboard.preset_uniques",
    hintKey: "dashboard.preset_uniques_hint",
    size: { w: 300, h: 160 },
    build: () => query("number", totalQuery("uniques"), { compare: true, sparkline: true }),
  },
  {
    key: "entries-over-time",
    labelKey: "dashboard.preset_over_time",
    hintKey: "dashboard.preset_over_time_hint",
    size: { w: 620, h: 300 },
    build: () => query("line", seriesQuery("entries", localTimezone()), { compare: true }),
  },
  {
    key: "names",
    labelKey: "dashboard.preset_names",
    hintKey: "dashboard.preset_names_hint",
    size: { w: 440, h: 320 },
    build: () =>
      query(
        "list",
        rankingQuery({ by: { kind: "column", column: "name" }, unit: "entries", limit: 20 })
      ),
  },
  {
    key: "errors",
    labelKey: "dashboard.preset_errors",
    hintKey: "dashboard.preset_errors_hint",
    size: { w: 620, h: 300 },
    build: () => query("bar", seriesQuery("entries", localTimezone(), atLeast("ERROR"))),
  },
  {
    key: "exception-types",
    labelKey: "dashboard.preset_exceptions",
    hintKey: "dashboard.preset_exceptions_hint",
    size: { w: 440, h: 320 },
    build: () =>
      query(
        "list",
        rankingQuery({
          by: attr(ATTR.EXCEPTION_TYPE),
          unit: "entries",
          filter: nameIs(NAME.EXCEPTION),
          also: { fn: "count_distinct", field: { kind: "unique" } },
        })
      ),
  },
  {
    // The type says WHAT broke; the message usually says WHICH thing broke, and
    // the two are a different ranking. Grouping on the message is the closest
    // this product gets to an issue list, and it is an ordinary group by rather
    // than a fingerprint somebody has to trust.
    key: "exception-messages",
    labelKey: "dashboard.preset_exception_messages",
    hintKey: "dashboard.preset_exception_messages_hint",
    size: { w: 620, h: 320 },
    build: () =>
      query(
        "list",
        rankingQuery({
          by: attr(ATTR.EXCEPTION_MESSAGE),
          unit: "entries",
          filter: nameIs(NAME.EXCEPTION),
          also: { fn: "count_distinct", field: { kind: "unique" } },
        })
      ),
  },
  {
    key: "pages",
    labelKey: "dashboard.preset_pages",
    hintKey: "dashboard.preset_pages_hint",
    size: { w: 440, h: 320 },
    build: () => query("list", rankingQuery({ by: attr(ATTR.URL_PATH), filter: nameIs(NAME.PAGE_VIEW) })),
  },
  {
    key: "referrers",
    labelKey: "dashboard.preset_referrers",
    hintKey: "dashboard.preset_referrers_hint",
    size: { w: 440, h: 320 },
    build: () =>
      query("list", rankingQuery({ by: attr(ATTR.REFERRER_HOST), filter: nameIs(NAME.PAGE_VIEW) })),
  },
  {
    key: "vitals",
    labelKey: "dashboard.preset_vitals",
    hintKey: "dashboard.preset_vitals_hint",
    size: { w: 440, h: 240 },
    build: () => query("table", vitalsQuery(NAME.WEB_VITAL)),
  },
  {
    key: "versions",
    labelKey: "dashboard.preset_versions",
    hintKey: "dashboard.preset_versions_hint",
    size: { w: 620, h: 300 },
    build: () => query("list", rankingQuery({ by: attr(ATTR.SERVICE_VERSION), limit: 20 })),
  },
  {
    key: "slow-routes",
    labelKey: "dashboard.preset_slow_routes",
    hintKey: "dashboard.preset_slow_routes_hint",
    size: { w: 620, h: 300 },
    build: () =>
      query(
        "table",
        percentileQuery({
          by: attr(ATTR.HTTP_ROUTE),
          value: ATTR.DURATION_MS,
          p: 0.95,
          filter: nameIs(NAME.HTTP_REQUEST),
        })
      ),
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

/**
 * A blank query, for the "start from nothing" case.
 *
 * Count of entries with no filter is the one query that is always meaningful
 * and always has an answer, which is what an empty builder should open on.
 */
export const blankQuery = (): LogQuery => ({ aggregations: [{ fn: "count" }] });

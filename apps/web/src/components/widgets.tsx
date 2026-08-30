import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { cn } from "../lib/cn.js";
import { hairlineStroke, useCardTier, type CardTier } from "./canvas.js";
import {
  effectiveQuery,
  widgetKey,
  widgetSparklineKey,
  type Board,
  type BoardWidget,
  type QueryWidget,
} from "@firstrun/schema/board";
import {
  delta,
  rowsAt,
  scalarOf,
  type BoardSnapshot,
  type LogQuery,
  type QueryRow,
  type Visualisation,
} from "@firstrun/schema/query";
import { useI18n, type I18n } from "../lib/i18n/index.js";
import { NUM } from "./format.js";
import { queryLabels } from "./query-labels.js";
import {
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  hairlineBottom,
} from "./ui/index.js";

/**
 * One component per VISUALISATION, not one per kind of card.
 *
 * A card is a saved query and a way of drawing its answer, so nothing here
 * knows what a card is "for": every component below takes rows in the shape the
 * query compiler decodes into and draws them. Six ways of drawing, and the same
 * rows go through all of them, which is why changing a chart from bars to a
 * line re-renders and does not re-query.
 *
 * Two rules run through everything here.
 *
 * 1. ONE NUMBER PER QUESTION. Nothing is inferred and nothing is guessed, so no
 *    figure has a differently coloured companion saying how many more there
 *    might be. A card with nothing to say draws nothing.
 *
 * 2. VALUES AND KEYS ARE CUSTOMER DATA. A group label is whatever a client
 *    wrote into an attribute: long, unfamiliar, and possibly full of dots.
 *    Everything truncates and keeps the whole string in a `title`, so no card
 *    is broken by somebody naming a route `checkout.step_3.address_validated`.
 *
 * Cards are resizable in both directions, so a fixed height is a bug and a
 * fixed *amount of content* is the same bug one level up. Everything fills its
 * box and reads its own size through the canvas tier contract. Where an SVG
 * genuinely needs pixels, `Measured` supplies them.
 */

// ---------------------------------------------------------------------------
// How much room a card has
// ---------------------------------------------------------------------------

/**
 * Four sizes of card, and what each one has earned the right to say.
 *
 * A board where every card says the same amount whatever its size is a board
 * where making a card bigger buys nothing but whitespace. The ladder is the
 * same everywhere so a reader learns it once: the headline number at `tiny`,
 * what names it and how it moved at `small`, its shape over time at `medium`,
 * and the supporting detail at `large`.
 */
export type Tier = "tiny" | "small" | "medium" | "large";

const TIER_ORDER: readonly Tier[] = ["tiny", "small", "medium", "large"];

const atLeast = (tier: Tier, min: Tier) => TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);

/**
 * The names above are this file's vocabulary for the canvas's tier contract;
 * the numbers belong to `canvas.tsx`.
 *
 * They are derived there from the rect the drag is writing, which is what makes
 * a card re-tier as the pointer moves rather than a frame later. Measuring the
 * body here instead would fight that: a body measurement has to subtract the
 * card's chrome, and the card tightens its padding at the low tiers, so the
 * amount to subtract would depend on the answer.
 */
const TIER_NAME: Record<CardTier, Tier> = { 1: "tiny", 2: "small", 3: "medium", 4: "large" };

/**
 * The tier this card is at, and the box every widget body sits in.
 *
 * Outside a `CanvasItem` the contract answers its top tier, so a visualisation
 * rendered anywhere else (the explore screen, a preview) shows everything.
 */
function CardFit(props: { children: (tier: () => Tier) => JSX.Element }) {
  const cardTier = useCardTier();
  const tier = () => TIER_NAME[cardTier()];
  return <div class="h-full min-h-0">{props.children(tier)}</div>;
}

const SPARK_SPACE: Record<Tier, string> = {
  tiny: "",
  small: "",
  medium: "mt-2 min-h-[18px] flex-1",
  large: "mt-3 min-h-[26px] flex-1",
};

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function Swatch(props: { colour: string }) {
  return (
    <span
      class="inline-block size-2 shrink-0 rounded-[2px]"
      style={{ "background-color": props.colour }}
    />
  );
}

/**
 * Why a card is blank, in as few lines as will fit.
 *
 * Clamped rather than truncated: an explanation cut off at the fourth line is
 * still an explanation, whereas one that overflows paints over the card below.
 */
function Empty(props: { children: JSX.Element }) {
  return (
    <div class="flex h-full min-h-0 items-center justify-center overflow-hidden px-2 text-center">
      <span class="line-clamp-4 break-words text-xs text-muted-foreground">{props.children}</span>
    </div>
  );
}

/**
 * A card whose answer has not arrived yet.
 *
 * One shape for every visualisation, on purpose. A card cannot know what its
 * answer will look like before it has one, so a skeleton drawn in the shape of
 * a chart is a promise about a number nobody has counted, and four different
 * waiting states across four kinds of card is four things to recognise instead
 * of one.
 */
function Pending() {
  const i18n = useI18n();
  return <Skeleton class="h-full w-full opacity-60" aria-label={i18n.t("explore.running")} />;
}

/**
 * The headline figure, sized by the card rather than by the tier.
 *
 * The canvas publishes the hero size as a pixel value computed from the same
 * rect the tier is, so the number and the amount of content around it can never
 * disagree about how much room there is. The fallback covers a visualisation
 * rendered outside a card.
 */
function Headline(props: { children: JSX.Element; class?: string }) {
  return (
    <div
      class={cn(
        "shrink-0 truncate font-semibold leading-none tracking-tight text-foreground",
        NUM,
        props.class
      )}
      style={{ "font-size": "var(--card-hero, 2rem)" }}
    >
      {props.children}
    </div>
  );
}

/**
 * The change against the comparison window, or nothing.
 *
 * Null draws nothing at all, because a card that prints "0%" where it means
 * "nothing to compare against" is stating the opposite of what it knows.
 */
function Delta(props: { change: number | null; compare: { from: Date; to: Date }; tier: Tier }) {
  const i18n = useI18n();
  const shown = () => i18n.delta(props.change);
  return (
    <Show when={shown()}>
      {(change) => (
        <div class="mt-2 flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <span
            class={cn(
              "font-semibold",
              change().dir === "up" && "text-positive",
              change().dir === "down" && "text-negative",
              change().dir === "flat" && "text-muted-foreground"
            )}
          >
            {change().label}
          </span>
          <Show when={atLeast(props.tier, "medium")}>
            <span class="truncate text-muted-foreground">
              {i18n.t("dashboard.baseline", {
                range: i18n.dateRange(props.compare.from, props.compare.to),
              })}
            </span>
          </Show>
        </div>
      )}
    </Show>
  );
}

/**
 * A box that knows its own pixel size.
 *
 * An SVG stretched with a non-uniform aspect ratio distorts everything in it:
 * round corners turn oval, a 1px rule turns 3px wide on a squat card. Charts
 * are drawn in real pixels instead, which costs one ResizeObserver and is the
 * difference between a chart that survives being resized and one that merely
 * does not crash.
 */
function Measured(props: {
  class?: string;
  children: (box: () => { w: number; h: number }) => JSX.Element;
}) {
  const [box, setBox] = createSignal({ w: 0, h: 0 });
  let el: HTMLDivElement | undefined;

  onMount(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBox({ w: Math.round(rect.width), h: Math.round(rect.height) });
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div ref={el} class={cn("min-h-0 min-w-0", props.class)}>
      {props.children(box)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows, shaped for drawing
// ---------------------------------------------------------------------------

/**
 * What a null group is called on screen. Never folded into the empty string.
 *
 * Passed in rather than looked up here, so the pure shaping functions below stay
 * free of the provider and can be called from anywhere.
 */
export const groupLabel = (row: QueryRow, notSet: string): string =>
  row.group.length === 0 ? "" : row.group.map((g) => g ?? notSet).join(" · ");

export interface Point {
  at: Date;
  value: number;
}

export interface Series {
  /** The group this line belongs to. Empty when the query is not grouped. */
  label: string;
  points: Point[];
}

/**
 * Bucketed rows as one series per group, in the order the query returned them.
 *
 * A grouped and bucketed query answers with the cross product, so the rows have
 * to be split by group before anything can be drawn. Ungrouped, that is one
 * series with an empty label, which is the same code path with one bucket.
 */
export function seriesFrom(rows: readonly QueryRow[], notSet: string, index = 0): Series[] {
  const byGroup = new Map<string, Series>();
  for (const row of rows) {
    if (!row.bucket) continue;
    const label = groupLabel(row, notSet);
    let series = byGroup.get(label);
    if (!series) {
      series = { label, points: [] };
      byGroup.set(label, series);
    }
    series.points.push({ at: row.bucket, value: row.value[index] ?? 0 });
  }
  for (const series of byGroup.values()) {
    series.points.sort((a, b) => a.at.getTime() - b.at.getTime());
  }
  return [...byGroup.values()];
}

export interface Rank {
  label: string;
  value: number;
  /** Of the total over EVERY group, not of the rows that fit. Null: no total. */
  share: number | null;
}

/** Grouped rows as a ranking. Already ordered by the query, so never re-sorted. */
export function ranksFrom(rows: readonly QueryRow[], notSet: string, index = 0): Rank[] {
  return rows.map((row) => {
    const value = row.value[index] ?? 0;
    const total = row.total ?? null;
    return {
      label: groupLabel(row, notSet) || notSet,
      value,
      share: total && total > 0 ? value / total : null,
    };
  });
}

/**
 * How many series a chart will draw before it stops being readable.
 *
 * Six lines is already a lot; the limit on the query decides which six, because
 * it is the one that ran with an ORDER BY behind it. Anything past this is
 * dropped from the drawing rather than merged into an "other" bucket somebody
 * would then try to click.
 */
const MAX_SERIES = 6;

const CHART_COLOURS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-muted-foreground)",
];

const colourAt = (i: number) => CHART_COLOURS[i % CHART_COLOURS.length]!;

/**
 * `min(time)` and `max(time)` come back as epoch milliseconds, so the same
 * numeric array carries them as everything else. Printing one as a count would
 * be a thirteen-digit number nobody can read, so the aggregation says how.
 */
function formatValue(
  i18n: I18n,
  query: LogQuery,
  index: number,
  value: number | null
): string {
  if (value === null) return "–";
  const agg = query.aggregations[index];
  if (
    agg &&
    (agg.fn === "min" || agg.fn === "max") &&
    agg.field.kind === "column" &&
    (agg.field.column === "time" || agg.field.column === "ingested_at")
  ) {
    return i18n.shortDate(new Date(value));
  }
  // Two decimals at most, through `Intl`: an average of 3.5 is "3,5" in German
  // and `toFixed` cannot know that.
  return Number.isInteger(value)
    ? i18n.num(value)
    : i18n.num(value, { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// A single number
// ---------------------------------------------------------------------------

export function NumberView(props: {
  rows: readonly QueryRow[];
  previous: readonly QueryRow[] | null;
  compare: { from: Date; to: Date } | null;
  /** The daily shape of the same question, when the card asked for one. */
  sparkline: readonly QueryRow[];
  query: LogQuery;
  tier: Tier;
}) {
  const i18n = useI18n();
  const labels = queryLabels(i18n);
  const value = () => scalarOf(props.rows);
  const change = () => delta(value(), props.previous ? scalarOf(props.previous) : null);
  const points = createMemo(() => {
    const series = seriesFrom(props.sparkline, i18n.t("dashboard.not_set"))[0]?.points ?? [];
    // One point is a dot pretending to be a trend, and all zeroes draws as a
    // line along the axis that reads as data. Both are worse than no chart.
    return series.length > 1 && series.some((p) => p.value > 0) ? series : [];
  });
  const label = () => labels.aggregation(props.query.aggregations[0] ?? { fn: "count" });

  return (
    <Show
      when={value() !== null}
      fallback={<Empty>{i18n.t("dashboard.nothing_measured")}</Empty>}
    >
      <div
        class={cn(
          "flex h-full min-h-0 flex-col",
          !atLeast(props.tier, "medium") && "justify-center"
        )}
      >
        <div class="min-w-0 shrink-0">
          <Headline>
            {props.tier === "tiny"
              ? i18n.compact(value() ?? 0)
              : formatValue(i18n, props.query, 0, value())}
          </Headline>

          <Show when={atLeast(props.tier, "small")}>
            {/* Printed as the catalogue writes it. Lower-casing it here was an
                English typographic choice, and German capitalises a noun
                wherever it stands: "einträge" is a spelling mistake. */}
            <div class="mt-1.5 truncate text-xs text-muted-foreground" title={label()}>
              {label()}
            </div>
          </Show>

          <Show when={atLeast(props.tier, "small") && props.compare}>
            <Delta change={change()} compare={props.compare!} tier={props.tier} />
          </Show>
        </div>

        <Show when={atLeast(props.tier, "medium") && points().length > 0}>
          <Measured class={SPARK_SPACE[props.tier]}>
            {(box) => (
              <Show when={box().w > 0 && box().h > 0}>
                <Sparkline points={points()} w={box().w} h={box().h} />
              </Show>
            )}
          </Measured>
        </Show>

        <Show when={atLeast(props.tier, "large") && points().length > 0}>
          <div
            class={cn(
              "mt-1.5 flex shrink-0 items-baseline justify-between gap-2",
              "text-label-13 text-muted-foreground"
            )}
          >
            <span class="truncate">
              {i18n.t("dashboard.window_span", {
                from: i18n.shortDate(points()[0]!.at),
                to: i18n.shortDate(points()[points().length - 1]!.at),
              })}
            </span>
            <span class="shrink-0">
              {i18n.t("dashboard.peak")}{" "}
              <span class={cn("font-semibold text-foreground", NUM)}>
                {i18n.num(Math.max(...points().map((p) => p.value)))}
              </span>
            </span>
          </div>
        </Show>
      </div>
    </Show>
  );
}

/** Bars, because a sparkline of a bucketed count is a count per bucket. */
function Sparkline(props: { points: Point[]; w: number; h: number }) {
  const max = () => Math.max(1, ...props.points.map((p) => p.value));
  const barWidth = () => props.w / Math.max(1, props.points.length);

  return (
    <svg class="block" width={props.w} height={props.h} aria-hidden="true">
      <g opacity="0.7">
        <For each={props.points}>
          {(point, i) => {
            const height = () => Math.max(point.value > 0 ? 1 : 0, (point.value / max()) * props.h);
            return (
              <rect
                class="fill-chart-1"
                x={i() * barWidth()}
                y={props.h - height()}
                width={Math.max(1, barWidth() - 1)}
                height={height()}
              />
            );
          }}
        </For>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Over time, and across groups
// ---------------------------------------------------------------------------

/**
 * A line, bars or an area.
 *
 * Bucketed, it is a series per group over time. Grouped without a bucket, the x
 * axis is the groups themselves, which is what makes "bars" a chart type rather
 * than a second kind of ranking: the same query drawn either way.
 */
export function ChartView(props: {
  rows: readonly QueryRow[];
  previous: readonly QueryRow[] | null;
  chart: "line" | "bar" | "area";
  query: LogQuery;
  tier: Tier;
}) {
  const i18n = useI18n();
  const labels = queryLabels(i18n);
  const notSet = () => i18n.t("dashboard.not_set");
  const bucketed = () => props.query.bucket !== undefined;
  const series = createMemo(() => seriesFrom(props.rows, notSet()).slice(0, MAX_SERIES));
  const ranks = createMemo(() => ranksFrom(props.rows, notSet()));

  /**
   * The comparison line is the first thing to go. Two overlaid series in a
   * chart 60px tall are one thick smudge, and a smudge that changes shape when
   * the window changes reads as data.
   */
  const previous = () => {
    if (!props.previous || !atLeast(props.tier, "medium")) return null;
    const first = seriesFrom(props.previous, notSet())[0];
    return first && first.points.length > 0 ? first.points : null;
  };

  const max = () =>
    Math.max(
      1,
      ...series().flatMap((s) => s.points.map((p) => p.value)),
      ...ranks().map((r) => r.value),
      ...(previous() ?? []).map((p) => p.value)
    );

  const empty = () => (bucketed() ? series().length === 0 : ranks().length === 0);
  const label = () => labels.aggregation(props.query.aggregations[0] ?? { fn: "count" });

  return (
    <Show when={!empty()} fallback={<Empty>{i18n.t("dashboard.no_events")}</Empty>}>
      <div class="flex h-full min-h-0 flex-col">
        <Measured class="min-h-[32px] flex-1">
          {(box) => (
            <Show when={box().w > 0 && box().h > 0}>
              <Show
                when={bucketed()}
                fallback={
                  <CategoryChart
                    ranks={ranks()}
                    max={max()}
                    w={box().w}
                    h={box().h}
                    label={label()}
                  />
                }
              >
                <SeriesChart
                  series={series()}
                  previous={previous()}
                  chart={props.chart}
                  max={max()}
                  w={box().w}
                  h={box().h}
                  baseline={atLeast(props.tier, "medium")}
                  label={label()}
                />
              </Show>
            </Show>
          )}
        </Measured>

        <Show when={atLeast(props.tier, "small") && bucketed() && series()[0]}>
          {(first) => (
            <div
              class={cn(
                "mt-2 flex shrink-0 items-baseline justify-between gap-2",
                "text-label-13 text-muted-foreground"
              )}
            >
              <span class="truncate">{i18n.shortDate(first().points[0]!.at)}</span>
              <Show when={atLeast(props.tier, "medium")}>
                <span class="shrink-0">
                  {i18n.t("dashboard.peak")}{" "}
                  <span class={cn("font-semibold text-foreground", NUM)}>{i18n.num(max())}</span>
                </span>
              </Show>
              <span class="truncate">
                {i18n.shortDate(first().points[first().points.length - 1]!.at)}
              </span>
            </div>
          )}
        </Show>

        <Show when={atLeast(props.tier, "large")}>
          <div
            class={cn(
              "mt-1.5 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1",
              "text-label-13 text-muted-foreground"
            )}
          >
            <Show
              when={series().length > 1}
              fallback={
                <span class="flex min-w-0 items-center gap-1.5">
                  <Swatch colour={colourAt(0)} />
                  <span class="truncate">{label()}</span>
                </span>
              }
            >
              <For each={series()}>
                {(s, i) => (
                  <span class="flex min-w-0 items-center gap-1.5" title={s.label}>
                    <Swatch colour={colourAt(i())} />
                    <span class="truncate">{s.label}</span>
                  </span>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

/**
 * One or more series, drawn in real pixels.
 *
 * The comparison window is always a faint dashed line regardless of the chart
 * type, because two sets of bars interleaved are unreadable. It is drawn in the
 * muted foreground: a second hue would imply a second kind of answer.
 */
function SeriesChart(props: {
  series: Series[];
  previous: Point[] | null;
  chart: "line" | "bar" | "area";
  max: number;
  w: number;
  h: number;
  baseline: boolean;
  label: string;
}) {
  const i18n = useI18n();
  const gradientId = createUniqueId();

  const xAt = (i: number, count: number) =>
    count <= 1 ? props.w / 2 : (i / (count - 1)) * props.w;
  const yAt = (value: number) => props.h - (value / props.max) * props.h;

  const linePath = (points: Point[]) =>
    points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${xAt(i, points.length).toFixed(1)},${yAt(p.value).toFixed(1)}`
      )
      .join(" ");

  /** Bars only make sense for one series. Several are drawn as lines instead. */
  const asBars = () => props.chart === "bar" && props.series.length === 1;

  return (
    <svg class="block" width={props.w} height={props.h} role="img" aria-label={props.label}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--color-chart-1)" stop-opacity="0.45" />
          <stop offset="100%" stop-color="var(--color-chart-1)" stop-opacity="0.02" />
        </linearGradient>
      </defs>

      {/* The axis the bars stand on. Without it a short bar floats. */}
      <Show when={props.baseline}>
        <line
          class={hairlineStroke}
          x1="0"
          y1={props.h - 0.5}
          x2={props.w}
          y2={props.h - 0.5}
          stroke="var(--color-border)"
        />
      </Show>

      <Show when={asBars()}>
        <For each={props.series[0]!.points}>
          {(point, i) => {
            const count = props.series[0]!.points.length;
            const barWidth = () => props.w / count;
            const height = () =>
              Math.max(point.value > 0 ? 1.5 : 0, (point.value / props.max) * props.h);
            return (
              <rect
                // The bar brightens to say which one the native tooltip is
                // about, and it transitions because every other thing on a card
                // that answers a hover does. Opacity is not in Tailwind's
                // colour transition list, so it is named.
                class="fill-chart-1 opacity-90 transition-opacity hover:opacity-100"
                x={i() * barWidth()}
                y={props.h - height()}
                width={Math.max(1, barWidth() - 1.5)}
                height={height()}
                rx="1"
              >
                <title>{`${i18n.shortDate(point.at)}: ${i18n.num(point.value)}`}</title>
              </rect>
            );
          }}
        </For>
      </Show>

      <Show when={!asBars()}>
        <For each={props.series}>
          {(s, i) => (
            <>
              <Show when={props.chart === "area" && props.series.length === 1}>
                <path
                  fill={`url(#${gradientId})`}
                  d={`${linePath(s.points)} L${props.w},${props.h} L0,${props.h} Z`}
                />
              </Show>
              <path
                fill="none"
                stroke={colourAt(i())}
                stroke-width="2"
                stroke-linejoin="round"
                d={linePath(s.points)}
              />
            </>
          )}
        </For>
      </Show>

      <Show when={props.previous}>
        {(previous) => (
          <path
            fill="none"
            stroke="var(--color-muted-foreground)"
            stroke-width="1.5"
            stroke-dasharray="3 3"
            opacity="0.75"
            d={linePath(previous())}
          />
        )}
      </Show>
    </svg>
  );
}

/** Groups on the x axis: the same answer a ranked list draws, as bars. */
function CategoryChart(props: {
  ranks: Rank[];
  max: number;
  w: number;
  h: number;
  label: string;
}) {
  const i18n = useI18n();
  const barWidth = () => props.w / Math.max(1, props.ranks.length);
  return (
    <svg class="block" width={props.w} height={props.h} role="img" aria-label={props.label}>
      <line
        class={hairlineStroke}
        x1="0"
        y1={props.h - 0.5}
        x2={props.w}
        y2={props.h - 0.5}
        stroke="var(--color-border)"
      />
      <For each={props.ranks}>
        {(rank, i) => {
          const height = () =>
            Math.max(rank.value > 0 ? 1.5 : 0, (rank.value / props.max) * props.h);
          return (
            <rect
              // Same treatment as the bucketed bars: they are the same mark
              // answering the same hover.
              class="fill-chart-1 opacity-90 transition-opacity hover:opacity-100"
              x={i() * barWidth()}
              y={props.h - height()}
              width={Math.max(1, barWidth() - 2)}
              height={height()}
              rx="1"
            >
              <title>{`${rank.label}: ${i18n.num(rank.value)}`}</title>
            </rect>
          );
        }}
      </For>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// A ranked list
// ---------------------------------------------------------------------------

/**
 * The limit on the query is a ceiling, not a quota.
 *
 * A card that asked for ten rows and has room for three shows three, because
 * the alternative is ten rows of two-pixel text or a scrollbar hiding seven of
 * them. Growing the card is how you get the rest.
 */
const LIST_ROWS: Record<Tier, number> = {
  tiny: 2,
  small: 4,
  medium: 7,
  large: Number.POSITIVE_INFINITY,
};

export function ListView(props: {
  rows: readonly QueryRow[];
  query: LogQuery;
  tier: Tier;
}) {
  const i18n = useI18n();
  const labels = queryLabels(i18n);
  const ranks = createMemo(() => ranksFrom(props.rows, i18n.t("dashboard.not_set")));
  // Bars are scaled to the top row rather than to 100%, so the shape of the
  // ranking is visible even when the leader holds 4% of a long tail. The
  // printed figure is the real share either way.
  const top = () => Math.max(...ranks().map((r) => r.value), 1);
  const shown = () => ranks().slice(0, LIST_ROWS[props.tier]);
  const hasShare = () => ranks().some((r) => r.share !== null);

  return (
    <Show when={ranks().length > 0} fallback={<Empty>{i18n.t("dashboard.no_events")}</Empty>}>
      <div class="flex h-full min-h-0 flex-col">
        <Show when={atLeast(props.tier, "medium")}>
          <div
            class={cn(
              "flex shrink-0 items-center justify-between gap-2 pb-2",
              "text-label-13 text-muted-foreground"
            )}
          >
            <span class="min-w-0 truncate font-medium">
              {i18n.list((props.query.groupBy ?? []).map(labels.field)) ||
                i18n.t("dashboard.all_events")}
            </span>
            <span class="shrink-0">
              {labels.aggregation(props.query.aggregations[0] ?? { fn: "count" })}
            </span>
          </div>
        </Show>

        <div class="min-h-0 flex-1 overflow-auto">
          <For each={shown()}>
            {(rank, i) => (
              <div
                class={cn(
                  "relative flex items-center justify-between gap-3",
                  // A device pixel, like every other rule in the chrome, and
                  // stated per row rather than as a last-child exception: a
                  // resolution variant and a position variant on the same
                  // property is a fight about source order that a reader cannot
                  // see and a scanner will not warn about.
                  i() < shown().length - 1 && hairlineBottom,
                  atLeast(props.tier, "small") ? "py-1.5" : "py-1"
                )}
              >
                <div
                  class="absolute inset-y-0 left-0 rounded-sm bg-chart-1/20"
                  style={{ width: `${Math.min(100, (rank.value / top()) * 100)}%` }}
                  aria-hidden="true"
                />
                <span
                  class={cn(
                    "relative truncate text-foreground",
                    atLeast(props.tier, "small") ? "text-label-13" : "text-caption"
                  )}
                  title={rank.label}
                >
                  {rank.label}
                </span>
                <span class={cn("relative flex shrink-0 items-baseline gap-2 text-xs", NUM)}>
                  <Show when={atLeast(props.tier, "medium") || !hasShare()}>
                    <span class="font-semibold text-foreground">
                      {formatValue(i18n, props.query, 0, rank.value)}
                    </span>
                  </Show>
                  <Show when={atLeast(props.tier, "small") && rank.share !== null}>
                    {/* Wider than it was: German writes a percentage with a
                        non-breaking space before the sign, and `i18n.percent`
                        keeps a decimal on a small share, so the old ten
                        characters of width clipped the number. */}
                    <span
                      class={cn(
                        "w-14 text-right",
                        atLeast(props.tier, "medium")
                          ? "text-muted-foreground"
                          : "font-semibold text-foreground"
                      )}
                    >
                      {i18n.percent(rank.share!)}
                    </span>
                  </Show>
                </span>
              </div>
            )}
          </For>
        </div>

        <Show when={atLeast(props.tier, "medium") && ranks().length > shown().length}>
          <div class="shrink-0 pt-1.5 text-label-13 text-muted-foreground">
            {i18n.t("dashboard.more", { count: ranks().length - shown().length })}
          </div>
        </Show>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// The rows as they came back
// ---------------------------------------------------------------------------

/**
 * Every column the query produced: the bucket, each group, each aggregation.
 *
 * The one visualisation that draws a query with several aggregations honestly.
 * The others take the first and ignore the rest, which is right for a chart and
 * would be a lie in a table.
 */
export function TableView(props: { rows: readonly QueryRow[]; query: LogQuery; tier: Tier }) {
  const i18n = useI18n();
  const labels = queryLabels(i18n);
  const groups = () => props.query.groupBy ?? [];
  const aggregations = () => props.query.aggregations;
  const notSet = () => i18n.t("dashboard.not_set");

  return (
    <Show when={props.rows.length > 0} fallback={<Empty>{i18n.t("dashboard.no_events")}</Empty>}>
      <div class="h-full min-h-0 overflow-auto">
        {/*
          32px rows, not the 48px measured LIST row.

          A list page has the whole content track to spend and a card has
          whatever the person dragging it left; at 48px a table on a tier 4 card
          shows a header and three rows, which is a worse answer than the one it
          is drawing. The height is stated at this call site rather than changed
          in the primitive, because the list pages are right at 48.
        */}
        <Table>
          <TableHeader>
            <TableRow class="h-8">
              <Show when={props.query.bucket}>
                <TableHead class="h-8">{i18n.t("explore.column_time")}</TableHead>
              </Show>
              <For each={groups()}>
                {(field) => <TableHead class="h-8">{labels.field(field)}</TableHead>}
              </For>
              <For each={aggregations()}>
                {(agg) => (
                  <TableHead numeric class="h-8">
                    {labels.aggregation(agg)}
                  </TableHead>
                )}
              </For>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={props.rows}>
              {(row) => (
                <TableRow class="h-8">
                  <Show when={props.query.bucket}>
                    <TableCell class="whitespace-nowrap">
                      {row.bucket ? i18n.shortDate(row.bucket) : "–"}
                    </TableCell>
                  </Show>
                  <For each={groups()}>
                    {(_, i) => (
                      <TableCell class="max-w-[16rem] truncate" title={row.group[i()] ?? notSet()}>
                        {row.group[i()] ?? notSet()}
                      </TableCell>
                    )}
                  </For>
                  <For each={aggregations()}>
                    {(_, i) => (
                      <TableCell numeric class={NUM}>
                        {formatValue(i18n, props.query, i(), row.value[i()] ?? null)}
                      </TableCell>
                    )}
                  </For>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// A note
// ---------------------------------------------------------------------------

/** The one card with no query behind it. */
export function NoteView(props: { body: string; tier: Tier }) {
  const i18n = useI18n();
  return (
    <Show
      when={props.body.trim().length > 0}
      fallback={<Empty>{i18n.t("dashboard.empty_note")}</Empty>}
    >
      <div
        class={cn(
          "h-full min-h-0 overflow-auto whitespace-pre-wrap break-words leading-relaxed text-foreground",
          atLeast(props.tier, "medium") ? "text-sm" : "text-xs"
        )}
      >
        {props.body}
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * What a card is called when nobody has titled it: what its query asks.
 *
 * Takes the provider rather than reading it, so a caller already holding one
 * (every one of them does) passes it in and this stays callable from a memo.
 */
export function defaultTitle(i18n: I18n, widget: BoardWidget): string {
  return widget.kind === "note"
    ? i18n.t("dashboard.note_title")
    : queryLabels(i18n).describe(widget.query);
}

/**
 * A visualisation over rows somebody else fetched.
 *
 * Takes rows rather than a snapshot so the explore screen, which has one answer
 * and no board behind it, draws through exactly the same components as a card.
 */
export function VisualisationBody(props: {
  viz: Visualisation;
  query: LogQuery;
  rows: readonly QueryRow[];
  previous?: readonly QueryRow[] | null;
  compare?: { from: Date; to: Date } | null;
  sparkline?: readonly QueryRow[];
  tier?: Tier;
}) {
  const tier = () => props.tier ?? "large";
  return (
    <Switch>
      <Match when={props.viz === "number"}>
        <NumberView
          rows={props.rows}
          previous={props.previous ?? null}
          compare={props.compare ?? null}
          sparkline={props.sparkline ?? []}
          query={props.query}
          tier={tier()}
        />
      </Match>
      <Match when={props.viz === "line" || props.viz === "bar" || props.viz === "area"}>
        <ChartView
          rows={props.rows}
          previous={props.previous ?? null}
          chart={props.viz as "line" | "bar" | "area"}
          query={props.query}
          tier={tier()}
        />
      </Match>
      <Match when={props.viz === "list"}>
        <ListView rows={props.rows} query={props.query} tier={tier()} />
      </Match>
      <Match when={props.viz === "table"}>
        <TableView rows={props.rows} query={props.query} tier={tier()} />
      </Match>
    </Switch>
  );
}

/**
 * One card of a board.
 *
 * Every answer comes out of the snapshot the page already fetched, so adding a
 * card costs a render and not a round trip, and a card keeps showing real
 * numbers while it is being dragged. The key is DERIVED here by the same two
 * functions the planner used, never passed in and never stored, which is what
 * makes fetch and render agree by construction.
 */
export function WidgetBody(props: {
  board: Board;
  widget: BoardWidget;
  snapshot: BoardSnapshot;
}) {
  const asQuery = (): QueryWidget | null =>
    props.widget.kind === "query" ? props.widget : null;

  return (
    <CardFit>
      {(tier) => (
        <Show
          when={asQuery()}
          fallback={
            <NoteView
              body={props.widget.kind === "note" ? props.widget.body : ""}
              tier={tier()}
            />
          }
        >
          {(widget) => {
            const key = () => widgetKey(props.board, widget());
            const sparkKey = () => widgetSparklineKey(props.board, widget());
            /**
             * A key the snapshot has never carried is a question nobody has
             * asked yet, and that is not the same answer as none.
             *
             * `rowsAt` says the empty array to both, so a card added a moment
             * ago -- or one whose query was just edited in the drawer -- printed
             * "no entries" over a query still in flight, which is the card
             * asserting something it does not know. The board refetches on
             * exactly those two edits, so this is the gap between the edit and
             * the answer and nothing else.
             *
             * Only the main key. A sparkline that has not arrived draws no
             * sparkline, which is already what an empty series does.
             */
            const pending = () => !(key() in props.snapshot.results);
            return (
              <Show when={!pending()} fallback={<Pending />}>
                <VisualisationBody
                  viz={widget().viz}
                  query={effectiveQuery(props.board, widget())}
                  rows={rowsAt(props.snapshot.results, key())}
                  previous={
                    widget().compare && props.snapshot.previous
                      ? rowsAt(props.snapshot.previous, key())
                      : null
                  }
                  compare={widget().compare ? props.snapshot.compare : null}
                  sparkline={
                    sparkKey() ? rowsAt(props.snapshot.results, sparkKey()!) : []
                  }
                  tier={tier()}
                />
              </Show>
            );
          }}
        </Show>
      )}
    </CardFit>
  );
}

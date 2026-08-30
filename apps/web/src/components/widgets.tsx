import {
  For,
  Index,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
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
import { NUM, truncateMiddle } from "./format.js";
import { queryLabels } from "./query-labels.js";
import {
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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

/**
 * The room a headline card gives its own shape.
 *
 * From `small` up, not from `medium`: the stat tile that carries a number, its
 * change and a mini chart is the single most common card on any board, and the
 * size somebody actually places one at (300x180, every template counter) drew
 * no chart at all under the old gate. A tile with no shape in it is a tile that
 * answers "how many" and refuses "how it went", which is half the reason to
 * look at it.
 *
 * `tiny` stays empty on purpose. Below the second tier a card is one number and
 * nothing else, and a six-pixel chart is a smudge that reads as data.
 */
const SPARK_SPACE: Record<Tier, string> = {
  tiny: "",
  small: "mt-2 min-h-[16px] flex-1",
  medium: "mt-2 min-h-[22px] flex-1",
  large: "mt-3 min-h-[28px] flex-1",
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
      <span class="line-clamp-4 break-words text-label-13 text-muted-foreground">
        {props.children}
      </span>
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
 * The change against the comparison window, as a pill beside the number.
 *
 * A tinted pill rather than coloured text on the card's own fill, which is what
 * the reference draws and what makes the change readable at a glance next to a
 * 31px figure: green words beside a black number read as a second number, and a
 * badge reads as an annotation on the first.
 *
 * Null draws nothing at all, because a card that prints "0%" where it means
 * "nothing to compare against" is stating the opposite of what it knows.
 *
 * UP is drawn as good. That is a guess this product is allowed to make and the
 * reference is not: every aggregation here counts occurrences of something a
 * customer chose to measure, and there is no bounce rate in the vocabulary for
 * it to be wrong about. If a metric where down is good ever lands, this needs a
 * direction on the query rather than a cleverer rule here.
 */
function Delta(props: { change: number | null }) {
  const i18n = useI18n();
  const shown = () => i18n.delta(props.change);
  return (
    <Show when={shown()}>
      {(change) => (
        <span
          class={cn(
            "shrink-0 rounded-sm px-1.5 py-0.5 text-caption font-semibold",
            change().dir === "up" && "bg-positive/10 text-positive",
            change().dir === "down" && "bg-destructive/10 text-negative",
            change().dir === "flat" && "bg-muted text-muted-foreground"
          )}
        >
          {change().label}
        </span>
      )}
    </Show>
  );
}

/** Which window the change is against, spelled out. Never a bare percentage. */
function Baseline(props: { compare: { from: Date; to: Date } }) {
  const i18n = useI18n();
  return (
    <div class="mt-1.5 truncate text-caption text-muted-foreground">
      {i18n.t("dashboard.baseline", {
        range: i18n.dateRange(props.compare.from, props.compare.to),
      })}
    </div>
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

  const measure = (w: number, h: number) => {
    const next = { w: Math.round(w), h: Math.round(h) };
    setBox((held) => (held.w === next.w && held.h === next.h ? held : next));
  };

  onMount(() => {
    if (!el) return;

    // Measured once, here, and not left to the observer's first callback. A
    // ResizeObserver delivers that callback on the next frame at the earliest,
    // so a chart that waits for it paints its box empty and its marks a frame
    // later, which reads as a flash on every navigation. It is also the only
    // measurement that arrives at all where frames are not being produced --
    // a headless render, a page in a background tab, a screenshot -- and a
    // chart that draws nothing in a screenshot is a chart nobody can review.
    const rect = el.getBoundingClientRect();
    measure(rect.width, rect.height);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (size) measure(size.width, size.height);
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

// ---------------------------------------------------------------------------
// The plot: scales, ticks and the box they are drawn in
// ---------------------------------------------------------------------------

/**
 * A scale a person recognises, ending at or above the largest value.
 *
 * The old charts scaled straight to the maximum, which is fine while nothing is
 * labelled and wrong the moment something is: an axis whose top tick reads
 * 1,247 is an axis nobody can read a bar against. This rounds the top up to a
 * step of 1, 2 or 5 times a power of ten, which is the only ladder anybody
 * estimates in.
 *
 * Counts are integers, so a step below one is forced back up to one whenever
 * the data itself reaches one. An average of 0.4 keeps its fractional ticks,
 * because that is the honest scale for it.
 */
export function niceScale(max: number, targetTicks: number): { top: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { top: 1, ticks: [0, 1] };

  const rough = max / Math.max(1, targetTicks);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  let step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
  if (step < 1 && max >= 1) step = 1;

  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Half a step of slack, because 3 * 0.1 is not 0.3 in binary floating point
  // and a tick ladder that stops one step short leaves the top of the chart
  // unlabelled.
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { top, ticks };
}

/** The plot area inside the SVG: what is left once the axes have their room. */
interface Plot {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * How much of the box the axes take.
 *
 * The left gutter is derived from the widest tick string rather than fixed,
 * because "8" and "1.2M" are not the same number of pixels and a fixed gutter
 * is either wasted space or a clipped label. Seven pixels per character is the
 * mono advance at the caption size, rounded up; the cap stops one absurd label
 * from eating the chart it is meant to explain.
 *
 * Four pixels of headroom at the top whether or not there are axes: a 2px line
 * at the maximum value is otherwise drawn half outside its own box.
 */
const AXIS_ROW_H = 16;
const CHAR_PX = 7;
/** The measured air between a tick label and the plot it labels. */
const AXIS_GAP_PX = 12;

function plotOf(w: number, h: number, axes: boolean, xLabels: boolean, widest: string): Plot {
  const left = axes ? Math.min(60, widest.length * CHAR_PX + AXIS_GAP_PX) : 0;
  const bottom = xLabels ? AXIS_ROW_H : 0;
  // Half a tick label sits above the highest gridline, so the headroom has to
  // clear it. Without axes there is only the 2px half of a line's own stroke.
  const top = axes ? 8 : 4;
  return {
    left,
    top,
    width: Math.max(1, w - left),
    height: Math.max(1, h - top - bottom),
  };
}

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
          {/*
            The change sits BESIDE the number on its baseline, which is where
            the reference puts it and the reason a stat tile reads in one
            movement: figure, then how it moved, then what it is. Under the
            number it was a third line competing with the unit for the same
            room, and on a 140px card there is no third line.

            It wraps rather than shrinking the figure, so a very long formatted
            number keeps its own row on a narrow card.
          */}
          <div class="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <Headline>
              {props.tier === "tiny"
                ? i18n.compact(value() ?? 0)
                : formatValue(i18n, props.query, 0, value())}
            </Headline>
            <Show when={atLeast(props.tier, "small") && props.compare}>
              <Delta change={change()} />
            </Show>
          </div>

          {/* What the number COUNTS, under it, where a unit goes.
              The card's own title is already above this in the header, so a
              second label over the figure would be two captions stacked on one
              number. It is the first thing to go when the tile is small, and
              the shape of the thing is what takes the room instead.

              Printed as the catalogue writes it. Lower-casing it here was an
              English typographic choice, and German capitalises a noun wherever
              it stands: "einträge" is a spelling mistake. */}
          <Show when={atLeast(props.tier, "medium")}>
            <div class="mt-1.5 truncate text-label-13 text-muted-foreground" title={label()}>
              {label()}
            </div>
          </Show>

          {/* The window the change is against, on the one tier with room for
              it. The toolbar states both windows on every board, so this is the
              second statement of a fact rather than the only one: it earns its
              place on a big card and not on a small one. */}
          <Show when={atLeast(props.tier, "large") && props.compare && change() !== null}>
            <Baseline compare={props.compare!} />
          </Show>
        </div>

        <Show when={atLeast(props.tier, "small") && points().length > 0}>
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

/**
 * The shape of the same question, with no axes on it at all.
 *
 * Bars, because a sparkline of a bucketed count is a count per bucket. It is
 * deliberately unlabelled and unhoverable: a tile answers "how many, and is it
 * going up", and the moment it grows ticks and a tooltip it is competing with
 * the chart card next to it rather than supporting the number above it.
 *
 * Scaled to its own maximum with no shared domain, which is the point of a
 * sparkline: the reader is judging the SHAPE. The bar that touches the top is
 * the biggest day, and nothing here claims to say what it was.
 */
function Sparkline(props: { points: Point[]; w: number; h: number }) {
  const max = () => Math.max(1, ...props.points.map((p) => p.value));
  const pitch = () => props.w / Math.max(1, props.points.length);
  // A quarter of the pitch, capped at two pixels. Below about eight pixels of
  // pitch a fixed gap eats the bar it is separating, and thirty days of a
  // hundred-pixel tile is three pixels a day.
  const gap = () => Math.min(2, Math.max(0.5, pitch() * 0.25));

  return (
    <svg class="block" width={props.w} height={props.h} aria-hidden="true">
      <For each={props.points}>
        {(point, i) => {
          const height = () => Math.max(point.value > 0 ? 1 : 0, (point.value / max()) * props.h);
          return (
            <rect
              class="fill-chart-1 opacity-80"
              x={i() * pitch()}
              y={props.h - height()}
              width={Math.max(1, pitch() - gap())}
              height={height()}
              rx={Math.min(1.5, Math.max(0, (pitch() - gap()) / 3))}
            />
          );
        }}
      </For>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Over time, and across groups
// ---------------------------------------------------------------------------

/**
 * Every series on one shared x domain.
 *
 * A grouped, bucketed query answers with the cross product MINUS the empty
 * cells, so two groups routinely come back with different numbers of buckets.
 * Drawn from their own point lists they were laid out over their own widths,
 * which put the same Tuesday in two places on one chart. The union of the
 * timestamps fixes that once, and it is also what a crosshair needs: one index
 * per column, every line answering the same question at it.
 *
 * A cell nobody sent is null rather than zero. For a count they mean the same
 * thing; for an average or a p95 they do not, and a line that dives to the axis
 * because nobody measured anything that hour is a chart telling a lie about a
 * quiet period. The line connects across the gap and the bar simply is not
 * drawn, which is the same treatment a missing point has always had here.
 */
interface Grid {
  times: Date[];
  lines: Array<{ label: string; values: Array<number | null> }>;
}

export function gridFrom(series: Series[]): Grid {
  const stamps = [...new Set(series.flatMap((s) => s.points.map((p) => p.at.getTime())))];
  stamps.sort((a, b) => a - b);
  const at = new Map(stamps.map((t, i) => [t, i]));

  return {
    times: stamps.map((t) => new Date(t)),
    lines: series.map((s) => {
      const values = new Array<number | null>(stamps.length).fill(null);
      for (const point of s.points) values[at.get(point.at.getTime())!] = point.value;
      return { label: s.label, values };
    }),
  };
}

/**
 * Which columns get a label under them.
 *
 * A fixed STRIDE, not `want` positions interpolated across the range and
 * rounded. Rounding bunches: over thirty days it put the 15th and the 16th
 * forty pixels apart while every other pair was eighty, and two dates on top of
 * each other is worse than one date missing. A stride cannot do that.
 *
 * The last column is always labelled, because it is the end of the window and a
 * ruler stopping three days short of it is a ruler somebody misreads. When the
 * stride lands too near it, the tick before is dropped rather than crowded.
 */
function tickIndices(count: number, want: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const n = Math.max(2, Math.min(want, count));
  const stride = Math.max(1, Math.ceil((count - 1) / (n - 1)));

  const out: number[] = [];
  for (let i = 0; i < count; i += stride) out.push(i);

  const last = count - 1;
  if (out[out.length - 1] !== last) {
    if (last - out[out.length - 1]! < stride / 2) out.pop();
    out.push(last);
  }
  return out;
}

/**
 * One label every ~130px.
 *
 * A short date is about sixty pixels of mono at the caption size, so this is
 * roughly a label per two labels' worth of room. Tighter reads as a ruler on
 * graph paper rather than as the handful of anchors somebody actually checks a
 * shape against.
 */
const X_TICK_PITCH_PX = 130;

/**
 * A line, bars or an area, with a scale on it.
 *
 * Bucketed, it is a series per group over time. Grouped without a bucket, the x
 * axis is the groups themselves, which is what makes "bars" a chart type rather
 * than a second kind of ranking: the same query drawn either way.
 *
 * From tier 3 the chart carries real axes: a rounded y scale with its ticks
 * labelled and a gridline at each, dated ticks along the bottom, and a
 * crosshair that reads every series at one column. Below that it is a shape and
 * nothing else, because an axis in forty pixels of height is two labels
 * overlapping each other on top of the data they describe.
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
  const grid = createMemo(() => gridFrom(series()));
  const ranks = createMemo(() => ranksFrom(props.rows, notSet()));

  /**
   * The comparison line is the first thing to go. Two overlaid series in a
   * chart 60px tall are one thick smudge, and a smudge that changes shape when
   * the window changes reads as data.
   */
  const previous = () => {
    if (!props.previous || !atLeast(props.tier, "medium")) return null;
    const first = seriesFrom(props.previous, notSet())[0];
    if (!first || first.points.length === 0) return null;
    // Cut to the current window's column count. The baseline is drawn on THIS
    // chart's x mapping, so a comparison window holding one bucket more (a
    // month against a shorter month, an hour lost to a clock change) would
    // otherwise draw its last point past the right hand edge.
    return first.points.slice(0, Math.max(1, grid().times.length)).map((p) => p.value);
  };

  const peak = () =>
    Math.max(
      1,
      ...grid().lines.flatMap((line) => line.values.map((v) => v ?? 0)),
      ...ranks().map((r) => r.value),
      ...(previous() ?? [])
    );

  /** Axes from tier 3, and one more tick once there is room to read it. */
  const axes = () => atLeast(props.tier, "medium");
  const scale = createMemo(() => niceScale(peak(), atLeast(props.tier, "large") ? 4 : 3));

  // Compact on the axis, in full in the tooltip. An axis has three characters
  // of room and a tooltip has a line, so 12.4K on the scale and 12,431 under
  // the pointer is the same number answered at two densities.
  //
  // NOT `i18n.compact`, which prints in full below a hundred thousand: that is
  // right for a headline on a tiny card and wrong here, where an axis reading
  // "80.000" pins the gutter at its cap and takes the width from the plot. A
  // decimal only appears once the number is big enough to need one.
  const tickText = (value: number) =>
    i18n.num(value, {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: Math.abs(value) < 10_000 ? 0 : 1,
    });
  const valueText = (value: number) => formatValue(i18n, props.query, 0, value);
  const widest = () =>
    scale().ticks.reduce((held, t) => (tickText(t).length > held.length ? tickText(t) : held), "");

  const empty = () => (bucketed() ? series().length === 0 : ranks().length === 0);
  const label = () => labels.aggregation(props.query.aggregations[0] ?? { fn: "count" });

  /**
   * What the hovered column is called: the BUCKET, not the instant.
   *
   * A bare date under an hourly chart says the wrong thing twenty-three times a
   * day. Sub-day buckets therefore print the time as well; a day, a week and a
   * month all read as a date, and the bucket's own width is already stated by
   * the chart's x axis.
   */
  const bucketHeading = (at: Date) => {
    const unit = props.query.bucket?.unit;
    return unit === "minute" || unit === "hour" ? i18n.dateTime(at) : i18n.shortDate(at);
  };

  return (
    <Show when={!empty()} fallback={<Empty>{i18n.t("dashboard.no_events")}</Empty>}>
      <div class="flex h-full min-h-0 flex-col">
        {/* `relative`, because the crosshair's tooltip is an HTML sibling of the
            SVG rather than a `<title>`: a native tooltip cannot show several
            series at once and appears a second after the pointer stops. */}
        <Measured class="relative min-h-[32px] flex-1">
          {(box) => (
            <Show when={box().w > 0 && box().h > 0}>
              <Show
                when={bucketed()}
                fallback={
                  <CategoryChart
                    ranks={ranks()}
                    scale={scale()}
                    w={box().w}
                    h={box().h}
                    axes={axes()}
                    widest={widest()}
                    tickText={tickText}
                    valueText={valueText}
                    label={label()}
                  />
                }
              >
                <SeriesChart
                  grid={grid()}
                  previous={previous()}
                  chart={props.chart}
                  scale={scale()}
                  w={box().w}
                  h={box().h}
                  axes={axes()}
                  widest={widest()}
                  tickText={tickText}
                  valueText={valueText}
                  heading={bucketHeading}
                  label={label()}
                />
              </Show>
            </Show>
          )}
        </Measured>

        {/*
          The window, in words, on a card too small to have carried an x axis.
          Above tier 3 the ticks say this and better, so restating it would be
          the same fact twice under one chart.
        */}
        <Show when={!axes() && atLeast(props.tier, "small") && bucketed() && grid().times.length > 0}>
          <div
            class={cn(
              "mt-2 flex shrink-0 items-baseline justify-between gap-2",
              "text-label-13 text-muted-foreground"
            )}
          >
            <span class="truncate">{i18n.shortDate(grid().times[0]!)}</span>
            <span class="truncate">
              {i18n.shortDate(grid().times[grid().times.length - 1]!)}
            </span>
          </div>
        </Show>

        <Show when={atLeast(props.tier, "large")}>
          <div
            class={cn(
              "mt-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1",
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
            <Show when={previous()}>
              <span class="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  class="inline-block h-px w-3 shrink-0 border-t border-dashed border-muted-foreground"
                />
                <span class="truncate">{i18n.t("dashboard.baseline_series")}</span>
              </span>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// The axes, shared by both charts
// ---------------------------------------------------------------------------

/**
 * The horizontal rules and the numbers beside them.
 *
 * One rule per tick INCLUDING zero, so the axis a bar stands on is drawn by the
 * same code as the rules above it and can never be a pixel out from them. They
 * are the chrome's own hairline -- `--border` at one device pixel -- because a
 * gridline heavier than the card it sits inside reads as data, and every one of
 * them is behind the marks in paint order for the same reason.
 *
 * Labels are `--muted-foreground`, which is the token whose own definition
 * names axis labels as one of its jobs, and set in the mono face like every
 * other figure in the product so a column of them lines up on the digit.
 */
function Gridlines(props: {
  plot: Plot;
  scale: { top: number; ticks: number[] };
  labels: boolean;
  tickText: (value: number) => string;
}) {
  const yAt = (value: number) =>
    props.plot.top + props.plot.height - (value / props.scale.top) * props.plot.height;

  return (
    <Index each={props.scale.ticks}>
      {(tick) => (
        <>
          <line
            class={hairlineStroke}
            x1={props.plot.left}
            x2={props.plot.left + props.plot.width}
            y1={yAt(tick()) - 0.5}
            y2={yAt(tick()) - 0.5}
            stroke="var(--color-border)"
            shape-rendering="crispEdges"
          />
          <Show when={props.labels}>
            <text
              class={cn("fill-muted-foreground text-caption", NUM)}
              x={props.plot.left - AXIS_GAP_PX}
              y={yAt(tick())}
              text-anchor="end"
              dominant-baseline="middle"
            >
              {props.tickText(tick())}
            </text>
          </Show>
        </>
      )}
    </Index>
  );
}

/** One dated or named label under a column. */
function XTicks(props: {
  plot: Plot;
  count: number;
  at: (index: number) => number;
  text: (index: number) => string;
}) {
  const shown = () =>
    tickIndices(props.count, Math.max(2, Math.floor(props.plot.width / X_TICK_PITCH_PX)));

  return (
    <Index each={shown()}>
      {(index, nth) => {
        // The first and last labels are pulled onto the plot's edges rather
        // than centred on their column, which is what stops them being clipped
        // by the SVG on a chart whose first column starts at x = 0.
        const last = () => nth === shown().length - 1;
        const first = () => nth === 0;
        return (
          <text
            class={cn("fill-muted-foreground text-caption", NUM)}
            x={props.at(index())}
            y={props.plot.top + props.plot.height + AXIS_ROW_H - 4}
            text-anchor={first() ? "start" : last() ? "end" : "middle"}
          >
            {props.text(index())}
          </text>
        );
      }}
    </Index>
  );
}

/**
 * What the pointer is over, drawn as a card rather than as a native tooltip.
 *
 * A `<title>` can carry one mark's value and appears a second after the pointer
 * stops moving, which is the wrong answer to "what happened on the 14th" on a
 * chart with four lines on it. This reads every series at one column, in the
 * order the legend lists them.
 *
 * It flips sides at the halfway point instead of being clamped, so it never
 * covers the column it is describing and never runs off the card.
 *
 * The heading is UNDER the rows, centred and muted, and it names the BUCKET
 * rather than the instant: a reader hovering a chart is asking "what is this
 * value", and the answer to "of what period" is the qualifier on it. Putting
 * the period on top makes the first line of every tooltip the least useful one.
 */
function ChartTip(props: {
  x: number;
  flip: boolean;
  heading: string;
  rows: Array<{ label: string; colour: string; value: string }>;
}) {
  return (
    <div
      // Never a hit target: it follows the pointer, and a tooltip that can take
      // a hover is a tooltip that fights the chart under it.
      class={cn(
        "pointer-events-none absolute top-0 z-20 max-w-[15rem] rounded-md",
        "bg-popover px-2 py-1.5 text-caption text-popover-foreground shadow-tooltip"
      )}
      style={{
        left: `${props.x}px`,
        transform: props.flip ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
      }}
    >
      <For each={props.rows}>
        {(row) => (
          <div class="flex items-center justify-between gap-4 py-0.5">
            <span class="flex min-w-0 items-center gap-1.5">
              <Swatch colour={row.colour} />
              <span class="truncate font-medium text-foreground">{row.label}</span>
            </span>
            {/* The figure in a chip of its own, so a column of them lines up
                down the right hand edge whatever the names beside them are. */}
            <span
              class={cn("shrink-0 rounded-sm bg-muted px-1 py-px text-foreground", NUM)}
            >
              {row.value}
            </span>
          </div>
        )}
      </For>
      <div class="mt-1 truncate text-center text-muted-foreground">{props.heading}</div>
    </div>
  );
}

/**
 * One or more series over time, drawn in real pixels.
 *
 * The comparison window is always a faint dashed line regardless of the chart
 * type, because two sets of bars interleaved are unreadable. It is drawn in the
 * muted foreground: a second hue would imply a second kind of answer.
 *
 * Lines and areas put their first and last points ON the plot's edges; bars
 * occupy a column of it. Those are two different x mappings for the same data,
 * and the crosshair uses whichever one the chart is currently drawn with, so
 * the rule lands on the mark under the pointer rather than half a column off it.
 *
 * Returns a fragment: the tooltip is a sibling of the SVG, so the caller has to
 * be positioned.
 */
function SeriesChart(props: {
  grid: Grid;
  previous: number[] | null;
  chart: "line" | "bar" | "area";
  scale: { top: number; ticks: number[] };
  w: number;
  h: number;
  axes: boolean;
  widest: string;
  tickText: (value: number) => string;
  valueText: (value: number) => string;
  /** What one column is CALLED. Passed in, because only the query knows the
      bucket width and this component is handed a grid rather than a question. */
  heading: (at: Date) => string;
  label: string;
}) {
  const i18n = useI18n();
  const [hover, setHover] = createSignal<number | null>(null);

  const count = () => props.grid.times.length;
  const plot = () => plotOf(props.w, props.h, props.axes, props.axes, props.widest);

  /** Bars only make sense for one series. Several are drawn as lines instead. */
  const asBars = () => props.chart === "bar" && props.grid.lines.length === 1;

  const pitch = () => plot().width / Math.max(1, count());
  /** The centre of column `i`, which is what a tick and a crosshair aim at. */
  const xAt = (i: number) =>
    asBars()
      ? plot().left + (i + 0.5) * pitch()
      : count() <= 1
        ? plot().left + plot().width / 2
        : plot().left + (i / (count() - 1)) * plot().width;
  const yAt = (value: number) =>
    plot().top + plot().height - (value / props.scale.top) * plot().height;

  const linePath = (values: Array<number | null>) => {
    let started = false;
    let d = "";
    values.forEach((value, i) => {
      if (value === null) return;
      d += `${started ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(value).toFixed(1)}`;
      d += " ";
      started = true;
    });
    return d.trim();
  };

  /** The nearest column to a pointer, in the SVG's own coordinates. */
  const columnAt = (clientX: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    const x = clientX - rect.left - plot().left;
    if (count() <= 0) return null;
    const i = asBars()
      ? Math.floor(x / pitch())
      : count() <= 1
        ? 0
        : Math.round((x / plot().width) * (count() - 1));
    return Math.max(0, Math.min(count() - 1, i));
  };

  const tipRows = () => {
    const i = hover();
    if (i === null) return [];
    const rows = props.grid.lines.map((line, n) => ({
      label: line.label || props.label,
      colour: colourAt(n),
      value: line.values[i] === null ? "–" : props.valueText(line.values[i]!),
    }));
    const before = props.previous?.[i];
    if (before !== undefined) {
      rows.push({
        label: i18n.t("dashboard.baseline_series"),
        colour: "var(--color-muted-foreground)",
        value: props.valueText(before),
      });
    }
    return rows;
  };

  return (
    <>
      <svg
        class="block"
        width={props.w}
        height={props.h}
        role="img"
        aria-label={props.label}
        onPointerMove={(e) => setHover(columnAt(e.clientX, e.currentTarget))}
        onPointerLeave={() => setHover(null)}
      >
        <Gridlines
          plot={plot()}
          scale={props.scale}
          labels={props.axes}
          tickText={props.tickText}
        />

        {/*
          The column under the pointer, painted before the marks so it reads as
          the chart's own background rather than as a fifth series.

          A band for bars and a RULE for lines, because those are two different
          questions: a bar owns a column and a line owns a point on one. The
          rule is solid and in the foreground colour, not dashed and not the
          focus blue: a dashed line inside a chart is a convention already spent
          on the comparison series, and blue is a colour a series can be.

          The rule needs a scale behind it to be worth anything, so it appears
          only where the axes do. The band does not: a tinted column is legible
          at sixty pixels and is the only way a bar that small can say which one
          the tooltip is about.
        */}
        <Show when={hover() !== null && (asBars() || props.axes)}>
          {asBars() ? (
            <rect
              class="fill-accent"
              x={plot().left + hover()! * pitch()}
              y={plot().top}
              width={pitch()}
              height={plot().height}
            />
          ) : (
            <line
              class={hairlineStroke}
              x1={xAt(hover()!)}
              x2={xAt(hover()!)}
              y1={plot().top}
              y2={plot().top + plot().height}
              stroke="var(--color-foreground)"
            />
          )}
        </Show>

        <Show when={asBars()}>
          <Index each={props.grid.lines[0]!.values}>
            {(value, i) => {
              const gap = () => Math.min(4, Math.max(1, pitch() * 0.22));
              const height = () => {
                const v = value();
                return v === null
                  ? 0
                  : Math.max(v > 0 ? 1.5 : 0, (v / props.scale.top) * plot().height);
              };
              return (
                <Show when={value() !== null}>
                  <rect
                    // The bar brightens to say which one the crosshair is
                    // about, and it transitions because every other thing on a
                    // card that answers a hover does. Opacity is not in
                    // Tailwind's colour transition list, so it is named.
                    class={cn(
                      "fill-chart-1 transition-opacity",
                      hover() === null || hover() === i ? "opacity-100" : "opacity-45"
                    )}
                    x={plot().left + i * pitch() + gap() / 2}
                    y={plot().top + plot().height - height()}
                    width={Math.max(1, pitch() - gap())}
                    height={height()}
                    rx={Math.min(2, Math.max(0, (pitch() - gap()) / 4))}
                  />
                </Show>
              );
            }}
          </Index>
        </Show>

        <Show when={!asBars()}>
          <For each={props.grid.lines}>
            {(line, i) => (
              <>
                <Show when={props.chart === "area" && props.grid.lines.length === 1}>
                  <path
                    // One flat tone at 15%, not a gradient fading to nothing.
                    // A gradient puts a soft edge halfway up the plot that
                    // reads as a second, fainter series, and it hides the
                    // gridlines it is drawn over unevenly: under a flat fill
                    // every rule composites by the same amount, so the scale
                    // stays legible through the shape.
                    fill="var(--color-chart-1)"
                    fill-opacity="0.15"
                    d={`${linePath(line.values)} L${(plot().left + plot().width).toFixed(1)},${(
                      plot().top + plot().height
                    ).toFixed(1)} L${plot().left.toFixed(1)},${(
                      plot().top + plot().height
                    ).toFixed(1)} Z`}
                  />
                </Show>
                <path
                  fill="none"
                  stroke={colourAt(i())}
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  d={linePath(line.values)}
                />
              </>
            )}
          </For>
        </Show>

        <Show when={props.previous}>
          {(before) => <path fill="none" class="stroke-muted-foreground" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.75" d={linePath(before())} />}
        </Show>

        {/* The dot on every line at the hovered column, after the marks so it
            is never buried under the one it belongs to. */}
        <Show when={hover() !== null && !asBars()}>
          <For each={props.grid.lines}>
            {(line, i) => (
              <Show when={line.values[hover()!] !== null && line.values[hover()!] !== undefined}>
                <circle
                  cx={xAt(hover()!)}
                  cy={yAt(line.values[hover()!]!)}
                  r="4"
                  fill={colourAt(i())}
                  // The card-coloured halo is a deliberate divergence from the
                  // reference, which draws a bare dot. It draws ONE series;
                  // this draws up to six, and two lines crossing at the hovered
                  // column put two dots on top of each other. The halo is what
                  // keeps them countable.
                  class="stroke-card"
                  stroke-width="1.5"
                />
              </Show>
            )}
          </For>
        </Show>

        <Show when={props.axes}>
          <XTicks
            plot={plot()}
            count={count()}
            at={xAt}
            text={(i) => i18n.shortDate(props.grid.times[i]!)}
          />
        </Show>
      </svg>

      <Show when={hover() !== null && props.grid.times[hover()!]}>
        {(at) => (
          <ChartTip
            x={xAt(hover()!)}
            flip={xAt(hover()!) > plot().left + plot().width / 2}
            heading={props.heading(at())}
            rows={tipRows()}
          />
        )}
      </Show>
    </>
  );
}

/**
 * Groups on the x axis: the same answer a ranked list draws, as bars.
 *
 * The group name is customer data of unbounded length, so a tick under a bar is
 * cut in the middle and the whole of it is in the tooltip. Cutting in the
 * middle keeps the tail, which is the part that tells two names sharing a
 * prefix apart.
 */
function CategoryChart(props: {
  ranks: Rank[];
  scale: { top: number; ticks: number[] };
  w: number;
  h: number;
  axes: boolean;
  widest: string;
  tickText: (value: number) => string;
  valueText: (value: number) => string;
  label: string;
}) {
  const [hover, setHover] = createSignal<number | null>(null);

  const count = () => props.ranks.length;
  const plot = () => plotOf(props.w, props.h, props.axes, props.axes, props.widest);
  const pitch = () => plot().width / Math.max(1, count());
  const xAt = (i: number) => plot().left + (i + 0.5) * pitch();

  const columnAt = (clientX: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    const i = Math.floor((clientX - rect.left - plot().left) / pitch());
    return count() <= 0 ? null : Math.max(0, Math.min(count() - 1, i));
  };

  /** How many characters a tick has room for at this pitch. */
  const tickChars = () => Math.max(3, Math.floor(pitch() / CHAR_PX) - 1);

  return (
    <>
      <svg
        class="block"
        width={props.w}
        height={props.h}
        role="img"
        aria-label={props.label}
        onPointerMove={(e) => setHover(columnAt(e.clientX, e.currentTarget))}
        onPointerLeave={() => setHover(null)}
      >
        <Gridlines
          plot={plot()}
          scale={props.scale}
          labels={props.axes}
          tickText={props.tickText}
        />

        <For each={props.ranks}>
          {(rank, i) => {
            const gap = () => Math.min(6, Math.max(1, pitch() * 0.24));
            const height = () =>
              Math.max(rank.value > 0 ? 1.5 : 0, (rank.value / props.scale.top) * plot().height);
            return (
              <rect
                class={cn(
                  "fill-chart-1 transition-opacity",
                  hover() === null || hover() === i() ? "opacity-100" : "opacity-45"
                )}
                x={plot().left + i() * pitch() + gap() / 2}
                y={plot().top + plot().height - height()}
                width={Math.max(1, pitch() - gap())}
                height={height()}
                rx={Math.min(2, Math.max(0, (pitch() - gap()) / 4))}
              />
            );
          }}
        </For>

        <Show when={props.axes}>
          <XTicks
            plot={plot()}
            count={count()}
            at={xAt}
            text={(i) => truncateMiddle(props.ranks[i]!.label, tickChars())}
          />
        </Show>
      </svg>

      <Show when={hover() !== null && props.ranks[hover()!]}>
        {(rank) => (
          <ChartTip
            x={xAt(hover()!)}
            flip={xAt(hover()!) > plot().left + plot().width / 2}
            heading={rank().label}
            rows={[
              { label: props.label, colour: colourAt(0), value: props.valueText(rank().value) },
            ]}
          />
        )}
      </Show>
    </>
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
        {/*
          ONE column header, over the values, and the group name beside it.

          The reference draws exactly one: an uppercase micro-label above the
          number column, and nothing above the names, because the names ARE the
          rows. The group name is kept on the left because this product has no
          tab group there to say what is being ranked, and without it a card
          titled "Top pages" does not say the ranking is by path.
        */}
        <Show when={atLeast(props.tier, "medium")}>
          <div class="flex shrink-0 items-center justify-between gap-2 px-3 pb-2">
            <span class="min-w-0 truncate text-label-13 text-muted-foreground">
              {i18n.list((props.query.groupBy ?? []).map(labels.field)) ||
                i18n.t("dashboard.all_events")}
            </span>
            <span class="shrink-0 text-caption uppercase tracking-wide text-muted-foreground">
              {labels.aggregation(props.query.aggregations[0] ?? { fn: "count" })}
            </span>
          </div>
        </Show>

        <div class="min-h-0 flex-1 overflow-auto">
          <For each={shown()}>
            {(rank) => (
              <div
                class={cn(
                  "group/row relative flex items-center justify-between gap-3 rounded-sm",
                  // A 32px bar on a 40px pitch, which is the measured ranked
                  // row, stepped down twice for the cards that cannot afford
                  // it. Stated as a height rather than as padding so a row with
                  // a two-line-worth label still occupies exactly one row.
                  atLeast(props.tier, "medium")
                    ? "my-1 h-8 px-3"
                    : atLeast(props.tier, "small")
                      ? "my-0.5 h-7 px-2"
                      : "h-6 px-2"
                )}
              >
                {/*
                  The track is NEUTRAL, and it is the separator.

                  Two things changed here at once and they hold each other up.
                  The bar was the series blue, which made a ranked list read as
                  five bar charts of one bar; the reference fills it with the
                  page's own light grey so the row reads as a row and the length
                  is the only thing carrying data. And there used to be a
                  hairline under every row as well, which is a second boundary
                  on a list that already has one in the gap between tracks.
                */}
                <div
                  class={cn(
                    "absolute inset-y-0 left-0 rounded-sm bg-muted transition-colors",
                    "group-hover/row:bg-accent"
                  )}
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
          <div class="shrink-0 px-3 pt-1.5 text-caption text-muted-foreground">
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

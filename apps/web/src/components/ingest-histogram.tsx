import { For, createMemo } from "solid-js";
import { cn } from "../lib/cn.js";
import { NUM } from "./format.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * Thirty days of ingest, as one bar per day.
 *
 * The shape of the last month is the fact the captions beside it cannot carry:
 * "last entry 2 hours ago" says nothing about whether the thing has been
 * quietly dying for a fortnight, and a bar per day says it at a glance.
 *
 * One component for both lists that draw it -- projects on the workspace
 * overview, sources on the workspace sources page -- because they are the same
 * chart over the same window in the same units (`INGEST_HISTOGRAM_DAYS` in
 * `db/repo.ts`). Two implementations would be two things to keep in step, and a
 * reader comparing a project's bars against one of its sources' bars would be
 * comparing two charts that only looked alike.
 *
 * Drawn in viewBox units with `preserveAspectRatio="none"`, so the same
 * component fills a 120px column in a row and a whole tile in a grid without
 * anything measuring it. Bars are rectangles: stretching one horizontally
 * distorts nothing a reader could misread, which is what makes the cheap answer
 * the right one here. A card on a board, which has an axis to keep square,
 * measures its box instead.
 *
 * ONLY THE WIDTH STRETCHES. The height is a number rather than a class, and the
 * viewBox is exactly that tall, so the vertical scale is always 1:1 and every
 * constant below is the pixel it says it is. Set as a class it was not: the
 * same 32-tall box drawn at 64 or 48 scaled the bars by two or by one and a
 * half against a width scaled by seven, so a chart that was right in a 120px
 * column was a wall of squat blocks across a card, and the one-pixel stub for
 * an empty day was two or three pixels of what looked like data.
 *
 * A day with nothing gets a one-unit stub rather than nothing at all: thirty
 * bars with gaps in them reads as thirty days, and thirty bars with days
 * missing reads as a shorter window.
 */
export function IngestHistogram(props: {
  /** Oldest first, zero-filled. One number per day. */
  daily: number[];
  /**
   * How tall to draw it, in pixels. The viewBox takes the same number.
   *
   * A prop rather than a height class, because the two have to agree: the
   * element's height and the viewBox's are the vertical scale between them, and
   * a caller who set one without the other got a chart stretched by whatever
   * the ratio happened to be.
   */
  height?: number;
  /**
   * The accessible name, supplied by the caller.
   *
   * The chart is shared and the sentence is not: each page says what its own
   * bars count, in its own namespace, rather than this reaching into somebody
   * else's catalogue for a string.
   */
  label: string;
  class?: string;
}) {
  // At least 1, so a row that has sent nothing divides by one rather than by
  // zero and draws thirty stubs.
  const max = createMemo(() => Math.max(1, ...props.daily));
  const width = createMemo(() => Math.max(1, props.daily.length * BAR_PITCH - BAR_GAP));
  const space = createMemo(() => Math.max(1, Math.round(props.height ?? BAR_SPACE)));

  return (
    <svg
      class={cn("block w-full", props.class)}
      style={{ height: `${space()}px` }}
      viewBox={`0 0 ${width()} ${space()}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={props.label}
    >
      <For each={props.daily}>
        {(value, i) => {
          const height = () => (value > 0 ? Math.max(2, (value / max()) * space()) : 1);
          return (
            <rect
              class={value > 0 ? "fill-chart-1" : "fill-border"}
              x={i() * BAR_PITCH}
              y={space() - height()}
              width={BAR_PITCH - BAR_GAP}
              height={height()}
            />
          );
        }}
      </For>
    </svg>
  );
}

/** The histogram's own units: a 3-wide bar every 4, in a box 32 tall by default. */
const BAR_PITCH = 4;
const BAR_GAP = 1;
const BAR_SPACE = 32;

/** What the bars add up to, for the sentence a caller writes around them. */
export const ingestTotal = (daily: readonly number[]): number =>
  daily.reduce((sum, n) => sum + n, 0);

/**
 * The same thirty days read as a rate, as a headline figure beside the bars.
 *
 * Lives here rather than on the workspace overview because both lists that draw
 * the histogram draw this next to it, at the same size, in the same place. Two
 * copies would be two things to keep in step, and a reader comparing a project's
 * rate against one of its sources' would be comparing two numbers that only
 * looked alike.
 *
 * Mono and tabular, like every figure in the product (`NUM`), so a column of
 * these down a list lines up on the decimal point instead of dancing.
 *
 * The digits follow the magnitude, like `formatPercent` does: 240/hour does not
 * want a decimal place and 0.04/hour is nothing without two.
 *
 * Two arrangements, because the two places give it different room. In a row the
 * unit sits UNDER the number: a four-digit rate and a one-digit rate would
 * otherwise put the words in two different places down a list, where stacked
 * they are a column. `inline` puts the two on one baseline, for a tile whose
 * chart then keeps the card's whole width.
 */
export function IngestRate(props: {
  perHour: number;
  /** The unit, from the calling page's own catalogue. */
  unit: string;
  inline?: boolean;
  class?: string;
}) {
  const i18n = useI18n();

  const rate = () => {
    const value = props.perHour;
    const digits = value === 0 || value >= 10 ? 0 : value >= 1 ? 1 : 2;
    return i18n.num(value, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  };

  return (
    <div
      class={cn(
        "shrink-0",
        props.inline ? "flex items-baseline gap-1.5" : "text-right",
        props.class
      )}
    >
      <div class={cn("truncate text-2xl leading-none font-semibold text-foreground", NUM)}>
        {rate()}
      </div>
      <div class={cn("truncate text-caption text-muted-foreground", props.inline ? "" : "mt-1")}>
        {props.unit}
      </div>
    </div>
  );
}

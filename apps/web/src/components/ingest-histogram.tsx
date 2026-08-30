import { For, createMemo } from "solid-js";
import { cn } from "../lib/cn.js";

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
 * The viewBox is 32 tall and the element is 32px tall by default, so a bar's
 * minimum height lands on a real pixel rather than a fraction of one.
 *
 * A day with nothing gets a one-unit stub rather than nothing at all: thirty
 * bars with gaps in them reads as thirty days, and thirty bars with days
 * missing reads as a shorter window.
 */
export function IngestHistogram(props: {
  /** Oldest first, zero-filled. One number per day. */
  daily: number[];
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

  return (
    <svg
      class={cn("block h-8 w-full", props.class)}
      viewBox={`0 0 ${width()} ${BAR_SPACE}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={props.label}
    >
      <For each={props.daily}>
        {(value, i) => {
          const height = () => (value > 0 ? Math.max(2, (value / max()) * BAR_SPACE) : 1);
          return (
            <rect
              class={value > 0 ? "fill-chart-1" : "fill-border"}
              x={i() * BAR_PITCH}
              y={BAR_SPACE - height()}
              width={BAR_PITCH - BAR_GAP}
              height={height()}
            />
          );
        }}
      </For>
    </svg>
  );
}

/** The histogram's own units: a 3-wide bar every 4, in a 32-tall box. */
const BAR_PITCH = 4;
const BAR_GAP = 1;
const BAR_SPACE = 32;

/** What the bars add up to, for the sentence a caller writes around them. */
export const ingestTotal = (daily: readonly number[]): number =>
  daily.reduce((sum, n) => sum + n, 0);

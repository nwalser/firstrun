import { z } from "zod";

/**
 * The window a dashboard looks at, and what it compares against.
 *
 * Two things are deliberately separate here. The *range* is what the numbers
 * are; the *comparison* is what "up 12%" means. Folding them together is how
 * you end up with a delta nobody can explain, because the baseline moved when
 * the range did and nothing on screen said so.
 *
 * Absolute dates are plain `yyyy-mm-dd` strings in the viewer's own reckoning,
 * not instants. A range picked as "the 3rd to the 9th" should stay the 3rd to
 * the 9th regardless of who opens it, and an ISO timestamp cannot promise that.
 */

const DAY = 24 * 60 * 60 * 1000;

/** `yyyy-mm-dd`, and a real date rather than merely digits in that shape. */
export const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")), "not a real date");

export const DateRange = z.discriminatedUnion("kind", [
  /** Rolling. "The last 30 days" means something different tomorrow, on purpose. */
  z.object({ kind: z.literal("last"), days: z.number().int().min(1).max(730) }),
  /** Pinned. Both ends inclusive, which is what a date picker appears to promise. */
  z.object({ kind: z.literal("absolute"), from: CalendarDate, to: CalendarDate }),
]);

export type DateRange = z.infer<typeof DateRange>;

export const Comparison = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  /** The window of the same length immediately before this one. */
  z.object({ kind: z.literal("previous") }),
  /** The same dates a year earlier. Seasonal products need this, not "previous". */
  z.object({ kind: z.literal("year") }),
  z.object({ kind: z.literal("absolute"), from: CalendarDate, to: CalendarDate }),
]);

export type Comparison = z.infer<typeof Comparison>;

export interface ResolvedWindow {
  /** Inclusive start, midnight. */
  from: Date;
  /** EXCLUSIVE end. Every query is `>= from AND < to`, so a day is never half-counted. */
  to: Date;
}

const midnight = (day: string): Date => new Date(day + "T00:00:00.000Z");

/** `Date` -> `yyyy-mm-dd`, in UTC, which is what the calendar hands back. */
export function toCalendarDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A range as two instants.
 *
 * `now` is a parameter rather than a call so the same layout renders the same
 * numbers twice in a row, and so tests do not need a clock.
 */
export function resolveRange(range: DateRange, now: Date = new Date()): ResolvedWindow {
  if (range.kind === "absolute") {
    const from = midnight(range.from);
    // Inclusive on both ends for the person picking it, exclusive for the query.
    const to = new Date(midnight(range.to).getTime() + DAY);
    return from <= to ? { from, to } : { from: to, to: from };
  }
  const to = new Date(midnight(toCalendarDate(now)).getTime() + DAY);
  return { from: new Date(to.getTime() - range.days * DAY), to };
}

/**
 * The baseline window, or null when there is nothing to compare against.
 *
 * "Previous" is the same *length* immediately before, not the same calendar
 * period: a 17-day range compares against the 17 days before it, because that
 * is the only reading that keeps the two numbers the same size.
 */
export function resolveComparison(
  range: DateRange,
  comparison: Comparison,
  now: Date = new Date()
): ResolvedWindow | null {
  if (comparison.kind === "none") return null;

  if (comparison.kind === "absolute") {
    return resolveRange({ kind: "absolute", from: comparison.from, to: comparison.to }, now);
  }

  const current = resolveRange(range, now);

  if (comparison.kind === "previous") {
    const span = current.to.getTime() - current.from.getTime();
    return { from: new Date(current.from.getTime() - span), to: current.from };
  }

  // A year earlier, by calendar rather than by 365 days, so the comparison
  // lands on the same dates and not three days off after a leap year.
  const shift = (d: Date) => {
    const x = new Date(d);
    x.setUTCFullYear(x.getUTCFullYear() - 1);
    return x;
  };
  return { from: shift(current.from), to: shift(current.to) };
}

/** How the range reads in the toolbar. */
export function describeRange(range: DateRange): string {
  if (range.kind === "last") {
    if (range.days === 1) return "Last 24 hours";
    if (range.days === 365) return "Last 12 months";
    return `Last ${range.days} days`;
  }
  return range.from === range.to ? range.from : `${range.from} to ${range.to}`;
}

export function describeComparison(comparison: Comparison): string {
  switch (comparison.kind) {
    case "none":
      return "No comparison";
    case "previous":
      return "Previous period";
    case "year":
      return "Previous year";
    case "absolute":
      return `${comparison.from} to ${comparison.to}`;
  }
}

/** What the range dropdown offers before anyone opens the calendar. */
export const RANGE_PRESETS: Array<{ label: string; range: DateRange }> = [
  { label: "Last 24 hours", range: { kind: "last", days: 1 } },
  { label: "Last 7 days", range: { kind: "last", days: 7 } },
  { label: "Last 14 days", range: { kind: "last", days: 14 } },
  { label: "Last 30 days", range: { kind: "last", days: 30 } },
  { label: "Last 90 days", range: { kind: "last", days: 90 } },
  { label: "Last 180 days", range: { kind: "last", days: 180 } },
  { label: "Last 12 months", range: { kind: "last", days: 365 } },
];

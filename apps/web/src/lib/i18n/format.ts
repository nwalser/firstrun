import { INTL_TAG, type Locale } from "./locales.js";

/**
 * Numbers and dates in the active language.
 *
 * This matters more than the strings do. German writes 1.234,5 where English
 * writes 1,234.5, and a board of hard-coded en-US figures under German labels
 * does not read as "not translated yet", it reads as wrong numbers. A dashboard
 * is mostly numbers, so this is most of the translation.
 *
 * Every function is pure and takes the locale, so a caller outside the
 * component tree (a loader, a test) can use it. The provider exposes the same
 * set already bound to the active locale, which is what components should use.
 *
 * `Intl` constructors are the expensive part, and a board formats thousands of
 * values per render, so every formatter is cached. The cache key is the locale
 * plus the options, and a key collision is impossible for objects we write by
 * hand here: the worst case of a miss is a formatter built twice.
 */

export type DateLike = Date | string | number;

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();
const listFormats = new Map<string, Intl.ListFormat>();

function key(locale: Locale, opts?: object): string {
  return opts ? `${locale}|${JSON.stringify(opts)}` : locale;
}

function numberFormatter(locale: Locale, opts?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = key(locale, opts);
  let f = numberFormats.get(k);
  if (!f) {
    f = new Intl.NumberFormat(INTL_TAG[locale], opts);
    numberFormats.set(k, f);
  }
  return f;
}

function dateFormatter(locale: Locale, opts?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = key(locale, opts);
  let f = dateFormats.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(INTL_TAG[locale], opts);
    dateFormats.set(k, f);
  }
  return f;
}

/** Anything the API hands us as a timestamp, as a `Date`. */
export function toDate(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatNumber(
  locale: Locale,
  value: number,
  opts?: Intl.NumberFormatOptions
): string {
  if (!Number.isFinite(value)) return "";
  return numberFormatter(locale, opts).format(value);
}

/**
 * The same number in the width a very small card actually has.
 *
 * Rounding costs the reader precision, so it is paid only where it buys
 * something: below six figures the exact number fits and is printed in full.
 * Above it, "1,2 Mio." says the size of the thing, which is the whole job of a
 * card with no room to say more.
 */
export function formatCompact(locale: Locale, value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) < 100_000) return formatNumber(locale, value);
  return formatNumber(locale, value, { notation: "compact", maximumFractionDigits: 1 });
}

/**
 * A fraction of one as a percentage, with the precision the size deserves.
 *
 * A bounce rate of 42% does not want two decimal places and a conversion rate
 * of 0.34% is nothing without them, so the digits follow the magnitude.
 */
export function formatPercent(locale: Locale, fraction: number): string {
  if (!Number.isFinite(fraction)) return "";
  const p = Math.abs(fraction * 100);
  const digits = p >= 10 ? 0 : p >= 1 ? 1 : 2;
  return formatNumber(locale, fraction, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * A part of a whole, or nothing at all.
 *
 * Null when there is no whole to be a share of. Zero is a legitimate whole and
 * still returns null: every part of nothing is undefined, not 0%.
 */
export function formatShare(
  locale: Locale,
  part: number,
  whole: number | null | undefined
): string | null {
  if (!whole) return null;
  return formatPercent(locale, part / whole);
}

export type DeltaDirection = "up" | "down" | "flat";

/**
 * A change against the baseline window, ready to print.
 *
 * The argument is what `delta()` in the schema returns: a fraction, or null
 * when there is no baseline or the baseline was zero. Null in, null out, so a
 * card with nothing to compare against draws nothing rather than "0%", which
 * would say the opposite of the truth.
 *
 * Under half a percent reads as flat. A board that reports "+0.2%" against a
 * window one day longer is reporting the calendar, not the product.
 *
 * The sign comes from `Intl` rather than from a "+" glued on in front, because
 * where the sign goes and what it looks like is a property of the language, and
 * a hand-written one lands on the wrong side of the number the first time this
 * app learns a language that puts it there.
 *
 * `noChange` is passed in rather than looked up, so this file stays free of
 * words. The provider binds it to the catalogue entry.
 */
export function formatDelta(
  locale: Locale,
  change: number | null,
  noChange: string
): { dir: DeltaDirection; label: string } | null {
  if (change === null || !Number.isFinite(change)) return null;

  const percentage = change * 100;
  if (Math.abs(percentage) < 0.5) return { dir: "flat", label: noChange };

  const digits = Math.abs(percentage) > 100 ? 0 : 1;
  return {
    dir: percentage > 0 ? "up" : "down",
    label: formatNumber(locale, change, {
      style: "percent",
      signDisplay: "exceptZero",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }),
  };
}

/**
 * A file size a person reads at a glance.
 *
 * Through `Intl` rather than a template with "KB" on the end: the unit is
 * abbreviated differently per language, the separator between number and unit
 * is too, and German writes the decimal with a comma. All three are things
 * `style: "unit"` already knows.
 *
 * It climbs to terabytes rather than stopping at megabytes, which is what it
 * used to do. Its first caller was a logo upload, where a ceiling of MB is
 * every value it will ever see; the operator pages measure a whole database
 * with it, and "204.800 MB" is a number somebody has to divide in their head
 * before it means anything.
 */
const SIZE_UNITS = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

export function formatFileSize(locale: Locale, bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";

  let value = bytes / 1024;
  let step = 0;
  // 1000 rather than 1024, and deliberately: the step happens where the NUMBER
  // gets long, not where the next binary unit begins.
  while (value >= 1000 && step < SIZE_UNITS.length - 1) {
    value /= 1024;
    step += 1;
  }

  return formatNumber(locale, value, {
    style: "unit",
    unit: SIZE_UNITS[step]!,
    unitDisplay: "short",
    // One decimal below ten, none above it: the digit is worth having when it
    // is a tenth of the value and noise when it is a thousandth.
    maximumFractionDigits: value < 10 ? 1 : step === 0 ? 0 : 1,
  });
}

export function formatDate(
  locale: Locale,
  value: DateLike,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }
): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "";
  return dateFormatter(locale, opts).format(d);
}

/** Day and month only, for an axis tick or a dense table cell. */
export function formatShortDate(locale: Locale, value: DateLike): string {
  return formatDate(locale, value, { day: "numeric", month: "short" });
}

export function formatDateTime(locale: Locale, value: DateLike): string {
  return formatDate(locale, value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/*
 * The three below are for a calendar grid, and all three are pinned to UTC.
 *
 * A calendar cell is a date with no time in it, so the value handed to them is
 * midnight UTC. Formatting that in the viewer's zone puts anybody west of
 * Greenwich on the previous day, which draws the month starting on the wrong
 * weekday. They are separate helpers rather than options on `formatDate`
 * because the UTC pin is the point of them, and an options object is exactly
 * the thing a caller drops.
 */

/** The heading over a month grid: "August 2026" / "August 2026". */
export function formatMonthYear(locale: Locale, value: DateLike): string {
  return formatDate(locale, value, { month: "long", year: "numeric", timeZone: "UTC" });
}

/** A column head in a month grid: "Mon" / "Mo". */
export function formatWeekdayShort(locale: Locale, value: DateLike): string {
  return formatDate(locale, value, { weekday: "short", timeZone: "UTC" });
}

/** The accessible name of one day cell, spelled out in full. */
export function formatFullDate(locale: Locale, value: DateLike): string {
  return formatDate(locale, value, { dateStyle: "full", timeZone: "UTC" });
}

/**
 * The window a set of numbers covers, written out.
 *
 * `to` is exclusive everywhere in this codebase, so the label steps back a day
 * before printing it. Showing the exclusive end would claim a day of data the
 * numbers do not contain, and a reader has no way to know that.
 *
 * `formatRange` is what makes this worth routing through `Intl` rather than
 * joining two dates with a dash: it collapses the shared parts per language,
 * and it knows which separator each language uses.
 */
export function formatDateRange(locale: Locale, from: DateLike, toExclusive: DateLike): string {
  const start = toDate(from);
  const endExclusive = toDate(toExclusive);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) return "";

  const end = new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000);
  if (start.getTime() > end.getTime()) return formatShortDate(locale, start);

  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return dateFormatter(locale, opts).formatRange(start, end);
}

/**
 * How long ago, in whole coarse units.
 *
 * Rounds toward the coarser unit rather than the nearer one: an event 90
 * seconds old reads "1 minute ago", not "2 minutes ago", because claiming more
 * elapsed time than has actually passed makes a live feed look stale.
 *
 * Returns null under the threshold and for a future timestamp. `event_time` is
 * client-stamped, so a clock running fast is a clock problem rather than news,
 * and the caller says "just now" for both. That string is the caller's because
 * it belongs to the catalogue, and this file holds no words.
 */
export function relativeParts(
  at: DateLike,
  now: Date = new Date()
): { value: number; unit: Intl.RelativeTimeFormatUnit } | null {
  const then = toDate(at);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (Number.isNaN(seconds) || seconds < 45) return null;

  const units: Array<[limit: number, size: number, unit: Intl.RelativeTimeFormatUnit]> = [
    [3600, 60, "minute"],
    [86400, 3600, "hour"],
    [2592000, 86400, "day"],
    [31536000, 2592000, "month"],
    [Infinity, 31536000, "year"],
  ];

  for (const [limit, size, unit] of units) {
    if (seconds < limit) return { value: -Math.floor(seconds / size), unit };
  }
  return null;
}

/**
 * "3 minutes ago" / "vor 3 Minuten".
 *
 * `justNow` is passed in rather than looked up, so this file stays free of
 * words. The provider binds it to the catalogue entry.
 */
export function formatRelativeTime(
  locale: Locale,
  at: DateLike,
  justNow: string,
  now: Date = new Date()
): string {
  const parts = relativeParts(at, now);
  if (!parts) return justNow;

  const k = key(locale);
  let f = relativeFormats.get(k);
  if (!f) {
    // "always" rather than "auto": "auto" turns -1 day into "yesterday", which
    // is friendlier prose and worse at answering "how stale is this number".
    f = new Intl.RelativeTimeFormat(INTL_TAG[locale], { numeric: "always" });
    relativeFormats.set(k, f);
  }
  return f.format(parts.value, parts.unit);
}

/**
 * Milliseconds as something a person reads at a glance.
 *
 * Two units at most and never a decimal: "1m 23s" is a time on page, "83.4
 * seconds" is a lab measurement. The unit names come from `Intl` rather than
 * from the catalogue, because every language already has abbreviations for
 * these and they are not ours to invent.
 */
export function formatDuration(locale: Locale, ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return unitText(locale, 0, "second");
  if (ms < 1000) return unitText(locale, Math.round(ms), "millisecond");

  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    const hours = unitText(locale, h, "hour");
    return m > 0 ? `${hours} ${unitText(locale, m, "minute")}` : hours;
  }
  if (m > 0) {
    const minutes = unitText(locale, m, "minute");
    return s > 0 ? `${minutes} ${unitText(locale, s, "second")}` : minutes;
  }
  return unitText(locale, s, "second");
}

function unitText(locale: Locale, value: number, u: string): string {
  return formatNumber(locale, value, { style: "unit", unit: u, unitDisplay: "narrow" });
}

/** "a, b and c" / "a, b und c". */
export function formatList(locale: Locale, items: string[]): string {
  const k = key(locale);
  let f = listFormats.get(k);
  if (!f) {
    f = new Intl.ListFormat(INTL_TAG[locale], { style: "long", type: "conjunction" });
    listFormats.set(k, f);
  }
  return f.format(items);
}

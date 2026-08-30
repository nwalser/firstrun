/**
 * What is left of this file after the locale moved.
 *
 * Everything here that depended on a language has gone to
 * `apps/web/src/lib/i18n/format.ts`, where the same function takes a locale and
 * the provider hands out a version already bound to the active one. A component
 * asks `useI18n()` for `num`, `compact`, `percent`, `share`, `delta`,
 * `shortDate`, `dateRange` or `relative`; nothing calls a formatter that has an
 * `en-US` baked into it, because a board of English-formatted figures under
 * German labels does not read as untranslated, it reads as wrong numbers.
 *
 * `relativeTime` and `windowLabel` are the last two, and they are here only
 * because two route files still call them. They hard-code `en-GB` and an
 * English pluralisation and must not gain a third caller: the replacements are
 * `i18n.relative` and `i18n.dateRange`, one for one. Delete both, and
 * `shortDate` under them, once those routes have moved.
 *
 * What remains below that is presentation with no language in it: a class name,
 * a version comparison and a string cut. Those stay.
 */

/**
 * The mono tabular treatment every figure on a board gets.
 *
 * Numbers are the product, so they are set in the mono face, which is pinned to
 * tabular figures and a slashed zero in `styles.css`. Shared as a constant
 * rather than retyped because a column of figures that is mono in one card and
 * sans in the next reads as two different measurements.
 */
export const NUM = "font-mono tabular-nums";

/** Private: the last two locale-dependent exports below are built on it. */
function shortDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The window a set of numbers covers, written out. DEPRECATED: `i18n.dateRange`.
 *
 * `to` is exclusive everywhere in this codebase, so the label subtracts a day
 * before printing it. Showing the exclusive end would claim a day of data the
 * numbers do not contain, and a reader has no way to know that.
 */
export function windowLabel(from: Date | string, to: Date | string): string {
  const start = typeof from === "string" ? new Date(from) : from;
  const endExclusive = typeof to === "string" ? new Date(to) : to;
  const end = new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000);
  if (start.getTime() > end.getTime()) return shortDate(start);
  return `${shortDate(start)} – ${shortDate(end)}`;
}

/**
 * "3 minutes ago", for a timestamp that is always in the past.
 * DEPRECATED: `i18n.relative`.
 *
 * Rounds toward the coarser unit rather than the nearer one: an event 90
 * seconds old reads "1 minute ago", not "2 minutes ago", because claiming more
 * elapsed time than has actually passed makes a live feed look stale. A future
 * timestamp (a client clock running fast, which happens) reads "just now"
 * rather than "in 4 minutes", since `event_time` is client-stamped and a
 * negative age is a clock problem, not news.
 */
export function relativeTime(at: Date | string, now: Date = new Date()): string {
  const then = typeof at === "string" ? new Date(at) : at;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (Number.isNaN(seconds) || seconds < 45) return "just now";

  const units: Array<[limit: number, size: number, name: string]> = [
    [3600, 60, "minute"],
    [86400, 3600, "hour"],
    [2592000, 86400, "day"],
    [31536000, 2592000, "month"],
    [Infinity, 31536000, "year"],
  ];

  for (const [limit, size, name] of units) {
    if (seconds < limit) {
      const n = Math.floor(seconds / size);
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

/** Numeric-segment comparison, so 1.10.0 sorts above 1.9.0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * An event name cut to a length, with the full name kept for the `title`.
 *
 * Event names are customer data. They are as long as somebody felt like making
 * them, and `checkout.step_3.address_validated` must not break a card. Cutting
 * in the middle keeps the tail, which is the part that distinguishes two names
 * that share a prefix, and every caller pairs this with a title attribute
 * carrying the whole thing.
 */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max || max < 6) return text;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

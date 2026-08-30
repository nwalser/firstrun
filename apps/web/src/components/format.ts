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
 * What remains below is presentation with no language in it: a class name, a
 * version comparison and a string cut. Nothing here may grow an `en-GB` or an
 * English pluralisation again; anything that needs a language belongs in
 * `lib/i18n/format.ts`, where it takes a locale.
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

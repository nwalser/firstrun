import { createContext, createSignal, useContext, type Accessor, type JSX } from "solid-js";
import {
  formatCompact,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDelta,
  formatDuration,
  formatFileSize,
  formatFullDate,
  formatList,
  formatMonthYear,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatShare,
  formatShortDate,
  formatWeekdayShort,
  type DateLike,
  type DeltaDirection,
} from "./format.js";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from "./locales.js";
import { translate, translator, type TFn, type Vars } from "./translate.js";

/**
 * The active language, and everything that depends on it.
 *
 * One signal. `t` and the formatters read it, so every string and every number
 * on the screen is downstream of it and switching language re-renders the app
 * without a navigation or a reload.
 *
 * The initial value comes from the server, through the root loader, which is
 * what makes the first paint correct. Nothing here reads the cookie on the way
 * in: by the time this runs the answer has already been decided once, and
 * deciding it a second time in the browser is how the two disagree.
 */

export interface I18n {
  locale: Accessor<Locale>;
  /** Persists to the cookie and re-renders. No navigation, no reload. */
  setLocale: (next: Locale) => void;
  t: TFn;

  // The pure helpers from `format.ts`, bound to the active locale. Components
  // should use these; the unbound versions are for loaders and tests.
  num: (value: number, opts?: Intl.NumberFormatOptions) => string;
  compact: (value: number) => string;
  percent: (fraction: number) => string;
  /** A part of a whole, or null when there is no whole to be a share of. */
  share: (part: number, whole: number | null | undefined) => string | null;
  /** A change against the baseline, or null when there is nothing to compare. */
  delta: (change: number | null) => { dir: DeltaDirection; label: string } | null;
  fileSize: (bytes: number) => string;
  date: (value: DateLike, opts?: Intl.DateTimeFormatOptions) => string;
  shortDate: (value: DateLike) => string;
  dateTime: (value: DateLike) => string;
  dateRange: (from: DateLike, toExclusive: DateLike) => string;
  /** The three calendar-grid helpers. Date-only values, pinned to UTC. */
  monthYear: (value: DateLike) => string;
  weekdayShort: (value: DateLike) => string;
  fullDate: (value: DateLike) => string;
  relative: (value: DateLike, now?: Date) => string;
  duration: (ms: number) => string;
  list: (items: string[]) => string;
}

const I18nCtx = createContext<I18n>();

export function LocaleProvider(props: { locale: Locale; children: JSX.Element }) {
  // Read once, on purpose: this is the initial value of a signal the user then
  // owns. Tracking the prop would let a loader re-run stamp on a choice the
  // person has just made.
  const [locale, setSignal] = createSignal<Locale>(props.locale);

  const setLocale = (next: Locale) => {
    if (next === locale()) return;
    setSignal(next);
    persist(next);
  };

  const value: I18n = {
    locale,
    setLocale,
    // The cast is where the overloads meet the one implementation. Everything
    // above this line is typed; nothing below it needs to be.
    t: ((key: string, vars?: Vars) => translate(locale(), key, vars)) as TFn,
    num: (v, opts) => formatNumber(locale(), v, opts),
    compact: (v) => formatCompact(locale(), v),
    percent: (v) => formatPercent(locale(), v),
    share: (part, whole) => formatShare(locale(), part, whole),
    delta: (change) => formatDelta(locale(), change, translate(locale(), "common.no_change")),
    fileSize: (bytes) => formatFileSize(locale(), bytes),
    date: (v, opts) => formatDate(locale(), v, opts),
    shortDate: (v) => formatShortDate(locale(), v),
    dateTime: (v) => formatDateTime(locale(), v),
    dateRange: (from, to) => formatDateRange(locale(), from, to),
    monthYear: (v) => formatMonthYear(locale(), v),
    weekdayShort: (v) => formatWeekdayShort(locale(), v),
    fullDate: (v) => formatFullDate(locale(), v),
    relative: (v, now) =>
      formatRelativeTime(locale(), v, translate(locale(), "common.just_now"), now),
    duration: (ms) => formatDuration(locale(), ms),
    list: (items) => formatList(locale(), items),
  };

  return <I18nCtx.Provider value={value}>{props.children}</I18nCtx.Provider>;
}

/**
 * Everything language-dependent, for one component.
 *
 * Falls back to a default-locale instance outside a provider rather than
 * throwing, matching `useProjectNav` in the app shell: a component rendered in
 * isolation should still produce words. The fallback is built once, lazily, so
 * the normal path pays nothing for it.
 */
export function useI18n(): I18n {
  return useContext(I18nCtx) ?? fallback();
}

/** Just the translator, for the common case. */
export function useT(): TFn {
  return useI18n().t;
}

let fallbackI18n: I18n | null = null;

function fallback(): I18n {
  if (!fallbackI18n) {
    const locale = () => DEFAULT_LOCALE;
    const t = translator(DEFAULT_LOCALE);
    fallbackI18n = {
      locale,
      setLocale: () => {},
      t,
      num: (v, opts) => formatNumber(DEFAULT_LOCALE, v, opts),
      compact: (v) => formatCompact(DEFAULT_LOCALE, v),
      percent: (v) => formatPercent(DEFAULT_LOCALE, v),
      share: (part, whole) => formatShare(DEFAULT_LOCALE, part, whole),
      delta: (change) => formatDelta(DEFAULT_LOCALE, change, t("common.no_change")),
      fileSize: (bytes) => formatFileSize(DEFAULT_LOCALE, bytes),
      date: (v, opts) => formatDate(DEFAULT_LOCALE, v, opts),
      shortDate: (v) => formatShortDate(DEFAULT_LOCALE, v),
      dateTime: (v) => formatDateTime(DEFAULT_LOCALE, v),
      dateRange: (from, to) => formatDateRange(DEFAULT_LOCALE, from, to),
      monthYear: (v) => formatMonthYear(DEFAULT_LOCALE, v),
      weekdayShort: (v) => formatWeekdayShort(DEFAULT_LOCALE, v),
      fullDate: (v) => formatFullDate(DEFAULT_LOCALE, v),
      relative: (v, now) => formatRelativeTime(DEFAULT_LOCALE, v, t("common.just_now"), now),
      duration: (ms) => formatDuration(DEFAULT_LOCALE, ms),
      list: (items) => formatList(DEFAULT_LOCALE, items),
    };
  }
  return fallbackI18n;
}

/**
 * Written from script rather than through a server function, because there is
 * nothing for a server to decide: the value is already known and the round trip
 * would only delay the paint. The server reads it on the next request, which is
 * the whole reason it is a cookie and not localStorage.
 *
 * `SameSite=Lax` so the language survives arriving from an external link, and
 * `Secure` only over HTTPS, since dev runs on plain HTTP and a `Secure` cookie
 * there is silently dropped.
 */
function persist(next: Locale): void {
  if (typeof document === "undefined") return;

  const parts = [
    `${LOCALE_COOKIE}=${next}`,
    "Path=/",
    `Max-Age=${LOCALE_COOKIE_MAX_AGE}`,
    "SameSite=Lax",
  ];
  if (location.protocol === "https:") parts.push("Secure");
  document.cookie = parts.join("; ");

  // The document element is server-rendered and its `lang` is bound reactively
  // in `__root.tsx`, so this is belt and braces. It costs one assignment and it
  // means a screen reader is never left announcing the old language if that
  // binding is ever hoisted out of the component tree.
  document.documentElement.lang = next;
}

/**
 * The whole i18n layer, from one specifier.
 *
 * `api.js` is not re-exported. It defines a server function, and pulling it
 * into the barrel would drag that definition into every module that only wanted
 * `t`. The root route imports it directly, which is the only place that needs
 * it.
 *
 * The per-area modules under `messages/` are not re-exported either. A
 * component asks for a key, never for a namespace: the catalogue is composed
 * once, in `en.ts` and `de.ts`, and a component that imported one namespace
 * directly would be reaching around the fallback that makes a half-translated
 * language show a real word.
 */
export { en, type Messages } from "./en.js";
export { de } from "./de.js";
export {
  DEFAULT_LOCALE,
  INTL_TAG,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_NAMES,
  isLocale,
  localeFromAcceptLanguage,
  resolveLocale,
  type Locale,
} from "./locales.js";
export {
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
  relativeParts,
  toDate,
  type DateLike,
  type DeltaDirection,
} from "./format.js";
export {
  CATALOGUES,
  translate,
  translator,
  type PluralKey,
  type SimpleKey,
  type TFn,
  type TranslationKey,
  type Vars,
} from "./translate.js";
export { LocaleProvider, useI18n, useT, type I18n } from "./provider.js";

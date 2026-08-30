import type { Namespaced } from "./namespace.js";

/**
 * The language switcher itself.
 *
 * The language names are not here. They are endonyms and live in
 * `locales.ts` as `LOCALE_NAMES`, so the row somebody needs is readable
 * whichever language they have landed in.
 */
export const locale = {
  "locale.language": "Language",
} satisfies Namespaced<"locale">;

export type LocaleMessages = typeof locale;

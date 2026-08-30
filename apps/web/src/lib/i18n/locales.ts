/**
 * Which languages exist, and how the active one is chosen.
 *
 * No i18n framework. Two languages need a typed dictionary, a signal, and the
 * `Intl` built-ins the platform already ships. A framework here would add a
 * loader, a plural DSL and a message compiler to solve problems this app does
 * not have yet, and every one of them would have to be understood before the
 * next string could be added.
 *
 * `en` is the source of truth: `de.ts` is typed against it, so a key that is
 * missing or misspelled is a compile error rather than a word of English
 * sitting in the middle of a German screen.
 */

export const LOCALES = ["en", "de"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Languages are listed in their own language.
 *
 * Somebody who has landed in a language they cannot read is exactly the person
 * using this menu, and "German" is no help to them. These are names, not
 * strings to translate, so they live here rather than in the catalogue.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
};

/**
 * The BCP 47 tag handed to `Intl`, which is not the locale id.
 *
 * `en-150` is English as written in Europe, and it is the tag because it is the
 * only one that matches what this app already writes on both counts. `en-US`
 * dates read "Aug 13" where every screen here says "13 Aug". `en-GB` fixes the
 * date and breaks the numbers: its compact notation is lower case, so 3,402,913
 * becomes "3.4m" and 1.2 billion becomes "1.2bn", where the cards have always
 * said "3.4M". `en-150` gives "13 Aug" and "3.4M".
 *
 * A runtime built without full ICU data falls back to plain `en` here, which
 * costs the date order and nothing else.
 */
export const INTL_TAG: Record<Locale, string> = {
  en: "en-150",
  de: "de-DE",
};

/**
 * A cookie, not localStorage.
 *
 * This app server-renders. The server has to know the language before it writes
 * the first byte, and a value that only exists in the browser cannot be read
 * then: the page would paint in English, swap on hydration, and hydrate against
 * markup that no longer matches. A cookie is on the request.
 *
 * Deliberately readable by script (no HttpOnly): the switcher writes it
 * directly, so changing language costs no round trip. It carries no authority
 * and names no user, so there is nothing here to steal.
 */
export const LOCALE_COOKIE = "fr_locale";

export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The best supported language named by an `Accept-Language` header.
 *
 * Ranked by q-value, highest first, and ties keep the order the browser sent
 * because `sort` is stable. Only the primary subtag is matched, so `de-AT` and
 * `de-CH` both land on German: a regional variant we do not have is much better
 * served by the language we do have than by falling through to English.
 *
 * Returns null rather than the default so the caller can tell "the browser
 * asked for nothing we have" apart from "the browser asked for English".
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag: (tag ?? "").trim().toLowerCase(), q: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    // `*` means "anything will do", which is what the default already is.
    if (tag === "*") return null;
    const primary = tag.split("-")[0] ?? "";
    if (isLocale(primary)) return primary;
  }
  return null;
}

/**
 * Detection order: an explicit choice, then what the browser asked for, then
 * English.
 *
 * An explicit choice wins over `Accept-Language` permanently. Somebody who has
 * picked English on a German-configured machine did so on purpose, and a
 * preference that gets overruled by the browser on the next visit is not a
 * preference.
 */
export function resolveLocale(
  stored: string | null | undefined,
  acceptLanguage: string | null | undefined
): Locale {
  if (isLocale(stored)) return stored;
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

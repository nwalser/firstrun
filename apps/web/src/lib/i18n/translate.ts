import { de } from "./de.js";
import { en, type Messages } from "./en.js";
import { formatNumber } from "./format.js";
import { DEFAULT_LOCALE, INTL_TAG, type Locale } from "./locales.js";

/**
 * Looking a message up, and filling it in.
 *
 * Two things are worth doing properly here and neither is the lookup.
 *
 * The first is the key type. Every key in `en.ts` is a literal in `Messages`,
 * so `TranslationKey` is a closed union and a typo is a compile error. Nothing
 * in the app may pass a computed string.
 *
 * The second is plurals. `Intl.PluralRules` decides which form to use, not an
 * `n === 1` check written here. German agrees with English on one and other, so
 * a hand-rolled check would pass review today and be wrong the first time
 * somebody adds a language with a `few`, by which point the check is spread
 * across every call site that ever needed a count.
 */

export const CATALOGUES: Record<Locale, Messages> = { en, de };

type MessageKey = keyof Messages & string;

/**
 * The `Intl.PluralRules` categories. A key ending in one of these is a member
 * of a plural family rather than a key in its own right.
 */
type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/**
 * `other` is required of every plural family by `Intl.PluralRules`, in every
 * language, so it is the one suffix that can stand for the family.
 */
type PluralFamily<K extends string> = K extends `${infer Base}_other` ? Base : never;
type PluralVariant<K extends string> = K extends `${string}_${PluralCategory}` ? K : never;

/** A key that is called by its base and needs a count. */
export type PluralKey = PluralFamily<MessageKey>;

/** A key that is called as written and needs nothing. */
export type SimpleKey = Exclude<MessageKey, PluralVariant<MessageKey>>;

export type TranslationKey = SimpleKey | PluralKey;

export type Vars = Record<string, string | number>;

/**
 * Two overloads rather than one signature, so a plural key cannot be called
 * without a count. Missing the count is how a plural silently renders its
 * `other` form for the value one.
 */
export interface TFn {
  (key: SimpleKey, vars?: Vars): string;
  (key: PluralKey, vars: Vars & { count: number }): string;
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

function rulesFor(locale: Locale): Intl.PluralRules {
  let r = pluralRules.get(locale);
  if (!r) {
    r = new Intl.PluralRules(INTL_TAG[locale]);
    pluralRules.set(locale, r);
  }
  return r;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * The whole translator, in one pure function.
 *
 * Lookup order: the plural form when a count was given, then the key as
 * written, then English, then the key itself. Falling back to English rather
 * than to nothing means a language that is mid-translation shows a real word;
 * falling back to the key means a genuinely missing message is visible on the
 * screen instead of being an empty element nobody notices.
 */
export function translate(locale: Locale, key: string, vars?: Vars): string {
  const template = lookup(locale, key, vars) ?? lookup(DEFAULT_LOCALE, key, vars) ?? key;
  return interpolate(locale, template, vars);
}

function lookup(locale: Locale, key: string, vars?: Vars): string | undefined {
  const catalogue = CATALOGUES[locale];

  if (vars && typeof vars.count === "number") {
    const category = rulesFor(locale).select(vars.count);
    const exact = catalogue[`${key}_${category}` as MessageKey];
    if (exact !== undefined) return exact;
    // Every family has `other`, so this is the form a language reaches for when
    // it does not distinguish the category the count landed in.
    const other = catalogue[`${key}_other` as MessageKey];
    if (other !== undefined) return other;
  }

  return catalogue[key as MessageKey];
}

/**
 * A missing variable leaves its placeholder on the screen rather than writing
 * "undefined". Both are bugs; only one of them says which key to go and look at.
 *
 * Numbers go through `Intl` on the way in. This is the reason interpolation is
 * here at all instead of being template literals at the call site: a count
 * pasted in raw reads 1,234 in a German sentence, and no reviewer catches that
 * on every one of a hundred call sites.
 */
function interpolate(locale: Locale, template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(locale, value) : value;
  });
}

/** `t` for one locale, with the overloads applied. */
export function translator(locale: Locale): TFn {
  return ((key: string, vars?: Vars) => translate(locale, key, vars)) as TFn;
}

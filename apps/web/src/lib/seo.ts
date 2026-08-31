import { DEFAULT_LOCALE, isLocale, type Locale } from "./i18n/index.js";

/**
 * What a route puts in its `head()`, in one shape.
 *
 * ## Why this is a helper and not eleven tags written out per route
 *
 * A page needs its title in four places (the `<title>`, `og:title`,
 * `twitter:title`, and the JSON-LD when it has any) and its description in
 * three. Written by hand that is a set that drifts: somebody edits the title
 * and the card a link unfurls into still says the old one. So a route states
 * the page once and this spreads it.
 *
 * ## Only public pages carry a canonical
 *
 * `canonical` is absolute, because a relative one is a hint and an absolute one
 * is an instruction, and the origin is not knowable in the browser bundle: this
 * deployment could be `firstrun.app` or a customer's own hostname. It comes off
 * the root route's loader, which reads it from the request, and
 * `siteOrigin()` is how a child route fishes it back out.
 *
 * An `index: false` page gets `noindex, nofollow` and no canonical at all. Half
 * this app is behind a session and the other half is a redirect; the
 * documentation is the part that is meant to be found.
 */
export interface Seo {
  /** The page, without the site name. `seoMeta` appends that. */
  title: string;
  /** One or two sentences. Search results cut somewhere around 160 characters. */
  description: string;
  /** Absolute URL of this page. Leave unset when `index` is false. */
  canonical?: string;
  /** Default true. False means `noindex, nofollow`. */
  index?: boolean;
}

export const SITE_NAME = "firstrun";

/**
 * The card image.
 *
 * The 512px mark rather than a drawn 1200x630 banner, which is why the Twitter
 * card below is `summary` and not `summary_large_image`: a square logo stretched
 * into a wide card is worse than a small correct one. Swap both together if a
 * real banner is ever drawn.
 */
const CARD_IMAGE = "/icon-512.png";

/** `"Log entries · firstrun"`, or just `"firstrun"` for the site itself. */
export function pageTitle(title: string): string {
  return title === SITE_NAME ? SITE_NAME : `${title} · ${SITE_NAME}`;
}

/**
 * The meta tags for a page.
 *
 * Order does not matter to the router: it walks matches from the deepest
 * outwards and keeps the first tag it sees for any given `name`/`property`, so
 * a route stating `description` here silently wins over the root's default
 * without either having to know about the other. The same rule gives `title` to
 * the deepest route that sets one.
 */
export function seoMeta(seo: Seo, origin = ""): Array<Record<string, string>> {
  const indexable = seo.index !== false;
  const image = origin ? `${origin}${CARD_IMAGE}` : CARD_IMAGE;

  const meta: Array<Record<string, string>> = [
    { title: pageTitle(seo.title) },
    { name: "description", content: seo.description },

    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: pageTitle(seo.title) },
    { property: "og:description", content: seo.description },
    { property: "og:image", content: image },

    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: pageTitle(seo.title) },
    { name: "twitter:description", content: seo.description },
    { name: "twitter:image", content: image },
  ];

  // Stated either way. A crawler that has been told `noindex` once on a page it
  // reached while signed out must not have to infer the opposite from silence
  // on the documentation.
  meta.push({
    name: "robots",
    content: indexable ? "index, follow" : "noindex, nofollow",
  });

  if (indexable && seo.canonical) {
    meta.push({ property: "og:url", content: seo.canonical });
  }

  return meta;
}

/**
 * The canonical link, when there is one.
 *
 * Separate from `seoMeta` because the router keeps meta and links in different
 * buckets, and returned as an array so a route can spread it next to whatever
 * else it puts in `links` without a conditional at the call site.
 */
export function seoLinks(seo: Seo): Array<Record<string, string>> {
  if (seo.index === false || !seo.canonical) return [];
  return [{ rel: "canonical", href: seo.canonical }];
}

/**
 * The shape `head()` is handed, reduced to the part any of this needs.
 *
 * `head` receives every match on the route, root first, each carrying its own
 * loader data. The root's is where the locale and the origin are, and neither
 * is reachable any other way from inside `head`: it runs outside the component
 * tree, so there is no i18n context to read and no request to look at.
 *
 * Typed structurally rather than against the generated route types, because the
 * router's `matches` is generic over the route it was called from and pinning
 * that here would mean one signature per route.
 */
export interface HeadMatch {
  loaderData?: unknown;
}

interface RootLoaderData {
  locale?: unknown;
  origin?: unknown;
}

/** The language the document is being rendered in. English if nothing says. */
export function siteLocale(matches: ReadonlyArray<HeadMatch>): Locale {
  for (const match of matches) {
    const data = match.loaderData as RootLoaderData | undefined;
    if (isLocale(data?.locale)) return data.locale;
  }
  return DEFAULT_LOCALE;
}

/**
 * The origin this deployment is reached at, or an empty string before the root
 * loader has resolved. Callers treat empty as "no canonical", which is the
 * right answer: a canonical pointing at the wrong host is worse than none.
 */
export function siteOrigin(matches: ReadonlyArray<HeadMatch>): string {
  for (const match of matches) {
    const data = match.loaderData as RootLoaderData | undefined;
    if (typeof data?.origin === "string" && data.origin) return data.origin;
  }
  return "";
}

/** `https://host/docs/log-entries`, or `""` when the origin is not known yet. */
export function canonicalUrl(origin: string, path: string): string | undefined {
  return origin ? `${origin}${path}` : undefined;
}

/**
 * A structured-data graph, ready to be the body of a `application/ld+json`
 * script.
 *
 * The router writes a head script's children through `innerHTML`, so the string
 * lands in the document as markup rather than as text. `<` is therefore escaped
 * to its JSON unicode form, which JSON.parse reads back identically and an HTML
 * parser cannot read as the start of a tag. Everything here is written by us
 * and none of it currently contains a `<`, which is exactly the condition that
 * quietly stops being true later.
 */
export function jsonLd(graph: unknown): string {
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}

import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/solid-router";
import { HydrationScript } from "solid-js/web";
import { Toaster } from "../components/ui/index.js";
import { getSession } from "../lib/api.js";
import { DEFAULT_LOCALE, LocaleProvider, useI18n } from "../lib/i18n/index.js";
import { getLocale } from "../lib/i18n/api.js";
import styles from "../styles.css?url";

/**
 * The document.
 *
 * Chrome lives in the app shell, not here: signed-out pages have none, and the
 * shell needs a workspace this route does not have. All this does is establish
 * the document, the session, the language, and the fact that the page itself
 * never scrolls -- `h-dvh overflow-hidden` on the body, with the content pane
 * scrolling inside.
 */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "dark" },
      // The page behind the chrome is pure black, so the browser UI matches it.
      { name: "theme-color", content: "#000000" },
      { title: "firstrun" },
    ],
    links: [
      /*
        No remote stylesheet, and no font host.

        Geist is vendored in `apps/web/public/fonts` and declared in
        `src/fonts.css`. This is self-hosted analytics whose own wiki promises
        that nothing about a customer's visitors leaves their infrastructure,
        and a dashboard pulling its typeface from fonts.gstatic.com would send
        every operator's IP and referer to Google on every page load. The
        document loads nothing it does not serve itself.

        The two preloads are the Latin faces, which every page needs
        immediately. The rest of the subsets are fetched only if the text on
        the page actually reaches into them.
      */
      {
        rel: "preload",
        href: "/fonts/geist-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossorigin: "anonymous",
      },
      {
        rel: "preload",
        href: "/fonts/geist-mono-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossorigin: "anonymous",
      },
      /*
        The mark, shared with firstrun.app, so a tab, a bookmark and the site
        all show the same thing. The SVG is what a current browser uses; the
        .ico is the path crawlers and older browsers ask for by convention, and
        Google's favicon crawler does not read SVG at all. Both are generated
        from the SVG by `npm run icons` in the site repo.
      */
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "stylesheet", href: styles },
    ],
  }),
  /*
    Both in parallel. The session is a database round trip and the locale is a
    header read, so running them one after the other would add the cheap one to
    the time to first byte for nothing.

    The language has to be decided here, on the server, before any markup is
    written. A choice read in the browser instead would paint English, swap on
    hydration, and hydrate against markup that no longer matches.
  */
  loader: async () => {
    const [session, locale] = await Promise.all([getSession(), getLocale()]);
    return { session, locale };
  },
  component: RootDocument,
});

/**
 * The provider has to sit outside the document, because `<html lang>` is itself
 * language-dependent and an element cannot read a context its own subtree
 * provides.
 */
function RootDocument() {
  const data = Route.useLoaderData();
  return (
    // Defaulted rather than asserted: the loader always resolves, but the
    // accessor is typed as possibly empty and English is the right answer for a
    // frame that has not got the data yet.
    <LocaleProvider locale={data()?.locale ?? DEFAULT_LOCALE}>
      <Document />
    </LocaleProvider>
  );
}

function Document() {
  const { locale } = useI18n();

  return (
    // `lang` is a live binding, not a server-rendered constant: switching
    // language re-renders the app in place, and an attribute left saying `en`
    // would keep a screen reader on English pronunciation and hyphenation for a
    // page that is now German.
    <html lang={locale()} class="dark">
      <head>
        <HeadContent />
        {/*
          Solid's own hydration bootstrap. Without this nothing on the page is
          interactive, in dev or in production, and the failure surfaces as a
          seroval stream error inside TanStack's client entry that names nothing
          Solid-related. Do not remove it.
        */}
        <HydrationScript />
      </head>
      <body class="h-dvh overflow-hidden antialiased">
        <Outlet />
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}

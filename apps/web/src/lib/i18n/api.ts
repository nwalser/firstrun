import { createServerFn } from "@tanstack/solid-start";
import type { Locale } from "./locales.js";

/**
 * The one thing the client cannot work out for itself.
 *
 * The stored choice is a cookie the browser can read, but `Accept-Language` is
 * a request header and exists nowhere else: `navigator.languages` is a
 * different list, arrives after hydration, and is exactly the flash of English
 * the cookie was chosen to avoid. So detection runs on the server, once, in the
 * root loader.
 *
 * There is deliberately no matching write. The switcher sets the cookie from
 * script and updates the signal, so changing language costs no round trip and
 * no page reload. The cookie is only ever read here.
 */
export const getLocale = createServerFn({ method: "GET" }).handler(async (): Promise<Locale> => {
  const { detectLocale } = await import("./detect.server.js");
  return detectLocale();
});

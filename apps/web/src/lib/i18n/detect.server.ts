import { getRequest } from "@tanstack/solid-start/server";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./locales.js";

/**
 * Which language this request is in, decided before the first byte is written.
 *
 * Server-only, and reached only through a dynamic import from the server
 * function in `api.ts`, the same way every other `.server` module here is: a
 * top-level import of `@tanstack/solid-start/server` from a file the root route
 * pulls in would be traced into the browser graph.
 *
 * The cookie header is read off the request rather than through a helper, which
 * keeps this file to one framework import and matches `readCookie` in
 * `auth.server.ts`.
 */
export function detectLocale(): Locale {
  const request = getRequest();
  return resolveLocale(
    readCookie(request, LOCALE_COOKIE),
    request.headers.get("accept-language")
  );
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

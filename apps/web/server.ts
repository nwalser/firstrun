#!/usr/bin/env bun
import { join } from "node:path";
import handler from "./dist/server/server.js";

/**
 * The production host.
 *
 * TanStack Start's build emits a fetch handler and a folder of client assets;
 * it does not emit a server that serves them. Without this, every `/assets/*`
 * request 404s in production while the page itself renders fine -- which looks
 * like a styling bug and is not.
 *
 * Railway sets PORT.
 */
const CLIENT = join(import.meta.dir, "dist", "client");
const port = Number(process.env.PORT ?? 3000);

const YEAR = "public, max-age=31536000, immutable";
const DAY = "public, max-age=86400";

/**
 * How long a browser may keep a file out of this folder, decided by what it is.
 *
 * `/assets/*` is Vite's output and carries a content hash in its name, so a
 * year is free.
 *
 * `/fonts/*` gets the same year, and until it did, the typeface arrived late.
 * A response with no `Cache-Control` at all leaves the browser guessing, and
 * what it guesses is a short life and a revalidation: Geist was being re-asked
 * for on ordinary navigations, `font-display: swap` painted the fallback while
 * that round trip happened, and the page changed typeface a moment after it
 * appeared. These files are subsets that are replaced by writing a new name,
 * not by editing one, which is exactly the condition `immutable` states. If
 * one is ever re-cut under its existing name, rename it in the same commit.
 *
 * Everything else here is an icon. Small, replaceable under its own name, and
 * fetched once per session anyway: a day, revalidated after that.
 */
function cacheControl(path: string): string {
  return path.startsWith("/assets/") || path.startsWith("/fonts/") ? YEAR : DAY;
}

/**
 * What is worth compressing: markup, script, style, data, and SVG.
 *
 * Deliberately not fonts or images. A woff2 is already Brotli inside, and a PNG
 * is already deflate: gzipping either spends CPU to make the file very slightly
 * bigger.
 */
const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|xml|manifest\+json)|image\/svg\+xml)/;

/**
 * Anything shorter than this is sent as it is.
 *
 * A gzip member costs about twenty bytes of header and trailer, so below a
 * kilobyte the saving is noise. Only a guard against small STATIC files, since
 * an in-process `Response` built from a string does not carry a length yet: the
 * data plane is kept out by path instead, below.
 */
const COMPRESS_FLOOR = 1024;

/**
 * The data plane, which is not compressed and must not be.
 *
 * `POST /v1/e` answers with a few dozen bytes of JSON. gzip cannot make that
 * smaller, and every client sending to it is a fire-and-forget queue on
 * somebody's laptop or server. Rule 7: nothing on the ingest path grows work it
 * does not need, least of all work that cannot pay for itself.
 *
 * `/t.js` is deliberately NOT in here. The tag is script served to somebody
 * else's marketing site and its 4KB budget is measured gzipped, so sending it
 * uncompressed would be shipping four times the thing that budget promises.
 */
const isDataPlane = (path: string) => path.startsWith("/v1/");

/**
 * gzip, because nothing in front of this process is doing it.
 *
 * Railway's edge terminates TLS and forwards; it does not compress, and
 * `Bun.serve` does not either. Uncompressed that means the client bundle and
 * every server-rendered page cross the wire at three or four times their size,
 * which is the single largest number on a Lighthouse report and is also just
 * the page arriving late.
 *
 * Through `CompressionStream` rather than `Bun.gzipSync`, so the streamed SSR
 * response stays streamed: buffering the whole document to compress it would
 * trade first paint for transfer size, and the point is to have both.
 *
 * `Content-Length` has to go. The compressed length is not known until the
 * stream ends, and a length that describes the ORIGINAL body truncates the
 * response at exactly the point it looks like a corrupt bundle.
 */
function compress(request: Request, path: string, response: Response): Response {
  if (isDataPlane(path)) return response;
  if (!response.body || response.headers.has("content-encoding")) return response;
  if (!request.headers.get("accept-encoding")?.includes("gzip")) return response;
  if (!COMPRESSIBLE.test(response.headers.get("content-type") ?? "")) return response;

  const length = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(length) && length < COMPRESS_FLOOR) return response;

  const headers = new Headers(response.headers);
  headers.set("Content-Encoding", "gzip");
  headers.append("Vary", "Accept-Encoding");
  headers.delete("Content-Length");

  return new Response(response.body.pipeThrough(new CompressionStream("gzip")), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const server = Bun.serve({
  port,
  idleTimeout: 60,
  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path !== "/" && !path.endsWith("/")) {
      const file = Bun.file(join(CLIENT, path));
      if (await file.exists()) {
        const served = new Response(file, { headers: { "Cache-Control": cacheControl(path) } });
        return compress(request, path, served);
      }
    }

    return compress(request, path, await handler.fetch(request));
  },
});

console.log(`listening on :${server.port}`);

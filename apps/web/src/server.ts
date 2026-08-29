import { createStartHandler, defaultStreamHandler } from "@tanstack/solid-start/server";
import {
  handleAsset,
  handleClaim,
  handleDownload,
  handleEvents,
  preflight,
} from "@firstrun/ingest";
import { finishGithubLogin, logout, startGithubLogin } from "./lib/auth.server.js";
import { ensureReady, getCtx } from "./lib/context.server.js";
import { readWebTag } from "./lib/web-tag.server.js";

/**
 * The server entry.
 *
 * TanStack Start picks this up in place of its default because it is
 * `src/server.ts`. It exists so the public data plane -- the beacon endpoint,
 * the download redirect, the claim -- can be plain Request/Response handlers
 * rather than anything framework-shaped.
 *
 * That matters beyond tidiness. These endpoints are called by a script tag on
 * someone else's marketing site and by a Rust binary on someone's laptop.
 * Neither should care what renders the dashboard, and moving them to their own
 * service later should be a routing change rather than a rewrite.
 */

const renderApp = createStartHandler(defaultStreamHandler);

const DL = /^\/dl\/([^/]+)\/([^/]+)$/;

async function route(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/v1/health") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Auth is not part of the data plane, but it is the same kind of thing: a
  // redirect and a cookie, with no page to render.
  if (path === "/auth/github") return startGithubLogin(request);
  if (path === "/auth/github/callback") return finishGithubLogin(request);
  if (path === "/auth/logout") return logout(request);

  const isData = path.startsWith("/v1/") || path.startsWith("/dl/") || path === "/t.js";
  if (!isData) return null;

  if (request.method === "OPTIONS") return preflight();

  await ensureReady();
  const ctx = getCtx();

  if (path === "/v1/e" && request.method === "POST") return handleEvents(request, ctx);
  if (path === "/v1/download") return handleDownload(request, ctx);
  if (path === "/v1/claim" && request.method === "POST") return handleClaim(request, ctx);

  const dl = DL.exec(path);
  if (dl) return handleAsset(ctx, decodeURIComponent(dl[1]!), decodeURIComponent(dl[2]!));

  if (path === "/t.js") {
    const js = await readWebTag();
    if (!js) {
      return new Response("// web tag not built. run: bun run build:web-tag\n", {
        status: 503,
        headers: { "Content-Type": "text/javascript; charset=utf-8" },
      });
    }
    return new Response(js, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const handled = await route(request);
    if (handled) return handled;
    await ensureReady();
    return renderApp(request);
  },
};

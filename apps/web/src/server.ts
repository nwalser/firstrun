import { createStartHandler, defaultStreamHandler } from "@tanstack/solid-start/server";
import { handleEntries, handleHealth, preflight } from "@firstrun/ingest";
import { finishGithubLogin, logout, publicOrigin, startGithubLogin } from "./lib/auth.server.js";
import { ensureReady, getCtx, getStore } from "./lib/context.server.js";
import { readWebTag } from "./lib/web-tag.server.js";

/**
 * The server entry.
 *
 * TanStack Start picks this up in place of its default because it is
 * `src/server.ts`. It exists so the public data plane (the ingest endpoint and
 * the health check) can be plain Request/Response handlers rather than
 * anything framework-shaped.
 *
 * That matters beyond tidiness. These endpoints are called by a script tag on
 * someone else's marketing site and by a binary on someone's laptop. Neither
 * should care what renders the dashboard, and moving them to their own service
 * later should be a routing change rather than a rewrite.
 *
 * There are two of them, and there is deliberately nothing here that a
 * customer's users have to pass through. No download redirect, no asset proxy,
 * no claim. If this whole service is down, every page and every installer the
 * customer ships still works, because firstrun is not in the way of any of it.
 */

const renderApp = createStartHandler(defaultStreamHandler);

/**
 * Under /api/ rather than /w/<slug>/logo, which would be swallowed by the UI
 * route for a project called "logo".
 */
const LOGO = /^\/api\/logo\/([^/]+)$/;

/** The same shelf, one level down: a project's own picture. */
const PROJECT_LOGO = /^\/api\/logo\/([^/]+)\/([^/]+)$/;

/**
 * One response for both, so a project image and a workspace image cannot drift
 * apart in how they cache.
 *
 * A logo is not a secret and does not change often, but it can be replaced. The
 * ETag is its timestamp, so a swap is picked up immediately and an unchanged one
 * is never re-sent.
 */
function logoResponse(
  request: Request,
  found: { bytes: Buffer; mimeType: string; updatedAt: Date }
): Response {
  const etag = `"${found.updatedAt.getTime()}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": found.mimeType,
      "Cache-Control": "public, max-age=60, must-revalidate",
      ETag: etag,
    },
  });
}

/**
 * What a crawler is allowed to read, and where the list of it is.
 *
 * Almost none of this app is public. Everything under `/w/` needs a session,
 * `/login` and `/new` are steps in getting one, and `/v1/`, `/t.js`, `/auth/`
 * and `/api/` are machine surfaces that would only ever be crawled by mistake.
 * The documentation is the half that is meant to be found, so it is the half
 * that is left open.
 *
 * Generated rather than a file in `public/`, for one reason: the `Sitemap:`
 * line has to be absolute, and this deployment does not know its own hostname
 * until a request arrives. A static file would have to hard-code firstrun.app,
 * which is wrong on every self-hosted install.
 */
function robots(request: Request): Response {
  const origin = publicOrigin(request);
  const body = [
    "User-agent: *",
    "Allow: /docs",
    "Disallow: /w/",
    "Disallow: /login",
    "Disallow: /new",
    "Disallow: /auth/",
    "Disallow: /api/",
    "Disallow: /v1/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/**
 * Every public URL, which is the documentation and nothing else.
 *
 * The topic list is imported dynamically because `registry.ts` eagerly pulls in
 * every page module under `components/docs/topics/`, and those are Solid
 * components: importing them at the top of the server entry would put the whole
 * documentation in the module graph of the ingest endpoint. Inside the handler
 * it is paid for by whoever asked for the sitemap, which is a crawler, once.
 *
 * No `lastmod`. A date this cannot compute honestly is a date that says every
 * page changed on the day of the deploy, and a sitemap that cries wolf about
 * freshness is worse than one that says nothing about it.
 */
async function sitemap(request: Request): Promise<Response> {
  const origin = publicOrigin(request);
  const { DOCS_TOPICS } = await import("./components/docs/registry.js");

  const urls = ["/docs", ...DOCS_TOPICS.map((topic) => `/docs/${topic.slug}`)];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((path) => `  <url><loc>${origin}${path}</loc></url>\n`).join("") +
    `</urlset>\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

async function route(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/v1/health") return handleHealth();

  // Above the data-plane guard for the same reason the webhook is: that guard
  // hands anything outside `/v1/` to SSR, and a crawler asking for /robots.txt
  // would be answered with the application shell and a 200.
  if (path === "/robots.txt") return robots(request);
  if (path === "/sitemap.xml") return sitemap(request);

  // Auth is not part of the data plane, but it is the same kind of thing: a
  // redirect and a cookie, with no page to render.
  if (path === "/auth/github") return startGithubLogin(request);
  if (path === "/auth/github/callback") return finishGithubLogin(request);
  if (path === "/auth/logout") return logout(request);

  /*
    Stripe's webhook, ABOVE the data-plane guard below.
    
    That guard answers `null` for anything outside `/v1/` and `/t.js`, which
    hands the request to SSR: a webhook mounted after it would render a page at
    Stripe and never be delivered. It also has to see the raw `Request`, because
    the signature is over the exact bytes of the body and anything that parses
    and re-serialises the JSON first produces a signature that never matches.
  */
  if (path === "/api/stripe/webhook" && request.method === "POST") {
    await ensureReady();
    const { handleStripeWebhook } = await import("./lib/stripe.server.js");
    return handleStripeWebhook(request);
  }

  const logo = LOGO.exec(path);
  if (logo) {
    await ensureReady();
    const { workspaceLogo } = await import("@firstrun/db");
    const found = await workspaceLogo(getStore().db, decodeURIComponent(logo[1]!));
    if (!found) return new Response(null, { status: 404 });
    return logoResponse(request, found);
  }

  // Checked after the workspace form, which cannot match a two-segment path, so
  // the order here is documentation rather than a dependency.
  const projectLogoPath = PROJECT_LOGO.exec(path);
  if (projectLogoPath) {
    await ensureReady();
    const { projectLogo } = await import("@firstrun/db");
    const found = await projectLogo(
      getStore().db,
      decodeURIComponent(projectLogoPath[1]!),
      decodeURIComponent(projectLogoPath[2]!)
    );
    if (!found) return new Response(null, { status: 404 });
    return logoResponse(request, found);
  }

  const isData = path.startsWith("/v1/") || path === "/t.js";
  if (!isData) return null;

  if (request.method === "OPTIONS") return preflight();

  // One endpoint for every kind of telemetry. An exception, a page view and a
  // latency sample arrive in the same array and take the same path.
  if (path === "/v1/e" && request.method === "POST") {
    await ensureReady();
    return handleEntries(request, getCtx());
  }

  /*
    The tag. One file, the same bytes for everybody, served from disk.

    It takes no query string and reads nothing out of the database, which is what
    keeps a marketing site's cold visitors off this deployment's Postgres: the
    response is identical for every source, so it caches for an hour in every
    browser and in whatever sits in front of us.
  */
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
        // An hour. The file cannot change from request to request, and the
        // deploy that changes it is not one the customer is waiting on.
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

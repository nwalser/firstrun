import {
  claimDownloadToken,
  createDownloadToken,
  downloadToken,
  recordDownloadHint,
  sourceByKey,
} from "@firstrun/db";
import {
  AppBatch,
  CompactBatch,
  EVENT,
  EventEnvelope,
  TOKEN_TTL_MS,
  installerFilename,
  isToken,
  mintToken,
  normalizeApp,
  normalizeWeb,
} from "@firstrun/schema";
import type { Ctx } from "./context.js";
import { estimateFirstRun, hashIp } from "./estimate.js";
import { ingestEnvelopes } from "./pipeline.js";

/**
 * The public data plane, as plain Request -> Response.
 *
 * No framework. These are mounted by the web app's server routes today and
 * could be mounted by anything tomorrow: the decision to run one service on
 * Railway should be a routing decision, not something baked into the handlers.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** The address to hash for estimated matching. The proxy header wins. */
export function clientIp(req: Request, socketIp?: string): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || socketIp || null;
}

/** Coarse on purpose. It is a matching key, not a device report. */
export function osFromUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux|X11/i.test(ua)) return "linux";
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// POST /v1/e
// ---------------------------------------------------------------------------

/**
 * Everything a client sends, in either shape.
 *
 * One endpoint rather than two because the tag's URL is what customers put
 * behind a CNAME, and a second path is a second thing to get wrong in their
 * proxy config.
 */
export async function handleEvents(req: Request, ctx: Ctx): Promise<Response> {
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "body must be json" }, 400);
  }

  if (body && typeof body === "object" && "person_id" in body) {
    return json({ error: "person_id is derived server-side" }, 400);
  }

  const ingestTime = ctx.now();

  const web = CompactBatch.safeParse(body);
  const app = web.success ? null : AppBatch.safeParse(body);
  const key = web.success ? web.data.k : app?.success ? app.data.source_key : null;
  if (!key) {
    return json({ error: "unrecognised body" }, 400);
  }

  const source = await sourceByKey(ctx.store.db, key);
  if (!source) return json({ error: "unknown source key" }, 404);

  const context = {
    workspaceId: source.workspaceId,
    sourceId: source.id,
    ingestTime,
  };

  const envelopes = web.success
    ? normalizeWeb(web.data, context)
    : normalizeApp(app!.data!, context);

  const result = await ingestEnvelopes(ctx, envelopes);
  return json(result, 202);
}

// ---------------------------------------------------------------------------
// GET /v1/download
// ---------------------------------------------------------------------------

/**
 * Step 1 of the join: mint on download.
 *
 * The redirect is the whole mechanism. The browser saves a file whose name
 * carries the token, and that filename is the only thing that survives the jump
 * from the website into the installed app.
 */
export async function handleDownload(req: Request, ctx: Ctx, socketIp?: string): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const vid = url.searchParams.get("vid");
  const version = url.searchParams.get("version") ?? "latest";
  if (!key) return json({ error: "key is required" }, 400);

  const source = await sourceByKey(ctx.store.db, key);
  if (!source) return json({ error: "unknown source key" }, 404);

  const asset = url.searchParams.get("asset") ?? source.assetName ?? "Setup";
  const now = ctx.now();
  const token = mintToken();

  await createDownloadToken(ctx.store.db, {
    token,
    workspaceId: source.workspaceId,
    sourceId: source.id,
    webVisitorId: vid,
    asset,
    expiresAt: new Date(now + TOKEN_TTL_MS),
  });

  const os = osFromUserAgent(req.headers.get("user-agent"));
  const ip = clientIp(req, socketIp);

  // Material for the estimated path, in case this download becomes an install
  // that never sees its own filename. Never used for an exact join.
  if (vid && ip) {
    await recordDownloadHint(ctx.store.db, {
      workspaceId: source.workspaceId,
      webVisitorId: vid,
      ipHash: hashIp(ctx.config.ipHashSalt, source.workspaceId, ip),
      os,
    });
  }

  // Step 2 of the funnel is server-side: a click on a download button that
  // never reaches us is not a download.
  if (vid) {
    await ingestEnvelopes(ctx, [
      EventEnvelope.parse({
        workspace_id: source.workspaceId,
        source_id: source.id,
        event_id: crypto.randomUUID(),
        event_name: EVENT.DOWNLOAD_STARTED,
        event_time: now,
        ingest_time: now,
        surface: "web",
        web_visitor_id: vid,
        os,
        url: req.headers.get("referer"),
        props: { asset, version, token },
      }),
    ]);
  }

  const filename = installerFilename(asset, version, token);
  return new Response(null, {
    status: 302,
    headers: { Location: `${ctx.config.publicOrigin}/dl/${token}/${filename}`, ...CORS },
  });
}

// ---------------------------------------------------------------------------
// GET /dl/:token/:filename
// ---------------------------------------------------------------------------

/**
 * Streams the real installer under a filename carrying the token.
 *
 * The token is not validated here. A shared link should still download
 * something; the worst case is a token claimed by the wrong machine, which is a
 * wrong join, not a broken download.
 */
export async function handleAsset(ctx: Ctx, token: string, filename: string): Promise<Response> {
  // `Themia-Setup-1.4.2-9GQ4T7BX.exe` -> `Themia-Setup-1.4.2.exe`
  const underlying = filename.replace(new RegExp(`-${token}(\\.[^.]+)$`, "i"), "$1");

  if (ctx.config.assetOrigin) {
    const upstream = await fetch(`${ctx.config.assetOrigin}/${underlying}`).catch(() => null);
    if (upstream?.ok && upstream.body) {
      return new Response(upstream.body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }
  }

  // No asset origin configured: this is a development machine. Serve something
  // with the right name so the whole flow can be walked end to end without
  // anyone having to build an installer first.
  return new Response(`placeholder installer for ${underlying}\ntoken=${token}\n`, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Firstrun-Placeholder": "1",
    },
  });
}

// ---------------------------------------------------------------------------
// POST /v1/claim
// ---------------------------------------------------------------------------

/**
 * Step 2 of the join: claim on first run.
 *
 * `token` is nullable on purpose. The app calls this exactly once whether or not
 * it found a token, so first run has one code path and the estimated fallback
 * lives on the server, where the download hints are.
 */
export async function handleClaim(req: Request, ctx: Ctx, socketIp?: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "body must be json" }, 400);

  const installId = str(body.install_id);
  if (!installId) return json({ error: "install_id is required" }, 400);

  const sourceKey = str(body.source_key);
  if (!sourceKey) return json({ error: "source_key is required" }, 400);

  const source = await sourceByKey(ctx.store.db, sourceKey);
  if (!source) return json({ error: "unknown source key" }, 404);

  const workspaceId = source.workspaceId;
  const token = typeof body.token === "string" && isToken(body.token) ? body.token : null;
  const tokenRow = token ? await downloadToken(ctx.store.db, token) : null;

  const now = ctx.now();
  const eventTime = typeof body.event_time === "number" ? body.event_time : now;

  let join: {
    method: "token" | "estimate" | "none";
    confidence: number;
    web_visitor_id: string | null;
    reason?: string;
  } = { method: "none", confidence: 0, web_visitor_id: null };

  const tokenUsable =
    tokenRow &&
    tokenRow.workspaceId === workspaceId &&
    tokenRow.expiresAt.getTime() >= now &&
    tokenRow.webVisitorId;

  if (tokenUsable) {
    // Claiming twice is normal: the install hook wrote the token file AND the
    // Downloads scan found the installer. link() is idempotent, so the second
    // claim costs an edge write and changes nothing.
    await claimDownloadToken(ctx.store.db, token!, new Date(now));
    await ctx.resolver.link(
      workspaceId,
      { type: "install", id: installId },
      { type: "web_visitor", id: tokenRow!.webVisitorId! },
      "token"
    );
    join = { method: "token", confidence: 1, web_visitor_id: tokenRow!.webVisitorId };
  } else {
    const est = await estimateFirstRun(ctx, {
      workspaceId,
      installId,
      os: str(body.os),
      ip: clientIp(req, socketIp),
      at: now,
    });
    join = est.matched
      ? { method: "estimate", confidence: est.confidence, web_visitor_id: est.web_visitor_id }
      : { method: "none", confidence: 0, web_visitor_id: null, reason: est.reason };
  }

  await ingestEnvelopes(ctx, [
    EventEnvelope.parse({
      workspace_id: workspaceId,
      source_id: source.id,
      event_id: typeof body.event_id === "string" ? body.event_id : crypto.randomUUID(),
      event_name: EVENT.APP_FIRST_RUN,
      event_time: eventTime,
      ingest_time: now,
      surface: "app",
      install_id: installId,
      account_id: str(body.account_id),
      app_version: str(body.app_version),
      channel: str(body.channel),
      os: str(body.os),
      arch: str(body.arch),
      locale: str(body.locale),
      props: { join_method: join.method },
    }),
  ]);

  const personId = await ctx.resolver.resolve(workspaceId, { type: "install", id: installId });
  return json({ person_id: personId, join });
}

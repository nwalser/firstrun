import { Hono } from "hono";
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
import { ingestEnvelopes } from "./ingest.js";
import { readWebTag } from "./web-tag.js";

/** Bun hands the socket address in; behind a proxy the header wins. */
export interface Env {
  Bindings: { ip?: string };
}

function clientIp(header: string | undefined, socketIp: string | undefined): string | null {
  const first = header?.split(",")[0]?.trim();
  return first || socketIp || null;
}

/** Coarse on purpose. It is a matching key, not a device report. */
export function osFromUserAgent(ua: string | undefined): string | null {
  if (!ua) return null;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux|X11/i.test(ua)) return "linux";
  return null;
}

export function createApp(ctx: Ctx) {
  const app = new Hono<Env>();

  // The tag sends `text/plain` so the beacon stays preflight-free. These
  // headers are for the fetch fallback and for anyone debugging in a console.
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      });
    }
    await next();
    c.header("Access-Control-Allow-Origin", "*");
  });

  app.get("/v1/health", (c) => c.json({ ok: true }));

  /**
   * Everything a client sends, in either shape.
   *
   * One endpoint rather than two because the web tag's URL is the thing
   * customers put behind a CNAME, and a second path is a second thing to get
   * wrong in their proxy config.
   */
  app.post("/v1/e", async (c) => {
    const raw = await c.req.text();
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: "body must be json" }, 400);
    }

    if (body && typeof body === "object" && "person_id" in body) {
      return c.json({ error: "person_id is derived server-side" }, 400);
    }

    const ingestTime = ctx.now();
    let envelopes: EventEnvelope[];

    const web = CompactBatch.safeParse(body);
    if (web.success) {
      envelopes = normalizeWeb(web.data, { ingestTime });
    } else {
      const appBatch = AppBatch.safeParse(body);
      if (!appBatch.success) {
        return c.json({ error: "unrecognised body", detail: appBatch.error.issues.slice(0, 3) }, 400);
      }
      envelopes = normalizeApp(appBatch.data, { ingestTime });
    }

    const result = await ingestEnvelopes(ctx, envelopes);
    return c.json(result, 202);
  });

  /**
   * Step 1 of the join: mint on download.
   *
   * The redirect is the whole mechanism. The browser saves a file whose name
   * carries the token, and that filename is the only thing that survives the
   * jump from the website to the installer.
   */
  app.get("/v1/download", async (c) => {
    const projectId = c.req.query("project");
    const vid = c.req.query("vid") ?? null;
    const version = c.req.query("version") ?? "latest";
    if (!projectId) return c.json({ error: "project is required" }, 400);

    const project = ctx.repos.projects.get(projectId);
    if (!project) return c.json({ error: "unknown project" }, 404);

    const asset = c.req.query("asset") ?? project.asset_name;
    const now = ctx.now();
    const token = mintToken();

    ctx.repos.downloadTokens.create({
      token,
      project_id: projectId,
      web_visitor_id: vid,
      asset,
      created_at: now,
      expires_at: now + TOKEN_TTL_MS,
      claimed_at: null,
    });

    const os = osFromUserAgent(c.req.header("user-agent"));
    const ip = clientIp(c.req.header("x-forwarded-for"), c.env?.ip);

    // Material for the estimated path, in case this download turns into an
    // install that never sees its own filename. Never used for an exact join.
    if (vid && ip) {
      ctx.repos.downloadHints.record({
        project_id: projectId,
        web_visitor_id: vid,
        ip_hash: hashIp(ctx.config.ipHashSalt, projectId, ip),
        os,
        created_at: now,
      });
    }

    // Step 2 of the funnel is server-side: a click on a download button that
    // never reaches us is not a download.
    if (vid) {
      await ingestEnvelopes(ctx, [
        EventEnvelope.parse({
          project_id: projectId,
          event_id: crypto.randomUUID(),
          event_name: EVENT.DOWNLOAD_STARTED,
          event_time: now,
          ingest_time: now,
          surface: "web",
          web_visitor_id: vid,
          os,
          url: c.req.header("referer") ?? null,
          props: { asset, version, token },
        }),
      ]);
    }

    const filename = installerFilename(asset, version, token);
    return c.redirect(`${ctx.config.publicOrigin}/dl/${token}/${filename}`, 302);
  });

  /**
   * Streams the real installer under a filename that carries the token.
   *
   * The token is not validated here. A shared link should still download
   * something; the worst case is a token that gets claimed by the wrong
   * machine, which is a wrong join, not a broken download.
   */
  app.get("/dl/:token/:filename", async (c) => {
    const { token, filename } = c.req.param();
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

    // No asset origin configured: this is a development machine. Serve
    // something with the right name so the whole flow can be walked end to end
    // without anyone having to build an installer first.
    return new Response(`placeholder installer for ${underlying}\ntoken=${token}\n`, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Firstrun-Placeholder": "1",
      },
    });
  });

  /**
   * Step 2 of the join: claim on first run.
   *
   * `token` is nullable on purpose. The app calls this exactly once whether or
   * not it found a token, so first run has one code path and the estimated
   * fallback lives on the server where it can see the download hints.
   */
  app.post("/v1/claim", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: "body must be json" }, 400);

    const installId = typeof body.install_id === "string" ? body.install_id : null;
    if (!installId) return c.json({ error: "install_id is required" }, 400);

    const token = typeof body.token === "string" && isToken(body.token) ? body.token : null;
    const tokenRow = token ? ctx.repos.downloadTokens.get(token) : null;
    const projectId = tokenRow?.project_id ?? (typeof body.project_id === "string" ? body.project_id : null);
    if (!projectId) return c.json({ error: "project_id is required when there is no valid token" }, 400);

    const now = ctx.now();
    const appVersion = str(body.app_version);
    const os = str(body.os);
    const arch = str(body.arch);
    const locale = str(body.locale);
    const eventTime = typeof body.event_time === "number" ? body.event_time : now;

    let join: {
      method: "token" | "estimate" | "none";
      confidence: number;
      web_visitor_id: string | null;
      reason?: string;
    } = { method: "none", confidence: 0, web_visitor_id: null };

    if (tokenRow && tokenRow.expires_at >= now && tokenRow.web_visitor_id) {
      // Claiming twice is normal: the NSIS hook wrote the token file AND the
      // Downloads scan found the installer. link() is idempotent, so the second
      // claim costs an edge write and changes nothing.
      ctx.repos.downloadTokens.claim(token!, now);
      await ctx.resolver.link(
        projectId,
        { type: "install", id: installId },
        { type: "web_visitor", id: tokenRow.web_visitor_id },
        "token"
      );
      join = { method: "token", confidence: 1, web_visitor_id: tokenRow.web_visitor_id };
    } else {
      const ip = clientIp(c.req.header("x-forwarded-for"), c.env?.ip);
      const est = await estimateFirstRun(ctx, {
        projectId,
        installId,
        os,
        ip,
        at: now,
      });
      join = est.matched
        ? { method: "estimate", confidence: est.confidence, web_visitor_id: est.web_visitor_id }
        : { method: "none", confidence: 0, web_visitor_id: null, reason: est.reason };
    }

    await ingestEnvelopes(ctx, [
      EventEnvelope.parse({
        project_id: projectId,
        event_id: typeof body.event_id === "string" ? body.event_id : crypto.randomUUID(),
        event_name: EVENT.APP_FIRST_RUN,
        event_time: eventTime,
        ingest_time: now,
        surface: "app",
        install_id: installId,
        account_id: str(body.account_id),
        app_version: appVersion,
        channel: str(body.channel),
        os,
        arch,
        locale,
        props: { join_method: join.method },
      }),
    ]);

    const personId = await ctx.resolver.resolve(projectId, { type: "install", id: installId });
    return c.json({ person_id: personId, join });
  });

  /** The tag itself, from a path a customer can put behind their own CNAME. */
  app.get("/t.js", async (c) => {
    const js = await readWebTag();
    if (!js) return c.text("// web tag not built. run: bun run build:web-tag\n", 503);
    return new Response(js, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  });

  return app;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

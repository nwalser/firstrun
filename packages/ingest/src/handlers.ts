import { sourceByKey } from "@firstrun/db/repo";
import {
  LogBatch,
  WireEntry,
  normalizeBatch,
  type NormalizeContext,
} from "@firstrun/schema/log";
import type { Ctx } from "./context.js";
import { ingestEntries } from "./pipeline.js";

/**
 * The public data plane, as plain Request -> Response.
 *
 * Two endpoints and no more: somewhere to put log entries, and somewhere to ask
 * whether the process is up. firstrun does not proxy, redirect, or stand in
 * front of anything a customer ships, so there is nothing else for it to serve.
 *
 * One endpoint for ALL telemetry, not one per kind. An exception, a page view
 * and a latency sample arrive in the same array, in the same shape, and nothing
 * below reads the name or the severity to decide what to do with one. There is
 * no `/v1/errors`, and adding one would be adding a second pipeline for rows
 * that belong in the same table.
 *
 * No framework. These are mounted by the web app's server entry today and could
 * be mounted by anything tomorrow: running one service on Railway should be a
 * routing decision, not something baked into the handlers.
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

// ---------------------------------------------------------------------------
// GET /v1/health
// ---------------------------------------------------------------------------

/**
 * Deliberately does not touch the database.
 *
 * This answers "is this process serving requests", which is the only question a
 * load balancer is asking. Probing Postgres here turns one slow query into a
 * rolling restart of a service whose job is to accept a POST and return.
 */
export function handleHealth(): Response {
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// POST /v1/e
// ---------------------------------------------------------------------------

export interface IngestResponse {
  accepted: number;
  duplicates: number;
  /** Entries in the batch that did not parse. See `keepParsable`. */
  dropped: number;
}

/**
 * Keeps the entries that parse and counts the ones that do not.
 *
 * A malformed entry never fails the batch around it. The client cannot fix the
 * bytes it has already queued: reject the batch and a well-written SDK retries
 * the same body forever, while a badly written one drops its whole queue to get
 * unstuck. Both lose more than dropping the single entry that is wrong, and
 * neither tells anybody anything, because nothing is listening on the other end
 * (every client here is fire-and-forget by design).
 *
 * "Malformed" is only ever about SHAPE: a name that is not a name, a severity
 * off the ladder, an attribute map past its bounds. An entry is never dropped
 * for its name, its severity, or for using keys nobody has heard of. There is
 * no allowlist at this layer or any other.
 */
function keepParsable(raw: unknown): { kept: unknown[]; dropped: number } {
  const all = Array.isArray(raw) ? raw : [];
  const kept = all.filter((e) => WireEntry.safeParse(e).success);
  return { kept, dropped: all.length - kept.length };
}

/**
 * A batch of log entries, from any client.
 *
 * One endpoint rather than one per kind of telemetry, and one body shape rather
 * than a compact browser dialect beside a verbose SDK one. The URL is what
 * customers put behind a CNAME, and every extra path is another thing to get
 * wrong in a proxy config.
 *
 * Which source an entry arrived through comes from the key's own row, so a body
 * cannot claim to have come from a source it did not.
 */
export async function handleEntries(req: Request, ctx: Ctx): Promise<Response> {
  // Checked before the body is read, so an oversized one is never held. The
  // header can lie, hence the second check: a JS string is never longer than
  // its UTF-8 encoding, so comparing its length is a sound cap on bytes.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > ctx.config.maxBodyBytes) return json({ error: "body too large" }, 413);

  const raw = await req.text();
  if (raw.length > ctx.config.maxBodyBytes) return json({ error: "body too large" }, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "body must be json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "body must be an object" }, 400);
  }

  const b = body as Record<string, unknown>;
  if (typeof b.k !== "string") return json({ error: "unrecognised body" }, 400);

  // The key identifies and never authorises: it ships in a script tag and in
  // binaries anyone can unpack. All it buys is the project it belongs to.
  const source = await sourceByKey(ctx.store.db, b.k);
  if (!source) return json({ error: "unknown source key" }, 404);

  const { kept, dropped } = keepParsable(b.e);

  // Nothing survived, but the batch was still received and there is nothing the
  // client should do differently, so this is an outcome and not an error.
  if (kept.length === 0) {
    return json({ accepted: 0, duplicates: 0, dropped } satisfies IngestResponse, 202);
  }

  // The header, unlike one entry, is not droppable: with no distinct id there
  // is nothing to attribute any of these entries to.
  //
  // The resource is the exception. It is a whole map of attributes describing
  // the client, and one bad key in it would otherwise cost every entry in the
  // batch its existence for the sake of a field that is decoration on each of
  // them. So a batch that fails only because of `r` is retried without it: the
  // entries land, missing the app version they would have carried.
  let batch = LogBatch.safeParse({ ...b, e: kept });
  if (!batch.success && b.r !== undefined) {
    batch = LogBatch.safeParse({ ...b, r: undefined, e: kept });
  }
  if (!batch.success) return json({ error: "malformed batch" }, 400);

  const context: NormalizeContext = {
    projectId: source.projectId,
    sourceId: source.id,
    ingestedAt: ctx.now(),
  };

  const result = await ingestEntries(ctx, normalizeBatch(batch.data, context));
  return json({ ...result, dropped } satisfies IngestResponse, 202);
}

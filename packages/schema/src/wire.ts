import { z } from "zod";
import { EventEnvelope, type Surface } from "./envelope.js";

/**
 * What clients put on the wire.
 *
 * Clients send a SOURCE KEY, never a workspace id. The key is public by
 * necessity -- it ships in a script tag -- so it identifies and never
 * authorises, and the edge is the only thing that knows which workspace it
 * belongs to. Internal ids stay internal.
 */

/** `fr_web_9f3a…`. Prefix names the kind so a misplaced key is obvious. */
export const SourceKey = z.string().regex(/^fr_(web|app)_[0-9a-z]{16}$/);

/**
 * The compact body the web tag sends.
 *
 * Short keys because this is measured in bytes on a `sendBeacon` from a page
 * being unloaded, and because the tag has a 3KB gzipped budget. Content type
 * stays `text/plain;charset=UTF-8` so the request is preflight-free -- do not
 * change that without re-checking CORS.
 */
export const CompactBatch = z.object({
  /** source key */
  k: SourceKey,
  /** web visitor id -- absent before consent */
  v: z.string().min(1).max(64).optional(),
  /** session id */
  s: z.string().min(1).max(64).optional(),
  /** account id, if the site knows who this is */
  a: z.string().min(1).max(512).optional(),
  e: z
    .array(
      z.object({
        /** event id, client generated so retries dedup */
        i: z.string().uuid(),
        n: z.string().min(1).max(128),
        /** client-stamped event time, ms since epoch */
        t: z.number().int().nonnegative(),
        u: z.string().max(2048).optional(),
        r: z.string().max(2048).optional(),
        l: z.string().max(35).optional(),
        us: z.string().max(512).optional(),
        um: z.string().max(512).optional(),
        uc: z.string().max(512).optional(),
        x: z.record(z.string(), z.string()).optional(),
      })
    )
    .min(1)
    .max(50),
});

export type CompactBatch = z.infer<typeof CompactBatch>;

/** The body the desktop SDK sends. Not size constrained. */
export const AppBatch = z.object({
  source_key: SourceKey,
  install_id: z.string().min(1).max(512),
  account_id: z.string().min(1).max(512).nullish(),
  app_version: z.string().max(64).nullish(),
  channel: z.string().max(64).nullish(),
  os: z.string().max(64).nullish(),
  arch: z.string().max(64).nullish(),
  locale: z.string().max(35).nullish(),
  events: z
    .array(
      z.object({
        event_id: z.string().uuid(),
        event_name: z.string().min(1).max(128),
        event_time: z.number().int().nonnegative(),
        session_id: z.string().max(64).nullish(),
        props: z.record(z.string(), z.string()).optional(),
      })
    )
    .min(1)
    .max(500),
});

export type AppBatch = z.infer<typeof AppBatch>;

/** What the edge learned by looking the source key up. */
export interface NormalizeContext {
  workspaceId: string;
  sourceId: string;
  /** Server-stamped. Never used for bucketing -- see CLAUDE.md rule 2. */
  ingestTime: number;
}

/** Compact web body -> internal envelopes. */
export function normalizeWeb(batch: CompactBatch, ctx: NormalizeContext): EventEnvelope[] {
  const surface: Surface = "web";
  return batch.e.map((e) =>
    EventEnvelope.parse({
      workspace_id: ctx.workspaceId,
      source_id: ctx.sourceId,
      event_id: e.i,
      event_name: e.n,
      event_time: e.t,
      ingest_time: ctx.ingestTime,
      surface,
      web_visitor_id: batch.v ?? null,
      install_id: null,
      account_id: batch.a ?? null,
      session_id: batch.s ?? null,
      app_version: null,
      channel: null,
      os: null,
      arch: null,
      locale: e.l ?? null,
      url: e.u ?? null,
      referrer: e.r ?? null,
      utm_source: e.us ?? null,
      utm_medium: e.um ?? null,
      utm_campaign: e.uc ?? null,
      props: e.x ?? {},
    })
  );
}

/** App batch -> internal envelopes. */
export function normalizeApp(batch: AppBatch, ctx: NormalizeContext): EventEnvelope[] {
  const surface: Surface = "app";
  return batch.events.map((e) =>
    EventEnvelope.parse({
      workspace_id: ctx.workspaceId,
      source_id: ctx.sourceId,
      event_id: e.event_id,
      event_name: e.event_name,
      event_time: e.event_time,
      ingest_time: ctx.ingestTime,
      surface,
      web_visitor_id: null,
      install_id: batch.install_id,
      account_id: batch.account_id ?? null,
      session_id: e.session_id ?? null,
      app_version: batch.app_version ?? null,
      channel: batch.channel ?? null,
      os: batch.os ?? null,
      arch: batch.arch ?? null,
      locale: batch.locale ?? null,
      url: null,
      referrer: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      props: e.props ?? {},
    })
  );
}

/** Mints a source key. Public identifier, so it only has to be unguessable. */
export function mintSourceKey(kind: "web" | "desktop"): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `fr_${kind === "web" ? "web" : "app"}_${hex}`;
}

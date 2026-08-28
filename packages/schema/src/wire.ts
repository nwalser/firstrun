import { z } from "zod";
import { EventEnvelope, type Surface } from "./envelope.js";

/**
 * The compact body the web tag puts on the wire.
 *
 * Short keys because this is measured in bytes on a `sendBeacon` from a page
 * that is being unloaded, and because the tag itself has a 3KB gzipped budget.
 * Content type stays `text/plain;charset=UTF-8` so the request is
 * preflight-free — do not change that without re-checking CORS.
 *
 * Normalized to the internal envelope at the edge and never seen again.
 */
export const CompactBatch = z.object({
  /** project id */
  p: z.string().uuid(),
  /** web visitor id — absent before consent */
  v: z.string().min(1).max(64).optional(),
  /** session id */
  s: z.string().min(1).max(64).optional(),
  /** account id, if the site knows who this is */
  a: z.string().min(1).max(512).optional(),
  /** events */
  e: z
    .array(
      z.object({
        /** event id, client generated so retries dedup */
        i: z.string().uuid(),
        /** event name */
        n: z.string().min(1).max(128),
        /** client-stamped event time, ms since epoch */
        t: z.number().int().nonnegative(),
        /** url */
        u: z.string().max(2048).optional(),
        /** referrer */
        r: z.string().max(2048).optional(),
        /** locale */
        l: z.string().max(35).optional(),
        /** utm source / medium / campaign */
        us: z.string().max(512).optional(),
        um: z.string().max(512).optional(),
        uc: z.string().max(512).optional(),
        /** props */
        x: z.record(z.string(), z.string()).optional(),
      })
    )
    .min(1)
    .max(50),
});

export type CompactBatch = z.infer<typeof CompactBatch>;

/**
 * The body the Tauri SDK sends. Not size constrained, so it is the envelope
 * minus the fields only the server may set.
 */
export const AppBatch = z.object({
  project_id: z.string().uuid(),
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

export interface NormalizeContext {
  /** Server-stamped. Never used for bucketing — see CLAUDE.md rule 2. */
  ingestTime: number;
}

/** Compact web body -> internal envelopes. */
export function normalizeWeb(batch: CompactBatch, ctx: NormalizeContext): EventEnvelope[] {
  const surface: Surface = "web";
  return batch.e.map((e) =>
    EventEnvelope.parse({
      project_id: batch.p,
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
      project_id: batch.project_id,
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

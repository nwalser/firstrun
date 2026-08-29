import { z } from "zod";

/**
 * The internal event envelope. A flat header plus a string-keyed attribute map.
 * Everything that reaches the database has been normalized into exactly this.
 *
 * Three rules live here and are enforced nowhere else:
 *
 *  - `event_time` is client-stamped and authoritative. `ingest_time` is
 *    server-stamped. They are separate, both required, and nothing may sort,
 *    bucket or window on `ingest_time`.
 *  - There is no `person_id` field. `person_id` is derived by
 *    `@firstrun/identity` server-side. A client that sends one is refused.
 *  - `project_id` is the identity namespace; `source_id` only records which
 *    ingestion site an event came from. A person spans sources by design --
 *    that is the whole product.
 */

export const Surface = z.enum(["web", "app"]);
export type Surface = z.infer<typeof Surface>;

/** Milliseconds since epoch. Accepts a number or an ISO-8601 string. */
const Millis = z.union([
  z.number().int().nonnegative(),
  z.string().datetime().transform((s) => Date.parse(s)),
]);

const NullableStr = z.string().min(1).max(512).nullish().transform((v) => v ?? null);

export const EventEnvelope = z.object({
  project_id: z.string().uuid(),
  source_id: z.string().uuid().nullish().transform((v) => v ?? null),
  event_id: z.string().uuid(),
  event_name: z.string().min(1).max(128),

  /** Client-stamped. Authoritative. Every query buckets on this. */
  event_time: Millis,
  /** Server-stamped at the edge. Debugging and dedup windows only. */
  ingest_time: Millis,

  surface: Surface,

  // Distincts. person_id is derived from these; never sent.
  web_visitor_id: NullableStr,
  install_id: NullableStr,
  account_id: NullableStr,
  session_id: NullableStr,

  app_version: NullableStr,
  channel: NullableStr,
  os: NullableStr,
  arch: NullableStr,
  locale: NullableStr,

  url: z.string().max(2048).nullish().transform((v) => v ?? null),
  referrer: z.string().max(2048).nullish().transform((v) => v ?? null),
  utm_source: NullableStr,
  utm_medium: NullableStr,
  utm_campaign: NullableStr,

  props: z.record(z.string(), z.string()).default({}),
});

export type EventEnvelope = z.infer<typeof EventEnvelope>;

/** An envelope that has been through identity resolution and is ready to store. */
export type StoredEvent = EventEnvelope & { person_id: string };

/**
 * Reject anything that looks like a client asserting a person.
 * Called before parsing so the error is explicit rather than a silent drop.
 */
export function assertNoClientPerson(body: unknown): void {
  if (body && typeof body === "object" && "person_id" in body) {
    throw new Error("person_id is derived server-side and must not be sent by a client");
  }
}

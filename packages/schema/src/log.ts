import { z } from "zod";
import { Attributes, type Attributes as Attrs } from "./attributes.js";
import { SeverityNumber } from "./severity.js";
import { SURFACES, type Surface } from "./surface.js";

/**
 * One log entry, and the wire it arrives on. The only row shape this has.
 *
 * An error is a log entry. A page view is a log entry. A Core Web Vital is a
 * log entry. There is no second table, no second pipeline and no enum of kinds:
 * meaning is assigned by CONVENTION at write time (`conventions.ts`) and by
 * QUERY at read time, and the backend is never told which is which.
 *
 * The model is OpenTelemetry's log data model, used as the reference rather
 * than invented here, so the client conventions have a spec to point at:
 *
 *   OTel                  here          why
 *   --------------------  ------------  ------------------------------------
 *   timestamp             time          client-stamped, authoritative
 *   observed_timestamp    ingested_at   server-stamped, debugging only
 *   severity_number       severity      the 1..24 ladder, nullable
 *   severity_text         (derived)     `severityText()`, never stored
 *   attributes            attributes    everything else, queried by path
 *   resource attributes   attributes    merged in at the edge, same map
 *   body, trace_id, …     attributes    not columns. See below
 *
 * Five things are promoted and the rest is one JSON map: `project_id`, `time`,
 * `distinct_id`, `severity`, `name`. A closed set of columns is a closed set of
 * questions, and which question a customer needs is the one thing we cannot
 * know in advance. `body`, `trace_id` and `span_id` are therefore attributes
 * like any other: they are part of the spec's vocabulary, not part of ours, and
 * promoting one later is a generated column over `attributes` rather than a
 * schema break.
 */

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export const LOG_NAME_MAX = 128;

/**
 * The only rule a name has to obey.
 *
 * Starts with a letter or a digit, then letters, digits, underscore, dot and
 * hyphen. There is no allowlist: `page_view` and `invoice.exported` are the
 * same kind of thing to everything downstream. Colon and greater-than are
 * excluded deliberately, because derived query keys are delimited strings and a
 * name allowed to contain a delimiter could forge a key of another shape.
 */
export const LOG_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export const LogName = z.string().regex(LOG_NAME_RE, "invalid log name");
export type LogName = z.infer<typeof LogName>;

export const isLogName = (s: string): boolean => LOG_NAME_RE.test(s);

/** `page_view` becomes `Page view`. A display fallback, never an identity. */
export function logLabel(name: string): string {
  const words = name.replace(/[_.-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}

// ---------------------------------------------------------------------------
// The stored entry
// ---------------------------------------------------------------------------

/** Milliseconds since epoch. A number, or an ISO-8601 string a server SDK sent. */
const Millis = z.union([
  z.number().int().nonnegative(),
  z.string().datetime().transform((s) => Date.parse(s)),
]);

export const LogEntry = z.object({
  project_id: z.string().uuid(),
  entry_id: z.string().uuid(),

  /** Client-stamped and authoritative. Every bucket, window and sort uses this. */
  time: Millis,
  /** Server-stamped at the edge. Debugging only. Never bucketed on. */
  ingested_at: Millis,

  name: LogName,
  /** The 1..24 ladder, or null for an entry nobody classified. */
  severity: SeverityNumber.nullish().transform((v) => v ?? null),

  /**
   * The anonymous id this surface generated and persisted for itself. Required,
   * because an entry that cannot be attributed to anything cannot be counted.
   */
  distinct_id: z.string().min(1).max(512),

  attributes: Attributes.default({}),
});

export type LogEntry = z.infer<typeof LogEntry>;

// ---------------------------------------------------------------------------
// Source keys
// ---------------------------------------------------------------------------

/**
 * `fr_web_9f3a…`. The prefix names the surface, so a misplaced key is obvious.
 *
 * Public by necessity: it ships in a script tag and inside binaries anyone can
 * unpack. It identifies a destination and authorises nothing, and the edge is
 * the only thing that knows which project it belongs to.
 */
export const SOURCE_KEY_RE = new RegExp(`^fr_(${SURFACES.join("|")})_[0-9a-z]{16}$`);
export const SourceKey = z.string().regex(SOURCE_KEY_RE, "invalid source key");

/** The surface a key claims. The edge still trusts the stored source, not this. */
export function surfaceFromSourceKey(key: string): Surface | null {
  const m = SOURCE_KEY_RE.exec(key);
  return m ? (m[1] as Surface) : null;
}

/** Mints a source key. Public identifier, so it only has to be unguessable. */
export function mintSourceKey(surface: Surface): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `fr_${surface}_${hex}`;
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

/** How many entries one POST may carry. `maxBatch` must not exceed this. */
export const MAX_BATCH_ENTRIES = 500;

/**
 * One entry on the wire.
 *
 * Short keys, and one shape for every client rather than a compact browser
 * dialect beside a verbose SDK one. The browser tag posts this from
 * `sendBeacon` on a page being unloaded, where bytes are the constraint, and a
 * second body shape is a second thing to get wrong in a proxy config and a
 * second normaliser to keep in step. The mapping onto OTel's names is the table
 * at the top of this file; it is a rename and nothing more.
 */
export const WireEntry = z.object({
  /** entry id. Client-generated, so a replayed queue deduplicates. */
  i: z.string().uuid(),
  /** timestamp, ms since epoch. Client-stamped and authoritative. */
  t: Millis,
  /** name */
  n: LogName,
  /** severity_number, 1..24. Absent means unclassified, not INFO. */
  s: SeverityNumber.optional(),
  /** attributes */
  a: Attributes.optional(),
});

export type WireEntry = z.infer<typeof WireEntry>;

/**
 * A batch, from any surface.
 *
 * `r` is the resource: the attributes true of the whole client rather than of
 * one entry, such as `service.version`, `os.type`, `session.id` and `user.id`.
 * They are merged UNDER each entry's own attributes at the edge, so a row is
 * self-contained and a query never has to join to find out which app version
 * something came from. An entry that sets the same key wins, because the entry
 * is the more specific statement.
 */
export const LogBatch = z.object({
  /** source key */
  k: SourceKey,
  /** distinct id: the anonymous id this client generated and persisted */
  d: z.string().min(1).max(512),
  /** resource attributes */
  r: Attributes.optional(),
  e: z.array(WireEntry).min(1).max(MAX_BATCH_ENTRIES),
});

export type LogBatch = z.infer<typeof LogBatch>;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** What the edge learned by looking the source key up. */
export interface NormalizeContext {
  projectId: string;
  sourceId: string;
  /** The surface recorded on the source row, not the one the key claimed. */
  surface: Surface;
  /** Server-stamped. Never used for bucketing. */
  ingestedAt: number;
}

/**
 * A wire entry becomes a stored entry.
 *
 * Three attribute maps are layered, least specific first: the resource, then
 * the entry's own, then the two the edge stamps. The edge wins outright.
 * `firstrun.source.surface` is what the stored source row says, so a client
 * cannot report itself as a surface it is not by putting the key in its own
 * attributes.
 *
 * Nothing here reads `n` or `s`. An exception and a page view take the same
 * three lines, which is the property the whole design rests on.
 */
export function normalizeEntry(
  batch: Pick<LogBatch, "d" | "r">,
  e: WireEntry,
  ctx: NormalizeContext
): LogEntry {
  const attributes: Attrs = {
    ...(batch.r ?? {}),
    ...(e.a ?? {}),
    "firstrun.source.id": ctx.sourceId,
    "firstrun.source.surface": ctx.surface,
  };

  return LogEntry.parse({
    project_id: ctx.projectId,
    entry_id: e.i,
    time: e.t,
    ingested_at: ctx.ingestedAt,
    name: e.n,
    severity: e.s ?? null,
    distinct_id: batch.d,
    attributes,
  });
}

export function normalizeBatch(batch: LogBatch, ctx: NormalizeContext): LogEntry[] {
  return batch.e.map((e) => normalizeEntry(batch, e, ctx));
}

/**
 * The parts of the wire contract this client has to know, copied by hand.
 *
 * They are copied rather than imported from `@firstrun/schema` because that
 * package's only entry point pulls in zod, and this library ships with no
 * runtime dependencies. A published client also outlives the server it was
 * built against: pinning the shape here means an old binary keeps sending a
 * body the edge still understands, instead of one that drifted with a version
 * bump nobody redeployed. If the contract moves, this file moves with it.
 *
 * Source of truth: `packages/schema/src/severity.ts`, `attributes.ts` and
 * `conventions.ts`.
 *
 * ## One shape for everything
 *
 * There is no event type, no error type and no metric type. There is a LOG
 * ENTRY, and that is all there is. An error is an entry with a high severity
 * and `exception.*` attributes. A metric sample is an entry with
 * `firstrun.metric` and `firstrun.value`. A product event is an entry with a
 * name and whatever attributes the caller thought were worth keeping. Meaning
 * is assigned by convention when it is written and by query when it is read,
 * never by a closed set of types in the backend.
 */

/**
 * `fr_9f3ab21c4d5e6f70`. Sixteen hex characters, and nothing before them.
 *
 * The middle segment used to name the kind of source the key belonged to. There
 * are no kinds of source, so there is nothing for it to say.
 */
export const SOURCE_KEY_RE = /^fr_[0-9a-f]{16}$/;

/** Entry names are shape-checked only. There is no allowlist. */
export const LOG_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** `LogBatch.entries` is bounded. A larger body is rejected whole. */
export const MAX_ENTRIES_PER_BATCH = 500;

/** `distinct_id` and the id-shaped attributes are bounded. */
export const MAX_ID_LEN = 512;

/** The one ingestion path. Every body shape goes to it. */
export const INGEST_PATH = "/v1/e";

// ---------------------------------------------------------------------------
// Attribute bounds
// ---------------------------------------------------------------------------

/**
 * The bounds the edge enforces, mirrored here so one oversized attribute costs
 * itself rather than costing the whole batch its existence.
 *
 * The edge rejects a body that breaks any of these, and a rejected body is a
 * permanent failure that takes every entry in it down. Clamping on this side is
 * the difference between losing one attribute and losing 250 entries.
 */
export const MAX_ATTRIBUTES = 64;
export const MAX_ATTRIBUTE_DEPTH = 4;
export const MAX_ATTRIBUTE_KEY = 128;
export const MAX_ATTRIBUTE_STRING = 4096;
export const MAX_ATTRIBUTE_ITEMS = 128;

/** The longest `body` this client will send. Truncated, never dropped. */
export const MAX_BODY = 16_384;

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

/**
 * The OpenTelemetry severity ladder: twenty-four numbers in six bands of four.
 *
 * The number is authoritative and is what the server stores; the text is
 * derived from it for display and is never sent. Two entries that sorted
 * differently because one said "warn" and the other said "WARNING" would be a
 * bug nobody could see.
 *
 * The three spare steps inside each band exist so a caller whose own logger has
 * nine levels can map onto this without losing the ordering: `SEVERITY.WARN + 1`
 * is a slightly worse warning and still filters as a warning.
 */
export const SEVERITY = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
} as const;

export type SeverityBand = keyof typeof SEVERITY;

export const SEVERITY_MIN = 1;
export const SEVERITY_MAX = 24;

const BAND_WIDTH = 4;
const BANDS: SeverityBand[] = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

/** The spellings people already have in their loggers, mapped onto a band. */
const ALIASES: Record<string, SeverityBand> = {
  VERBOSE: "TRACE",
  FINE: "DEBUG",
  FINER: "TRACE",
  FINEST: "TRACE",
  NOTICE: "INFO",
  INFORMATION: "INFO",
  INFORMATIONAL: "INFO",
  WARNING: "WARN",
  ERR: "ERROR",
  SEVERE: "ERROR",
  CRIT: "FATAL",
  CRITICAL: "FATAL",
  ALERT: "FATAL",
  EMERG: "FATAL",
  EMERGENCY: "FATAL",
  PANIC: "FATAL",
};

const TEXT_RE = /^([A-Za-z]+)([1-4])?$/;

/**
 * A severity name back to its number, or null when it is not one of ours.
 *
 * Null rather than a default, because guessing a severity is worse than having
 * none: an entry with no severity is honestly unclassified, and one silently
 * filed as INFO is a lie a filter will act on.
 */
export function severityNumber(text: string): number | null {
  const m = TEXT_RE.exec(String(text).trim());
  if (!m) return null;
  const word = m[1]!.toUpperCase();
  const band =
    ALIASES[word] ?? (BANDS.includes(word as SeverityBand) ? (word as SeverityBand) : undefined);
  if (!band) return null;
  return SEVERITY[band] + (m[2] ? Number(m[2]) - 1 : 0);
}

/** `9` becomes `INFO`, `10` becomes `INFO2`. Display only; the number travels. */
export function severityText(n: number): string {
  const v = Math.min(SEVERITY_MAX, Math.max(SEVERITY_MIN, Math.round(n)));
  const band = BANDS[Math.min(BANDS.length - 1, Math.floor((v - 1) / BAND_WIDTH))]!;
  const step = (v - SEVERITY[band]) % BAND_WIDTH;
  return step === 0 ? band : `${band}${step + 1}`;
}

// ---------------------------------------------------------------------------
// Conventions
// ---------------------------------------------------------------------------

/**
 * Conventional entry names. SUGGESTIONS, NOT LAW.
 *
 * Nothing here is enforced. Any string matching `LOG_NAME_RE` is stored,
 * counted, grouped and filtered identically. These exist so two projects that
 * mean the same thing spell it the same way.
 */
export const NAME = {
  PAGE_VIEW: "page_view",
  SESSION_START: "session_start",
  APP_INSTALL: "app_install",
  APP_LAUNCH: "app_launch",
  IDENTIFY: "identify",
  EXCEPTION: "exception",
  HTTP_REQUEST: "http.request",
  MEASUREMENT: "measurement",
  /**
   * What the level helpers (`info`, `warn` and the rest) name an entry.
   *
   * A free-form log line still needs a name, because `name` is the column a
   * dashboard groups on. `log` is this client's convention for "a line, not an
   * occurrence of a thing". Use `event()` or `log()` when you want your own.
   */
  LOG: "log",
} as const;

/**
 * Conventional attribute keys, from `packages/schema/src/conventions.ts`.
 *
 * The exception, session, user, os, http and url keys are OpenTelemetry's, used
 * verbatim. The `firstrun.*` keys are ours, namespaced so it is obvious at a
 * glance which half of the vocabulary we can change.
 */
export const ATTR = {
  EXCEPTION_TYPE: "exception.type",
  EXCEPTION_MESSAGE: "exception.message",
  EXCEPTION_STACKTRACE: "exception.stacktrace",
  EXCEPTION_ESCAPED: "exception.escaped",

  SESSION_ID: "session.id",
  USER_ID: "user.id",

  SERVICE_NAME: "service.name",
  SERVICE_VERSION: "service.version",

  OS_TYPE: "os.type",
  HOST_ARCH: "host.arch",
  BROWSER_LANGUAGE: "browser.language",

  URL_PATH: "url.path",
  URL_FULL: "url.full",

  HTTP_REQUEST_METHOD: "http.request.method",
  HTTP_RESPONSE_STATUS_CODE: "http.response.status_code",
  HTTP_ROUTE: "http.route",

  /**
   * The human-readable line.
   *
   * OpenTelemetry's log model has `body` as a top-level field. This product
   * promotes five columns and no more, so it travels as an attribute under the
   * spec's own name. Same for `trace_id` and `span_id` below: they are part of
   * the spec's vocabulary, not part of ours, and promoting one later is a
   * generated column over `attributes` rather than a schema break.
   */
  BODY: "body",
  TRACE_ID: "trace_id",
  SPAN_ID: "span_id",

  CHANNEL: "firstrun.channel",

  /**
   * Test data. Written as the JSON boolean `true` and never as the string.
   *
   * The dashboard matches it with `attributes @> '{"firstrun.test": true}'`,
   * which is containment over jsonb: `"true"` is a different value from `true`
   * and would not match, so an entry that sent the string would be invisible in
   * BOTH worlds. Production omits the key rather than sending `false`.
   */
  TEST: "firstrun.test",

  DURATION_MS: "firstrun.duration_ms",
  VALUE: "firstrun.value",
  METRIC: "firstrun.metric",
  UNIT: "firstrun.unit",
} as const;

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

export type AttributeValue =
  | string
  | number
  | boolean
  | null
  | AttributeValue[]
  | { [key: string]: AttributeValue };

export type Attributes = Record<string, AttributeValue>;

/**
 * The `LogBatch` body, exactly. Field names are the contract; do not add any.
 *
 * The keys are one letter because this is the same body the browser tag posts
 * from `sendBeacon` on a page being unloaded, where bytes are the constraint.
 * One shape for every client rather than a compact browser dialect beside a
 * verbose SDK one: a second body shape is a second thing to get wrong in a
 * proxy config and a second normaliser to keep in step.
 *
 * `r` is the resource: what is true of the whole PROCESS, not of one entry.
 * It sits once per body rather than on every entry because it does not change
 * between two entries in the same request, and repeating it 250 times is 250
 * copies of one string. The edge merges it UNDER each entry's own attributes,
 * so an entry that sets the same key wins.
 *
 * Source of truth: `LogBatch` in `packages/schema/src/log.ts`.
 */
export interface LogBatch {
  /** source key */
  k: string;
  /** resource attributes, identity included */
  r?: Attributes;
  /** entries */
  e: WireEntry[];
}

/**
 * One entry on the wire.
 *
 * Five fields, and there is no sixth. `body`, `trace_id` and `span_id` are not
 * fields here: they are attributes, under the spec's own names, because this
 * product promotes four columns and no more. `observed_timestamp` is not sent
 * at all, because the edge stamps `ingested_at` itself and would overwrite
 * anything a client claimed.
 */
export interface WireEntry {
  /** entry id. Client-generated, so a request that times out and is retried dedups. */
  i: string;
  /** timestamp, ms since epoch. Client-stamped and AUTHORITATIVE. */
  t: number;
  /** name */
  n: string;
  /** severity_number, 1..24. Omitted rather than guessed when the caller did not say. */
  s?: number;
  /** attributes */
  a?: Attributes;
}

// ---------------------------------------------------------------------------
// Clamping
// ---------------------------------------------------------------------------

/** True when the server will accept this as an entry name. */
export const isLogName = (s: unknown): s is string =>
  typeof s === "string" && LOG_NAME_RE.test(s);

function clampString(s: string): string {
  return s.length > MAX_ATTRIBUTE_STRING ? s.slice(0, MAX_ATTRIBUTE_STRING) : s;
}

/**
 * A value the edge will accept, or `undefined` when there is nothing sendable.
 *
 * Non-finite numbers go because NaN and Infinity are not JSON and arrive as the
 * string `null` after a round trip through the driver, which is a value nobody
 * can tell from a real one. Anything past the depth limit is dropped rather
 * than flattened: a truncated object that still looks like an object is worse
 * to debug than a key that is honestly absent.
 */
function clampValue(v: unknown, depth: number): AttributeValue | undefined {
  if (v === null) return null;
  switch (typeof v) {
    case "string":
      return clampString(v);
    case "number":
      return Number.isFinite(v) ? v : undefined;
    case "boolean":
      return v;
    case "bigint":
      return clampString(v.toString());
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
  }
  if (depth <= 1) return undefined;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
  }
  if (Array.isArray(v)) {
    const out: AttributeValue[] = [];
    for (const item of v) {
      if (out.length >= MAX_ATTRIBUTE_ITEMS) break;
      const clamped = clampValue(item, depth - 1);
      // `undefined` is not JSON, and a hole in an array shifts every later
      // index. Null is the honest stand-in for "this one did not survive".
      out.push(clamped === undefined ? null : clamped);
    }
    return out;
  }
  if (typeof v === "object") {
    const out: Attributes = {};
    let n = 0;
    for (const key of Object.keys(v as object)) {
      if (n >= MAX_ATTRIBUTE_ITEMS) break;
      if (key.length === 0 || key.length > MAX_ATTRIBUTE_KEY) continue;
      const clamped = clampValue((v as Record<string, unknown>)[key], depth - 1);
      if (clamped === undefined) continue;
      out[key] = clamped;
      n++;
    }
    return out;
  }
  return undefined;
}

/**
 * Copies and bounds an attribute map. Returns `undefined` when nothing survived.
 *
 * Copying matters as much as clamping: a caller who reuses and mutates their
 * object after the call must not be able to rewrite an entry this library has
 * already recorded.
 */
export function clampAttributes(input: unknown): Attributes | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: Attributes = {};
  let n = 0;
  for (const key of Object.keys(input as object)) {
    if (n >= MAX_ATTRIBUTES) break;
    if (key.length === 0 || key.length > MAX_ATTRIBUTE_KEY) continue;
    const value = clampValue((input as Record<string, unknown>)[key], MAX_ATTRIBUTE_DEPTH);
    if (value === undefined) continue;
    out[key] = value;
    n++;
  }
  return n > 0 ? out : undefined;
}

/** Merges two bounded maps. Later keys win. Undefined when both are empty. */
export function mergeAttributes(
  a: Attributes | undefined,
  b: Attributes | undefined
): Attributes | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: Attributes = { ...a };
  let n = Object.keys(out).length;
  for (const key of Object.keys(b)) {
    const known = Object.prototype.hasOwnProperty.call(out, key);
    if (!known && n >= MAX_ATTRIBUTES) continue;
    if (!known) n++;
    out[key] = b[key]!;
  }
  return out;
}

/** Bounds a body string. Truncated rather than dropped: half a line still says something. */
export function clampBody(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  if (v.length === 0) return undefined;
  return v.length > MAX_BODY ? v.slice(0, MAX_BODY) : v;
}

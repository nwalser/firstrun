/** Public types. Everything a caller can name lives here. */

import type { DeliveryMode, DeliveryOptions, Persistence } from "./delivery.js";
import type { Attributes, SeverityBand } from "./wire.js";

/**
 * What a caller may put in an attribute map.
 *
 * Wider than the wire type on purpose. `undefined`, functions, symbols and
 * non-finite numbers are dropped on the way in rather than refused, because a
 * telemetry call is not a place to make somebody handle a validation error, and
 * refusing `{ ok: undefined }` would only teach callers to write a filter at
 * every call site. Dates become ISO-8601 strings; bigints become their decimal
 * text. Everything else is copied, bounded and sent.
 */
export type AttributesInput = Record<string, unknown>;

/**
 * The raw escape hatch: one log entry, exactly as the wire models it.
 *
 * `log()` takes this. It is the shape everything else in this library builds,
 * and there is nothing the helpers can produce that you cannot write here by
 * hand. The model is OpenTelemetry's log data model, so if you already know
 * that one you already know this.
 */
export interface LogEntryInput {
  /**
   * The `name` column: what KIND of thing this is.
   *
   * Any string matching the entry-name rule. There is no allowlist and no
   * privileged name. `NAME` in this package holds conventions, and they are
   * suggestions.
   */
  name: string;

  /** The human-readable line, when there is one. */
  body?: string;

  /**
   * 1..24 on the OpenTelemetry ladder, or a name like `warn` or `ERROR2`.
   *
   * Left out when you have nothing to say. An entry with no severity is
   * honestly unclassified; one silently filed as INFO is a lie a filter acts on.
   */
  severity?: number | SeverityBand | string;

  /**
   * Everything else about this entry.
   *
   * The backend does not know what any key means, which is the point: a closed
   * set of columns is a closed set of questions. `ATTR` holds the conventional
   * spellings so two projects that mean the same thing agree.
   */
  attributes?: AttributesInput;

  /**
   * The customer's own id for this person. Lands in the `user.id` attribute.
   *
   * Only ever the string you passed. Never inferred, never derived, never
   * looked up. Optional, like the other two: an entry with no identity at all
   * is a legal entry, and on a server it is the ordinary one.
   *
   * IDENTITY IS INHERITED AS A UNIT. Stating any one of `userId`, `deviceId` or
   * `sessionId` here means this entry's identity comes from this call, and the
   * request context and the client defaults are not consulted for the other two.
   * Anything else lets a background job recorded inside a request keep the
   * requester's `user.id` while naming its own device, and the unique count
   * then quietly attributes that job to a customer.
   *
   * `null` is a statement ("nobody") and not silence, so it counts as stating
   * one. Leaving all three out is silence, and silence inherits.
   */
  userId?: string | null;

  /**
   * The machine this entry is about, when there is one and you know it. Lands
   * in `device.id`.
   *
   * A server does not have one and this client never invents one: a process is
   * not a machine and a request is not a visitor. Set it where you genuinely
   * have a machine to name, such as a worker pinned to a host, or a device id
   * your own protocol already carries.
   */
  deviceId?: string | null;

  /** Lands in the `session.id` attribute. `null` clears it, the same as `userId`. */
  sessionId?: string | null;

  /** When it happened. Defaults to now. Authoritative: the server never rebuckets. */
  timestamp?: number | Date;

  /** Per-call overrides of the resource attributes set on the client. */
  serviceVersion?: string | null;
  channel?: string | null;
  os?: string | null;
  arch?: string | null;
  locale?: string | null;

  /** Reserved by the log data model. Stored, unused by the product today. */
  traceId?: string;
  spanId?: string;
}

/** What the helpers accept beyond a name and attributes. */
export type EntryParams = Omit<LogEntryInput, "name" | "body" | "attributes" | "severity">;

export type DiagnosticLevel = "debug" | "warn" | "error";

export type DiagnosticCode =
  /** An entry was refused before it entered the queue. Caller error. */
  | "rejected"
  /** The queue was full, so the oldest entries were discarded. */
  | "dropped"
  /** A batch reached the server. */
  | "sent"
  /** A batch failed and will be retried. */
  | "retry"
  /** A batch was abandoned: rejected by the server, or out of retries. */
  | "abandoned"
  /** The breaker opened: sending has paused. */
  | "breaker_open"
  /** The breaker closed: sending has resumed. */
  | "breaker_close"
  /** `flush()` ran out of time with entries still queued. */
  | "flush_timeout"
  /**
   * An option was corrected rather than obeyed: a `maxBatch` over the server's
   * cap, or `startup` delivery coerced onto a disk queue. Worth reading once at
   * boot, because every one of them is a setting that does not do what it says.
   */
  | "config"
  /** The durable queue recovered entries from a previous run, or could not. */
  | "persistence"
  /** Something threw where nothing should. A bug in this library. */
  | "internal";

/**
 * The only way this library reports anything.
 *
 * It never writes to stdout or stderr: a library that prints into a host
 * program's logs corrupts that program's output, and an analytics client is
 * the last thing that should be allowed to do so.
 */
export interface Diagnostic {
  code: DiagnosticCode;
  level: DiagnosticLevel;
  message: string;
  detail?: Record<string, unknown>;
}

export interface Stats {
  /** Entries waiting to be sent. */
  queued: number;
  /** Entries refused before the queue: bad name, no distinct id, client closed. */
  rejected: number;
  /** Entries discarded because the queue was full or a batch was abandoned. */
  dropped: number;
  /** Entries the server accepted. */
  sent: number;
  /** HTTP attempts that failed, including ones later retried successfully. */
  failedRequests: number;
  /** Entries recovered from a durable queue written by a previous run. */
  restored: number;
  breakerOpen: boolean;
  closed: boolean;
  /** The schedule in force, after any coercion. */
  mode: DeliveryMode;
  /** The durability in force, after any coercion. */
  persistence: Persistence;
}

/** A minimal `fetch`. Narrow on purpose so a caller can pass a stub. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    keepalive?: boolean;
  }
) => Promise<{ status: number; text?: () => Promise<string> }>;

export interface FirstrunOptions {
  /** `fr_9f3a2b1c4d5e6f70`. Public by necessity; it identifies and authorises nothing. */
  sourceKey: string;
  /** Origin of the firstrun edge, e.g. `https://t.example.com`. No trailing path. */
  host: string;

  /**
   * Client-level identity, for calls and requests that state none of their own.
   *
   * NOTHING is on by default. This client generates no id of any kind: there is
   * no per-process id, no persisted file, and no fallback. A server that sets
   * none of these sends entries carrying no identity, which counts them as
   * entries and in no unique, and that is the honest answer for a backend.
   *
   * Leave them unset in a multi-tenant server: passing identity per call, or
   * per request through `runWithContext`, is the whole point. Set them only
   * where the process genuinely is the subject, such as a single-tenant worker
   * or a CLI.
   *
   * They are a unit here too. A call or a request that states any identity of
   * its own replaces all three rather than merging with them.
   */
  userId?: string;
  deviceId?: string;
  sessionId?: string;

  /** The build of your software. Sent as the `service.version` resource attribute. */
  serviceVersion?: string;
  /** The name of your service. Sent as the `service.name` resource attribute. */
  serviceName?: string;
  /** stable, beta, nightly. Sent as `firstrun.channel`. */
  channel?: string;
  /** Sent as `os.type`. */
  os?: string;
  /** Sent as `host.arch`. */
  arch?: string;
  /** BCP-47. Sent as `browser.language`, which is what the convention calls it. */
  locale?: string;

  /**
   * Extra resource attributes: anything true of this PROCESS rather than of one
   * entry. Merged under the named options above, which win on a clash.
   */
  resource?: AttributesInput;

  /**
   * Attributes stamped onto every entry this client sends.
   *
   * For what is true of every entry but is not a property of the process: a
   * tenant, a region, a deployment id. An entry's own attributes win.
   */
  defaultAttributes?: AttributesInput;

  /**
   * Marks everything this client sends as test data.
   *
   * Sent as the `firstrun.test` resource attribute, and only ever as `true`: a
   * production client omits the key rather than sending `false`. The dashboard
   * shows one world or the other, never both, so a development or CI process
   * with this set cannot move a number anybody is looking at.
   *
   * Wire it to whatever your build already knows: `NODE_ENV !== "production"`,
   * a staging flag, `process.env.CI`. There is no inference here on purpose: a
   * server has no equivalent of "running from the IDE", and a client that
   * guessed would eventually guess wrong on somebody's production box.
   */
  testMode?: boolean;

  /** When false, every call is a no-op that still returns immediately. */
  enabled?: boolean;

  /**
   * Entries below this severity are dropped before they are queued. Default 0,
   * which sends everything, including entries with no severity at all.
   *
   * Entries with no severity are never dropped by this: an unclassified entry
   * is not a quiet one, and silently discarding it would make the threshold a
   * filter on a field the caller did not set.
   */
  minSeverity?: number;

  /**
   * When entries are sent, and what survives a crash. See `DeliveryOptions`.
   *
   * Two settings rather than one, because a schedule and a durability are not
   * the same question: "send once at startup" is a schedule that never fires
   * during the run plus a queue that outlives it. Server defaults are
   * `interval` every 15s over a memory queue.
   */
  delivery?: DeliveryOptions;

  /** Entries held before the oldest are dropped. Default 10000. */
  maxQueueEntries?: number;
  /** Entries drained per flush cycle. Default 2000. */
  maxEntriesPerFlush?: number;
  /** Requests per flush cycle, so one cycle cannot run forever. Default 32. */
  maxRequestsPerFlush?: number;

  /**
   * Whole-attempt timeout: connect, send and response. Default 5000ms.
   *
   * `fetch` has no separate connect timeout without pulling in an undici
   * `Agent`, and this library has no runtime dependencies. Aborting the whole
   * attempt bounds the same failure, which is what the queue needs. Pass
   * `fetch` if you want a dispatcher with finer control.
   */
  requestTimeoutMs?: number;

  /** Retries per batch before it is abandoned. Default 5. */
  maxRetries?: number;
  /** First backoff step. Default 500ms. */
  retryBaseMs?: number;
  /** Backoff ceiling. Default 30000ms. */
  retryMaxMs?: number;

  /** Consecutive request failures that open the breaker. Default 5. */
  breakerThreshold?: number;
  /** How long the breaker stays open before one probe. Default 30000ms. */
  breakerResetMs?: number;

  /** The only reporting channel. Never called with the host's logger implied. */
  onDiagnostic?: (d: Diagnostic) => void;

  /** Overridable for tests. */
  fetch?: FetchLike;
  now?: () => number;
  uuid?: () => string;
}

/** Re-exported so a caller can name the exact map that goes on the wire. */
export type { Attributes };

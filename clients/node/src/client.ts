import { randomUUID } from "node:crypto";
import { clampInt, resolveDelivery, type ResolvedDelivery } from "./delivery.js";
import {
  DiskStore,
  MemoryStore,
  defaultDiskPath,
  groupKey,
  type EntryStore,
  type QueuedEntry,
} from "./persistence.js";
import { BoundedQueue } from "./queue.js";
import { Breaker, backoffMs } from "./retry.js";
import { registerShutdownHook } from "./shutdown.js";
import { sendBatch } from "./transport.js";
import type {
  AttributesInput,
  Diagnostic,
  DiagnosticCode,
  DiagnosticLevel,
  EntryParams,
  FetchLike,
  FirstrunOptions,
  LogEntryInput,
  Stats,
} from "./types.js";
import {
  ATTR,
  INGEST_PATH,
  MAX_ID_LEN,
  NAME,
  SEVERITY,
  SOURCE_KEY_RE,
  clampAttributes,
  clampBody,
  isLogName,
  mergeAttributes,
  severityNumber,
  type Attributes,
  type LogBatch,
  type WireEntry,
} from "./wire.js";

/**
 * A queued entry travels with the batch context it needs (`QueuedEntry`), because
 * `LogBatch` carries the distinct id and the resource attributes once per body
 * rather than per entry: two entries may only share a request if both match. A
 * server handling many people at once therefore sends one request per person
 * per flush, which is a property of the wire contract rather than a choice this
 * client makes.
 */
type Queued = QueuedEntry;

/** Undefined for anything that is not a usable string, so an omitted key is honest. */
function opt(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

/**
 * The resource attribute keys this client sets, in one fixed order.
 *
 * Fixed so `JSON.stringify` of a resource map is a stable grouping key. Two
 * bodies whose resources differ only in key order are the same body, and
 * grouping them apart would double the number of requests for nothing.
 */
const RESOURCE_KEYS = [
  ATTR.SERVICE_NAME,
  ATTR.SERVICE_VERSION,
  ATTR.CHANNEL,
  ATTR.OS_TYPE,
  ATTR.HOST_ARCH,
  ATTR.BROWSER_LANGUAGE,
] as const;

const DEFAULTS = {
  enabled: true,
  minSeverity: 0,
  maxQueueEntries: 10_000,
  maxEntriesPerFlush: 2_000,
  maxRequestsPerFlush: 32,
  requestTimeoutMs: 5_000,
  maxRetries: 5,
  retryBaseMs: 500,
  retryMaxMs: 30_000,
  breakerThreshold: 5,
  breakerResetMs: 30_000,
} as const;

/** Everything about WHEN entries go out lives in `delivery.ts`. */
const clamp = clampInt;

/** Stands in for `fetch` when there is none. Only reachable on a disabled client. */
const notConfigured: FetchLike = async () => ({ status: 0 });

/**
 * Unwraps a thrown thing into the conventional exception attributes.
 *
 * This is the single most valuable helper in the library, so it does the work
 * the caller would otherwise do at every catch site: the class name, the
 * message, the formatted stack, and the `cause` chain appended to the stack
 * rather than thrown away. A rejected promise carrying a string still produces
 * something a dashboard can group on.
 */
function exceptionAttributes(err: unknown): { body: string; attributes: Attributes } {
  if (err instanceof Error) {
    const type = opt(err.name) ?? err.constructor?.name ?? "Error";
    const message = typeof err.message === "string" ? err.message : String(err.message ?? "");
    const attributes: Attributes = {
      [ATTR.EXCEPTION_TYPE]: type,
      [ATTR.EXCEPTION_MESSAGE]: message,
    };
    const stack = stackOf(err);
    if (stack) attributes[ATTR.EXCEPTION_STACKTRACE] = stack;
    return { body: message || type, attributes };
  }

  if (typeof err === "string") {
    return { body: err, attributes: { [ATTR.EXCEPTION_MESSAGE]: err } };
  }

  let text: string;
  try {
    text = String(err);
  } catch {
    // A thrown object with a throwing `toString`. There is nothing to read, but
    // the entry itself is still worth having: something failed here.
    text = "[unprintable]";
  }
  return {
    body: text,
    attributes: { [ATTR.EXCEPTION_TYPE]: typeof err, [ATTR.EXCEPTION_MESSAGE]: text },
  };
}

/** The stack, with any `cause` chain appended. Bounded so a deep chain cannot run away. */
function stackOf(err: Error): string | undefined {
  const parts: string[] = [];
  let current: unknown = err;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const stack = typeof current.stack === "string" ? current.stack : undefined;
    parts.push(stack ?? `${current.name}: ${current.message}`);
    current = (current as { cause?: unknown }).cause;
    if (current instanceof Error) parts.push("Caused by: ");
  }
  const joined = parts.join("\n");
  return joined.length > 0 ? joined : undefined;
}

/**
 * A server-side firstrun client.
 *
 * The contract, and the reason to trust it: if firstrun is unreachable, slow or
 * broken, this object still does nothing to your program. Every recording call
 * puts an entry on a bounded in-memory queue and returns. It performs no I/O,
 * awaits nothing, and cannot throw. Everything that can fail happens on a
 * background timer that is unreferenced, time-boxed, breaker-guarded, and
 * silent.
 *
 * ## One shape for everything
 *
 * Everything this client sends is a LOG ENTRY. `log()` is the whole API and
 * takes an entry as the wire models it. `event`, `error`, `info` and the rest
 * are convenience helpers that build a CONVENTIONAL entry: examples of a good
 * shape, not a schema. Nothing they produce is privileged, and nothing you send
 * without them is second class.
 */
export class Firstrun {
  private readonly url: string;
  private readonly sourceKey: string;
  private readonly cfg: {
    minSeverity: number;
    maxQueueEntries: number;
    maxEntriesPerFlush: number;
    maxRequestsPerFlush: number;
    requestTimeoutMs: number;
    maxRetries: number;
    retryBaseMs: number;
    retryMaxMs: number;
  };
  /** When entries go out, and what outlives this process. */
  private readonly delivery: ResolvedDelivery;
  private readonly store: EntryStore;
  private readonly defaults: {
    distinctId?: string;
    userId?: string;
    serviceName?: string;
    serviceVersion?: string;
    channel?: string;
    os?: string;
    arch?: string;
    locale?: string;
  };
  private readonly baseResource: Attributes | undefined;
  private readonly defaultAttributes: Attributes | undefined;
  /** True when every entry carries `firstrun.test`. Never per-entry: a process is one or the other. */
  private readonly testMode: boolean;

  private readonly queue: BoundedQueue<Queued>;
  private readonly breaker: Breaker;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly onDiagnostic: ((d: Diagnostic) => void) | undefined;

  private timer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** The `immediate` coalescing window. One per tick, never one per entry. */
  private coalesceTimer: ReturnType<typeof setTimeout> | undefined;
  private unregisterShutdown: (() => void) | undefined;
  /** Resolves once the durable queue has been read back, so `flush()` can wait. */
  private restored: Promise<void> = Promise.resolve();

  private pumping = false;
  /** Set when the exit flush ran out of time. It does not get a second turn. */
  private exitFlushGaveUp = false;
  private attempt = 0;
  private waiters: Array<(ok: boolean) => void> = [];
  private closePromise: Promise<void> | undefined;

  private counters = { rejected: 0, sent: 0, failedRequests: 0, abandoned: 0, restored: 0 };
  private lastDropDiag = 0;
  private reportedDrops = 0;

  /** False when disabled by configuration, by a bad option, or after `close()`. */
  public enabled: boolean;
  private isClosed = false;

  constructor(options: FirstrunOptions) {
    this.now = options.now ?? Date.now;
    this.uuid = options.uuid ?? randomUUID;
    this.onDiagnostic = options.onDiagnostic;

    this.cfg = {
      minSeverity: clamp(options.minSeverity, DEFAULTS.minSeverity, 0, 24),
      maxQueueEntries: clamp(options.maxQueueEntries, DEFAULTS.maxQueueEntries, 1, 1_000_000),
      maxEntriesPerFlush: clamp(
        options.maxEntriesPerFlush,
        DEFAULTS.maxEntriesPerFlush,
        1,
        1_000_000
      ),
      maxRequestsPerFlush: clamp(
        options.maxRequestsPerFlush,
        DEFAULTS.maxRequestsPerFlush,
        1,
        4_096
      ),
      requestTimeoutMs: clamp(options.requestTimeoutMs, DEFAULTS.requestTimeoutMs, 100, 300_000),
      maxRetries: clamp(options.maxRetries, DEFAULTS.maxRetries, 0, 100),
      retryBaseMs: clamp(options.retryBaseMs, DEFAULTS.retryBaseMs, 10, 600_000),
      retryMaxMs: clamp(options.retryMaxMs, DEFAULTS.retryMaxMs, 10, 3_600_000),
    };

    // Resolved before anything else reads a schedule, and it reports through
    // the same channel as everything else: an option that was corrected rather
    // than obeyed is worth one line in the host's log at boot.
    this.delivery = resolveDelivery(
      { delivery: options.delivery, maxQueueEntries: this.cfg.maxQueueEntries },
      (message, detail) => this.diag("config", "warn", message, detail)
    );

    this.queue = new BoundedQueue<Queued>(this.cfg.maxQueueEntries);
    this.breaker = new Breaker(
      clamp(options.breakerThreshold, DEFAULTS.breakerThreshold, 1, 1_000),
      clamp(options.breakerResetMs, DEFAULTS.breakerResetMs, 100, 3_600_000)
    );

    this.sourceKey = options.sourceKey ?? "";
    this.url = String(options.host ?? "").replace(/\/+$/, "") + INGEST_PATH;
    this.defaults = {
      distinctId: opt(options.distinctId),
      userId: opt(options.userId),
      serviceName: opt(options.serviceName),
      serviceVersion: opt(options.serviceVersion),
      channel: opt(options.channel),
      os: opt(options.os),
      arch: opt(options.arch),
      locale: opt(options.locale),
    };
    this.baseResource = clampAttributes(options.resource);
    this.defaultAttributes = clampAttributes(options.defaultAttributes);
    this.testMode = options.testMode === true;

    this.store =
      this.delivery.persistence === "disk"
        ? new DiskStore({
            dir: this.delivery.diskPath ?? defaultDiskPath(this.sourceKey, this.url),
            maxEntries: this.delivery.maxDiskEntries,
            maxBytes: this.delivery.maxDiskBytes,
            report: (message, detail) => this.diag("persistence", "warn", message, detail),
          })
        : new MemoryStore();

    const globalFetch = (globalThis as { fetch?: unknown }).fetch;
    this.fetchImpl = options.fetch ?? (globalFetch as FetchLike | undefined) ?? notConfigured;

    // A misconfigured client disables itself and says so. It does not throw:
    // a typo in an environment variable must not be able to stop a host process
    // from booting, which is the same promise the recording calls make at run
    // time.
    this.enabled = options.enabled ?? DEFAULTS.enabled;
    if (this.enabled) {
      const problem = this.configProblem(options, globalFetch);
      if (problem) {
        this.enabled = false;
        this.diag("rejected", "error", problem);
      }
    }

    if (!this.enabled) return;

    this.syncTimer();

    if (this.delivery.flushOnExit) {
      this.unregisterShutdown = registerShutdownHook(() => this.flushOnExit());
    }

    if (this.store.kind === "disk") this.restored = this.restore();
  }

  /**
   * The exit flush: best effort, and bounded ONCE.
   *
   * `beforeExit` fires again every time the loop drains, and a flush that timed
   * out has itself scheduled timers, so retrying it there is a loop that holds
   * the process open for as long as the server stays slow. That is the exact
   * failure `flushOnExit` is supposed to be bounded against, so a flush that
   * gives up is not attempted again: the entries are dropped, or persisted if
   * this client has a durable queue.
   */
  private async flushOnExit(): Promise<void> {
    if (this.exitFlushGaveUp || this.isClosed) return;
    const drained = await this.flush(this.delivery.flushTimeoutMs);
    if (!drained) {
      this.exitFlushGaveUp = true;
      this.store.checkpoint(this.queue.snapshot());
    }
  }

  /**
   * Reads back whatever the last run left behind, then sends it if the schedule
   * says to.
   *
   * Asynchronous on purpose: a constructor that awaited a filesystem would put
   * firstrun on the host's boot path, and `startup` mode is not worth that. The
   * entries go in front of anything recorded in the meantime, because they are
   * older and the queue is a FIFO.
   */
  private async restore(): Promise<void> {
    try {
      const { entries, dropped } = await this.store.load();
      if (this.isClosed) return;
      if (dropped > 0) {
        this.diag("dropped", "warn", `discarded ${dropped} persisted entries over the bound`, {
          entries: dropped,
        });
      }
      if (entries.length === 0) return;

      this.queue.unshift(entries);
      this.counters.restored += entries.length;
      this.diag("persistence", "debug", `recovered ${entries.length} entries from disk`, {
        entries: entries.length,
      });
      // Written straight back out under this run's own segment, so a second
      // crash does not lose what the first one preserved.
      this.store.checkpoint(this.queue.snapshot());

      switch (this.delivery.mode) {
        case "startup":
          // The one burst this mode exists for.
          void this.pump();
          return;
        case "immediate":
          this.scheduleCoalesced();
          return;
        case "interval":
          if (this.queue.size >= this.delivery.flushAt) void this.pump();
          return;
        case "manual":
          // The caller decides. Recovered entries wait for `flush()` like any
          // other, which is what "only when flush() is called" has to mean.
          return;
      }
    } catch (err) {
      this.internal("restore", err);
    }
  }

  /**
   * Starts or stops the interval timer to match the current state.
   *
   * The breaker is part of that state: a timer that keeps firing into an open
   * breaker is the busy loop against a dead server that the breaker exists to
   * prevent, so the schedule stops entirely while it is open and the half-open
   * probe is left to the backoff timer. `interval` is the only mode with a
   * timer at all.
   */
  private syncTimer(): void {
    const wanted =
      this.enabled &&
      !this.isClosed &&
      this.delivery.mode === "interval" &&
      !this.breaker.isOpen;

    if (wanted && this.timer === undefined) {
      this.timer = setInterval(() => void this.pump(), this.delivery.every);
      // Unreferenced so a queued entry can never be the reason a process refuses
      // to exit. Shutdown flushing is the shutdown hook's job, not the timer's.
      this.timer.unref?.();
    } else if (!wanted && this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * The `immediate` coalescing window.
   *
   * `immediate` means "do not wait for a timer", not "one request per entry".
   * A 0ms timer collects everything produced in this turn of the event loop
   * (and the microtasks it schedules) into one drain, so a loop calling
   * `event()` a thousand times produces a handful of requests. A microtask
   * would fire between two awaits in an async caller and split the batch.
   */
  private scheduleCoalesced(): void {
    if (this.coalesceTimer !== undefined || this.pumping) return;
    this.coalesceTimer = setTimeout(() => {
      this.coalesceTimer = undefined;
      void this.pump();
    }, this.delivery.coalesceMs);
    this.coalesceTimer.unref?.();
  }

  private configProblem(options: FirstrunOptions, globalFetch: unknown): string | null {
    if (!SOURCE_KEY_RE.test(this.sourceKey)) {
      return "disabled: sourceKey is not a firstrun source key (fr_<16 hex>)";
    }
    if (!/^https?:\/\/[^/]+$/i.test(String(options.host ?? "").replace(/\/+$/, ""))) {
      return "disabled: host must be an http(s) origin with no path, e.g. https://t.example.com";
    }
    if (!options.fetch && typeof globalFetch !== "function") {
      return "disabled: no global fetch; use Node 18+ or pass options.fetch";
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // The raw call
  // -------------------------------------------------------------------------

  /**
   * Records one log entry, exactly as you describe it. Returns immediately,
   * does no I/O, and never throws.
   *
   * This is the whole API. Everything else on this class builds one of these
   * and calls it. Use it whenever the conventional helpers do not say what you
   * mean: they are examples of a good shape, not a schema you have to fit.
   *
   * ```ts
   * client.log({
   *   name: "job.finished",
   *   severity: "info",
   *   body: "nightly reindex finished",
   *   attributes: { "firstrun.duration_ms": 41_220, rows: 18_400, dry_run: false },
   *   distinctId: tenantId,
   * });
   * ```
   */
  log(entry: LogEntryInput): void {
    try {
      this.enqueue(entry);
    } catch (err) {
      this.internal("log", err);
    }
  }

  // -------------------------------------------------------------------------
  // Conventional helpers
  // -------------------------------------------------------------------------

  /**
   * Something happened that is worth counting: a product event.
   *
   * A conventional entry at INFO whose `name` is the thing that happened. There
   * is no allowlist and no privileged name: `event("download_clicked")` and
   * `event("exported_csv")` are the same kind of thing, and the second one is
   * as much a first-class citizen as the first.
   */
  event(name: string, attributes?: AttributesInput, params: EntryParams = {}): void {
    this.log({ ...params, name, severity: SEVERITY.INFO, attributes });
  }

  /**
   * Something threw. The exception is unwrapped for you.
   *
   * A conventional entry named `exception` at ERROR, carrying `exception.type`,
   * `exception.message` and `exception.stacktrace` taken off the error itself,
   * with any `cause` chain appended to the stack. There is no error table and
   * no error pipeline behind this: it is a log entry like every other one, and
   * it is only an error because of its severity and its attributes.
   *
   * Accepts a string as well as an `Error`, because a catch block does not
   * always get one.
   */
  error(err: unknown, attributes?: AttributesInput, params: EntryParams = {}): void {
    // Unwrapping reads `name`, `message` and `stack` off the thrown thing, any of
    // which can be a getter that throws. `log()` guards itself, but this runs
    // before it, so a hostile error object would otherwise escape into the host.
    let unwrapped: { body: string; attributes: Attributes };
    try {
      unwrapped = exceptionAttributes(err);
    } catch (inner) {
      this.internal("error", inner);
      unwrapped = { body: "", attributes: {} };
    }
    this.log({
      ...params,
      name: NAME.EXCEPTION,
      severity: SEVERITY.ERROR,
      body: unwrapped.body,
      attributes: mergeAttributes(unwrapped.attributes, clampAttributes(attributes)),
    });
  }

  /** A line at TRACE. Named `log`, because `name` is what a board groups on. */
  trace(body: string, attributes?: AttributesInput, params: EntryParams = {}): void {
    this.line(SEVERITY.TRACE, body, attributes, params);
  }

  /** A line at DEBUG. */
  debug(body: string, attributes?: AttributesInput, params: EntryParams = {}): void {
    this.line(SEVERITY.DEBUG, body, attributes, params);
  }

  /** A line at INFO. */
  info(body: string, attributes?: AttributesInput, params: EntryParams = {}): void {
    this.line(SEVERITY.INFO, body, attributes, params);
  }

  /** A line at WARN. */
  warn(body: string, attributes?: AttributesInput, params: EntryParams = {}): void {
    this.line(SEVERITY.WARN, body, attributes, params);
  }

  /**
   * A line at ERROR with no exception to unwrap.
   *
   * `error()` is taken by the helper that unwraps a thrown thing, which is the
   * one worth the shorter name. This is for the case where you have a sentence
   * and no `Error`.
   */
  errorLog(body: string, attributes?: AttributesInput, params: EntryParams = {}): void {
    this.line(SEVERITY.ERROR, body, attributes, params);
  }

  /** A line at FATAL. */
  fatal(body: string, attributes?: AttributesInput, params: EntryParams = {}): void {
    this.line(SEVERITY.FATAL, body, attributes, params);
  }

  private line(
    severity: number,
    body: string,
    attributes: AttributesInput | undefined,
    params: EntryParams
  ): void {
    this.log({ ...params, name: NAME.LOG, severity, body, attributes });
  }

  /**
   * Attaches the customer's own id to this client's anonymous id.
   *
   * Both are explicit because a server process is not a person: it handles many
   * at once, and any remembered "current user" would be whoever was served
   * last. Nothing is merged and nothing is back-filled; from here on, entries
   * carrying this `userId` count as the same unique.
   */
  identify(distinctId: string, userId: string, params: EntryParams = {}): void {
    this.log({ ...params, name: NAME.IDENTIFY, severity: SEVERITY.INFO, distinctId, userId });
  }

  /**
   * A server-rendered page view.
   *
   * The path travels as the conventional `url.path` attribute. There is no url
   * column: everything that is not one of the five promoted columns lives in
   * attributes and is queried from there.
   */
  page(path?: string, attributes?: AttributesInput, params: EntryParams = {}): void {
    const attrs: AttributesInput = { ...attributes };
    if (typeof path === "string" && path.length > 0) attrs[ATTR.URL_PATH] = path;
    this.event(NAME.PAGE_VIEW, attrs, params);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Sends what is queued. Resolves true if the queue drained, false if it ran
   * out of time or the breaker is holding sends back. Never rejects.
   *
   * Awaiting this is optional everywhere. It exists for shutdown and for tests.
   */
  async flush(timeoutMs: number = this.delivery.flushTimeoutMs): Promise<boolean> {
    // A flush during startup recovery would otherwise report "drained" over a
    // queue the disk has not been read into yet.
    await this.restored.catch(() => undefined);
    if (!this.enabled && this.queue.size === 0) return true;
    // An explicit flush means "try now", so it clears a pending backoff. It
    // does not clear the breaker: if the server is down, waiting out the flush
    // timeout would only delay a shutdown that is already going to lose entries.
    this.clearRetry();
    void this.pump();
    return this.waitDrain(timeoutMs);
  }

  /**
   * Stops the client: one last flush, then every timer and hook released.
   *
   * Idempotent. Calling it twice returns the same promise, and calling it never
   * rejects. After it resolves nothing of this client is left running.
   */
  close(timeoutMs: number = this.delivery.flushTimeoutMs): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      // Set first, so nothing new is queued behind the final flush.
      this.isClosed = true;
      try {
        // `manual` and `startup` do not send on their own, and close is not a
        // send instruction: with a durable queue the honest thing is to write
        // what is left down and let the next run take it.
        if (this.delivery.flushOnExit || this.store.kind === "memory") {
          await this.flush(timeoutMs);
        }
      } catch (err) {
        this.internal("close", err);
      }
      if (this.timer !== undefined) clearInterval(this.timer);
      this.timer = undefined;
      this.clearRetry();
      if (this.coalesceTimer !== undefined) clearTimeout(this.coalesceTimer);
      this.coalesceTimer = undefined;
      this.unregisterShutdown?.();
      this.unregisterShutdown = undefined;
      this.enabled = false;

      const left = this.queue.snapshot();
      try {
        await this.store.close(left);
      } catch (err) {
        this.internal("close", err);
      }
      const remaining = this.queue.clear();
      if (remaining > 0) {
        if (this.store.kind === "disk") {
          // Not dropped: persisted. The next run drains them.
          this.diag("persistence", "debug", `left ${remaining} entries on disk for next run`, {
            entries: remaining,
          });
        } else {
          this.counters.abandoned += remaining;
          this.diag("dropped", "warn", `discarded ${remaining} unsent entries on close`, {
            entries: remaining,
          });
        }
      }
      this.settleWaiters();
    })();
    return this.closePromise;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  stats(): Stats {
    return {
      queued: this.queue.size,
      rejected: this.counters.rejected,
      dropped: this.queue.dropped + this.counters.abandoned,
      sent: this.counters.sent,
      failedRequests: this.counters.failedRequests,
      restored: this.counters.restored,
      breakerOpen: this.breaker.isOpen,
      closed: this.isClosed,
      mode: this.delivery.mode,
      persistence: this.store.kind,
    };
  }

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  private enqueue(entry: LogEntryInput): void {
    if (!this.enabled) {
      if (this.isClosed) {
        this.counters.rejected++;
        this.diag("rejected", "warn", "client is closed", { name: entry?.name });
      }
      return;
    }

    if (!entry || typeof entry !== "object") {
      this.counters.rejected++;
      this.diag("rejected", "warn", "log() takes an entry object");
      return;
    }

    const name = entry.name;
    if (!isLogName(name)) {
      this.counters.rejected++;
      this.diag("rejected", "warn", `invalid entry name: ${JSON.stringify(name)}`, { name });
      return;
    }

    const severity = this.resolveSeverity(entry.severity);
    // A threshold filters entries the caller CLASSIFIED. One with no severity
    // is unclassified rather than quiet, so it is never dropped here.
    if (severity !== undefined && severity < this.cfg.minSeverity) return;

    const distinctId = opt(entry.distinctId) ?? this.defaults.distinctId;
    if (!distinctId) {
      this.counters.rejected++;
      this.diag(
        "rejected",
        "error",
        `no distinctId for ${name}: pass one per call, or set options.distinctId`,
        { name }
      );
      return;
    }

    const userId = opt(entry.userId) ?? this.defaults.userId;
    const sessionId = opt(entry.sessionId);

    // Over-length ids are refused rather than truncated. Truncating two ids to
    // the same 512 characters would merge two people into one unique, and that
    // is a wrong number nobody would ever find.
    const tooLong = [distinctId, userId, sessionId].find(
      (v) => typeof v === "string" && v.length > MAX_ID_LEN
    );
    if (tooLong !== undefined) {
      this.counters.rejected++;
      this.diag("rejected", "warn", `identifier longer than ${MAX_ID_LEN} characters`, { name });
      return;
    }

    // Identity attributes sit UNDER the caller's own, so an entry that names
    // `user.id` explicitly wins over the client-level default. Anything else
    // would make a per-call override silently ineffective.
    const identity: Attributes = {};
    if (userId) identity[ATTR.USER_ID] = userId;
    if (sessionId) identity[ATTR.SESSION_ID] = sessionId;

    const attributes = mergeAttributes(
      mergeAttributes(this.defaultAttributes, Object.keys(identity).length ? identity : undefined),
      clampAttributes(entry.attributes)
    );

    const at = entry.timestamp;
    const happenedAt = at instanceof Date ? at.getTime() : typeof at === "number" ? at : this.now();

    // `body`, `trace_id` and `span_id` are attributes, not fields: this product
    // promotes five columns and no more, and the spec's vocabulary is not ours
    // to promote. The dedicated input field wins over a same-named attribute,
    // because naming it explicitly is the more specific statement.
    const spec: Attributes = {};
    const body = clampBody(entry.body);
    if (body !== undefined) spec[ATTR.BODY] = body;
    const traceId = opt(entry.traceId);
    if (traceId) spec[ATTR.TRACE_ID] = traceId;
    const spanId = opt(entry.spanId);
    if (spanId) spec[ATTR.SPAN_ID] = spanId;

    const finalAttributes = mergeAttributes(
      attributes,
      Object.keys(spec).length ? spec : undefined
    );

    const wire: WireEntry = {
      // Generated here, so a request that times out and is retried is deduped
      // by the server rather than counted twice.
      i: this.uuid(),
      // Client-stamped and authoritative: an entry queued during an outage and
      // delivered an hour later is still counted at the moment it happened.
      t: Math.max(0, Math.round(Number.isFinite(happenedAt) ? happenedAt : this.now())),
      n: name,
    };
    if (severity !== undefined) wire.s = severity;
    if (finalAttributes) wire.a = finalAttributes;

    const resource = this.resourceFor(entry);

    const item: Queued = { group: groupKey(distinctId, resource), distinctId, resource, wire };
    const before = this.queue.dropped;
    this.queue.push(item);
    if (this.queue.dropped > before) this.reportDrops();

    // Buffered and written on a timer, never inline: a durable queue does not
    // get to put a filesystem call in the caller's path either.
    this.store.record([item]);

    this.schedule(severity);
  }

  /**
   * Decides whether this entry starts a send, and how soon.
   *
   * The severity check comes first and overrides every schedule. That is what
   * `flushOnSeverity` is for: a crash report that waits for the next tick is a
   * crash report that usually never arrives, because by then the process is
   * gone. It costs nothing at rest, because most runs log no errors at all.
   *
   * An error storm does not become a request storm. `pump()` admits one sender
   * at a time and that sender drains until the queue is empty, so a thousand
   * errors in one tick still leave as a handful of batches.
   */
  private schedule(severity: number | undefined): void {
    const threshold = this.delivery.flushOnSeverity;
    if (threshold !== null && severity !== undefined && severity >= threshold) {
      // Synchronous up to the first await, so the request leaves in this turn
      // of the loop rather than in one the process may not live to see.
      void this.pump();
      return;
    }

    switch (this.delivery.mode) {
      case "immediate":
        this.scheduleCoalesced();
        return;
      case "interval":
        // "Every `every`, or when `maxBatch` is queued, whichever comes first."
        if (this.queue.size >= this.delivery.flushAt) void this.pump();
        return;
      case "startup":
      case "manual":
        // Neither sends during the run: `startup` accumulates for the next
        // launch, `manual` waits to be asked.
        return;
    }
  }

  /** A number, or undefined when the caller said nothing we could read. */
  private resolveSeverity(input: LogEntryInput["severity"]): number | undefined {
    if (typeof input === "number") {
      if (!Number.isFinite(input)) return undefined;
      return Math.min(24, Math.max(1, Math.round(input)));
    }
    if (typeof input === "string") {
      const n = severityNumber(input);
      return n === null ? undefined : n;
    }
    return undefined;
  }

  /**
   * The resource attributes for one entry: what is true of the process.
   *
   * Built with the keys in a fixed order so the serialised form is a stable
   * grouping key, and returned undefined when there is nothing to say, so an
   * empty object never splits a batch in two.
   */
  private resourceFor(entry: LogEntryInput): Attributes | undefined {
    const values: Record<string, string | undefined> = {
      [ATTR.SERVICE_NAME]: this.defaults.serviceName,
      [ATTR.SERVICE_VERSION]: opt(entry.serviceVersion) ?? this.defaults.serviceVersion,
      [ATTR.CHANNEL]: opt(entry.channel) ?? this.defaults.channel,
      [ATTR.OS_TYPE]: opt(entry.os) ?? this.defaults.os,
      [ATTR.HOST_ARCH]: opt(entry.arch) ?? this.defaults.arch,
      [ATTR.BROWSER_LANGUAGE]: opt(entry.locale) ?? this.defaults.locale,
    };

    let out: Attributes | undefined;
    if (this.baseResource) {
      out = {};
      for (const key of Object.keys(this.baseResource).sort()) out[key] = this.baseResource[key]!;
    }
    for (const key of RESOURCE_KEYS) {
      const value = values[key];
      if (value === undefined) continue;
      (out ??= {})[key] = value;
    }
    // Last, and outside the loop above, because that map is string-typed and
    // this one value must reach the wire as a JSON boolean. Last is also a
    // fixed position, so the serialised resource stays a stable grouping key.
    if (this.testMode) (out ??= {})[ATTR.TEST] = true;
    return out;
  }

  /** Drop reports are rate limited: an overflowing queue must not flood a log. */
  private reportDrops(): void {
    const now = this.now();
    if (now - this.lastDropDiag < 1_000) return;
    this.lastDropDiag = now;
    const total = this.queue.dropped;
    const since = total - this.reportedDrops;
    this.reportedDrops = total;
    this.diag("dropped", "warn", `queue full: dropped ${since} of the oldest entries`, {
      since,
      total,
      capacity: this.cfg.maxQueueEntries,
    });
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /** One sender at a time. The flag is the whole concurrency model. */
  private async pump(): Promise<void> {
    if (this.pumping) return;

    // Asked to send while the breaker is open. Do not attempt on schedule
    // regardless of outcome: back off once and leave the existing backoff
    // alone, so a timer and a severity flush arriving together cannot keep
    // resetting the cooldown of a server that is already down.
    const wait = this.breaker.retryAfter(this.now());
    if (wait > 0) {
      if (this.retryTimer === undefined) this.scheduleRetry(wait);
      return;
    }

    this.pumping = true;
    try {
      await this.drain();
    } catch (err) {
      this.internal("pump", err);
    } finally {
      this.pumping = false;
      // What is left is what the next run would have to send, so this is both
      // the durability checkpoint and the moment the log can be compacted.
      try {
        this.store.checkpoint(this.queue.snapshot());
      } catch (err) {
        this.internal("checkpoint", err);
      }
      this.syncTimer();
      this.settleWaiters();
    }
  }

  private async drain(): Promise<void> {
    let requests = 0;

    while (this.queue.size > 0) {
      if (requests >= this.cfg.maxRequestsPerFlush) {
        // Yield rather than run forever, so a large backlog cannot monopolise
        // the event loop of the program we are a guest in.
        this.scheduleRetry(0);
        return;
      }

      const now = this.now();
      if (!this.breaker.allow(now)) {
        this.scheduleRetry(Math.max(1, this.breaker.retryAfter(now)));
        return;
      }

      const slice = this.queue.take(this.cfg.maxEntriesPerFlush);
      const batches = this.groupIntoBatches(slice);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]!;
        requests++;
        const outcome = await sendBatch(
          { fetch: this.fetchImpl, url: this.url, timeoutMs: this.cfg.requestTimeoutMs },
          batch.body
        );

        if (outcome.kind === "ok") {
          this.counters.sent += batch.body.e.length;
          this.attempt = 0;
          if (this.breaker.onSuccess()) {
            this.diag("breaker_close", "debug", "server is answering again; sending resumed");
          }
          continue;
        }

        this.counters.failedRequests++;

        if (outcome.kind === "permanent") {
          // The server understood us and said no. It will say no again.
          this.counters.abandoned += batch.body.e.length;
          this.diag("abandoned", "error", `server rejected a batch (${outcome.reason})`, {
            reason: outcome.reason,
            entries: batch.body.e.length,
          });
          if (this.breaker.onSuccess()) {
            this.diag("breaker_close", "debug", "server is answering again; sending resumed");
          }
          continue;
        }

        if (this.breaker.onFailure(this.now())) {
          this.diag("breaker_open", "warn", "sending paused after repeated failures", {
            reason: outcome.reason,
          });
        }

        const pending = batches.slice(i).flatMap((b) => b.items);

        if (this.attempt >= this.cfg.maxRetries) {
          this.counters.abandoned += pending.length;
          this.attempt = 0;
          this.diag("abandoned", "error", `gave up on ${pending.length} entries`, {
            reason: outcome.reason,
            entries: pending.length,
            attempts: this.cfg.maxRetries,
          });
          return;
        }

        // Back at the front, so the oldest entries are still the first to go.
        this.queue.unshift(pending);
        const delay = backoffMs(this.attempt, this.cfg.retryBaseMs, this.cfg.retryMaxMs);
        this.attempt++;
        this.diag("retry", "debug", `retrying ${pending.length} entries in ${delay}ms`, {
          reason: outcome.reason,
          delayMs: delay,
          attempt: this.attempt,
        });
        this.scheduleRetry(delay);
        return;
      }
    }
  }

  /**
   * Splits a slice into request bodies, one per identity-and-resource pair,
   * each no larger than the server accepts.
   */
  private groupIntoBatches(slice: Queued[]): Array<{ body: LogBatch; items: Queued[] }> {
    const byGroup = new Map<string, Queued[]>();
    for (const item of slice) {
      const bucket = byGroup.get(item.group);
      if (bucket) bucket.push(item);
      else byGroup.set(item.group, [item]);
    }

    const out: Array<{ body: LogBatch; items: Queued[] }> = [];
    for (const items of byGroup.values()) {
      for (let i = 0; i < items.length; i += this.delivery.maxBatch) {
        const chunk = items.slice(i, i + this.delivery.maxBatch);
        const head = chunk[0]!;
        const body: LogBatch = {
          k: this.sourceKey,
          d: head.distinctId,
          e: chunk.map((c) => c.wire),
        };
        if (head.resource) body.r = head.resource;
        out.push({ body, items: chunk });
      }
    }
    return out;
  }

  private scheduleRetry(delayMs: number): void {
    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.pump();
    }, delayMs);
    this.refTimers();
  }

  /**
   * Background work is unreferenced; work somebody is waiting on is not.
   *
   * A pending promise does not keep Node alive. With every timer unreferenced,
   * `await client.close()` as the last statement of a program would lose the
   * race against process exit and the final flush would never happen. While a
   * caller is explicitly waiting we hold the loop open, bounded by their own
   * timeout; the rest of the time a queued entry can never delay an exit.
   */
  private refTimers(): void {
    if (this.waiters.length > 0) this.retryTimer?.ref?.();
    else this.retryTimer?.unref?.();
  }

  private clearRetry(): void {
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  // -------------------------------------------------------------------------
  // Waiting
  // -------------------------------------------------------------------------

  private settleWaiters(): void {
    if (this.pumping || this.queue.size > 0) return;
    const waiting = this.waiters;
    this.waiters = [];
    for (const w of waiting) w(true);
    this.refTimers();
  }

  private waitDrain(timeoutMs: number): Promise<boolean> {
    if (!this.pumping && this.queue.size === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Taken off the list even when it was the timeout that settled it. A
        // waiter left behind after a flush gives up keeps `refTimers` holding
        // the retry timer referenced, and the process would never exit.
        const at = this.waiters.indexOf(finish);
        if (at >= 0) this.waiters.splice(at, 1);
        this.refTimers();
        resolve(ok);
      };
      // Deliberately referenced: see `refTimers`. The caller asked to wait, so
      // the process stays alive for at most their timeout.
      const timer = setTimeout(() => {
        this.diag(
          "flush_timeout",
          "warn",
          `flush timed out with ${this.queue.size} entries queued`,
          { queued: this.queue.size }
        );
        finish(false);
      }, timeoutMs);
      this.waiters.push(finish);
      this.refTimers();
    });
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  private diag(
    code: DiagnosticCode,
    level: DiagnosticLevel,
    message: string,
    detail?: Record<string, unknown>
  ): void {
    if (!this.onDiagnostic) return;
    try {
      this.onDiagnostic(detail ? { code, level, message, detail } : { code, level, message });
    } catch {
      // A throwing hook is the host's bug, and it is still not allowed to
      // become ours. There is nowhere left to report it that we are permitted
      // to write to, so it stops here.
    }
  }

  private internal(where: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.diag("internal", "error", `firstrun internal error in ${where}: ${message}`, { where });
  }
}

/**
 * The delivery policy: WHEN what has been collected is sent, and WHAT survives
 * the process that collected it.
 *
 * Source of truth: `docs/delivery-policy.md`. The two things it insists on, and
 * the reason this is a file of its own rather than five more flat options:
 *
 * 1. **Schedule and durability are orthogonal.** Schedule decides when a send is
 *    attempted. Durability decides what is still there after a crash or a kill.
 *    "Send once at startup" is not a schedule on its own: it is a schedule that
 *    never fires during the run, plus a queue that survives to the next one.
 *    Modelled as one setting, that combination cannot be expressed at all.
 * 2. **`startup` with `memory` is incoherent.** Nothing survives the run, so
 *    nothing is ever sent. It is coerced to `disk` here, loudly, because
 *    silently sending nothing is the worst of the three available behaviours.
 *
 * Nothing in this file throws. A client that cannot be configured disables
 * itself and says so through `onDiagnostic`; a client that was configured
 * strangely is corrected and told. A typo in an environment variable is not
 * allowed to stop a host process from booting.
 */

import { MAX_ENTRIES_PER_BATCH, SEVERITY, severityNumber, type SeverityBand } from "./wire.js";

/**
 * When a send is attempted.
 *
 * `immediate` means "do not wait for a timer". It does NOT mean one request per
 * entry: entries produced in the same tick coalesce into one batch, because a
 * loop calling `event()` a thousand times must produce a handful of requests
 * rather than a thousand. Reading "live" as "synchronous" would break the rule
 * that firstrun is never in the caller's critical path.
 */
export type DeliveryMode =
  /** Send as soon as a batch can be formed. Coalesced per tick, never per entry. */
  | "immediate"
  /** Every `every`, or when `maxBatch` is queued, whichever comes first. */
  | "interval"
  /** Drain whatever survived the last run at init, then never during this run. */
  | "startup"
  /** Only when `flush()` is called. */
  | "manual";

/** What is still there after a crash or a kill. */
export type Persistence = "memory" | "disk";

/**
 * A severity threshold, a name for one, or `false` to switch the behaviour off.
 *
 * `false` exists for a test that wants a strictly manual client. It is not a
 * sensible production setting: see `flushOnSeverity` below.
 */
export type FlushOnSeverity = number | SeverityBand | string | false | null;

export interface DeliveryOptions {
  /** Default `interval`. See `DeliveryMode`. */
  mode?: DeliveryMode;

  /** Interval period in ms. Default 15000. Only read in `interval` mode. */
  every?: number;

  /**
   * Entries per HTTP request. Default 250, hard-capped at the server's 500.
   *
   * The cap is `MAX_ENTRIES_PER_BATCH`, read out of the wire contract rather
   * than guessed. Exceeding it means every request is rejected, the queue never
   * drains, and the whole thing presents as total silence.
   */
  maxBatch?: number;

  /**
   * Queue depth that sends without waiting for the timer. Defaults to
   * `maxBatch`, which is what "whichever comes first" means.
   *
   * Only read in `interval` mode: `immediate` already sends on the next tick,
   * and `startup` and `manual` are not supposed to send on their own at all.
   */
  flushAt?: number;

  /**
   * How long `immediate` waits to coalesce. Default 0, which is "the end of
   * this turn of the event loop", not "one request per entry".
   *
   * A 0ms timer, rather than a microtask, so an async caller awaiting between
   * two `event()` calls still gets one request rather than two.
   */
  coalesceMs?: number;

  /** Default `memory`. See the README for why disk is usually wrong on a server. */
  persistence?: Persistence;

  /** Directory for the durable queue. Defaults under the OS temp directory. */
  diskPath?: string;

  /** Entries kept on disk. Defaults to `maxQueueEntries`. */
  maxDiskEntries?: number;

  /** Bytes the durable queue may occupy before it starts dropping. Default 8MB. */
  maxDiskBytes?: number;

  /**
   * Entries at or above this severity are sent at once, whatever the schedule
   * says. Default ERROR (17).
   *
   * This is most of the value of having a policy at all. A crash report that
   * waits for the next tick is a crash report that usually never arrives,
   * because by then the process is gone. It costs nothing at rest: most runs
   * log no errors, so nothing is sent off-schedule.
   */
  flushOnSeverity?: FlushOnSeverity;

  /**
   * Best-effort flush on `beforeExit`, `SIGTERM` and `SIGINT`. Default true,
   * except in `startup` mode, whose whole point is one burst per launch.
   *
   * Always TIME-BOUNDED by `flushTimeoutMs`: a slow network must not be able to
   * hold a process open.
   */
  flushOnExit?: boolean;

  /** Budget for `flush()` and for the exit flush. Default 2000ms. */
  flushTimeoutMs?: number;
}

export interface ResolvedDelivery {
  mode: DeliveryMode;
  every: number;
  maxBatch: number;
  flushAt: number;
  coalesceMs: number;
  persistence: Persistence;
  diskPath: string | undefined;
  maxDiskEntries: number;
  maxDiskBytes: number;
  /** A number, or null when the caller switched the behaviour off. */
  flushOnSeverity: number | null;
  flushOnExit: boolean;
  flushTimeoutMs: number;
}

export const DELIVERY_DEFAULTS = {
  mode: "interval",
  every: 15_000,
  maxBatch: 250,
  coalesceMs: 0,
  persistence: "memory",
  flushOnSeverity: SEVERITY.ERROR,
  flushOnExit: true,
  flushTimeoutMs: 2_000,
  maxDiskBytes: 8 * 1024 * 1024,
} as const;

const MODES: DeliveryMode[] = ["immediate", "interval", "startup", "manual"];
const PERSISTENCES: Persistence[] = ["memory", "disk"];

/** Bounds a numeric option. A value we cannot read becomes the default. */
export function clampInt(
  v: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

/** What `resolveDelivery` needs from the wider options object. */
export interface DeliveryInput {
  delivery?: DeliveryOptions;
  maxQueueEntries: number;
}

type Report = (message: string, detail?: Record<string, unknown>) => void;

/**
 * Turns whatever the caller passed into a policy this client can act on.
 *
 * Never throws, never returns a combination that sends nothing by accident.
 */
export function resolveDelivery(input: DeliveryInput, report: Report): ResolvedDelivery {
  const d = input.delivery ?? {};

  let mode = DELIVERY_DEFAULTS.mode as DeliveryMode;
  if (d.mode !== undefined) {
    if (MODES.includes(d.mode)) mode = d.mode;
    else report(`unknown delivery mode ${JSON.stringify(d.mode)}; using "interval"`);
  }

  let persistence = DELIVERY_DEFAULTS.persistence as Persistence;
  if (d.persistence !== undefined) {
    if (PERSISTENCES.includes(d.persistence)) persistence = d.persistence;
    else report(`unknown persistence ${JSON.stringify(d.persistence)}; using "memory"`);
  }

  // The one combination that means "collect telemetry and never send it".
  // Coerced rather than refused, because refusing a client outright would also
  // send nothing, and at least this way the caller gets what they asked for.
  if (mode === "startup" && persistence === "memory") {
    persistence = "disk";
    report(
      'delivery mode "startup" needs "disk" persistence: nothing survives a memory queue, ' +
        "so nothing would ever be sent. Using disk. Set persistence explicitly to silence this."
    );
  }

  const requestedBatch = d.maxBatch;
  const maxBatch = clampInt(requestedBatch, DELIVERY_DEFAULTS.maxBatch, 1, MAX_ENTRIES_PER_BATCH);
  if (typeof requestedBatch === "number" && requestedBatch > MAX_ENTRIES_PER_BATCH) {
    // Left unclamped this is total silence, not a slow drain: the edge rejects
    // an oversized body whole, so every request fails and the queue never moves.
    report(
      `maxBatch ${requestedBatch} exceeds the server's per-request cap of ` +
        `${MAX_ENTRIES_PER_BATCH}; using ${maxBatch}`,
      { requested: requestedBatch, cap: MAX_ENTRIES_PER_BATCH }
    );
  }

  const every = clampInt(d.every, DELIVERY_DEFAULTS.every, 50, 3_600_000);
  const flushAt = clampInt(d.flushAt, maxBatch, 1, 1_000_000);
  const coalesceMs = clampInt(d.coalesceMs, DELIVERY_DEFAULTS.coalesceMs, 0, 60_000);
  const maxDiskEntries = clampInt(d.maxDiskEntries, input.maxQueueEntries, 1, 1_000_000);
  const maxDiskBytes = clampInt(
    d.maxDiskBytes,
    DELIVERY_DEFAULTS.maxDiskBytes,
    64 * 1024,
    1024 * 1024 * 1024
  );

  const flushTimeoutMs = clampInt(
    d.flushTimeoutMs,
    DELIVERY_DEFAULTS.flushTimeoutMs,
    1,
    600_000
  );

  // `startup` accumulates for the NEXT launch, so flushing at exit would give
  // two bursts per run instead of the one the mode exists to produce. Nothing
  // is lost by not sending: the queue is on disk, which is why this mode
  // requires it.
  const exitDefault = mode === "startup" ? false : DELIVERY_DEFAULTS.flushOnExit;
  const flushOnExit = d.flushOnExit ?? exitDefault;

  return {
    mode,
    every,
    maxBatch,
    flushAt,
    coalesceMs,
    persistence,
    diskPath: typeof d.diskPath === "string" && d.diskPath.length > 0 ? d.diskPath : undefined,
    maxDiskEntries,
    maxDiskBytes,
    flushOnSeverity: resolveFlushOnSeverity(d.flushOnSeverity, report),
    flushOnExit,
    flushTimeoutMs,
  };
}

/**
 * A threshold as a number, or null when the caller switched it off.
 *
 * An unreadable value falls back to the default rather than to "off": losing
 * the crash-report guarantee to a typo is the expensive failure here.
 */
function resolveFlushOnSeverity(v: FlushOnSeverity | undefined, report: Report): number | null {
  if (v === undefined) return DELIVERY_DEFAULTS.flushOnSeverity;
  if (v === false || v === null) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      report(`flushOnSeverity ${String(v)} is not a severity; using ERROR`);
      return DELIVERY_DEFAULTS.flushOnSeverity;
    }
    return Math.min(24, Math.max(1, Math.round(v)));
  }
  if (typeof v === "string") {
    const n = severityNumber(v);
    if (n !== null) return n;
    report(`flushOnSeverity ${JSON.stringify(v)} is not a severity name; using ERROR`);
    return DELIVERY_DEFAULTS.flushOnSeverity;
  }
  report("flushOnSeverity must be a severity, a severity name, or false; using ERROR");
  return DELIVERY_DEFAULTS.flushOnSeverity;
}

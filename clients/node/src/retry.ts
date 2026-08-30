/**
 * Backoff and the circuit breaker: the two things that stop a dead server from
 * turning into a busy loop against a dead server.
 */

/**
 * Capped exponential backoff with full jitter.
 *
 * Full jitter, not a fixed ladder, because every process in a fleet notices the
 * same outage at the same moment and would otherwise retry in lockstep and
 * arrive as one spike on a server that is already struggling.
 */
export function backoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(random() * ceiling);
}

/**
 * Consecutive failures open it; it half-opens after a cooldown and lets exactly
 * one request through to find out whether the server is back.
 *
 * Without this, a queue that keeps filling keeps generating requests to a host
 * that is down, and the client becomes a load generator pointed at an incident.
 */
export class Breaker {
  private failures = 0;
  private openedAt = 0;
  private probing = false;

  constructor(
    private readonly threshold: number,
    private readonly resetMs: number
  ) {}

  get isOpen(): boolean {
    return this.failures >= this.threshold;
  }

  /** Whether a request may go out now. Marks the half-open probe as taken. */
  allow(now: number): boolean {
    if (!this.isOpen) return true;
    if (this.probing) return false;
    if (now - this.openedAt < this.resetMs) return false;
    this.probing = true;
    return true;
  }

  /**
   * How long until `allow` could return true again. 0 when it already can.
   *
   * Non-consuming, unlike `allow`: the caller checks this before deciding
   * whether a scheduled send is worth attempting at all, and asking the
   * question must not spend the one probe the cooldown has earned.
   */
  retryAfter(now: number): number {
    if (!this.isOpen) return 0;
    // A probe is already in flight. Its outcome, not the clock, is what decides
    // next, so come back no sooner than a full cooldown.
    if (this.probing) return this.resetMs;
    return Math.max(0, this.resetMs - (now - this.openedAt));
  }

  /** Returns true if this success closed an open breaker. */
  onSuccess(): boolean {
    const wasOpen = this.isOpen;
    this.failures = 0;
    this.probing = false;
    return wasOpen;
  }

  /** Returns true if this failure is the one that opened the breaker. */
  onFailure(now: number): boolean {
    const wasOpen = this.isOpen;
    this.failures++;
    this.probing = false;
    // The cooldown restarts on every failure, including a failed probe, so a
    // server that is still down does not get a probe every `resetMs`.
    if (this.isOpen) this.openedAt = now;
    return !wasOpen && this.isOpen;
  }
}

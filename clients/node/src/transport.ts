import type { FetchLike } from "./types.js";
import type { LogBatch } from "./wire.js";

/**
 * What to do with a batch after one attempt.
 *
 * `permanent` is the important one. A 400 means the body is wrong and it will
 * be just as wrong in thirty seconds, so retrying it only burns the queue on
 * events that can never land. Dropping it and saying so through the diagnostics
 * hook is the honest outcome.
 */
export type SendOutcome =
  | { kind: "ok" }
  | { kind: "transient"; reason: string }
  | { kind: "permanent"; reason: string };

export interface TransportOptions {
  fetch: FetchLike;
  url: string;
  timeoutMs: number;
}

/**
 * One attempt. Resolves; never rejects.
 *
 * Every throw a `fetch` can produce (DNS failure, refused connection, TLS
 * error, abort) is a transient network condition from this library's point of
 * view, and none of them may reach the host program.
 */
export async function sendBatch(opts: TransportOptions, batch: LogBatch): Promise<SendOutcome> {
  const controller = new AbortController();
  // One timer for the whole attempt: connect, upload and response. Cleared in
  // `finally` so a fast response does not leave a timer pinning the event loop.
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  if (typeof timer === "object" && timer && "unref" in timer) timer.unref();

  try {
    const res = await opts.fetch(opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
      signal: controller.signal,
      // Lets the request outlive a short-lived caller and reuses the connection
      // rather than paying a TLS handshake per flush.
      keepalive: true,
    });

    // The body is read and thrown away purely to release the socket back to the
    // pool. Leaving it undrained leaks a connection per flush.
    if (typeof res.text === "function") {
      await res.text().catch(() => undefined);
    }

    const status = res.status;
    if (status >= 200 && status < 300) return { kind: "ok" };
    // 408 and 429 are the server asking us to come back, not a bad body.
    if (status === 408 || status === 429) return { kind: "transient", reason: `http ${status}` };
    if (status >= 400 && status < 500) return { kind: "permanent", reason: `http ${status}` };
    return { kind: "transient", reason: `http ${status}` };
  } catch (err) {
    const reason = err instanceof Error ? err.name + ": " + err.message : String(err);
    return { kind: "transient", reason };
  } finally {
    clearTimeout(timer);
  }
}

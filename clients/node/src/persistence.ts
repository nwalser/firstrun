/**
 * Durability: what is still there after a crash or a kill.
 *
 * Two stores behind one interface. `memory` keeps nothing, which is the right
 * default on a server: a crashed process is generally restarted by something
 * that will not preserve local state, and writing telemetry into a container
 * filesystem is a surprise nobody asked for. `disk` keeps a bounded NDJSON
 * queue so a crash report can outlive the crash that produced it, which is what
 * makes `startup` delivery mean anything.
 *
 * ## Every write is off the caller's path
 *
 * Nothing here is called synchronously from `event()` or `log()`. Entries are
 * buffered and written on a 0ms unreferenced timer, so a loop that records a
 * thousand entries performs ONE append, and the caller never waits on a
 * filesystem. The honest cost of that choice: a hard crash loses whatever was
 * recorded in the last few milliseconds. The alternative, an `appendFileSync`
 * per entry, puts a syscall in the caller's critical path for every log line,
 * and rule 7 does not have an exception for a fast syscall.
 *
 * ## Recovery is idempotent, so it is allowed to be optimistic
 *
 * Each client writes its own segment file and, at startup, takes over every
 * other segment it finds in the directory. In a multi-process deployment that
 * can mean a worker adopts a live sibling's pending entries. That is safe
 * rather than clever: every entry carries a client-generated id (`i`) and the
 * server deduplicates on it, so the worst case is one duplicate request, and
 * the sibling's own copy is still in its memory queue either way. The
 * alternative, a lock file, invents a new way to lose a queue forever when a
 * process dies holding one.
 */

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Persistence } from "./delivery.js";
import type { Attributes, WireEntry } from "./wire.js";

/**
 * One queued entry, plus the batch-level context it must travel with.
 *
 * `LogBatch` carries the resource attributes once per body rather than per
 * entry, so two entries may only share a request if their resources match.
 * `group` is that resource flattened into a key.
 *
 * The resource is where identity lives now, so grouping by it is also what
 * keeps two people out of one body: `user.id`, `device.id` and `session.id`
 * are resource keys and two entries that disagree about any of them land in
 * different groups without this file having to know that.
 */
export interface QueuedEntry {
  group: string;
  resource: Attributes | undefined;
  wire: WireEntry;
}

/**
 * The grouping key, in one place.
 *
 * Shared with the restore path on purpose: an entry recovered from disk has to
 * land in the same group as an identical one recorded live, and two copies of
 * this expression would eventually stop agreeing about that.
 */
export function groupKey(resource: Attributes | undefined): string {
  return resource ? JSON.stringify(resource) : "";
}

export interface LoadResult {
  entries: QueuedEntry[];
  /** Entries found on disk but discarded for being over the bound. */
  dropped: number;
}

export interface EntryStore {
  readonly kind: Persistence;
  /** Whatever survived the last run. Never rejects. */
  load(): Promise<LoadResult>;
  /** Records entries that were just queued. Returns immediately. */
  record(items: QueuedEntry[]): void;
  /** Tells the store what is still pending, so it can compact. Returns immediately. */
  checkpoint(pending: QueuedEntry[]): void;
  /** Final write, then release everything. Never rejects. */
  close(pending: QueuedEntry[]): Promise<void>;
}

/** Keeps nothing. Every call is a no-op, so the client needs no branches. */
export class MemoryStore implements EntryStore {
  readonly kind = "memory" as const;
  async load(): Promise<LoadResult> {
    return { entries: [], dropped: 0 };
  }
  record(): void {}
  checkpoint(): void {}
  async close(): Promise<void> {}
}

export interface DiskStoreOptions {
  /** Directory the segment files live in. Created on first write. */
  dir: string;
  maxEntries: number;
  maxBytes: number;
  /** The only reporting channel. This library never writes to stdout or stderr. */
  report: (message: string, detail?: Record<string, unknown>) => void;
}

const SEGMENT_RE = /^q-[0-9a-z]+-[0-9a-f]+\.ndjson$/;

/** Where the queue goes when the caller did not say. */
export function defaultDiskPath(sourceKey: string, url: string): string {
  const hash = createHash("sha1").update(sourceKey + "|" + url).digest("hex").slice(0, 16);
  return join(tmpdir(), "firstrun-queue", hash);
}

/**
 * A bounded NDJSON queue on the local filesystem.
 *
 * One line per entry, appended as entries are queued and compacted to a
 * snapshot of what is still pending once the append log has outgrown it.
 * Compaction is an atomic write-and-rename, so a process killed mid-compaction
 * leaves either the old file or the new one and never half of either.
 */
export class DiskStore implements EntryStore {
  readonly kind = "disk" as const;

  private readonly dir: string;
  private readonly file: string;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly report: DiskStoreOptions["report"];

  /** Serialises every filesystem call. One writer, in order, always. */
  private tail: Promise<void> = Promise.resolve();
  private buffered: QueuedEntry[] = [];
  private writeTimer: ReturnType<typeof setTimeout> | undefined;

  private bytes = 0;
  private appended = 0;
  private pendingAtLastCheckpoint = 0;
  private dirReady = false;
  /** After the first IO failure the store degrades to memory and says so once. */
  private degraded = false;

  constructor(options: DiskStoreOptions) {
    this.dir = options.dir;
    this.maxEntries = options.maxEntries;
    this.maxBytes = options.maxBytes;
    this.report = options.report;
    const stamp = Date.now().toString(36);
    const rand = createHash("sha1")
      .update(String(process.pid) + ":" + stamp + ":" + Math.random())
      .digest("hex")
      .slice(0, 12);
    this.file = join(this.dir, `q-${stamp}-${rand}.ndjson`);
  }

  async load(): Promise<LoadResult> {
    if (this.degraded) return { entries: [], dropped: 0 };
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      // No directory yet is the ordinary first run, not a failure.
      return { entries: [], dropped: 0 };
    }

    const mine = this.file.slice(this.dir.length + 1);
    const segments = names.filter((n) => SEGMENT_RE.test(n) && n !== mine).sort();

    const entries: QueuedEntry[] = [];
    let corrupt = 0;
    for (const name of segments) {
      const path = join(this.dir, name);
      try {
        const text = await readFile(path, "utf8");
        for (const line of text.split("\n")) {
          if (line.length === 0) continue;
          const parsed = decode(line);
          if (parsed) entries.push(parsed);
          else corrupt++;
        }
      } catch (err) {
        this.fail("reading a persisted queue", err);
        continue;
      }
      // Deleted once adopted. A crash between the read and the delete replays
      // the segment on the next launch, which the server deduplicates by entry
      // id, so the only cost is one duplicate request.
      try {
        await unlink(path);
      } catch {
        // A segment we cannot remove would be replayed forever. Truncating it
        // is the next best thing and needs no new permission.
        await writeFile(path, "").catch(() => undefined);
      }
    }

    if (corrupt > 0) {
      // A partial trailing line is the normal shape of a process killed
      // mid-append, so this is expected rather than alarming.
      this.report(`skipped ${corrupt} unreadable lines in the persisted queue`, { corrupt });
    }

    let dropped = 0;
    if (entries.length > this.maxEntries) {
      // Oldest first, same rule as the in-memory queue: what you lose in an
      // overflow is the stale tail of a backlog, not what just happened.
      dropped = entries.length - this.maxEntries;
      entries.splice(0, dropped);
    }
    return { entries, dropped };
  }

  record(items: QueuedEntry[]): void {
    if (this.degraded || items.length === 0) return;
    this.buffered.push(...items);
    if (this.writeTimer !== undefined) return;
    // 0ms rather than a microtask: a synchronous burst and the microtasks it
    // schedules all land in one append.
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      this.flushBuffer();
    }, 0);
    // Nothing here may be the reason a process refuses to exit.
    this.writeTimer.unref?.();
  }

  checkpoint(pending: QueuedEntry[]): void {
    if (this.degraded) return;
    this.pendingAtLastCheckpoint = pending.length;
    if (pending.length === 0) {
      // Everything landed. Truncating is both the compaction and the receipt.
      if (this.appended === 0 && this.bytes === 0) return;
      this.buffered = [];
      this.enqueueWrite(async () => {
        await this.ensureDir();
        await writeFile(this.file, "");
        this.bytes = 0;
        this.appended = 0;
      });
      return;
    }
    if (this.appended > Math.max(256, pending.length * 2) || this.bytes > this.maxBytes / 2) {
      this.compact(pending);
    }
  }

  async close(pending: QueuedEntry[]): Promise<void> {
    if (this.degraded) return;
    if (this.writeTimer !== undefined) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    // The buffer is already inside `pending`: the client checkpoints its whole
    // queue, so writing a snapshot both persists and compacts in one step.
    this.buffered = [];
    this.compact(pending);
    await this.tail.catch(() => undefined);
  }

  // -------------------------------------------------------------------------

  private flushBuffer(): void {
    if (this.buffered.length === 0) return;
    const items = this.buffered;
    this.buffered = [];
    const lines = items.map(encode).join("");
    if (this.bytes + lines.length > this.maxBytes) {
      // A durable queue that grows without limit is the host's disk-full
      // incident. Dropping and counting is the same trade the memory queue
      // makes, and the entries are still in memory to be sent normally.
      this.report(`durable queue is at its ${this.maxBytes} byte limit; not persisting`, {
        entries: items.length,
        bytes: this.bytes,
      });
      return;
    }
    this.enqueueWrite(async () => {
      await this.ensureDir();
      await appendFile(this.file, lines);
      this.bytes += lines.length;
      this.appended += items.length;
    });
  }

  private compact(pending: QueuedEntry[]): void {
    // The snapshot already says what is pending, buffered entries included, so
    // appending the buffer afterwards would only write some of them twice.
    this.buffered = [];
    const text = pending.map(encode).join("");
    const tmp = this.file + ".tmp";
    this.enqueueWrite(async () => {
      await this.ensureDir();
      // Write then rename: a kill mid-compaction leaves the old file or the new
      // one, never a half-written queue.
      await writeFile(tmp, text);
      await rename(tmp, this.file);
      this.bytes = text.length;
      this.appended = 0;
    });
  }

  private enqueueWrite(op: () => Promise<void>): void {
    this.tail = this.tail.then(
      async () => {
        if (this.degraded) return;
        try {
          await op();
        } catch (err) {
          this.fail("writing the persisted queue", err);
        }
      },
      () => undefined
    );
  }

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await mkdir(this.dir, { recursive: true });
    this.dirReady = true;
  }

  /**
   * One report, then memory-only for the rest of the run.
   *
   * A read-only or full filesystem would otherwise produce a diagnostic per
   * flush forever, and this client is not allowed to be the noisy thing in
   * somebody else's logs.
   */
  private fail(what: string, err: unknown): void {
    if (this.degraded) return;
    this.degraded = true;
    this.buffered = [];
    const message = err instanceof Error ? err.message : String(err);
    this.report(`disk persistence disabled after failure ${what}: ${message}`, {
      dir: this.dir,
      pending: this.pendingAtLastCheckpoint,
    });
  }
}

/** One entry as one NDJSON line, in the wire's own vocabulary. */
function encode(item: QueuedEntry): string {
  const line = item.resource ? { r: item.resource, e: item.wire } : { e: item.wire };
  return JSON.stringify(line) + "\n";
}

/** One line back, or null when it is not one of ours. Never throws. */
function decode(line: string): QueuedEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as { r?: unknown; e?: unknown };
  const wire = row.e as WireEntry | undefined;
  if (!wire || typeof wire !== "object") return null;
  if (typeof wire.i !== "string" || typeof wire.n !== "string" || typeof wire.t !== "number") {
    return null;
  }
  const resource =
    row.r && typeof row.r === "object" && !Array.isArray(row.r) ? (row.r as Attributes) : undefined;
  return { group: groupKey(resource), resource, wire };
}

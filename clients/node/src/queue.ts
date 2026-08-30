/**
 * A bounded FIFO that drops the oldest event when it is full.
 *
 * Dropping the oldest rather than refusing the newest is the choice that keeps
 * the host program honest under a long outage: what you lose is the stale tail
 * of a backlog, not the events happening right now, and memory is capped either
 * way. The alternative, an unbounded queue, turns a firstrun outage into the
 * host's out-of-memory kill, which is the exact failure this library exists to
 * avoid.
 *
 * A head index rather than `Array.shift()`, because shifting a ten-thousand
 * element array on every batch is a copy the sender does not need to make.
 */
export class BoundedQueue<T> {
  private items: T[] = [];
  private head = 0;
  private droppedCount = 0;

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.items.length - this.head;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  /** Appends, dropping the oldest if that put us over capacity. */
  push(item: T): void {
    this.items.push(item);
    this.trim();
    this.compact();
  }

  /**
   * Everything still waiting, oldest first, without consuming any of it.
   *
   * The durable queue needs to write down what is pending without taking it out
   * of the queue that is about to send it.
   */
  snapshot(): T[] {
    return this.items.slice(this.head);
  }

  /** Takes up to `n` from the front, oldest first. */
  take(n: number): T[] {
    const end = Math.min(this.head + n, this.items.length);
    const out = this.items.slice(this.head, end);
    this.head = end;
    this.compact();
    return out;
  }

  /**
   * Puts a taken run back at the front, preserving order.
   *
   * Only ever called with a run this queue just handed out, so there is always
   * room in front of `head` for it. Events pushed in the meantime went to the
   * tail and are unaffected.
   */
  unshift(run: T[]): void {
    if (run.length === 0) return;
    if (run.length <= this.head) {
      this.head -= run.length;
      for (let i = 0; i < run.length; i++) this.items[this.head + i] = run[i]!;
    } else {
      this.items = run.concat(this.items.slice(this.head));
      this.head = 0;
    }
    this.trim();
  }

  clear(): number {
    const n = this.size;
    this.items = [];
    this.head = 0;
    return n;
  }

  /** Drops from the front until we are within capacity. */
  private trim(): void {
    while (this.items.length - this.head > this.capacity) {
      this.head++;
      this.droppedCount++;
    }
  }

  /** Reclaims the consumed prefix once it is worth the copy. */
  private compact(): void {
    if (this.head > 64 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
  }
}

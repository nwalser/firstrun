import { describe, expect, test } from "bun:test";
import {
  COALESCE_MS,
  MAX_BATCH,
  MAX_BUFFER,
  SEV_ERROR,
  SEV_INFO,
  createTag,
  type DeliveryMode,
  type Env,
  type PageInfo,
  type Tag,
  type WireEntry,
} from "../src/core.js";

/**
 * The delivery policy, as assertions. See docs/delivery-policy.md.
 *
 * The claim that needs proving is the one that is easy to get wrong and
 * impossible to see: `immediate` means "do not wait for a timer", NOT "one
 * request per entry". A loop calling `event()` a thousand times has to leave
 * this page as a handful of beacons, because a tag that opens one request per
 * entry is a tag that is in the customer's critical path.
 *
 * The clock is injected rather than real. `Env.schedule` queues the callback
 * and a test decides when it runs, so "one beacon, not a thousand" is counted
 * rather than waited for, and nothing here is timing-dependent.
 */

const SOURCE_KEY = "fr_web_1111222233334444";
const HOST = "https://t.example.com";

interface Rec {
  env: Env;
  /** One entry per `send()`, which is one beacon. */
  sent: Array<{ url: string; body: string }>;
  /** How many coalescing windows were opened, ever. */
  scheduled: number;
  page: PageInfo;
  /** Run every window that is open. */
  tick(): void;
}

function recorder(): Rec {
  const store = new Map<string, string>();
  let timers: Array<() => void> = [];
  let n = 0;
  const r: Rec = {
    sent: [],
    scheduled: 0,
    page: { url: "https://themia.app/", referrer: "https://google.com/", locale: "de-CH" },
    tick: () => {
      const due = timers;
      timers = [];
      for (const fn of due) fn();
    },
    env: {
      now: () => 1_700_000_000_000,
      uuid: () => "00000000-0000-4000-8000-" + String(++n).padStart(12, "0"),
      get: (k) => store.get(k) ?? null,
      set: (k, v) => void store.set(k, v),
      del: (k) => void store.delete(k),
      send: (url, body) => void r.sent.push({ url, body }),
      pageInfo: () => r.page,
      schedule: (fn, ms) => {
        expect(ms).toBe(COALESCE_MS);
        r.scheduled++;
        timers.push(fn);
      },
    },
  };
  return r;
}

/** A consented tag, with the opening page view already sent and forgotten. */
function ready(mode?: DeliveryMode | string, flushOnSeverity?: number): [Rec, Tag] {
  const r = recorder();
  const tag = createTag(r.env, {
    sourceKey: SOURCE_KEY,
    host: HOST,
    mode: mode as DeliveryMode | undefined,
    flushOnSeverity,
  });
  tag.setConsent(true);
  tag.page();
  // Empty the buffer and close the window the opening page view opened, so a
  // test starts with nothing held and no timer already in flight, and can count
  // exactly the beacons and windows its own entries produce.
  tag.flush();
  r.tick();
  r.sent.length = 0;
  r.scheduled = 0;
  return [r, tag];
}

const entriesOf = (r: Rec): WireEntry[] =>
  r.sent.flatMap((s) => JSON.parse(s.body).e as WireEntry[]);

const names = (r: Rec) => entriesOf(r).map((e) => e.n);

// ---------------------------------------------------------------------------
// immediate, which is the browser's default
// ---------------------------------------------------------------------------

describe("immediate coalesces", () => {
  test("a thousand events in one tick are a handful of beacons, not a thousand", () => {
    const [r, tag] = ready();
    for (let i = 0; i < 1000; i++) tag.event("e" + i);

    // One window for the whole burst, not one per entry.
    expect(r.scheduled).toBe(1);
    r.tick();

    // 1000 entries at 50 to a batch. The requests are the full batches, which
    // is the floor for this many entries, and nothing was dropped to get there.
    expect(r.sent.length).toBe(1000 / MAX_BUFFER);
    expect(tag.dropped()).toBe(0);
    expect(entriesOf(r).length).toBe(1000);
  });

  test("a burst that fits in one batch is one beacon", () => {
    const [r, tag] = ready();
    for (let i = 0; i < 10; i++) tag.event("e" + i);

    // Nothing has gone out yet. `immediate` is not synchronous: a send inside
    // that loop would have put us in the caller's critical path.
    expect(r.sent.length).toBe(0);
    expect(r.scheduled).toBe(1);

    r.tick();
    expect(r.sent.length).toBe(1);
    expect(entriesOf(r).length).toBe(10);
  });

  test("a page view plus three clicks is one beacon, not four", () => {
    const [r, tag] = ready();
    tag.page();
    tag.event("cta_clicked");
    tag.event("pricing_clicked");
    tag.event("docs_clicked");

    r.tick();
    expect(r.sent.length).toBe(1);
    expect(names(r)).toEqual(["page_view", "cta_clicked", "pricing_clicked", "docs_clicked"]);
  });

  test("a later burst opens its own window, so nothing waits on the last one", () => {
    const [r, tag] = ready();
    tag.event("a");
    r.tick();
    tag.event("b");
    r.tick();
    expect(r.sent.length).toBe(2);
    expect(r.scheduled).toBe(2);
    expect(names(r)).toEqual(["a", "b"]);
  });

  test("an empty window sends nothing rather than an empty batch", () => {
    const [r, tag] = ready();
    tag.event("a");
    tag.flush();
    r.sent.length = 0;
    r.tick();
    expect(r.sent).toEqual([]);
  });

  test("is the default, and an unknown mode coerces to it rather than to silence", () => {
    // `startup` is the policy's fourth mode and is incoherent here: it only
    // means anything with a durable queue, and this client has none by design.
    // Coercing is the one behaviour the policy rules out being silent about,
    // and sending nothing is the failure it rules out entirely.
    for (const mode of [undefined, "startup", "nonsense"]) {
      const [r, tag] = ready(mode);
      tag.event("a");
      r.tick();
      expect(r.sent.length).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// flushOnSeverity
// ---------------------------------------------------------------------------

describe("flushOnSeverity", () => {
  test("an ERROR leaves the page at once, with no window and no flush()", () => {
    const [r, tag] = ready();
    tag.error(new Error("boom"));
    expect(r.sent.length).toBe(1);
    expect(entriesOf(r).some((e) => e.n === "exception" && e.s === SEV_ERROR)).toBe(true);
  });

  test("an INFO entry waits for the window, so ordinary traffic still batches", () => {
    const [r, tag] = ready();
    tag.event("clicked");
    expect(r.sent.length).toBe(0);
  });

  test("the threshold is a setting: lower it and everything sends at once", () => {
    const [r, tag] = ready("immediate", SEV_INFO);
    tag.event("clicked");
    expect(r.sent.length).toBe(1);
    expect(r.scheduled).toBe(0);
  });

  test("raise it past the ladder and even an exception waits", () => {
    const [r, tag] = ready("immediate", 25);
    tag.error(new Error("boom"));
    expect(r.sent.length).toBe(0);
    r.tick();
    expect(r.sent.length).toBe(1);
  });

  test("it outranks the schedule, manual included", () => {
    const [r, tag] = ready("manual");
    tag.event("clicked");
    expect(r.sent.length).toBe(0);
    tag.error(new Error("boom"));
    expect(r.sent.length).toBe(1);
    // The event it was buffered behind rides out with it.
    expect(names(r)).toEqual(["clicked", "exception"]);
  });

  test("a raw log() at ERROR is treated as one, because the rule is the severity", () => {
    const [r, tag] = ready();
    tag.log({ name: "queue.stalled", severity: SEV_ERROR });
    expect(r.sent.length).toBe(1);
  });

  test("consent still outranks it: an exception before the banner sends nothing", () => {
    const r = recorder();
    const tag = createTag(r.env, { sourceKey: SOURCE_KEY, host: HOST });
    tag.error(new Error("boom"));
    r.tick();
    expect(r.sent).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// the other two schedules
// ---------------------------------------------------------------------------

describe("interval", () => {
  test("opens no coalescing window: the host's timer is the schedule", () => {
    const [r, tag] = ready("interval");
    for (let i = 0; i < 5; i++) tag.event("e" + i);
    expect(r.scheduled).toBe(0);
    r.tick();
    expect(r.sent).toEqual([]);
  });

  test("but a full-enough buffer still sends, so a long period does not drop", () => {
    const [r, tag] = ready("interval");
    for (let i = 0; i < MAX_BUFFER; i++) tag.event("e" + i);
    expect(r.sent.length).toBe(1);
  });
});

describe("manual", () => {
  test("sends only from flush(), even past the buffer threshold", () => {
    const [r, tag] = ready("manual");
    for (let i = 0; i < MAX_BUFFER + 5; i++) tag.event("e" + i);
    expect(r.scheduled).toBe(0);
    r.tick();
    expect(r.sent).toEqual([]);
    tag.flush();
    expect(r.sent.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// the bounds
// ---------------------------------------------------------------------------

describe("the bounded queue", () => {
  test("drops the oldest and counts what it dropped", () => {
    const [, tag] = ready("manual");
    for (let i = 0; i < MAX_BUFFER + 30; i++) tag.event("e" + i);
    expect(tag.buffered()).toBe(MAX_BUFFER);
    expect(tag.dropped()).toBe(30);
  });

  test("says so on the resource, so a dropping queue is visible in the data", () => {
    const [r, tag] = ready("manual");
    for (let i = 0; i < MAX_BUFFER + 7; i++) tag.event("e" + i);
    tag.flush();
    expect(JSON.parse(r.sent[0]!.body).r["firstrun.dropped"]).toBe(7);
  });

  test("and says nothing when it has dropped nothing", () => {
    const [r, tag] = ready("manual");
    tag.event("a");
    tag.flush();
    expect(JSON.parse(r.sent[0]!.body).r["firstrun.dropped"]).toBeUndefined();
  });

  test("no request can exceed the server's per-request entry cap", () => {
    const [r, tag] = ready();
    for (let i = 0; i < 2000; i++) tag.event("e" + i);
    r.tick();
    expect(tag.dropped()).toBe(0);
    expect(r.sent.length).toBeGreaterThan(0);
    for (const s of r.sent) {
      const n = (JSON.parse(s.body).e as WireEntry[]).length;
      expect(n).toBeLessThanOrEqual(MAX_BUFFER);
      expect(n).toBeLessThanOrEqual(MAX_BATCH);
    }
  });
});

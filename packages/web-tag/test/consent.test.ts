import { beforeEach, describe, expect, test } from "bun:test";
import {
  KEY_CONSENT,
  KEY_SESSION,
  SEV_ERROR,
  SEV_INFO,
  createTag,
  type Env,
  type PageInfo,
  type Tag,
  type WireEntry,
} from "../src/core.js";

/**
 * "Consent-gated" is a promise made to the people being measured. These are the
 * assertions that keep it.
 *
 * The promise got harder to keep the moment the tag started emitting entries
 * nobody asked it to emit. A page view is one call a customer wrote; a scroll
 * depth, a vital, an outbound click, an uncaught exception and a session
 * boundary are things happening on their own, and every one of them has to be
 * as silent before the banner is answered as the one call was.
 *
 * Below the consent block, the shape assertions: every emission is a log entry
 * with a name, a severity on the 1..24 ladder and an attribute map, and there
 * is no second shape anywhere.
 */

const SOURCE_KEY = "fr_1111222233334444";
const HOST = "https://t.example.com";
const T0 = 1_700_000_000_000;

interface Recorder {
  env: Env;
  store: Map<string, string>;
  sent: Array<{ url: string; body: string }>;
  writes: string[];
  /** Mutable, so a test can navigate or arrive from somewhere else. */
  page: PageInfo;
  advance(ms: number): void;
  /**
   * Run the coalescing windows that are due. Nothing here waits on a real
   * clock: `immediate` schedules a callback and a test decides when it fires,
   * which is what makes "one beacon, not a thousand" an assertion.
   */
  runTimers(): void;
}

function recorder(seed: Record<string, string> = {}): Recorder {
  const store = new Map(Object.entries(seed));
  const sent: Array<{ url: string; body: string }> = [];
  const writes: string[] = [];
  const page: PageInfo = {
    url: "https://themia.app/",
    referrer: "https://google.com/",
    locale: "de-CH",
  };
  let now = T0;
  let n = 0;
  let timers: Array<() => void> = [];
  const r: Recorder = {
    store,
    sent,
    writes,
    page,
    advance: (ms) => {
      now += ms;
    },
    runTimers: () => {
      const due = timers;
      timers = [];
      for (const fn of due) fn();
    },
    env: {
      now: () => now,
      uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      get: (k) => store.get(k) ?? null,
      set: (k, v) => {
        writes.push(k);
        store.set(k, v);
      },
      del: (k) => {
        store.delete(k);
      },
      send: (url, body) => sent.push({ url, body }),
      pageInfo: () => page,
      schedule: (fn) => {
        timers.push(fn);
      },
      fingerprint: () => "fp_stub",
    },
  };
  return r;
}

const tagFor = (r: Recorder, extra: { fingerprint?: boolean; ephemeral?: boolean } = {}) =>
  createTag(r.env, { sourceKey: SOURCE_KEY, host: HOST, ...extra });

/** Everything sent so far, flattened, with the outbox emptied. */
function drain(r: Recorder, tag: Tag): WireEntry[] {
  tag.flush();
  const out: WireEntry[] = [];
  for (const s of r.sent) out.push(...(JSON.parse(s.body).e as WireEntry[]));
  r.sent.length = 0;
  return out;
}

const names = (entries: WireEntry[]) => entries.map((e) => e.n);

/** Fires one of everything the tag does on its own, without being asked. */
function everythingAutomatic(tag: Tag): void {
  tag.page();
  tag.navigated(4200, 63);
  tag.leave(4200, 63);
  tag.vital("LCP", 3100);
  tag.vital("CLS", 0.02);
  tag.vital("TTFB", 2400);
  tag.linkClick("https://github.com/themia/themia");
  tag.linkClick("https://themia.app/Themia-Setup-1.4.2-9GQ4T7BX.exe");
  tag.formSubmit("newsletter", "newsletter-form");
  tag.error(new TypeError("x is not a function"));
}

describe("before consent", () => {
  let r: Recorder;
  beforeEach(() => {
    r = recorder();
  });

  test("nothing is stored", () => {
    const tag = tagFor(r);
    tag.page();
    tag.call("event", "download_clicked");
    expect(r.writes).toEqual([]);
    expect(r.store.size).toBe(0);
  });

  test("nothing is sent, even when explicitly flushed", () => {
    const tag = tagFor(r);
    tag.page();
    tag.flush();
    expect(r.sent).toEqual([]);
  });

  test("nothing is sent even past the auto-flush threshold", () => {
    const tag = tagFor(r);
    for (let i = 0; i < 40; i++) tag.call("event", "e" + i);
    expect(r.sent).toEqual([]);
  });

  test("an ERROR does not buy an exemption from the flush gate", () => {
    const tag = tagFor(r);
    // Severity flushes immediately once there is consent. Before consent it is
    // the one thing that would most plausibly be argued into an exception, and
    // it is not one: an uncaught exception on a page whose banner is unanswered
    // is still a person who has not agreed to be measured.
    tag.error(new Error("boom"));
    tag.call("error", new Error("boom again"));
    expect(r.sent).toEqual([]);
    expect(r.store.size).toBe(0);
  });

  test("no device id is derived before the answer, even with fingerprinting on", () => {
    const tag = tagFor(r, { fingerprint: true });
    expect(tag.deviceId()).toBeUndefined();
  });

  test("but entries are held, so the first page view is not lost", () => {
    const tag = tagFor(r);
    tag.page();
    tag.call("event", "download_clicked");
    expect(tag.buffered()).toBe(3); // session_start, page_view, download_clicked
  });

  test("the buffer is bounded", () => {
    const tag = tagFor(r);
    for (let i = 0; i < 500; i++) tag.call("event", "e" + i);
    expect(tag.buffered()).toBeLessThanOrEqual(50);
  });

  // --- The automatic entries, one promise at a time -----------------------

  test("every automatic entry stores nothing", () => {
    const tag = tagFor(r);
    everythingAutomatic(tag);
    expect(r.writes).toEqual([]);
    expect(r.store.size).toBe(0);
  });

  test("every automatic entry sends nothing, flushed or not", () => {
    const tag = tagFor(r);
    everythingAutomatic(tag);
    tag.flush();
    expect(r.sent).toEqual([]);
  });

  test("a new session does not write the session stamp", () => {
    const tag = tagFor(r);
    tag.page();
    r.advance(45 * 60_000);
    tag.page();
    expect(r.store.has(KEY_SESSION)).toBe(false);
    expect(r.writes).toEqual([]);
  });

  test("an SPA navigation is held in memory like everything else", () => {
    const tag = tagFor(r);
    tag.page();
    r.page.url = "https://themia.app/pricing";
    expect(tag.navigated(1000, 20)).toBe(true);
    expect(r.sent).toEqual([]);
    expect(r.writes).toEqual([]);
  });

  test("vitals are held in memory like everything else", () => {
    const tag = tagFor(r);
    tag.vital("LCP", 900);
    tag.vital("INP", 40);
    expect(r.sent).toEqual([]);
    expect(r.writes).toEqual([]);
  });

  test("a click on someone else's link is not a reason to start storing", () => {
    const tag = tagFor(r);
    tag.linkClick("https://github.com/themia/themia");
    tag.linkClick("https://themia.app/Themia-Setup-1.4.2-9GQ4T7BX.exe");
    expect(r.sent).toEqual([]);
    expect(r.store.size).toBe(0);
  });

  test("a raw log() is gated exactly like the helpers that call it", () => {
    const tag = tagFor(r);
    tag.log({ name: "queue.drained", severity: 5, attributes: { depth: 12 } });
    tag.flush();
    expect(r.sent).toEqual([]);
    expect(r.store.size).toBe(0);
  });
});

describe("granting consent", () => {
  test("sends what was held", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.page();
    tag.call("event", "download_clicked");

    tag.call("consent", true);

    expect(r.store.get(KEY_CONSENT)).toBe("1");
    expect(r.sent.length).toBe(1);

    const body = JSON.parse(r.sent[0]!.body);
    expect(r.sent[0]!.url).toBe(HOST + "/v1/e");
    expect(body.k).toBe(SOURCE_KEY);
    // No top-level id field at all any more: identity travels on the resource,
    // and a tag with no fingerprint and no `user()` call carries only a session.
    expect(body.d).toBeUndefined();
    expect(body.r["device.id"]).toBeUndefined();
    expect(names(body.e)).toEqual(["session_start", "page_view", "download_clicked"]);
    expect(body.e[1].a["url.full"]).toBe("https://themia.app/");
  });

  test("the body uses short keys and no long ones", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.page();
    tag.call("consent", true);
    const body = r.sent[0]!.body;
    expect(body).toContain('"k":');
    expect(body).toContain('"e":[');
    expect(body).not.toContain("source_key");
    expect(body).not.toContain('"name"');
  });

  test("held automatic entries are released, and only then", () => {
    const r = recorder();
    const tag = tagFor(r);
    everythingAutomatic(tag);
    expect(r.sent).toEqual([]);

    tag.call("consent", true);
    const sent = names(r.sent.flatMap((s) => JSON.parse(s.body).e as WireEntry[]));
    expect(sent).toContain("session_start");
    expect(sent).toContain("page_view");
    expect(sent).toContain("page_leave");
    expect(sent).toContain("web_vital");
    expect(sent).toContain("outbound_click");
    expect(sent).toContain("file_download");
    expect(sent).toContain("form_submit");
    expect(sent).toContain("exception");
  });
});

describe("withdrawing consent", () => {
  test("clears the flag, the session, the device id, and anything still held", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    r.sent.length = 0;

    tag.call("event", "download_clicked");
    tag.call("consent", false);

    expect(r.store.has(KEY_CONSENT)).toBe(false);
    expect(r.store.has(KEY_SESSION)).toBe(false);
    expect(tag.deviceId()).toBeUndefined();
    expect(tag.buffered()).toBe(0);

    // Sending what we gathered while waiting for an answer, after the answer
    // was no, is what a consent banner exists to prevent.
    tag.flush();
    expect(r.sent).toEqual([]);
  });

  test("the automatic entries go quiet again afterwards", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.call("consent", false);
    r.writes.length = 0;

    everythingAutomatic(tag);
    tag.flush();
    expect(r.sent).toEqual([]);
    expect(r.writes).toEqual([]);
  });
});

describe("a returning visitor", () => {
  test("sends straight away, with no banner and no stored id to read", () => {
    const r = recorder({ [KEY_CONSENT]: "1" });
    const tag = tagFor(r);
    expect(tag.hasConsent()).toBe(true);

    tag.page();
    tag.flush();
    expect(r.sent.length).toBe(1);
    expect(JSON.parse(r.sent[0]!.body).r["session.id"]).toBe(tag.sessionId());
  });
});

describe("fingerprinting", () => {
  test("is off by default: no device id, however much consent there is", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    tag.flush();
    expect(tag.deviceId()).toBeUndefined();
    expect(JSON.parse(r.sent[0]!.body).r["device.id"]).toBeUndefined();
  });

  test("needs the flag AND consent before it derives anything", () => {
    const r = recorder();
    const tag = tagFor(r, { fingerprint: true });
    tag.page();
    expect(tag.deviceId()).toBeUndefined();

    tag.call("consent", true);
    expect(tag.deviceId()).toBe("fp_stub");
    tag.flush();
    expect(JSON.parse(r.sent[0]!.body).r["device.id"]).toBe("fp_stub");
  });

  test("withdrawing consent takes the derived id away again", () => {
    const r = recorder();
    const tag = tagFor(r, { fingerprint: true });
    tag.call("consent", true);
    tag.call("consent", false);
    expect(tag.deviceId()).toBeUndefined();
  });

  test("a device id the caller set needs no flag, but still needs consent to send", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("device", "machine-7");
    expect(tag.deviceId()).toBe("machine-7");
    tag.page();
    expect(r.sent).toEqual([]);

    tag.call("consent", true);
    expect(JSON.parse(r.sent[0]!.body).r["device.id"]).toBe("machine-7");
  });
});

// ---------------------------------------------------------------------------
// One shape for everything
// ---------------------------------------------------------------------------

describe("every emission is a log entry", () => {
  const first = (fn: (tag: Tag) => void): WireEntry => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);
    fn(tag);
    return drain(r, tag)[0]!;
  };

  test("an event, an exception and a measurement differ only in what they carry", () => {
    const event = first((t) => t.event("exported_csv", { rows: 40 }));
    const error = first((t) => t.error(new RangeError("nope")));
    const vital = first((t) => t.vital("LCP", 1800));

    // Same three fields, every time. Nothing carries a type, a kind or a flag
    // that would let anything downstream branch on which of the three it is.
    for (const e of [event, error, vital]) {
      expect(Object.keys(e).sort()).toEqual(["a", "i", "n", "s", "t"]);
      expect(typeof e.n).toBe("string");
      expect(e.s).toBeGreaterThanOrEqual(1);
      expect(e.s).toBeLessThanOrEqual(24);
    }

    expect(event.n).toBe("exported_csv");
    expect(error.n).toBe("exception");
    expect(vital.n).toBe("web_vital");
  });

  test("the automatic ones sit at INFO and an exception at ERROR", () => {
    expect(first((t) => t.event("x")).s).toBe(SEV_INFO);
    expect(first((t) => t.error("bad")).s).toBe(SEV_ERROR);
    expect(first((t) => t.vital("CLS", 0.02)).s).toBe(SEV_INFO);
  });
});

describe("log", () => {
  test("takes an entry through untouched: no convention is applied", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);

    tag.log({
      name: "queue.drained",
      severity: 6,
      attributes: { "firstrun.metric": "queue_depth", "firstrun.value": 12 },
      time: T0 - 5_000,
    });

    const e = drain(r, tag)[0]!;
    expect(e.n).toBe("queue.drained");
    expect(e.s).toBe(6);
    expect(e.t).toBe(T0 - 5_000);
    expect(e.a).toEqual({ "firstrun.metric": "queue_depth", "firstrun.value": 12 });
  });

  test("an entry with no severity keeps none: unclassified is not INFO", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);
    tag.log({ name: "something.happened" });
    expect(drain(r, tag)[0]!.s).toBeUndefined();
  });

  test("a nameless entry is not an entry", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);
    tag.log({ name: "" });
    tag.log(undefined as never);
    expect(drain(r, tag)).toEqual([]);
  });
});

describe("error", () => {
  const entryFor = (thrown: unknown, attrs?: Record<string, unknown>): WireEntry => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);
    tag.error(thrown, attrs);
    return drain(r, tag)[0]!;
  };

  test("follows the OTel exception convention: one name, the detail in attributes", () => {
    const e = entryFor(new TypeError("x is not a function"));
    expect(e.n).toBe("exception");
    expect(e.a!["exception.type"]).toBe("TypeError");
    expect(e.a!["exception.message"]).toBe("x is not a function");
    expect(e.a!["exception.stacktrace"]).toBeString();
  });

  test("a thrown string is still an exception, because a catch catches anything", () => {
    const e = entryFor("everything is on fire");
    expect(e.a!["exception.type"]).toBe("Error");
    expect(e.a!["exception.message"]).toBe("everything is on fire");
    expect(e.a!["exception.stacktrace"]).toBeUndefined();
  });

  test("the caller's own attributes are kept beside the conventional ones", () => {
    const e = entryFor(new Error("boom"), { "firstrun.form.id": "checkout" });
    expect(e.a!["firstrun.form.id"]).toBe("checkout");
    expect(e.a!["exception.message"]).toBe("boom");
  });

  test("sends at once rather than waiting: the page may not be there later", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    r.sent.length = 0;

    tag.error(new Error("boom"));
    // No flush() call. `flushOnSeverity` is what got this out of the buffer.
    expect(r.sent.length).toBe(1);
    expect(names(JSON.parse(r.sent[0]!.body).e)).toContain("exception");
  });

  test("an INFO entry is not sent at once, so ordinary traffic still batches", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    r.sent.length = 0;
    tag.event("clicked");
    expect(r.sent).toEqual([]);
  });
});

describe("user", () => {
  test("puts the customer's own id on the resource", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.call("user", "u_42");
    r.sent.length = 0;
    tag.call("event", "signed_in");
    tag.flush();
    expect(JSON.parse(r.sent[0]!.body).r["user.id"]).toBe("u_42");
  });

  test("user(null) drops it again, and it was never written to storage", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.call("user", "u_42");
    tag.call("user", null);
    r.sent.length = 0;
    tag.call("event", "signed_out");
    tag.flush();
    expect(JSON.parse(r.sent[0]!.body).r["user.id"]).toBeUndefined();
    expect([...r.store.values()]).not.toContain("u_42");
  });

  test("naming a different person cuts the session; naming the same one does not", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    const before = tag.sessionId();

    tag.call("user", "u_42");
    const afterSignIn = tag.sessionId();
    expect(afterSignIn).not.toBe(before);

    // What a router does on every route change. It must be a no-op, or a visit
    // becomes one session per navigation.
    tag.call("user", "u_42");
    expect(tag.sessionId()).toBe(afterSignIn);

    tag.call("user", null);
    expect(tag.sessionId()).not.toBe(afterSignIn);
  });
});

describe("session", () => {
  test("session(id) replaces the id, and there is no separate new-session call", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.call("session", "s_mine");
    expect(tag.sessionId()).toBe("s_mine");
    tag.page();
    tag.flush();
    expect(JSON.parse(r.sent[0]!.body).r["session.id"]).toBe("s_mine");
  });
});

describe("the resource", () => {
  test("carries what is true of the client, sent once instead of per entry", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    tag.event("a");
    tag.event("b");
    tag.flush();

    const body = JSON.parse(r.sent[0]!.body);
    expect(body.r["session.id"]).toBe(tag.sessionId());
    expect(body.r["browser.language"]).toBe("de-CH");
    // The session id appears once, not once per entry.
    expect(body.e.every((e: WireEntry) => !e.a || !("session.id" in e.a))).toBe(true);
  });
});

describe("attributes", () => {
  test("are copied, and keep their type so a number stays a number", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);

    const attrs = { n: 1, ok: true, gone: null, missing: undefined } as Record<string, unknown>;
    tag.event("checkout", attrs);
    // Mutating afterwards must not rewrite an entry we already recorded.
    attrs.n = 999;

    expect(drain(r, tag)[0]!.a).toEqual({ n: 1, ok: true, gone: null });
  });

  test("drop what JSON cannot carry, rather than costing the batch its entries", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);

    tag.event("odd", {
      fn: () => 1,
      big: BigInt(9),
      nan: NaN,
      inf: Infinity,
      kept: "yes",
    } as unknown as Record<string, unknown>);

    // A BigInt would have thrown out of JSON.stringify and taken every other
    // entry in the batch with it. NaN and Infinity would have arrived as null.
    expect(drain(r, tag)[0]!.a).toEqual({ kept: "yes" });
  });

  test("a non-object second argument is ignored rather than sent as one", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);
    tag.call("event", "clicked", "not-an-object");
    expect(drain(r, tag)[0]!.a).toBeUndefined();
  });
});

describe("sessions", () => {
  test("session_start comes before the page view that opened the visit", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    expect(names(drain(r, tag))).toEqual(["session_start", "page_view"]);
  });

  test("one session_start per visit, not per page view", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    r.advance(20_000);
    r.page.url = "https://themia.app/pricing";
    tag.page();
    expect(names(drain(r, tag))).toEqual(["session_start", "page_view", "page_view"]);
  });

  test("thirty idle minutes ends it, and the session id changes with it", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    const firstId = tag.sessionId();
    drain(r, tag);

    r.advance(31 * 60_000);
    tag.page();
    expect(names(drain(r, tag))).toEqual(["session_start", "page_view"]);
    expect(tag.sessionId()).not.toBe(firstId);
  });

  test("arriving from somewhere new starts a new one", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);

    r.page.referrer = "https://news.ycombinator.com/";
    tag.page();
    expect(names(drain(r, tag))).toEqual(["session_start", "page_view"]);
  });

  test("but a link from our own site is not somewhere new", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);

    r.page.referrer = "https://themia.app/blog";
    r.page.url = "https://themia.app/pricing";
    tag.page();
    expect(names(drain(r, tag))).toEqual(["page_view"]);
  });

  test("the last-activity stamp is written, but only once there is consent", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.page();
    expect(r.store.has(KEY_SESSION)).toBe(false);
    tag.call("consent", true);
    tag.page();
    expect(r.store.get(KEY_SESSION)).toBe(T0 + "|google.com|" + tag.sessionId());
  });

  test("a returning visitor inside the window continues the same visit", () => {
    const r = recorder({
      [KEY_CONSENT]: "1",
      [KEY_SESSION]: T0 - 60_000 + "|google.com|s_open",
    });
    const tag = tagFor(r);
    tag.page();
    expect(names(drain(r, tag))).toEqual(["page_view"]);
    // And it is the SAME visit, not merely an uncut one: a full page load
    // inside the window keeps the id it was already reporting under.
    expect(tag.sessionId()).toBe("s_open");
  });

  test("a stale stored session is not adopted", () => {
    const r = recorder({
      [KEY_CONSENT]: "1",
      [KEY_SESSION]: T0 - 31 * 60_000 + "|google.com|s_stale",
    });
    const tag = tagFor(r);
    tag.page();
    expect(names(drain(r, tag))).toEqual(["session_start", "page_view"]);
    expect(tag.sessionId()).not.toBe("s_stale");
  });
});

describe("page views on an SPA", () => {
  test("a replaceState that did not move the path is not a page view", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);

    expect(tag.navigated(1000, 10)).toBe(false);
    r.page.url = "https://themia.app/?utm_source=x#features";
    expect(tag.navigated(1000, 10)).toBe(false);
    expect(r.sent).toEqual([]);
  });

  test("a path change leaves the old page and views the new one", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);

    r.page.url = "https://themia.app/pricing";
    expect(tag.navigated(8000, 72)).toBe(true);
    const entries = drain(r, tag);
    expect(names(entries)).toEqual(["page_leave", "page_view"]);
    expect(entries[0]!.a).toEqual({
      "firstrun.duration_ms": 8000,
      "firstrun.scroll_pct": 72,
    });
    expect(entries[1]!.a!["url.path"]).toBe("/pricing");
  });
});

describe("page_view attributes", () => {
  test("carry the path separately, because that is what a breakdown groups on", () => {
    const r = recorder();
    r.page.url = "https://themia.app/pricing?utm_source=hn&utm_campaign=launch";
    r.page.referrer = "https://news.ycombinator.com/item?id=1";
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();

    const view = drain(r, tag).find((e) => e.n === "page_view")!;
    expect(view.a).toEqual({
      "url.full": "https://themia.app/pricing?utm_source=hn&utm_campaign=launch",
      "url.path": "/pricing",
      "firstrun.referrer": "https://news.ycombinator.com/item?id=1",
      "firstrun.referrer.host": "news.ycombinator.com",
    });
  });

  test("the utm fields come from the page, not from the URL we happen to see", () => {
    const r = recorder();
    r.page.utm_source = "hn";
    r.page.utm_medium = "social";
    r.page.utm_campaign = "launch";
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();

    const view = drain(r, tag).find((e) => e.n === "page_view")!;
    expect(view.a!["firstrun.utm.source"]).toBe("hn");
    expect(view.a!["firstrun.utm.medium"]).toBe("social");
    expect(view.a!["firstrun.utm.campaign"]).toBe("launch");
  });
});

describe("page_leave", () => {
  test("carries visible time and deepest scroll, rounded and clamped", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);

    tag.leave(12_345.6, 103.2);
    const entries = drain(r, tag);
    expect(names(entries)).toEqual(["page_leave"]);
    expect(entries[0]!.a).toEqual({
      "firstrun.duration_ms": 12346,
      "firstrun.scroll_pct": 100,
    });
  });

  test("fires once per page view: visibilitychange and pagehide both arrive", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);

    tag.leave(1000, 10);
    tag.leave(1000, 10);
    expect(names(drain(r, tag))).toEqual(["page_leave"]);
  });
});

describe("web vitals", () => {
  test("are a measurement, not a kind of their own", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.vital("LCP", 1800);
    tag.vital("CLS", 0.4);

    // The same three attributes a desktop app would use for a queue depth. The
    // rating against Google's thresholds is not sent: the server has the same
    // table, and storing the answer on every row freezes it at write time.
    expect(drain(r, tag).map((e) => e.a)).toEqual([
      { "firstrun.metric": "LCP", "firstrun.value": 1800, "firstrun.unit": "ms" },
      { "firstrun.metric": "CLS", "firstrun.value": 0.4 },
    ]);
  });

  test("once per metric per document, and never for a metric we do not know", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.vital("LCP", 1000);
    tag.vital("LCP", 9000);
    tag.vital("FID", 10);
    expect(drain(r, tag).length).toBe(1);
  });
});

describe("links", () => {
  const classify = (href: string) => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);
    tag.linkClick(href, "https://themia.app/");
    return drain(r, tag).map((e) => ({ n: e.n, a: e.a }));
  };

  test("another origin is an outbound click", () => {
    expect(classify("https://github.com/themia/themia")).toEqual([
      {
        n: "outbound_click",
        a: { "url.full": "https://github.com/themia/themia", "url.domain": "github.com" },
      },
    ]);
  });

  test("our own pages are neither", () => {
    expect(classify("https://themia.app/pricing")).toEqual([]);
  });

  test("a file is a download wherever it is hosted", () => {
    expect(classify("https://themia.app/Themia-Setup-1.4.2-9GQ4T7BX.exe")).toEqual([
      {
        n: "file_download",
        a: {
          "url.full": "https://themia.app/Themia-Setup-1.4.2-9GQ4T7BX.exe",
          "firstrun.file.ext": "exe",
        },
      },
    ]);
  });

  test("a file on another origin is a download, not an outbound click", () => {
    expect(classify("https://cdn.example.com/press/kit.zip?v=2").map((e) => e.n)).toEqual([
      "file_download",
    ]);
  });

  test("a version number in a path is not an extension", () => {
    expect(classify("https://themia.app/releases/v1.4.2/notes")).toEqual([]);
  });

  test("mailto and tel are not links to anywhere", () => {
    expect(classify("mailto:hello@themia.app")).toEqual([]);
    expect(classify("tel:+41000000000")).toEqual([]);
  });
});

describe("form_submit", () => {
  test("carries the form's identity and nothing that was typed into it", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);
    tag.formSubmit("newsletter", "newsletter-form");
    expect(drain(r, tag)[0]!.a).toEqual({
      "firstrun.form.id": "newsletter",
      "firstrun.form.name": "newsletter-form",
    });
  });

  test("an anonymous form still counts", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.page();
    drain(r, tag);
    tag.formSubmit();
    const entries = drain(r, tag);
    expect(names(entries)).toEqual(["form_submit"]);
    expect(entries[0]!.a).toBeUndefined();
  });
});

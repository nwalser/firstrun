import { beforeEach, describe, expect, test } from "bun:test";
import { KEY_CONSENT, KEY_VID, createTag, type Env } from "../src/core.js";

/**
 * "Consent-gated" is a promise made to the people being measured. These are the
 * assertions that keep it.
 */

const SOURCE_KEY = "fr_web_1111222233334444";
const HOST = "https://t.example.com";

interface Recorder {
  env: Env;
  store: Map<string, string>;
  sent: Array<{ url: string; body: string }>;
  writes: string[];
  identityChanges: number;
}

function recorder(seed: Record<string, string> = {}): Recorder {
  const store = new Map(Object.entries(seed));
  const sent: Array<{ url: string; body: string }> = [];
  const writes: string[] = [];
  let n = 0;
  const r: Recorder = {
    store,
    sent,
    writes,
    identityChanges: 0,
    env: {
      now: () => 1_700_000_000_000,
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
      pageInfo: () => ({ url: "https://themia.app/", referrer: "https://google.com/", locale: "de-CH" }),
      identityChanged: () => {
        r.identityChanges++;
      },
    },
  };
  return r;
}

const tagFor = (r: Recorder) => createTag(r.env, { sourceKey: SOURCE_KEY, host: HOST });

describe("before consent", () => {
  let r: Recorder;
  beforeEach(() => {
    r = recorder();
  });

  test("nothing is stored", () => {
    const tag = tagFor(r);
    tag.page();
    tag.call("event", "clicked_download");
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

  test("no visitor id exists to attach to a download link", () => {
    const tag = tagFor(r);
    expect(tag.visitorId()).toBeNull();
    expect(tag.downloadUrl("Themia-Setup", "1.4.2")).not.toContain("vid=");
  });

  test("but events are held, so the first page view is not lost", () => {
    const tag = tagFor(r);
    tag.page();
    tag.call("event", "clicked_download");
    expect(tag.buffered()).toBe(2);
  });

  test("the buffer is bounded", () => {
    const tag = tagFor(r);
    for (let i = 0; i < 500; i++) tag.call("event", "e" + i);
    expect(tag.buffered()).toBeLessThanOrEqual(60);
  });
});

describe("granting consent", () => {
  test("stores an id, sends what was held, and redoes the download links", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.page();
    tag.call("event", "clicked_download");

    tag.call("consent", true);

    expect(r.store.get(KEY_CONSENT)).toBe("1");
    expect(r.store.get(KEY_VID)).toBeString();
    expect(r.identityChanges).toBe(1);
    expect(r.sent.length).toBe(1);

    const body = JSON.parse(r.sent[0]!.body);
    expect(r.sent[0]!.url).toBe(HOST + "/v1/e");
    expect(body.k).toBe(SOURCE_KEY);
    expect(body.v).toBe(r.store.get(KEY_VID));
    expect(body.e.length).toBe(2);
    expect(body.e[0].n).toBe("page_view");
    expect(body.e[0].u).toBe("https://themia.app/");
  });

  test("the download link then carries the visitor id", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    expect(tag.downloadUrl("Themia-Setup", "1.4.2")).toContain("vid=" + tag.visitorId());
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
    expect(body).not.toContain("event_name");
  });
});

describe("withdrawing consent", () => {
  test("clears the id, the flag, and anything still held", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    r.sent.length = 0;

    tag.call("event", "clicked_download");
    tag.call("consent", false);

    expect(r.store.has(KEY_VID)).toBe(false);
    expect(r.store.has(KEY_CONSENT)).toBe(false);
    expect(tag.visitorId()).toBeNull();
    expect(tag.buffered()).toBe(0);

    // Sending what we gathered while waiting for an answer, after the answer
    // was no, is what a consent banner exists to prevent.
    tag.flush();
    expect(r.sent).toEqual([]);
  });
});

describe("a returning visitor", () => {
  test("keeps the id they already had and sends straight away", () => {
    const r = recorder({ [KEY_CONSENT]: "1", [KEY_VID]: "v_existing" });
    const tag = tagFor(r);
    expect(tag.hasConsent()).toBe(true);
    expect(tag.visitorId()).toBe("v_existing");

    tag.page();
    tag.flush();
    expect(r.sent.length).toBe(1);
    expect(JSON.parse(r.sent[0]!.body).v).toBe("v_existing");
  });

  test("with the flag but no id gets a new id rather than sending without one", () => {
    const r = recorder({ [KEY_CONSENT]: "1" });
    const tag = tagFor(r);
    expect(tag.visitorId()).toBeString();
    expect(r.store.get(KEY_VID)).toBe(tag.visitorId()!);
  });
});

describe("identify", () => {
  test("puts the account id on the batch, where it becomes an exact join", () => {
    const r = recorder();
    const tag = tagFor(r);
    tag.call("consent", true);
    tag.call("identify", "acct_42");
    r.sent.length = 0;
    tag.call("event", "signed_in");
    tag.flush();
    expect(JSON.parse(r.sent[0]!.body).a).toBe("acct_42");
  });
});

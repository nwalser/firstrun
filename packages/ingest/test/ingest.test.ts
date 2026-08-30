import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SEVERITY } from "@firstrun/schema/severity";
import { handleEntries } from "../src/index.js";
import { beacon, createTestStack, type TestStack } from "./helpers/stack.js";

/**
 * The whole data plane, end to end, against a real database.
 *
 * The properties that decide whether a customer loses data: a batch lands, one
 * bad entry does not take the good ones with it, a key we do not know is
 * refused, and a replayed queue costs nothing.
 *
 * Plus the one this pivot is about: an exception, an event and a measurement
 * are the same row, on the same path, and nothing in here can tell them apart.
 */

let stack: TestStack;

beforeAll(async () => {
  stack = await createTestStack();
});

afterAll(async () => {
  await stack?.drop();
});

const ok = (res: Response) =>
  res.json() as Promise<{ accepted: number; duplicates: number; dropped: number }>;

interface Row {
  name: string;
  severity: number | null;
  distinct_id: string;
  attributes: Record<string, unknown>;
}

const rowsFor = (distinctId: string) =>
  stack.store.query<Row>(
    `SELECT name, severity, distinct_id, attributes
       FROM log_entries
      WHERE project_id = $1 AND distinct_id = $2
      ORDER BY "time"`,
    [stack.projectId, distinctId]
  );

const entry = (n: string, extra: Record<string, unknown> = {}) => ({
  i: crypto.randomUUID(),
  t: Date.now(),
  n,
  ...extra,
});

describe("a batch lands", () => {
  test("from the browser tag, on the surface its source says", async () => {
    const res = await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.webKey,
        d: "v_lands",
        r: { "session.id": "s_1", "user.id": "user-42", "browser.language": "de-CH" },
        e: [
          entry("page_view", {
            s: SEVERITY.INFO,
            a: { "url.full": "https://x.test/pricing", "url.path": "/pricing" },
          }),
          entry("download_clicked", { s: SEVERITY.INFO, a: { asset: "Setup" } }),
        ],
      }),
      stack.ctx
    );

    expect(res.status).toBe(202);
    expect(await ok(res)).toEqual({ accepted: 2, duplicates: 0, dropped: 0 });

    const rows = await rowsFor("v_lands");
    expect(rows.map((r) => r.name)).toEqual(["page_view", "download_clicked"]);
    expect(rows[0]!.severity).toBe(SEVERITY.INFO);
    // The surface is read off the stored source row, never off the body.
    expect(rows.every((r) => r.attributes["firstrun.source.surface"] === "web")).toBe(true);
    expect(rows[0]!.attributes["url.path"]).toBe("/pricing");
    expect(rows[1]!.attributes.asset).toBe("Setup");
  });

  test("with the resource merged into every row, so no query has to join", async () => {
    await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.appKey,
        d: "i_resource",
        r: { "service.version": "1.4.2", "os.type": "windows", "session.id": "s_9" },
        e: [entry("app_launch"), entry("exported_csv")],
      }),
      stack.ctx
    );

    const rows = await rowsFor("i_resource");
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.attributes["service.version"]).toBe("1.4.2");
      expect(r.attributes["os.type"]).toBe("windows");
      expect(r.attributes["session.id"]).toBe("s_9");
    }
  });

  test("an entry's own attribute beats the resource's, being the narrower claim", async () => {
    await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.appKey,
        d: "i_override",
        r: { "service.version": "1.4.2" },
        e: [entry("app_launch", { a: { "service.version": "1.5.0-beta" } })],
      }),
      stack.ctx
    );

    expect((await rowsFor("i_override"))[0]!.attributes["service.version"]).toBe("1.5.0-beta");
  });

  test("but a client cannot claim a surface: the edge stamps over it", async () => {
    await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.webKey,
        d: "v_liar",
        r: { "firstrun.source.surface": "desktop" },
        e: [entry("page_view", { a: { "firstrun.source.surface": "server" } })],
      }),
      stack.ctx
    );

    const row = (await rowsFor("v_liar"))[0]!;
    expect(row.attributes["firstrun.source.surface"]).toBe("web");
    expect(row.attributes["firstrun.source.id"]).toBeString();
  });

  test("with a name nothing has ever heard of", async () => {
    const res = await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.appKey,
        d: "i_arbitrary",
        e: [entry("invoice.exported")],
      }),
      stack.ctx
    );

    expect((await ok(res)).accepted).toBe(1);
    expect((await rowsFor("i_arbitrary"))[0]!.name).toBe("invoice.exported");
  });
});

describe("one row shape for everything", () => {
  test("an exception, an event and a measurement take the same path", async () => {
    const res = await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.appKey,
        d: "i_one_shape",
        e: [
          entry("exception", {
            s: SEVERITY.ERROR,
            a: {
              "exception.type": "TypeError",
              "exception.message": "x is not a function",
              "exception.escaped": true,
            },
          }),
          entry("exported_csv", { s: SEVERITY.INFO, a: { rows: 40 } }),
          entry("measurement", {
            s: SEVERITY.INFO,
            a: { "firstrun.metric": "queue_depth", "firstrun.value": 12 },
          }),
        ],
      }),
      stack.ctx
    );

    expect(await ok(res)).toEqual({ accepted: 3, duplicates: 0, dropped: 0 });

    const rows = await rowsFor("i_one_shape");
    expect(rows.map((r) => r.name)).toEqual(["exception", "exported_csv", "measurement"]);
    expect(rows.map((r) => r.severity)).toEqual([SEVERITY.ERROR, SEVERITY.INFO, SEVERITY.INFO]);
    // Nothing about the exception routed it anywhere else, and nothing derived
    // a second entry from it. Three in, three rows, one table.
    const all = await stack.store.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM log_entries WHERE project_id = $1 AND distinct_id = $2`,
      [stack.projectId, "i_one_shape"]
    );
    expect(all[0]!.n).toBe(3);
  });

  test("attribute values keep their JSON type, so a number is not a string", async () => {
    await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.webKey,
        d: "v_types",
        e: [
          entry("web_vital", {
            a: { "firstrun.metric": "LCP", "firstrun.value": 1834.5, "firstrun.unit": "ms" },
          }),
        ],
      }),
      stack.ctx
    );

    const a = (await rowsFor("v_types"))[0]!.attributes;
    expect(a["firstrun.value"]).toBe(1834.5);
    expect(typeof a["firstrun.value"]).toBe("number");
  });

  test("an entry with no severity keeps none: unclassified is not INFO", async () => {
    await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.appKey,
        d: "i_unclassified",
        e: [entry("something.happened")],
      }),
      stack.ctx
    );

    expect((await rowsFor("i_unclassified"))[0]!.severity).toBeNull();
  });

  test("the whole 1..24 ladder is storable, not just the six band starts", async () => {
    await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.appKey,
        d: "i_ladder",
        e: [entry("a", { s: 1 }), entry("b", { s: 14 }), entry("c", { s: 24 })],
      }),
      stack.ctx
    );

    expect((await rowsFor("i_ladder")).map((r) => r.severity).sort((x, y) => x! - y!)).toEqual([
      1, 14, 24,
    ]);
  });
});

describe("a malformed entry", () => {
  test("is dropped, and the good entries in the same batch still land", async () => {
    const res = await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.webKey,
        d: "v_partial",
        e: [
          entry("page_view"),
          // Not a uuid, so it could never dedup.
          { i: "not-a-uuid", t: Date.now(), n: "page_view" },
          // A colon is reserved: a name may not forge a derived query key.
          entry("bad:name"),
          { i: crypto.randomUUID(), t: "yesterday", n: "session_start" },
          // Off the ladder entirely.
          entry("too_severe", { s: 99 }),
          entry("outbound_click"),
        ],
      }),
      stack.ctx
    );

    expect(res.status).toBe(202);
    expect(await ok(res)).toEqual({ accepted: 2, duplicates: 0, dropped: 4 });
    expect((await rowsFor("v_partial")).map((r) => r.name)).toEqual([
      "page_view",
      "outbound_click",
    ]);
  });

  test("on its own leaves nothing to store, and still is not an error", async () => {
    const res = await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.appKey,
        d: "i_all_bad",
        e: [{ i: "nope", t: Date.now(), n: "app_launch" }],
      }),
      stack.ctx
    );

    expect(res.status).toBe(202);
    expect(await ok(res)).toEqual({ accepted: 0, duplicates: 0, dropped: 1 });
    expect(await rowsFor("i_all_bad")).toEqual([]);
  });

  test("an attribute map past its bounds is a shape problem, so that entry goes", async () => {
    const huge: Record<string, number> = {};
    for (let i = 0; i < 200; i++) huge["k" + i] = i;

    const res = await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.appKey,
        d: "i_bounds",
        e: [entry("fine"), entry("too_many_attributes", { a: huge })],
      }),
      stack.ctx
    );

    expect(await ok(res)).toEqual({ accepted: 1, duplicates: 0, dropped: 1 });
    expect((await rowsFor("i_bounds")).map((r) => r.name)).toEqual(["fine"]);
  });

  test("a bad resource costs the resource, not the entries underneath it", async () => {
    const huge: Record<string, number> = {};
    for (let i = 0; i < 200; i++) huge["k" + i] = i;

    const res = await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.appKey,
        d: "i_bad_resource",
        r: huge,
        e: [entry("app_launch")],
      }),
      stack.ctx
    );

    // The entry is what the customer will miss. A resource is decoration on it.
    expect(await ok(res)).toEqual({ accepted: 1, duplicates: 0, dropped: 0 });
    const row = (await rowsFor("i_bad_resource"))[0]!;
    expect(row.attributes.k0).toBeUndefined();
    expect(row.attributes["firstrun.source.surface"]).toBe("desktop");
  });

  test("but a batch with no distinct id is refused: there is nothing to attribute", async () => {
    const res = await handleEntries(
      beacon("http://test.local/v1/e", { k: stack.webKey, e: [entry("page_view")] }),
      stack.ctx
    );
    expect(res.status).toBe(400);
  });
});

describe("an unknown source key", () => {
  test("is rejected, and nothing is written", async () => {
    const res = await handleEntries(
      beacon("http://test.local/v1/e", {
        k: "fr_web_0123456789abcdef",
        d: "v_unknown",
        e: [entry("page_view")],
      }),
      stack.ctx
    );

    expect(res.status).toBe(404);
    expect(await rowsFor("v_unknown")).toEqual([]);
  });

  test("and so is a body that names no source at all", async () => {
    const res = await handleEntries(
      beacon("http://test.local/v1/e", { d: "v_none", e: [] }),
      stack.ctx
    );
    expect(res.status).toBe(400);
  });
});

describe("a replayed queue", () => {
  test("is deduplicated by the primary key, not by a side table", async () => {
    const one = entry("app_launch");
    const batch = { k: stack.appKey, d: "i_replay", e: [one] };

    const first = await handleEntries(beacon("http://test.local/v1/e", batch), stack.ctx);
    expect(await ok(first)).toEqual({ accepted: 1, duplicates: 0, dropped: 0 });

    // The SDK crashed before it could clear the queue and sent the same bytes
    // again. That is the normal case, so it is a 202 with a count, not an error.
    const second = await handleEntries(beacon("http://test.local/v1/e", batch), stack.ctx);
    expect(second.status).toBe(202);
    expect(await ok(second)).toEqual({ accepted: 0, duplicates: 1, dropped: 0 });

    expect((await rowsFor("i_replay")).length).toBe(1);
  });

  test("dedups within one batch too, so a doubled queue file costs one row", async () => {
    const one = entry("app_launch");
    const res = await handleEntries(
      beacon("http://test.local/v1/e", { k: stack.appKey, d: "i_doubled", e: [one, one] }),
      stack.ctx
    );

    expect(await ok(res)).toEqual({ accepted: 1, duplicates: 1, dropped: 0 });
    expect((await rowsFor("i_doubled")).length).toBe(1);
  });
});

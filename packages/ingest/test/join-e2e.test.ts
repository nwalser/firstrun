import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { funnel } from "@firstrun/db";
import { EVENT, tokenFromFilename } from "@firstrun/schema";
import { handleAsset, handleClaim, handleDownload, handleEvents } from "../src/index.js";
import { FROM_IP, beacon, createTestStack, jsonRequest, type TestStack } from "./helpers/stack.js";

/**
 * The product, in one test.
 *
 * A stranger reads the marketing site, downloads the installer, runs it on a
 * machine that has never spoken to us before, and pays. If those five things do
 * not come back as ONE person, there is nothing here that Plausible does not
 * already do.
 */

let stack: TestStack;

beforeAll(async () => {
  stack = await createTestStack();
});

afterAll(async () => {
  await stack?.drop();
});

describe("visitor -> download -> first run -> paid", () => {
  const visitorId = "v_" + crypto.randomUUID().slice(0, 8);
  const installId = "i_" + crypto.randomUUID().slice(0, 8);
  let token: string;

  test("a visit is recorded against a web visitor", async () => {
    const res = await handleEvents(
      beacon("http://test.local/v1/e", {
        k: stack.webKey,
        v: visitorId,
        s: "s1",
        e: [
          {
            i: crypto.randomUUID(),
            n: EVENT.PAGE_VIEW,
            t: Date.now() - 60_000,
            u: "https://themia.app/",
            l: "de-CH",
          },
        ],
      }),
      stack.ctx
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0, dropped: 0 });
  });

  test("an unknown source key is refused", async () => {
    const res = await handleEvents(
      beacon("http://test.local/v1/e", {
        k: "fr_web_0000000000000000",
        v: visitorId,
        e: [{ i: crypto.randomUUID(), n: EVENT.PAGE_VIEW, t: Date.now() }],
      }),
      stack.ctx
    );
    expect(res.status).toBe(404);
  });

  test("the download mints a token and puts it in the filename", async () => {
    const res = await handleDownload(
      new Request(
        `http://test.local/v1/download?key=${stack.appKey}&vid=${visitorId}&version=1.4.2`,
        { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
      ),
      stack.ctx,
      FROM_IP
    );
    expect(res.status).toBe(302);

    const location = res.headers.get("location")!;
    expect(location).toStartWith("http://test.local/dl/");

    const filename = location.split("/").pop()!;
    expect(filename).toMatch(/^Themia-Setup-1\.4\.2-[0-9A-HJKMNP-TV-Z]{8}\.exe$/);

    token = tokenFromFilename(filename)!;
    expect(token).not.toBeNull();
    // The path segment and the filename carry the same token; the install hook
    // only ever sees the filename.
    expect(location).toContain(`/dl/${token}/`);
  });

  test("the installer streams under that filename", async () => {
    const filename = `Themia-Setup-1.4.2-${token}.exe`;
    const res = await handleAsset(stack.ctx, token, filename);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(filename);
  });

  test("first run claims the token and joins the install to the visitor", async () => {
    const res = await handleClaim(
      jsonRequest("http://test.local/v1/claim", {
        source_key: stack.appKey,
        install_id: installId,
        token,
        app_version: "1.4.2",
        os: "windows",
        arch: "x86_64",
        locale: "de-CH",
      }),
      stack.ctx,
      FROM_IP
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { person_id: string; join: { method: string; confidence: number } };
    expect(body.join.method).toBe("token");
    expect(body.join.confidence).toBe(1);
    expect(body.person_id).toBeString();
  });

  test("the visitor and the install are ONE person", async () => {
    const asWeb = await stack.ctx.resolver.resolve(stack.projectId, {
      type: "web_visitor",
      id: visitorId,
    });
    const asInstall = await stack.ctx.resolver.resolve(stack.projectId, {
      type: "install",
      id: installId,
    });
    expect(asInstall).toBe(asWeb);
  });

  test("that one person carries both a web_visitor_id and an install_id", async () => {
    const rows = await stack.store.query<{
      person_id: string;
      visitors: string[];
      installs: string[];
    }>(
      `SELECT person_id,
              array_remove(array_agg(DISTINCT web_visitor_id), NULL) AS visitors,
              array_remove(array_agg(DISTINCT install_id), NULL)     AS installs
         FROM events_resolved
        WHERE project_id = $1
        GROUP BY person_id`,
      [stack.projectId]
    );

    expect(rows.length).toBe(1);
    expect(rows[0]!.visitors).toEqual([visitorId]);
    expect(rows[0]!.installs).toEqual([installId]);
  });

  test("the person spans two sources, because a project is one identity namespace", async () => {
    const rows = await stack.store.query<{ sources: number }>(
      `SELECT count(DISTINCT source_id)::int AS sources
         FROM events_resolved WHERE project_id = $1`,
      [stack.projectId]
    );
    expect(rows[0]!.sources).toBe(2);
  });

  test("the funnel counts them exactly once at every step", async () => {
    // Pay, from inside the app.
    const res = await handleEvents(
      beacon("http://test.local/v1/e", {
        source_key: stack.appKey,
        install_id: installId,
        app_version: "1.4.2",
        os: "windows",
        events: [{ event_id: crypto.randomUUID(), event_name: EVENT.PURCHASE, event_time: Date.now() }],
      }),
      stack.ctx
    );
    expect(res.status).toBe(202);

    const now = Date.now();
    const result = await funnel(stack.store, {
      projectId: stack.projectId,
      from: new Date(now - 30 * 864e5),
      to: new Date(now + 864e5),
    });

    expect(result.exact).toEqual({ visited: 1, downloaded: 1, first_run: 1, paid: 1 });
    // No estimate edges exist, so the estimated pass sees the same person and
    // reports the same numbers. The difference -- what the screen labels as
    // estimated -- is zero.
    expect(result.estimated).toEqual(result.exact);
  });

  test("a replayed event is not counted twice", async () => {
    const eventId = crypto.randomUUID();
    const send = () =>
      handleEvents(
        beacon("http://test.local/v1/e", {
          source_key: stack.appKey,
          install_id: installId,
          app_version: "1.4.2",
          events: [{ event_id: eventId, event_name: EVENT.APP_LAUNCH, event_time: Date.now() }],
        }),
        stack.ctx
      );

    expect(await (await send()).json()).toEqual({ accepted: 1, duplicates: 0, dropped: 0 });
    expect(await (await send()).json()).toEqual({ accepted: 0, duplicates: 1, dropped: 0 });
  });

  test("a client that asserts a person_id is refused", async () => {
    const res = await handleEvents(
      beacon("http://test.local/v1/e", {
        k: stack.webKey,
        v: visitorId,
        person_id: crypto.randomUUID(),
        e: [],
      }),
      stack.ctx
    );
    expect(res.status).toBe(400);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { EVENT, tokenFromFilename } from "@firstrun/schema";
import { funnel } from "@firstrun/db";
import { FROM_IP, createTestStack, type TestStack } from "./helpers/stack.js";

/**
 * The product, in one test.
 *
 * A stranger reads the marketing site, downloads the installer, runs it on a
 * machine that has never spoken to us before, and pays. If those five things
 * do not come back as ONE person, there is nothing here that PostHog and
 * Plausible do not already do.
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
    const res = await stack.app.request(
      "/v1/e",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          p: stack.projectId,
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
      },
      FROM_IP
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0 });
  });

  test("the download mints a token and puts it in the filename", async () => {
    const res = await stack.app.request(
      `/v1/download?project=${stack.projectId}&vid=${visitorId}&version=1.4.2`,
      { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } },
      FROM_IP
    );
    expect(res.status).toBe(302);

    const location = res.headers.get("location")!;
    expect(location).toStartWith("http://test.local/dl/");

    const filename = location.split("/").pop()!;
    expect(filename).toMatch(/^Themia-Setup-1\.4\.2-[0-9A-HJKMNP-TV-Z]{8}\.exe$/);

    token = tokenFromFilename(filename)!;
    expect(token).not.toBeNull();
    // The path segment and the filename carry the same token; the NSIS hook
    // only ever sees the filename.
    expect(location).toContain(`/dl/${token}/`);
  });

  test("the installer streams under that filename", async () => {
    const filename = `Themia-Setup-1.4.2-${token}.exe`;
    const res = await stack.app.request(`/dl/${token}/${filename}`, {}, FROM_IP);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(filename);
  });

  test("first run claims the token and joins the install to the visitor", async () => {
    const res = await stack.app.request(
      "/v1/claim",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          install_id: installId,
          token,
          app_version: "1.4.2",
          os: "windows",
          arch: "x86_64",
          locale: "de-CH",
        }),
      },
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
    const rows = await stack.ch.query<{
      person_id: string;
      visitors: string[];
      installs: string[];
    }>(
      `SELECT person_id,
              groupUniqArray(web_visitor_id) AS visitors,
              groupUniqArray(install_id) AS installs
         FROM events_resolved
        WHERE project_id = {project:UUID}
        GROUP BY person_id`,
      { project: stack.projectId }
    );

    expect(rows.length).toBe(1);
    expect(rows[0]!.visitors).toEqual([visitorId]);
    expect(rows[0]!.installs).toEqual([installId]);
  });

  test("the funnel counts them exactly once at every step", async () => {
    // Pay, from inside the app.
    const res = await stack.app.request(
      "/v1/e",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          project_id: stack.projectId,
          install_id: installId,
          app_version: "1.4.2",
          os: "windows",
          events: [{ event_id: crypto.randomUUID(), event_name: EVENT.PURCHASE, event_time: Date.now() }],
        }),
      },
      FROM_IP
    );
    expect(res.status).toBe(202);

    const now = Date.now();
    const result = await funnel(stack.ch, {
      projectId: stack.projectId,
      from: now - 30 * 864e5,
      to: now + 864e5,
    });

    expect(result.exact).toEqual({ visited: 1, downloaded: 1, first_run: 1, paid: 1 });
    // No estimate edges exist, so the estimated pass sees exactly the same
    // person and reports the same numbers. The difference -- what the screen
    // labels as estimated -- is zero.
    expect(result.estimated).toEqual(result.exact);
  });

  test("a replayed event is not counted twice", async () => {
    const eventId = crypto.randomUUID();
    const send = () =>
      stack.app.request(
        "/v1/e",
        {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify({
            project_id: stack.projectId,
            install_id: installId,
            app_version: "1.4.2",
            events: [{ event_id: eventId, event_name: EVENT.APP_LAUNCH, event_time: Date.now() }],
          }),
        },
        FROM_IP
      );

    expect(await (await send()).json()).toEqual({ accepted: 1, duplicates: 0 });
    expect(await (await send()).json()).toEqual({ accepted: 0, duplicates: 1 });
  });

  test("a client that asserts a person_id is refused", async () => {
    const res = await stack.app.request(
      "/v1/e",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ p: stack.projectId, v: visitorId, person_id: crypto.randomUUID(), e: [] }),
      },
      FROM_IP
    );
    expect(res.status).toBe(400);
  });
});

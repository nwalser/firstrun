import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { EVENT } from "@firstrun/schema";
import { funnel } from "@firstrun/db";
import { FROM_IP, createTestStack, type TestStack } from "./helpers/stack.js";

/**
 * The untokened install: winget, a store, a link a colleague pasted.
 *
 * We can guess who it was. We are not allowed to act as though we know. So the
 * guess shows up as a second number on the screen and changes nothing about
 * who anybody is. See CLAUDE.md rule 1.
 */

let stack: TestStack;

beforeAll(async () => {
  stack = await createTestStack();
});

afterAll(async () => {
  await stack?.drop();
});

describe("an install that arrives with no token", () => {
  const visitorId = "v_est";
  const installId = "i_est";

  test("visits and downloads, but the installer's filename never reaches the app", async () => {
    await stack.app.request(
      "/v1/e",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          p: stack.projectId,
          v: visitorId,
          e: [{ i: crypto.randomUUID(), n: EVENT.PAGE_VIEW, t: Date.now() - 120_000 }],
        }),
      },
      FROM_IP
    );

    const res = await stack.app.request(
      `/v1/download?project=${stack.projectId}&vid=${visitorId}&version=1.4.2`,
      { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } },
      FROM_IP
    );
    expect(res.status).toBe(302);
  });

  test("first run with no token still gets matched, as an estimate", async () => {
    const res = await stack.app.request(
      "/v1/claim",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: stack.projectId,
          install_id: installId,
          token: null,
          app_version: "1.4.2",
          os: "windows",
        }),
      },
      FROM_IP
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { join: { method: string; confidence: number } };
    expect(body.join.method).toBe("estimate");
    expect(body.join.confidence).toBeLessThan(1);
    expect(body.join.confidence).toBeGreaterThan(0);
  });

  test("but the visitor and the install are still two people", async () => {
    const asWeb = await stack.ctx.resolver.resolve(stack.projectId, {
      type: "web_visitor",
      id: visitorId,
    });
    const asInstall = await stack.ctx.resolver.resolve(stack.projectId, {
      type: "install",
      id: installId,
    });
    expect(asInstall).not.toBe(asWeb);
  });

  test("and no override was written", async () => {
    const rows = await stack.ch.query<{ n: string }>(
      `SELECT count() AS n FROM person_overrides WHERE project_id = {project:UUID}`,
      { project: stack.projectId }
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  test("the funnel reports the guess as its own number, next to the exact one", async () => {
    const now = Date.now();
    const window = { projectId: stack.projectId, from: now - 30 * 864e5, to: now + 864e5 };
    const result = await funnel(stack.ch, window);

    // Nobody can be *proven* to have walked visit -> download -> first run.
    expect(result.exact.visited).toBe(1);
    expect(result.exact.downloaded).toBe(1);
    expect(result.exact.first_run).toBe(0);

    // Allowing the estimate to bridge the two halves, one person did.
    expect(result.estimated.first_run).toBe(1);

    // Which is what the screen labels: exact 0, estimated +1. Never 1.
    expect(result.estimated.first_run - result.exact.first_run).toBe(1);
  });
});

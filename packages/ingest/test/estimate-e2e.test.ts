import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { funnel } from "@firstrun/db";
import { EVENT } from "@firstrun/schema";
import { handleClaim, handleDownload, handleEvents } from "../src/index.js";
import { FROM_IP, beacon, createTestStack, jsonRequest, type TestStack } from "./helpers/stack.js";

/**
 * The untokened install: winget, a store, a link a colleague pasted.
 *
 * We can guess who it was. We are not allowed to act as though we know. So the
 * guess shows up as a second number and changes nothing about who anybody is.
 * See CLAUDE.md rule 1.
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
    await handleEvents(
      beacon("http://test.local/v1/e", {
        k: stack.webKey,
        v: visitorId,
        e: [{ i: crypto.randomUUID(), n: EVENT.PAGE_VIEW, t: Date.now() - 120_000 }],
      }),
      stack.ctx
    );

    const res = await handleDownload(
      new Request(`http://test.local/v1/download?key=${stack.appKey}&vid=${visitorId}&version=1.4.2`, {
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      }),
      stack.ctx,
      FROM_IP
    );
    expect(res.status).toBe(302);
  });

  test("first run with no token still gets matched, as an estimate", async () => {
    const res = await handleClaim(
      jsonRequest("http://test.local/v1/claim", {
        source_key: stack.appKey,
        install_id: installId,
        token: null,
        app_version: "1.4.2",
        os: "windows",
      }),
      stack.ctx,
      FROM_IP
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { join: { method: string; confidence: number } };
    expect(body.join.method).toBe("estimate");
    expect(body.join.confidence).toBeLessThan(1);
    expect(body.join.confidence).toBeGreaterThan(0);
  });

  test("but the visitor and the install are still two people", async () => {
    const asWeb = await stack.ctx.resolver.resolve(stack.workspaceId, {
      type: "web_visitor",
      id: visitorId,
    });
    const asInstall = await stack.ctx.resolver.resolve(stack.workspaceId, {
      type: "install",
      id: installId,
    });
    expect(asInstall).not.toBe(asWeb);
  });

  test("and no override was written", async () => {
    const rows = await stack.store.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM person_overrides WHERE workspace_id = $1`,
      [stack.workspaceId]
    );
    expect(rows[0]!.n).toBe(0);
  });

  test("the funnel reports the guess as its own number, next to the exact one", async () => {
    const now = Date.now();
    const result = await funnel(stack.store, {
      workspaceId: stack.workspaceId,
      from: new Date(now - 30 * 864e5),
      to: new Date(now + 864e5),
    });

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

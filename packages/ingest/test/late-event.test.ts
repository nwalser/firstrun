import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { EVENT } from "@firstrun/schema";
import { handleEvents } from "../src/index.js";
import { beacon, createTestStack, type TestStack } from "./helpers/stack.js";

/**
 * CLAUDE.md rule 2.
 *
 * A desktop app is offline for the weekend, the OS kills it, the queue replays
 * on Monday. Every one of those events happened when it happened. If ingest
 * time leaks into a bucket, Friday's usage shows up as Monday's spike, the
 * retention curve is wrong in the direction that flatters us, and nobody
 * notices because the numbers still look plausible.
 */

let stack: TestStack;
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  stack = await createTestStack();
});

afterAll(async () => {
  await stack?.drop();
});

describe("a late-arriving event", () => {
  const installId = "i_late";
  const threeDaysAgo = Date.now() - 3 * DAY;

  test("is stored with the day it happened, not the day it arrived", async () => {
    const res = await handleEvents(
      beacon("http://test.local/v1/e", {
        source_key: stack.appKey,
        install_id: installId,
        app_version: "1.4.2",
        events: [
          { event_id: crypto.randomUUID(), event_name: EVENT.APP_LAUNCH, event_time: threeDaysAgo },
        ],
      }),
      stack.ctx
    );
    expect(res.status).toBe(202);

    const rows = await stack.store.query<{ event_day: string; ingest_day: string; drift_days: number }>(
      `SELECT to_char(event_time  AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS event_day,
              to_char(ingest_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS ingest_day,
              (date_trunc('day', ingest_time) - date_trunc('day', event_time)) AS drift
         FROM events
        WHERE project_id = $1 AND install_id = $2`,
      [stack.projectId, installId]
    );

    expect(rows.length).toBe(1);
    const expectedDay = new Date(threeDaysAgo).toISOString().slice(0, 10);
    expect(rows[0]!.event_day).toBe(expectedDay);
    // Both timestamps are kept, and they genuinely differ. A schema that
    // quietly overwrote one with the other would still pass the line above.
    expect(rows[0]!.ingest_day).not.toBe(expectedDay);
  });

  test("falls in the day bucket it belongs to, three days back", async () => {
    const rows = await stack.store.query<{ day: string; n: number }>(
      `SELECT to_char(date_trunc('day', event_time) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              count(*)::int AS n
         FROM events_resolved
        WHERE project_id = $1
          AND event_time >= $2
          AND event_time <  $3
        GROUP BY 1
        ORDER BY 1`,
      [stack.projectId, new Date(Date.now() - 4 * DAY), new Date(Date.now() - 2 * DAY)]
    );

    expect(rows.length).toBe(1);
    expect(rows[0]!.day).toBe(new Date(threeDaysAgo).toISOString().slice(0, 10));
    expect(rows[0]!.n).toBe(1);
  });

  test("and is absent from today's bucket, where it arrived", async () => {
    const rows = await stack.store.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM events_resolved
        WHERE project_id = $1 AND date_trunc('day', event_time) = date_trunc('day', now())`,
      [stack.projectId]
    );
    expect(rows[0]!.n).toBe(0);
  });
});

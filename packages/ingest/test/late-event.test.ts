import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { handleEntries } from "../src/index.js";
import { beacon, createTestStack, type TestStack } from "./helpers/stack.js";

/**
 * `time` is the client's and `ingested_at` is ours, and nothing buckets on ours.
 *
 * OTel calls the pair `timestamp` and `observed_timestamp`. A desktop app is
 * offline for the weekend, the OS kills it, the queue replays on Monday. Every
 * one of those entries happened when it happened. If ingest time leaks into a
 * bucket, Friday's usage shows up as Monday's spike, the retention curve is
 * wrong in the direction that flatters us, and nobody notices because the
 * numbers still look plausible.
 *
 * It is also the partition key, so this is the promise the retention policy
 * rests on too: an entry is retained by when it happened, not by when it landed.
 */

let stack: TestStack;
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  stack = await createTestStack();
});

afterAll(async () => {
  await stack?.drop();
});

describe("a late-arriving entry", () => {
  const distinctId = "i_late";
  const threeDaysAgo = Date.now() - 3 * DAY;

  test("is stored with the day it happened, not the day it arrived", async () => {
    const res = await handleEntries(
      beacon("http://test.local/v1/e", {
        k: stack.appKey,
        d: distinctId,
        r: { "service.version": "1.4.2" },
        e: [{ i: crypto.randomUUID(), t: threeDaysAgo, n: "app_launch" }],
      }),
      stack.ctx
    );
    expect(res.status).toBe(202);

    const rows = await stack.store.query<{ event_day: string; ingest_day: string }>(
      `SELECT to_char("time"      AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS event_day,
              to_char(ingested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS ingest_day
         FROM log_entries
        WHERE project_id = $1 AND distinct_id = $2`,
      [stack.projectId, distinctId]
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
      `SELECT to_char(date_trunc('day', "time") AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              count(*)::int AS n
         FROM log_entries
        WHERE project_id = $1
          AND "time" >= $2
          AND "time" <  $3
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
         FROM log_entries
        WHERE project_id = $1 AND date_trunc('day', "time") = date_trunc('day', now())`,
      [stack.projectId]
    );
    expect(rows[0]!.n).toBe(0);
  });
});

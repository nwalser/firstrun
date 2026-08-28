import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { EVENT } from "@firstrun/schema";
import { FROM_IP, createTestStack, type TestStack } from "./helpers/stack.js";

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

beforeAll(async () => {
  stack = await createTestStack();
});

afterAll(async () => {
  await stack?.drop();
});

const DAY = 24 * 60 * 60 * 1000;

describe("a late-arriving event", () => {
  const installId = "i_late";
  const threeDaysAgo = Date.now() - 3 * DAY;

  test("is stored with the day it happened, not the day it arrived", async () => {
    const res = await stack.app.request(
      "/v1/e",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          project_id: stack.projectId,
          install_id: installId,
          app_version: "1.4.2",
          events: [
            {
              event_id: crypto.randomUUID(),
              event_name: EVENT.APP_LAUNCH,
              event_time: threeDaysAgo,
            },
          ],
        }),
      },
      FROM_IP
    );
    expect(res.status).toBe(202);

    const rows = await stack.ch.query<{ event_day: string; ingest_day: string; drift_days: number }>(
      `SELECT toDate(event_time) AS event_day,
              toDate(ingest_time) AS ingest_day,
              dateDiff('day', toDate(event_time), toDate(ingest_time)) AS drift_days
         FROM events
        WHERE project_id = {project:UUID} AND install_id = {install:String}`,
      { project: stack.projectId, install: installId }
    );

    expect(rows.length).toBe(1);
    const expectedDay = new Date(threeDaysAgo).toISOString().slice(0, 10);
    expect(rows[0]!.event_day).toBe(expectedDay);
    // Both timestamps are kept, and they genuinely differ. A schema that
    // quietly overwrote one with the other would still pass the line above.
    expect(rows[0]!.ingest_day).not.toBe(expectedDay);
    expect(Number(rows[0]!.drift_days)).toBe(3);
  });

  test("falls in the day bucket it belongs to, three days back", async () => {
    const rows = await stack.ch.query<{ day: string; n: string }>(
      `SELECT toDate(event_time) AS day, count() AS n
         FROM events_resolved
        WHERE project_id = {project:UUID}
          AND event_time >= {from:DateTime64(3)}
          AND event_time <  {to:DateTime64(3)}
        GROUP BY day
        ORDER BY day`,
      {
        project: stack.projectId,
        from: new Date(Date.now() - 4 * DAY).toISOString().replace("T", " ").replace("Z", ""),
        to: new Date(Date.now() - 2 * DAY).toISOString().replace("T", " ").replace("Z", ""),
      }
    );

    expect(rows.length).toBe(1);
    expect(rows[0]!.day).toBe(new Date(threeDaysAgo).toISOString().slice(0, 10));
    expect(Number(rows[0]!.n)).toBe(1);
  });

  test("and is absent from today's bucket, where it arrived", async () => {
    const rows = await stack.ch.query<{ n: string }>(
      `SELECT count() AS n
         FROM events_resolved
        WHERE project_id = {project:UUID}
          AND toDate(event_time) = today()`,
      { project: stack.projectId }
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

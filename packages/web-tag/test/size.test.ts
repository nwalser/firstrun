import { describe, expect, test } from "bun:test";
import { MAX_GZIP_BYTES, build } from "../build.js";

/**
 * The budget, enforced here as well as in CI.
 *
 * A size limit that only exists in a CI config is a limit you discover after
 * you have already written the feature. This one fails in `bun test`, next to
 * the change that caused it.
 */
describe("the tag stays small", () => {
  test(`is under ${MAX_GZIP_BYTES} bytes gzipped`, async () => {
    const { gzip, raw } = await build();
    console.log(`      web-tag: ${raw} B raw, ${gzip} B gzipped`);
    expect(gzip).toBeLessThanOrEqual(MAX_GZIP_BYTES);
  }, 30_000);

  test("sends with sendBeacon, and only falls back to fetch when it is absent", async () => {
    const { code } = await build();
    expect(code).toContain("sendBeacon");
    // A fetch in an unload handler is a request the browser may cancel. The
    // only fetch in the bundle is behind the sendBeacon check.
    const beaconAt = code.indexOf("sendBeacon");
    const fetchAt = code.indexOf("fetch(");
    expect(fetchAt).toBeGreaterThan(beaconAt);
  }, 30_000);

  test("flushes on the two events that actually fire", async () => {
    const { code } = await build();
    expect(code).toContain("visibilitychange");
    expect(code).toContain("pagehide");
  }, 30_000);
});

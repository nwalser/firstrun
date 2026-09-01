#!/usr/bin/env bun
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

/**
 * Builds the tag and enforces its size budget.
 *
 * The budget is not decoration. This file loads on someone else's marketing
 * site, ahead of their content, and the moment it stops being negligible it
 * becomes a thing they have to think about. `--check` fails the build rather
 * than warning, because a warning in CI is a number that only goes up.
 *
 * One bundle comes out of here, `tag.js`, and it is what `/t.js` serves to
 * everybody: the same bytes for every source, measured against one budget.
 */

/**
 * 4.25KB.
 *
 * It was 3KB when the tag did one thing: a page view, at 1493 B gzipped. It now
 * cuts sessions, follows SPA navigations, times and measures the page it is on,
 * watches every click and submit, observes five Core Web Vitals, can report
 * uncaught exceptions, carries the delivery policy (coalescing, a schedule, and
 * a severity that jumps it), and offers an ephemeral identity.
 *
 * The budget is a product constraint rather than a high-water mark, so it does
 * not follow the number down: it is whether a customer can paste this inline
 * into their `<head>` without thinking about it, and it is still an order of
 * magnitude under an initial congestion window. The next feature that does not
 * fit should argue for itself rather than for the budget.
 *
 * It was 4KB with 24 B left, which is a rounding error rather than headroom,
 * and the delivery policy had already paid its way in by spending settings
 * instead of bytes: `maxBatch`, the coalescing window and the exit flush are
 * constants here rather than options, because this is the one place in the
 * product where a knob nobody turns still costs every visitor bytes.
 *
 * `ephemeral` is the feature that argued rather than displaced, and this is the
 * argument. Every other line in this file is measured against bytes on someone
 * else's marketing site; `ephemeral` is measured against the thing that is on
 * that page INSTEAD when the id is persistent, which is a consent banner. A
 * banner is markup, a second script, a layout shift, a click, and a meaningful
 * share of visitors answering no. Refusing this at 4KB does not save the page
 * 47 B, it costs the page a banner or costs the customer the measurement, and
 * neither is a trade the budget was written to make.
 *
 * The rule is unchanged for the next one: displace something, or make an
 * argument this size.
 *
 * ## 4.25 KiB to 4.75 KiB: the three identity calls, and the fingerprint
 *
 * The second feature to argue rather than displace, and the argument is the
 * same shape. Identity became three optional things a customer states rather
 * than one id the tag minted for itself: `user()`, `device()`, `session()`.
 * Together with the session id surviving a full page load, and with the
 * fingerprint behind `data-fingerprint`, they cost about 490 B gzipped. That
 * does not fit, and squeezing it into 24 B of slack would have meant shipping
 * two of the three.
 *
 * What it buys is the thing the tag previously faked. There is no device to
 * find out in a browser, so the tag used to persist a storage key and report it
 * as an identity; the fingerprint costs 179 B of the 490 and is the only honest
 * way a site can ask for a device at all, off by default and gated twice. The
 * rest is the vocabulary itself, which has to be the same three calls in every
 * client or a customer who has read one has not read the others.
 *
 * The number moved by what the feature cost and not by more: the tag keeps the
 * same ~280 B of slack it had at 4.25 KiB, so the next feature faces exactly the
 * bar this one did. It is still an order of magnitude under an initial
 * congestion window, and it is still a file a customer pastes into a `<head>`
 * without thinking about it.
 */
export const MAX_GZIP_BYTES = 4.75 * 1024;

const here = import.meta.dir;

interface Built {
  raw: number;
  gzip: number;
  code: string;
}

async function bundle(entry: string, out: string): Promise<Built> {
  const result = await esbuild.build({
    entryPoints: [join(here, "src", entry)],
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2018"],
    write: false,
    legalComments: "none",
  });

  const code = result.outputFiles![0]!.text;
  mkdirSync(join(here, "dist"), { recursive: true });
  writeFileSync(join(here, "dist", out), code);

  return {
    raw: Buffer.byteLength(code),
    gzip: gzipSync(code, { level: 9 }).byteLength,
    code,
  };
}

/** The tag itself, which is what `/t.js` serves to everybody. */
export function build(): Promise<Built> {
  return bundle("tag.ts", "tag.js");
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  let over = false;

  const report = (label: string, built: Built, budget: number): void => {
    const pct = Math.round((built.gzip / budget) * 100);
    console.log(
      `${label.padEnd(8)} ${built.raw} B raw  ${built.gzip} B gzipped  ` +
        `(${pct}% of ${budget} B budget)`
    );
    if (built.gzip > budget) {
      console.error(`${label} is ${built.gzip - budget} B over the gzipped budget`);
      over = true;
    }
  };

  report("web-tag", await build(), MAX_GZIP_BYTES);

  if (over) process.exit(1);
  if (check) console.log("size ok");
}

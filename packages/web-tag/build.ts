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
 */

/**
 * 4KB.
 *
 * It was 3KB when the tag did one thing: a page view, at 1493 B gzipped. It now
 * cuts sessions, follows SPA navigations, times and measures the page it is on,
 * watches every click and submit, observes five Core Web Vitals, can report
 * uncaught exceptions, and carries the delivery policy: coalescing, a schedule,
 * and a severity that jumps it. It lands at 4072 B, which is 24 B of headroom.
 *
 * The budget is a product constraint rather than a high-water mark, so it does
 * not follow the number down: 4KB is whether a customer can paste this inline
 * into their `<head>` without thinking about it, and it is still under one TCP
 * window. The next feature that does not fit should argue for itself rather
 * than for the budget.
 *
 * 24 B is not headroom, it is a rounding error, and that is the honest state of
 * this file: it is full. The delivery policy paid its own way in by spending
 * settings rather than bytes. `maxBatch`, the coalescing window and the exit
 * flush are constants here instead of options, because this is the one place in
 * the product where a knob nobody turns still costs every visitor bytes, and
 * none of the three has a second value worth having on a web page. The next
 * feature has to displace something.
 */
export const MAX_GZIP_BYTES = 4 * 1024;

const here = import.meta.dir;
const outFile = join(here, "dist", "tag.js");

export async function build(): Promise<{ raw: number; gzip: number; code: string }> {
  const result = await esbuild.build({
    entryPoints: [join(here, "src", "tag.ts")],
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2018"],
    write: false,
    legalComments: "none",
  });

  const code = result.outputFiles![0]!.text;
  mkdirSync(join(here, "dist"), { recursive: true });
  writeFileSync(outFile, code);

  return {
    raw: Buffer.byteLength(code),
    gzip: gzipSync(code, { level: 9 }).byteLength,
    code,
  };
}

if (import.meta.main) {
  const { raw, gzip } = await build();
  const check = process.argv.includes("--check");
  const pct = Math.round((gzip / MAX_GZIP_BYTES) * 100);

  console.log(`web-tag  ${raw} B raw  ${gzip} B gzipped  (${pct}% of ${MAX_GZIP_BYTES} B budget)`);

  if (gzip > MAX_GZIP_BYTES) {
    console.error(`web-tag is ${gzip - MAX_GZIP_BYTES} B over the gzipped budget`);
    process.exit(1);
  }
  if (check) console.log("size ok");
}

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

export const MAX_GZIP_BYTES = 3 * 1024;

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

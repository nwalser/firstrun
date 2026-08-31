#!/usr/bin/env bun
import { join } from "node:path";
import { rmSync } from "node:fs";
import * as esbuild from "esbuild";

/**
 * Builds every entry point of `@firstrun/analytics`.
 *
 * Same tool and the same shape as `packages/web-tag/build.ts`, with two
 * differences that both come from this being a package people import rather
 * than a file they paste into a `<head>`:
 *
 *  - ESM with `splitting`, so the core lands in one shared chunk instead of
 *    once inside each framework wrapper. Somebody who imports the core and the
 *    React component gets one copy of the consent rule in their bundle.
 *  - Every framework is external. They are optional peer dependencies, and a
 *    bundled copy of React inside an analytics package is a bug, not a feature.
 *
 * Not minified: this is somebody else's build input, and their minifier is
 * better placed to do it than ours. There is no size budget here for the same
 * reason -- the budget that matters is `web-tag`'s, and it is enforced there.
 */

const here = import.meta.dir;
const outdir = join(here, "dist");

/**
 * Import specifiers left alone, rather than a list of package names: esbuild
 * matches these against what a file actually imports, so `next/navigation` has
 * to be here beside `next`. `#app` is Nuxt's alias for its runtime, resolved by
 * the customer's Nuxt build and by nothing here.
 */
export const PEERS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "next",
  "next/navigation",
  "vue",
  "svelte",
  "solid-js",
  "#app",
  "@angular/core",
  "@angular/router",
];

export async function build(): Promise<Record<string, number>> {
  rmSync(outdir, { recursive: true, force: true });

  const result = await esbuild.build({
    entryPoints: {
      index: join(here, "src", "index.ts"),
      react: join(here, "frameworks", "react.ts"),
      next: join(here, "frameworks", "next.ts"),
      svelte: join(here, "frameworks", "svelte.ts"),
      vue: join(here, "frameworks", "vue.ts"),
      nuxt: join(here, "frameworks", "nuxt.ts"),
      solid: join(here, "frameworks", "solid.ts"),
      angular: join(here, "frameworks", "angular.ts"),
    },
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    outdir,
    external: PEERS,
    legalComments: "none",
    metafile: true,
  });

  const sizes: Record<string, number> = {};
  for (const [file, info] of Object.entries(result.metafile!.outputs)) {
    sizes[file.replace(/.*dist[\\/]/, "")] = info.bytes;
  }
  return sizes;
}

if (import.meta.main) {
  const sizes = await build();
  for (const [name, bytes] of Object.entries(sizes)) {
    console.log(`analytics  ${name.padEnd(24)} ${bytes} B`);
  }
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  console.log(`analytics  ${"total".padEnd(24)} ${total} B raw`);
}

// Builds dist/esm and dist/cjs with tsc, then stamps each output directory with
// the module type it holds.
//
// Two tsc passes rather than a bundler, because this package has no runtime
// dependencies and therefore nothing to bundle. The stamp files are what let a
// CommonJS require and an ESM import of the same package both resolve
// correctly regardless of the consumer's own "type" field.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
// Resolved rather than joined, so it works whether typescript was installed
// here or hoisted to the repo root.
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

function run(project) {
  const result = spawnSync(process.execPath, [tsc, "-p", join(root, project)], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync(join(root, "dist"), { recursive: true, force: true });

run("tsconfig.esm.json");
run("tsconfig.cjs.json");

for (const [dir, type] of [
  ["esm", "module"],
  ["cjs", "commonjs"],
]) {
  const out = join(root, "dist", dir);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "package.json"), JSON.stringify({ type }, null, 2) + "\n");
}

console.log("built dist/esm and dist/cjs");

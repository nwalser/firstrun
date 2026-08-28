#!/usr/bin/env bun
import { spawn } from "bun";

/**
 * Runs the two processes that make up the stack.
 *
 * Not a task runner and not a dependency: `bun run dev` should do the thing
 * someone typing `bun run dev` means, and stopping it should leave nothing
 * behind.
 *
 * The dashboard runs under Bun rather than Node so the workspace packages load
 * as TypeScript source with no build step in between.
 */

interface Service {
  name: string;
  cmd: string[];
  cwd: string;
  colour: string;
}

const RESET = "\x1b[0m";

const services: Service[] = [
  {
    // Started from the repo root so --watch covers the workspace packages it
    // imports, not just the files under apps/ingest.
    name: "ingest",
    cmd: ["bun", "--watch", "apps/ingest/src/server.ts"],
    cwd: ".",
    colour: "\x1b[36m",
  },
  {
    name: "dash  ",
    cmd: ["bun", "--bun", "run", "next", "dev", "-p", "3000"],
    cwd: "apps/dashboard",
    colour: "\x1b[35m",
  },
];

/** Prefixes each line so two servers sharing one terminal stay legible. */
async function pipe(stream: ReadableStream<Uint8Array>, prefix: string): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) console.log(prefix + line);
  }
  if (rest) console.log(prefix + rest);
}

const children = services.map((service) => {
  const proc = spawn({
    cmd: service.cmd,
    cwd: service.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const prefix = `${service.colour}${service.name}${RESET} `;
  for (const stream of [proc.stdout, proc.stderr]) {
    void pipe(stream, prefix);
  }

  return proc;
});

function stop(): void {
  for (const child of children) child.kill();
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});

console.log("ingest  http://localhost:4318");
console.log("dash    http://localhost:3000");
console.log("");

await Promise.all(children.map((c) => c.exited));

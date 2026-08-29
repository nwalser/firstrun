#!/usr/bin/env bun
import { join } from "node:path";
import handler from "./dist/server/server.js";

/**
 * The production host.
 *
 * TanStack Start's build emits a fetch handler and a folder of client assets;
 * it does not emit a server that serves them. Without this, every `/assets/*`
 * request 404s in production while the page itself renders fine -- which looks
 * like a styling bug and is not.
 *
 * Railway sets PORT.
 */
const CLIENT = join(import.meta.dir, "dist", "client");
const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  idleTimeout: 60,
  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path !== "/" && !path.endsWith("/")) {
      const file = Bun.file(join(CLIENT, path));
      if (await file.exists()) {
        return new Response(file, {
          headers: path.startsWith("/assets/")
            ? { "Cache-Control": "public, max-age=31536000, immutable" }
            : {},
        });
      }
    }

    return handler.fetch(request);
  },
});

console.log(`listening on :${server.port}`);

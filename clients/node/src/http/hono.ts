/**
 * Hono middleware: one `http.request` entry per served request, and an ambient
 * identity around everything the handler does.
 *
 * ```ts
 * import { firstrunHono } from "@firstrun/node/hono";
 *
 * app.use(
 *   "*",
 *   firstrunHono(firstrun, {
 *     userId: (c) => c.get("accountId"),
 *     userId: (c) => c.get("user")?.id,
 *     ignore: ["/health"],
 *   })
 * );
 * ```
 *
 * The extractors take the CONTEXT rather than the request, unlike the Express
 * and Fastify adapters, because in Hono that is where an application keeps what
 * it has worked out about the caller: an auth middleware puts it there with
 * `c.set()`, and `c.req` only ever holds what arrived on the wire.
 *
 * Hono is typed structurally here: the properties below are everything this
 * file reads. Nothing is imported from hono and nothing needs to be installed
 * for this module to compile.
 *
 * ## Where this runs, and what happens where it cannot
 *
 * Hono runs on Workers, Deno, Bun and Node, and only one of those is certain to
 * have `AsyncLocalStorage`. Where it is missing there is no ambient identity to
 * inherit, so a handler records with the ids it passes itself, and this
 * middleware still writes its own entry: the identity goes onto it explicitly
 * rather than being picked back up out of a context that may not exist.
 */

import type { Firstrun } from "../client.js";
import { runWithContext } from "../context.js";
import {
  contextFor,
  liveContext,
  numeric,
  recordRequest,
  reporter,
  routeFrom,
  text,
  type HttpOptions,
} from "./shared.js";

export type { HttpOptions } from "./shared.js";

/** The parts of a Hono request this middleware reads, and no more. */
export interface HonoRequest {
  method?: string;
  /** The pathname, without the query string. */
  path?: string;
  /** The route template of whatever matched, e.g. `/users/:id`. */
  routePath?: string;
  /**
   * Which of the handlers Hono matched is running. Hono sets it before it calls
   * each one and never restores it, so after `await next()` it names the
   * DEEPEST handler that ran, which is what makes it usable as a signal below.
   */
  routeIndex?: number;
}

/** The parts of a Hono context this middleware reads, and no more. */
export interface HonoContext {
  req: HonoRequest;
  res?: { status?: number } | null;
}

export type HonoNext = () => Promise<void>;

function pathOf(c: HonoContext): string | undefined {
  try {
    return text(c?.req?.path);
  } catch {
    return undefined;
  }
}

/** Where this middleware itself sits in Hono's handler list. */
interface Position {
  index: unknown;
  route: string | undefined;
}

/** Read before `next()`, so `routeOf` has something to compare against. Never throws. */
function ownPosition(c: HonoContext): Position {
  try {
    return { index: c?.req?.routeIndex, route: text(c?.req?.routePath) };
  } catch {
    return { index: undefined, route: undefined };
  }
}

/**
 * The route template Hono matched, or undefined when nothing matched.
 *
 * Passed through as Hono spells it, `:id` and all: `http.route` is defined as
 * the route in the format the server framework uses, so translating it into
 * some other notation would only make two services that agree look like they
 * disagree.
 *
 * `routePath` alone is not that answer. It reports the registration pattern of
 * whichever handler is current, and for a request that matched no route at all
 * the current handler is THIS MIDDLEWARE: `GET /nothing` against a middleware
 * mounted at `app.use("*", ...)` reported `http.route = "/*"` next to its 404.
 * Every unmatched request then looks like it matched a route named after
 * wherever the customer happened to mount us, and the value moves when they
 * move the mount. Fastify omits the attribute in the same situation, and so
 * should this.
 *
 * The signal is Hono's own `routeIndex`, captured before `next()` and read
 * again after it. Hono sets it as it dispatches each handler and never restores
 * it, so if it has not moved past ours then nothing downstream ran and the
 * template can only be our own. The string comparison is the fallback for a
 * Hono old enough not to carry the index at all: identical means, at worst, a
 * template we cannot distinguish from our own registration, and omitting is the
 * safe way to be wrong.
 *
 * A middleware that answers without reaching a route (an auth layer returning
 * 401) does move the index, so its own pattern is what gets recorded. That is
 * still a template and still bounded, and it is genuinely what served the
 * request.
 */
function routeOf(c: HonoContext, own: Position): string | undefined {
  try {
    const route = text(c?.req?.routePath);
    if (!route) return undefined;
    const index = c?.req?.routeIndex;
    if (typeof index === "number" && typeof own.index === "number") {
      return index > own.index ? route : undefined;
    }
    return route === own.route ? undefined : route;
  } catch {
    return undefined;
  }
}

/** The status on the response Hono has built so far, if it has built one. */
function statusOf(c: HonoContext): number | undefined {
  try {
    return numeric(c?.res?.status);
  } catch {
    return undefined;
  }
}

/**
 * Builds the middleware. `Ctx` widens to your own context type, so an extractor
 * reading a typed `c.get("user")` type-checks without a cast.
 *
 * `next()` is awaited exactly once on every path through this function,
 * including the paths where our own code fails, and anything it throws is
 * rethrown unchanged: swallowing it would hide the failure from Hono's own
 * error handler and turn a 500 into a silence.
 */
export function firstrunHono<Ctx extends HonoContext = HonoContext>(
  client: Firstrun,
  options: HttpOptions<Ctx>
): (c: Ctx, next: HonoNext) => Promise<void> {
  // One per middleware, because what it holds is a rate limit rather than
  // anything about a request.
  const report = reporter(client);

  return async function firstrunMiddleware(c: Ctx, next: HonoNext): Promise<void> {
    // Never throws: every extractor call inside it is guarded, and every way of
    // having nothing to say arrives here as undefined.
    const ctx = contextFor(options, c, pathOf(c), report);
    if (!ctx) {
      await next();
      return;
    }

    // Where Hono is in its own handler list right now, which is this middleware.
    // Read before `next()`, because after it the same two values describe
    // whatever ran deepest. See `routeOf`.
    const own = ownPosition(c);

    const startedAt = Date.now();

    await runWithContext(ctx, async () => {
      const live = liveContext(ctx);

      // Guarded as one piece, argument building included, and for the same
      // reason on both sides of the try below: a throw from here would replace
      // the handler's own error on one path and invent one on the other, which
      // would turn this middleware into the cause of a 500 it was installed to
      // measure.
      //
      // This runs while Hono still owes the caller a Response, unlike Express
      // and Fastify, which record after the socket is done. Nothing here awaits
      // and nothing blocks, so rule 7 holds, but a 5xx is recorded at ERROR and
      // the client's default `flushOnSeverity` is ERROR: the serialisation of
      // the first batch body happens synchronously before the fetch is awaited.
      // A service that 5xxs under load pays that on its response path, and the
      // way out is `flushOnSeverity: false` rather than moving this call, which
      // on Workers can be frozen out of ever running at all.
      const finish = (threw: boolean): void => {
        try {
          recordRequest(
            client,
            live,
            {
              method: text(c?.req?.method),
              route: routeFrom(options, c, routeOf(c, own), report),
              // A handler that threw leaves no status behind: Hono decides it
              // afterwards, in its own error handler. The attribute is omitted
              // rather than claiming the 404 an unset response reads as.
              status: threw ? undefined : statusOf(c),
              path: pathOf(c),
              startedAt,
              threw,
            },
            report
          );
        } catch (err) {
          // The response is already on its way, so the only thing left is to
          // say so on the channel the operator asked for.
          report("internal", "recording the request entry", err);
        }
      };

      try {
        await next();
      } catch (err) {
        finish(true);
        throw err;
      }
      finish(false);
    });
  };
}

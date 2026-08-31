/**
 * Express middleware: one `http.request` entry per served request, and an
 * ambient identity around everything the handler does.
 *
 * ```ts
 * import { firstrunExpress } from "@firstrun/node/express";
 *
 * app.use(
 *   firstrunExpress(firstrun, {
 *     userId: (req) => req.cookies?.account_id,
 *     userId: (req) => req.user?.id,
 *     ignore: ["/health", "/assets"],
 *   })
 * );
 * ```
 *
 * Mount it before your routes. It reads the route template at the moment the
 * response finishes rather than when the request arrives, because that is when
 * Express knows which route matched, so mounting it first costs nothing.
 *
 * Express is typed structurally here: the four properties below are everything
 * this file reads, and both Express 4 and Express 5 provide all of them under
 * the same names. Nothing is imported from express and nothing needs to be
 * installed for this module to compile.
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

/** The parts of an Express request this middleware reads, and no more. */
export interface ExpressRequest {
  method?: string;
  /** The url as it arrived at this router, query string included. */
  url?: string;
  /** The url as it arrived at the application. Present from Express 4. */
  originalUrl?: string;
  /** Set once a route matches. `path` is the template, e.g. `/users/:id`. */
  route?: { path?: unknown } | null;
}

/** The parts of an Express response this middleware reads, and no more. */
export interface ExpressResponse {
  statusCode?: number;
  on(event: string, listener: () => void): unknown;
}

export type ExpressNext = (err?: unknown) => void;

/**
 * The path that was asked for, without the query string.
 *
 * `originalUrl` rather than `path`, because `path` on a mounted router is
 * relative to the mount point and two routers would report the same `/` for two
 * different urls. Query strings are cut off: they are unbounded, high
 * cardinality, and routinely carry things a customer did not mean to send us.
 */
function pathOf(req: ExpressRequest): string | undefined {
  try {
    const raw = text(req.originalUrl) ?? text(req.url);
    if (!raw) return undefined;
    const cut = raw.search(/[?#]/);
    return cut === -1 ? raw : raw.slice(0, cut);
  } catch {
    return undefined;
  }
}

/**
 * The route template of whatever matched, and NOT the mount prefix in front of
 * it.
 *
 * `req.route.path` is always a template: `/users/:id`, spelled exactly as the
 * application declared it. `req.baseUrl` is not, and that is the whole reason
 * this function reads one field rather than joining two.
 *
 * Express sets `baseUrl` to the MATCHED TEXT of the mount, never the mount
 * pattern. With `app.use("/orgs/:orgId", router)` and `router.get("/:id")`, a
 * request to `/orgs/12345/999` arrives here with `baseUrl = "/orgs/12345"`,
 * so prepending it produced `http.route = "/orgs/12345/:id"`: one row per org
 * in every breakdown by route, which is precisely the failure this attribute
 * exists to prevent. Reproduced on Express 4.22 and 5.2, and the same shape
 * holds for a RegExp or array mount, whose matched text is whatever the request
 * happened to contain.
 *
 * Nothing on the request carries the pattern that produced it. Express keeps
 * only the compiled matcher and, on the Layer, the matched text again, so there
 * is no version-safe way to tell `app.use("/api", r)` (where the prefix is a
 * constant and prepending would be right) from the parameterised case (where it
 * is poison). The two are indistinguishable from a single request.
 *
 * So the prefix is dropped, and what is recorded is the template of the route
 * itself. The trade is stated plainly: a route inside a mounted router reports
 * `/:id` rather than `/orgs/:orgId/:id`, and two routers that each declare the
 * same internal path share one row. That is a loss of DETAIL, bounded by the
 * number of routes the application declares. The alternative was a loss of the
 * ATTRIBUTE, unbounded by the number of ids the world contains. Absent beats
 * wrong, and incomplete beats both. A customer who knows their own mounts can
 * state the full template with the `route` option.
 *
 * Express also accepts a RegExp or an array of paths as a route, and neither is
 * a template anything could group by. `text()` returns undefined for both, so
 * the attribute is omitted instead. The template is passed through exactly as
 * the framework spells it, `:id` and all: `http.route` is defined as the route
 * in the format the server framework uses, so rewriting it into some other
 * notation would only make two services that agree look like they disagree.
 */
function routeOf(req: ExpressRequest): string | undefined {
  try {
    return text(req.route?.path);
  } catch {
    return undefined;
  }
}

/**
 * Builds the middleware. `Req` widens to your own request type, so an extractor
 * reading `req.user` type-checks without a cast.
 *
 * `next()` is called exactly once on every path through this function,
 * including the paths where our own code fails, and it is deliberately outside
 * every try/catch: a handler that throws synchronously must reach Express's own
 * error handling, not ours.
 */
export function firstrunExpress<Req extends ExpressRequest = ExpressRequest>(
  client: Firstrun,
  options: HttpOptions<Req>
): (req: Req, res: ExpressResponse, next: ExpressNext) => void {
  // One per middleware, because what it holds is a rate limit rather than
  // anything about a request.
  const report = reporter(client);

  return function firstrunMiddleware(req: Req, res: ExpressResponse, next: ExpressNext): void {
    // Read once and kept, rather than read again in the finish listener. The
    // path a request was measured against is the path it was ignored against,
    // and a middleware further down that rewrites `req.url` cannot make those
    // two disagree.
    const path = pathOf(req);

    // Never throws: every extractor call inside it is guarded, and every way of
    // having nothing to say arrives here as undefined.
    const ctx = contextFor(options, req, path, report);
    if (!ctx) {
      next();
      return;
    }

    const startedAt = Date.now();

    runWithContext(ctx, () => {
      const live = liveContext(ctx);
      try {
        // Registered before the handler runs, so a route that answers
        // synchronously is still measured. `finish` and not `close`: close also
        // fires for a connection the client abandoned before a status was ever
        // written, and a board full of phantom 200s for requests nobody
        // received is a worse number than a board missing them.
        res.on("finish", () => {
          try {
            recordRequest(
              client,
              live,
              {
                method: text(req.method),
                route: routeFrom(options, req, routeOf(req), report),
                status: numeric(res.statusCode),
                path,
                startedAt,
              },
              report
            );
          } catch (err) {
            // A throw out of an EventEmitter listener is an uncaught exception
            // in the host process, which is the worst thing this file could
            // possibly do. It stops here, and it is reported rather than
            // swallowed: nothing above should have been able to throw.
            report("internal", "the response finish listener", err);
          }
        });
      } catch (err) {
        // `res` is not an emitter, or refused the listener. The request is
        // served exactly as it would have been; it is simply not measured.
        report("rejected", "res.on('finish') was refused, so nothing is measured", err);
      }
      next();
    });
  };
}

/**
 * Fastify integration: one `http.request` entry per served request, and an
 * ambient identity around everything the handler does.
 *
 * ```ts
 * import { firstrunFastify } from "@firstrun/node/fastify";
 *
 * await app.register(
 *   firstrunFastify(firstrun, {
 *     userId: (request) => request.headers["x-account-id"],
 *     userId: (request) => request.user?.id,
 *     ignore: ["/health"],
 *   })
 * );
 * ```
 *
 * Two hooks, because Fastify's lifecycle is where the two halves of this belong:
 * `onRequest` is the earliest point at which a context can be opened around the
 * rest of the request, and `onResponse` fires once the response has actually
 * gone out, which is when the status and the duration are known.
 *
 * `firstrunFastify` wraps them as a plugin so registering is one line;
 * `fastifyHooks` hands the same two functions over for anyone who would rather
 * add them by hand, or add them inside one encapsulated scope on purpose.
 *
 * Fastify is typed structurally here: the properties below are everything this
 * file reads. Nothing is imported from fastify and nothing needs to be
 * installed for this module to compile.
 */

import type { Firstrun } from "../client.js";
import { runWithContext, type RequestContext } from "../context.js";
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

/** The parts of a Fastify request this integration reads, and no more. */
export interface FastifyRequest {
  method?: string;
  /** The url as it arrived, query string included. */
  url?: string;
  /** Fastify 4.10 and up. `url` here is the route template. */
  routeOptions?: { url?: string | null } | null;
  /** Fastify 3 and early 4, where the template lived directly on the request. */
  routerPath?: string;
}

/** The parts of a Fastify reply this integration reads, and no more. */
export interface FastifyReply {
  statusCode?: number;
}

/** Fastify's hook callback. Ours never passes an error: a failed request is still a request. */
export type FastifyDone = () => void;

/**
 * Whatever Fastify hands a plugin, described by the one member this file wants.
 *
 * `addHook` is deliberately `unknown` rather than a signature. Fastify's own is
 * two dozen overloads deep in generics describing hook payloads this file does
 * not touch, and any structural mirror of it is a guess that a real instance
 * then fails to match: an overloaded method is not assignable to a single
 * flattened signature, which is a compile error in the customer's build over a
 * shape we only ever call one way. So the type states what is true (there is a
 * member called `addHook`) and the plugin checks at runtime that it is callable
 * before calling it.
 */
export interface FastifyInstanceLike {
  addHook?: unknown;
}

/** The one way this file calls `addHook`, which is the only reason it narrows it. */
type AddHook = (name: string, hook: unknown) => unknown;

export interface FastifyHooks<Req> {
  onRequest: (request: Req, reply: FastifyReply, done: FastifyDone) => void;
  onResponse: (request: Req, reply: FastifyReply, done: FastifyDone) => void;
}

/** The path that was asked for, without the query string. */
function pathOf(request: FastifyRequest): string | undefined {
  try {
    const raw = text(request.url);
    if (!raw) return undefined;
    const cut = raw.search(/[?#]/);
    return cut === -1 ? raw : raw.slice(0, cut);
  } catch {
    return undefined;
  }
}

/**
 * The route template, from whichever place this Fastify keeps it.
 *
 * `routeOptions.url` is where it lives from 4.10 onwards, and `routerPath` is
 * where it lived before that. Reading both is what makes one file work across
 * the versions a customer might actually be on, and neither is a fallback to
 * something that is not a template: when a request matched no route at all,
 * both are absent and the attribute is omitted rather than filled in with the
 * path, which would put every 404 a scanner produces on its own row.
 */
function routeOf(request: FastifyRequest): string | undefined {
  try {
    return text(request.routeOptions?.url) ?? text(request.routerPath);
  } catch {
    return undefined;
  }
}

/**
 * The two hooks, sharing one table of requests in flight.
 *
 * The table is a `WeakMap` and the request object is the key, so a request that
 * never reaches `onResponse` (the client vanished, the connection died) is
 * collected with the request rather than accumulating as a leak in a long-lived
 * server. It is created per call rather than per module so two clients
 * instrumenting the same app do not overwrite each other's entry.
 */
export function fastifyHooks<Req extends FastifyRequest = FastifyRequest>(
  client: Firstrun,
  options: HttpOptions<Req>
): FastifyHooks<Req> {
  const pending = new WeakMap<object, { startedAt: number; ctx: RequestContext }>();
  // One per pair of hooks, because what it holds is a rate limit rather than
  // anything about a request.
  const report = reporter(client);

  return {
    onRequest(request: Req, _reply: FastifyReply, done: FastifyDone): void {
      // Never throws: every extractor call inside it is guarded, and every way
      // of having nothing to say arrives here as undefined.
      const ctx = contextFor(options, request, pathOf(request), report);
      if (!ctx) {
        done();
        return;
      }

      // `done()` is called from inside the context, which is what puts the rest
      // of the request lifecycle inside it: Fastify continues from this call,
      // so every hook, handler and awaited continuation after it inherits the
      // identity. This is the whole reason the opening half is a hook rather
      // than something computed in `onResponse`.
      runWithContext(ctx, () => {
        try {
          pending.set(request, { startedAt: Date.now(), ctx: liveContext(ctx) });
        } catch (err) {
          // A request that cannot be a WeakMap key. The request is served
          // exactly as it would have been; it is simply not measured.
          report("rejected", "the request cannot be tracked to its response", err);
        }
        done();
      });
    },

    onResponse(request: Req, reply: FastifyReply, done: FastifyDone): void {
      try {
        const started = pending.get(request);
        // Deleted rather than left for the collector to notice, which also
        // makes a second `onResponse` for one request a no-op instead of a
        // duplicate entry.
        pending.delete(request);
        if (started) {
          recordRequest(
            client,
            started.ctx,
            {
              method: text(request.method),
              route: routeFrom(options, request, routeOf(request), report),
              status: numeric(reply?.statusCode),
              path: pathOf(request),
              startedAt: started.startedAt,
            },
            report
          );
        }
      } catch (err) {
        // Nothing here may stop the lifecycle: `done()` is below, outside this
        // block, and is called exactly once whatever happened above it.
        report("internal", "the onResponse hook", err);
      }
      done();
    },
  };
}

/**
 * The same two hooks as a plugin, so registering is one line.
 *
 * The plugin is marked `skip-override`, which is what `fastify-plugin` does and
 * the reason this does not depend on it. Without the mark, `register` gives the
 * plugin its own encapsulated instance and the hooks apply only to routes
 * declared inside it: an app that registers this first and its routes
 * afterwards would install a middleware that measures nothing at all, silently.
 * A telemetry integration that quietly covers a subset of the routes is worse
 * than one that is obviously absent.
 */
export function firstrunFastify<Req extends FastifyRequest = FastifyRequest>(
  client: Firstrun,
  options: HttpOptions<Req>
): (instance: FastifyInstanceLike, opts: unknown, done: FastifyDone) => void {
  const hooks = fastifyHooks(client, options);
  const report = reporter(client);

  // Three declared parameters, because avvio reads the arity to decide whether
  // a plugin is callback style or promise style. Do not give one a default.
  const plugin = (instance: FastifyInstanceLike, _opts: unknown, done: FastifyDone): void => {
    try {
      const target = instance as { addHook?: AddHook };
      if (typeof target?.addHook === "function") {
        target.addHook("onRequest", hooks.onRequest);
        target.addHook("onResponse", hooks.onResponse);
      } else {
        report("rejected", "registered on something that is not a Fastify instance", "no addHook");
      }
    } catch (err) {
      // Registration failed, so nothing is measured. The app still boots, which
      // is the trade this library makes everywhere: a misconfigured client is
      // not a reason for somebody's service to fail to start. It is a boot-time
      // failure that produces no rows at all, though, so it is worth exactly one
      // line on the diagnostic channel.
      report("rejected", "the hooks could not be registered", err);
    }
    done();
  };

  (plugin as unknown as Record<symbol, boolean>)[Symbol.for("skip-override")] = true;
  return plugin;
}

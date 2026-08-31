/**
 * What the three HTTP adapters in this directory have in common.
 *
 * They differ in how a framework hands over a request, what it calls the route
 * template, and where the response status ends up. Everything after that is one
 * shape: an entry named `http.request` carrying the conventional attributes, at
 * INFO unless the server itself failed. There is no request table and no
 * request pipeline behind it. It is a log entry like every other one, and what
 * makes it findable is a query rather than a type.
 *
 * ## Why no framework is imported anywhere in this directory
 *
 * This package has no runtime dependencies and is not going to grow one for a
 * middleware. Express, Fastify and Hono are typed STRUCTURALLY: each adapter
 * writes out the handful of properties it actually reads, and any object
 * carrying those properties satisfies it. That is what lets one file serve
 * Express 4 and Express 5, or Fastify 3 through 5, with no version matrix, no
 * optional peer dependency to declare, and no build that breaks because a
 * framework the customer does not use is missing from their tree. It also means
 * a customer can pass their own object in a test without constructing a real
 * server.
 *
 * ## Identity is extracted, never inferred
 *
 * Every adapter takes the identity extractors and calls them. Nothing here reads
 * a cookie, a header, an IP address or a session store on its own initiative,
 * and nothing joins one request to another. A middleware that guessed would be
 * inventing an identity out of a network artefact, which is the one thing this
 * product does not do at any layer. If the extractor has nothing to say, the
 * request is not measured, which is the honest outcome rather than a row filed
 * against a made-up id.
 *
 * ## Rule 7 is the design, not a caveat on it
 *
 * The handler downstream runs exactly once whatever happens in here. Every
 * customer function is called inside a try/catch, every emit is, and every
 * failure falls the same way: this request is not measured, and the request
 * itself is served exactly as it would have been if the middleware were not
 * installed. Nothing is awaited that we did not already have to await, because
 * the client's recording calls do no I/O.
 *
 * ## Silent to the end user, not to the operator
 *
 * Swallowing is not the same as saying nothing. Every catch in this directory
 * reports through `client.report`, which is the client's own `onDiagnostic`
 * hook and the only channel this library is allowed to write to: never stdout,
 * never stderr, never the host's own logger. A middleware whose identity
 * extractor throws on every request records nothing at all, and without a word
 * on that channel there is no way to tell it apart from a firewall between the
 * service and the edge.
 *
 * Reports are rate limited to one per second per middleware, carrying a count
 * of what was swallowed since, for the same reason drop reports are: the
 * failures that matter here are the ones that happen on every single request.
 *
 * The one class of failure that stays quiet is a single field read off the
 * framework's own object: if `req.method` throws, the attribute is omitted, the
 * entry is still written, and the missing key is the signal. Those are the bare
 * catches left in this directory, and they are bare on purpose.
 */

import type { Firstrun } from "../client.js";
import { currentContext, type RequestContext } from "../context.js";
import type { AttributesInput } from "../types.js";
import { ATTR, NAME, SEVERITY } from "../wire.js";

/**
 * What an adapter needs from the customer.
 *
 * `T` is whatever the framework hands its middleware: the request for Express
 * and Fastify, the context for Hono, because that is where each of them keeps
 * the things an application has already worked out about the caller.
 */
export interface HttpOptions<T> {
  /**
   * REQUIRED. Who this request is for.
   *
   * The anonymous id the entries recorded during this request are attributed
   * to, and the reason this option is a function rather than a value: a server
   * process is not a person, so any id has to come out of the request. Return
   * whatever your own code already knows, and return nothing when it knows
   * nothing yet.
   *
   * ALL THREE ARE OPTIONAL, and a middleware that supplies none of them is a
   * legitimate configuration: the request is still measured, and its entries
   * carry no identity and count in no unique. There is no fallback behind any
   * of them, and nothing is ever made up to fill a gap.
   *
   * `userId` is for a request already authenticated by the time the middleware
   * runs. When it is not, leave it out and call `updateContext({ userId })`
   * from wherever authentication finishes: the request entry is written when
   * the response finishes, so an id filled in mid-request is still on it.
   */
  userId?: (subject: T) => string | null | undefined;

  /** Lands in `device.id`, for a request that names a machine. Never inferred. */
  deviceId?: (subject: T) => string | null | undefined;

  /** Lands in the `session.id` attribute. Same rule: yours, never inferred. */
  sessionId?: (subject: T) => string | null | undefined;

  /**
   * Attributes stamped on every entry recorded during this request, including
   * the request entry itself: a tenant, a region, a request id. They sit under
   * each entry's own attributes, so a value stated at a call site still wins.
   */
  attributes?: (subject: T) => AttributesInput | undefined;

  /**
   * The route TEMPLATE for this request, when you would rather state it than
   * take the framework's own answer.
   *
   * It exists because a framework's answer can be incomplete. Express is the
   * case that forced it: a route inside a mounted router reports the router's
   * own template (`/:id`) and not the mount prefix, because the prefix Express
   * exposes is resolved text rather than a pattern. See the long comment in
   * `express.ts`. If you know your own mounts, this is where you say so:
   * `route: (req) => "/orgs/:orgId" + req.route.path`.
   *
   * Whatever it returns is used verbatim, so it is also the one place in these
   * adapters where a resolved path could get into `http.route`. Do not put one
   * there. `/users/:id` is one row; `/users/8814` is one row per customer, and
   * the breakdown this attribute exists for becomes a list of every url you
   * have ever served. Returning nothing falls back to the framework.
   */
  route?: (subject: T) => string | null | undefined;

  /**
   * Requests this middleware should leave alone entirely: a predicate, or a
   * list of path prefixes.
   *
   * Health checks and static assets are the reason. They are the most frequent
   * thing a service serves and the least interesting, and left in they become
   * the loudest rows on every board that groups by route.
   *
   * Ignoring is total rather than partial: no extractor is called, no context
   * is opened, and no entry is written. Paying for an extractor call on every
   * asset request is exactly the cost this option exists to avoid, and a route
   * nobody wants measured is not a route anybody wants an identity resolved
   * for. Default is to record everything.
   */
  ignore?: readonly string[] | ((subject: T) => boolean);
}

/** Undefined for anything that is not a usable string, so an omitted key is honest. */
export function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

/** A status code we are willing to state. Undefined rather than a guess. */
export function numeric(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * Says what went wrong, to the one channel this library may write to.
 *
 * `where` is the site, not the error: it is what makes a report actionable, and
 * it is stable enough for somebody to grep their own logs for. The code says who
 * has a bug. `rejected` is the customer's (their extractor threw, so this
 * request is not measured) and `internal` is ours (something threw where nothing
 * should).
 */
export type Report = (code: "rejected" | "internal", where: string, err: unknown) => void;

/** One per second, so a failure that happens on every request costs one line a second. */
const REPORT_INTERVAL_MS = 1_000;

/**
 * A reporter for one middleware instance.
 *
 * Built per adapter rather than per request, because the state it holds is the
 * rate limit: the failures worth knowing about here are the ones that repeat on
 * every request, and reporting each of them is how a telemetry client ends up
 * being the loudest thing in somebody's log. Suppressed reports are counted and
 * the count travels with the next one, so a rate limit never reads as a problem
 * that went away.
 *
 * Never throws, whatever the hook does with what it is handed.
 */
export function reporter(client: Firstrun): Report {
  let last = 0;
  let suppressed = 0;
  return (code, where, err) => {
    try {
      suppressed++;
      const now = Date.now();
      if (now - last < REPORT_INTERVAL_MS) return;
      last = now;
      const since = suppressed;
      suppressed = 0;
      let detail: string;
      try {
        detail = err instanceof Error ? err.message : String(err);
      } catch {
        // An error object that fights back through `toString`. The site is
        // still worth reporting without it.
        detail = "unknown";
      }
      client.report({
        code,
        level: code === "internal" ? "error" : "warn",
        message: `firstrun http middleware: ${where}: ${detail}`,
        detail: { where, occurrences: since },
      });
    } catch {
      // `report` guards itself, so reaching here means the client is not one.
      // There is nowhere left to say so.
    }
  };
}

/**
 * Calls one of the customer's extractors. Their throw is theirs, and it stops
 * here: an exception raised working out an analytics id must not reach the
 * request that was only trying to be served. It is still reported, because an
 * extractor that throws every time is a middleware that measures nothing.
 */
function call<T, R>(
  fn: ((subject: T) => R) | undefined,
  subject: T,
  report: Report,
  where: string
): R | undefined {
  if (typeof fn !== "function") return undefined;
  try {
    return fn(subject);
  } catch (err) {
    report("rejected", where, err);
    return undefined;
  }
}

function ignored<T>(
  ignore: HttpOptions<T>["ignore"],
  subject: T,
  path: string | undefined,
  report: Report
): boolean {
  if (!ignore) return false;
  if (typeof ignore === "function") {
    try {
      return ignore(subject) === true;
    } catch (err) {
      // A filter that throws is a filter nobody can trust, and the two ways to
      // be wrong here are not the same size: recording a request we were told
      // to ignore fills the board with exactly the noise this option exists to
      // remove, while not recording one costs a single row.
      report("rejected", "ignore predicate", err);
      return true;
    }
  }
  if (!path) return false;
  try {
    // A bare string is one prefix, not something to iterate. `for...of` over a
    // string yields its characters, so `ignore: "/health"` (an easy mistake for
    // a JavaScript caller, since the option takes an array) would test every
    // path against "/" and quietly measure nothing at all, forever. Widened to
    // `unknown` first because the type says this cannot happen and the runtime
    // says it can: the signature is what is supported, not what arrives.
    const one: unknown = ignore;
    if (typeof one === "string") return one.length > 0 && path.startsWith(one);
    for (const prefix of ignore) {
      if (typeof prefix === "string" && prefix.length > 0 && path.startsWith(prefix)) return true;
    }
  } catch (err) {
    // `ignore` is not iterable: an object, a number, whatever a caller without
    // the types passed. This loop used to sit outside a try, so the throw
    // landed in `contextFor`'s outer catch and turned the middleware off for
    // every request instead of for this one.
    report("rejected", "ignore is neither a predicate nor a list of prefixes", err);
  }
  return false;
}

/**
 * The identity to open around this request, or undefined to leave it alone.
 *
 * Undefined covers all three ways there is nothing to say: the request is
 * ignored, the extractor had no id yet, or something in the customer's own code
 * threw on the way. They deliberately land in the same place. Every one of them
 * means the same thing to the adapter, which is that it calls the downstream
 * handler and nothing else.
 */
export function contextFor<T>(
  options: HttpOptions<T>,
  subject: T,
  path: string | undefined,
  report: Report
): RequestContext | undefined {
  try {
    if (!options) {
      report("rejected", "middleware called without options", "got undefined");
      return undefined;
    }
    if (ignored(options.ignore, subject, path, report)) return undefined;

    // An extractor that returns nothing is deliberately NOT reported. It is the
    // documented answer for a visitor this service has no id for yet, it is
    // correct on every anonymous request, and a line a second about the normal
    // case is how an operator learns to ignore the channel.
    //
    // A context is opened even when all three come back empty. The request is
    // still worth measuring, and an entry with no identity is a legal entry:
    // refusing to record it would trade a real measurement for a missing id.
    const ctx: RequestContext = {};
    const userId = text(call(options.userId, subject, report, "userId extractor"));
    if (userId) ctx.userId = userId;
    const deviceId = text(call(options.deviceId, subject, report, "deviceId extractor"));
    if (deviceId) ctx.deviceId = deviceId;
    const sessionId = text(call(options.sessionId, subject, report, "sessionId extractor"));
    if (sessionId) ctx.sessionId = sessionId;
    const attributes = call(options.attributes, subject, report, "attributes extractor");
    if (attributes && typeof attributes === "object") ctx.attributes = attributes;
    return ctx;
  } catch (err) {
    report("internal", "building the request context", err);
    return undefined;
  }
}

/**
 * The route template to record: the customer's if they state one, otherwise the
 * framework's.
 *
 * Their answer wins because they know things the framework will not tell us. It
 * is passed through the same `text()` guard as everything else and nothing
 * checks it against the path, which is the trade written down in the `route`
 * option: an adapter cannot tell a template from a resolved path, so this is one
 * place where a customer can put a high cardinality value into `http.route` if
 * they insist on it.
 */
export function routeFrom<T>(
  options: HttpOptions<T>,
  subject: T,
  fromFramework: string | undefined,
  report: Report
): string | undefined {
  try {
    if (typeof options?.route !== "function") return fromFramework;
    return text(call(options.route, subject, report, "route extractor")) ?? fromFramework;
  } catch (err) {
    report("internal", "resolving the route template", err);
    return fromFramework;
  }
}

/**
 * The context object the storage actually holds, from inside the scope that
 * opened it.
 *
 * `runWithContext` copies what it is given, so the object an adapter passed in
 * is not the one a handler's `updateContext` writes into. Holding the copy is
 * what lets the request entry carry an identity the request only learned
 * halfway through: a middleware runs before authentication, so `userId` is
 * usually unknown when the context opens and known by the time the response
 * finishes.
 *
 * The fallback covers a runtime with no `AsyncLocalStorage`, where there is no
 * ambient context to read and `updateContext` does nothing anyway. The entry is
 * still written, with the identity the extractors gave, which is why the
 * adapters state it explicitly rather than letting the client pick it up from
 * the ambient context that may not exist.
 */
export function liveContext(fallback: RequestContext): RequestContext {
  try {
    return currentContext() ?? fallback;
  } catch {
    return fallback;
  }
}

/** One served request, as the adapter observed it. Every field is optional but the clock. */
export interface RequestFacts {
  method?: string | undefined;
  /**
   * The route TEMPLATE, e.g. `/users/:id`, and never the path that was asked
   * for. Undefined when the framework did not offer one.
   */
  route?: string | undefined;
  status?: number | undefined;
  path?: string | undefined;
  /** When the request arrived, from `Date.now()`. */
  startedAt: number;
  /**
   * The handler threw and the framework has not turned that into a status code
   * yet. Only Hono can see this: Express and Fastify catch it themselves and
   * the response finishes as a 500 like any other.
   */
  threw?: boolean;
}

/**
 * Writes the one entry, and cannot fail in a way the host program sees.
 *
 * Severity is 9 (INFO) for everything except a server failure. A 4xx stays at
 * INFO deliberately: it is the caller's mistake rather than the server's, and a
 * board where every 404 from a scanner is an ERROR is a board with an incident
 * on it every day of the week.
 *
 * The entry is stamped with the moment the request ARRIVED rather than the
 * moment it finished, so a slow request sits in the same bucket as the entries
 * its own handler recorded while it ran. `time` is client-stamped and
 * authoritative throughout this product, and this is one more place where the
 * client is the one that knows.
 */
export function recordRequest(
  client: Firstrun,
  ctx: RequestContext,
  facts: RequestFacts,
  report: Report
): void {
  try {
    // Under the http facts, which are the more specific statement about this
    // one request, and above nothing: the client merges its own defaults below
    // both of them.
    //
    // The identity below is stated in full rather than left to the ambient
    // context, and it has to be: stating ANY of the three in `client.enqueue`
    // replaces the whole identity, so passing two of them and letting the third
    // fall through is exactly the bug that rule exists to prevent. All three
    // come from the same context object either way.
    const attributes: AttributesInput = { ...ctx.attributes };

    if (facts.method) attributes[ATTR.HTTP_REQUEST_METHOD] = facts.method;
    // Omitted rather than filled in with the resolved path. A path groups into
    // one row per id in it, which turns the breakdown this attribute exists for
    // into a list of every url the service has ever served.
    if (facts.route) attributes[ATTR.HTTP_ROUTE] = facts.route;
    if (facts.status !== undefined) attributes[ATTR.HTTP_RESPONSE_STATUS_CODE] = facts.status;
    if (facts.path) attributes[ATTR.URL_PATH] = facts.path;
    // Never negative: a clock stepped backwards mid-request would otherwise
    // produce a duration nobody can average.
    attributes[ATTR.DURATION_MS] = Math.max(0, Date.now() - facts.startedAt);

    const failed = facts.threw === true || (facts.status !== undefined && facts.status >= 500);

    client.log({
      name: NAME.HTTP_REQUEST,
      severity: failed ? SEVERITY.ERROR : SEVERITY.INFO,
      timestamp: facts.startedAt,
      userId: ctx.userId ?? null,
      deviceId: ctx.deviceId ?? null,
      sessionId: ctx.sessionId ?? null,
      attributes,
    });
  } catch (err) {
    // `log()` guards itself, so reaching here means our own bookkeeping threw:
    // a request object fighting back through a getter, most likely. The
    // response has already gone out, and the only thing left to do is say so on
    // the channel the operator asked for.
    report("internal", "writing the request entry", err);
  }
}

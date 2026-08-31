/**
 * The identity a handler is already running under.
 *
 * A server process is not a person: it serves many at once, so every recording
 * call has to say who it is about. Threading that through every layer of a
 * request is the boilerplate this module removes. A middleware states the
 * identity once, and anything running inside it records without repeating it.
 *
 * Nothing here is inferred. The ids are the ones the customer put in, and a
 * call that names its own still wins over them: this is a place to keep an
 * explicit answer, not a place to work one out from a cookie or a socket.
 *
 * ## Why the import is not an import
 *
 * `AsyncLocalStorage` lives in `node:async_hooks`, and this package has no
 * runtime dependencies precisely so it can run where Node's builtins do not
 * exist (the `fetch` option is there for the same reason). A top-level
 * `import { AsyncLocalStorage } from "node:async_hooks"` is a hard edge for
 * every one of those places: a bundler targeting a worker or a browser has to
 * resolve the specifier, and fails the build over a feature that target was
 * never going to reach.
 *
 * Neither obvious single-form answer compiles into BOTH builds this package
 * ships. A module-level `require("node:async_hooks")` in a try/catch is correct
 * in `dist/cjs` and a missing binding in `dist/esm`, which has no `require` at
 * all. `createRequire(import.meta.url)` is the mirror image: `import.meta` is a
 * compile error under `module: CommonJS`, so the CJS pass would not emit. Hence
 * two attempts, in order, from one source that compiles both ways:
 *
 * 1. `process.getBuiltinModule()`: synchronous, identical in both builds, and
 *    it hands back a builtin without leaving a specifier for a bundler to
 *    follow. Node 22.3 and up.
 * 2. A dynamic `import()` through a variable, started once as this module is
 *    evaluated. tsc leaves it alone in the ESM build and rewrites it to a
 *    `require()` inside a promise in the CJS build, so the one line covers
 *    both, and the variable is what keeps a bundler from resolving it
 *    statically.
 *
 * What (2) costs on Node 18 and 20 is that the storage arrives a tick or two
 * after this module loads, and a context opened inside that window simply is
 * not there. For a server this is harmless: `app.listen()` cannot serve a
 * request in the same tick it was called in. It is NOT harmless for code that
 * runs at module scope on first load, which is a real shape (a serverless
 * bundle whose handler runs during the initial import, a top-level init block):
 * that call gets no ambient identity at all, silently, on the oldest runtime
 * this package supports. Measured, not assumed, in both builds.
 *
 * When neither attempt lands there is no ambient identity at all, which is the
 * honest outcome rather than a broken one: `runWithContext` still calls its
 * function exactly once, `currentContext()` answers undefined, and every caller
 * falls back on the explicit ids they pass today.
 *
 * ## The context outlives the request, in exactly one direction
 *
 * `AsyncLocalStorage` propagates into everything an async call chain starts,
 * and it does not stop at the end of the request that opened it. A `setTimeout`
 * scheduled inside a handler runs inside that request's identity minutes later.
 * A `setInterval` started during one request attributes every entry it ever
 * writes to whoever made that one request, for the life of the process, and
 * holds that context object (and the attributes object the customer handed us,
 * which is held by reference) alive for just as long.
 *
 * This is how the primitive works and there is nothing to fix in this file: a
 * runtime that dropped the context at the end of the awaited chain would break
 * the ordinary case, where a handler awaits three things and records after all
 * of them. It is written down because the failure is silent and reads as a bug
 * in this library rather than a property of the platform.
 *
 * The rule for a caller is that DETACHED work states its own identity. Anything
 * that outlives the request that started it (a timer, an interval, a queue
 * push, a promise nobody awaits) should either state an identity on the call,
 * which replaces this context's whole identity rather than a third of it, or be
 * wrapped in its own `runWithContext`. Nesting replaces, so a wrap is enough.
 */

/** What a request knows about who it is for. Every field is optional and none is guessed. */
export interface RequestContext {
  /**
   * The three identity keys this request is about. All optional, none guessed.
   *
   * Whatever the customer's own code already has: an account id their auth
   * middleware resolved, a session cookie, a device id their own protocol
   * carries. We never make one up, and a request that states none of them
   * produces entries with no identity, which is correct rather than degraded.
   *
   * They travel as a UNIT. A call that states any identity of its own is not
   * merged with this context, it replaces it: a background job recorded inside
   * a handler must not keep the requester's `user.id` just because it named its
   * own device. Lending one id to another subject's entries is how a fleet of
   * workers collapses into one unique that nobody notices is wrong.
   */
  userId?: string | null;
  deviceId?: string | null;
  sessionId?: string | null;

  /** Merged UNDER the entry's own attributes, like the client-level defaults are. */
  attributes?: Record<string, unknown>;
}

/**
 * The slice of `AsyncLocalStorage` this module uses.
 *
 * Written out rather than imported as a type, so nothing here depends on the
 * Node types being present in a consumer's build either.
 */
interface Storage<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}

type StorageCtor = { new <T>(): Storage<T> };

/** Undefined until one of the two attempts below lands, and undefined forever off Node. */
let storage: Storage<RequestContext> | undefined;

/** Annotated `string` rather than left as a literal, so `import()` stays unresolvable. */
const ASYNC_HOOKS: string = "node:async_hooks";

function install(mod: unknown): void {
  if (storage) return;
  try {
    const ctor = (mod as { AsyncLocalStorage?: unknown } | null | undefined)?.AsyncLocalStorage;
    if (typeof ctor !== "function") return;
    const made = new (ctor as StorageCtor)<RequestContext>();
    if (typeof made.run === "function" && typeof made.getStore === "function") storage = made;
  } catch {
    // A runtime that exports something else under that name. No ambient
    // identity here, which is a supported way to run rather than a failure.
  }
}

try {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
    .process;
  if (typeof proc?.getBuiltinModule === "function") install(proc.getBuiltinModule(ASYNC_HOOKS));
} catch {
  // Not Node, or a host that has the name and refuses the call.
}

if (!storage) {
  try {
    // Rejected on any runtime without the builtin, and swallowed: a missing
    // async_hooks is a runtime we support, not an error the host should see.
    void import(ASYNC_HOOKS).then(install, () => {});
  } catch {
    // A runtime with no dynamic import at all. Same outcome as above.
  }
}

/**
 * Runs `fn` with `ctx` as the ambient identity, and returns whatever it returns.
 *
 * Transparent in every respect: `fn` is called exactly once, its value is
 * passed straight back, and anything it throws is thrown on unchanged. That
 * holds when there is no storage to run in, so wrapping a request handler in
 * this is safe on a runtime where it does nothing at all.
 *
 * Nesting REPLACES rather than merges. A job started inside a request is not
 * the request, and inheriting the outer identity is how a background task ends
 * up filed against whoever happened to trigger it.
 */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  const store = storage;
  if (!store) return fn();

  let owned: RequestContext;
  try {
    // Copied, so `updateContext` writes into this request's own object rather
    // than into one the caller still holds and may reuse for the next request.
    //
    // Shallow, deliberately: `attributes` stays the object the caller passed,
    // because cloning an attribute map per request is a cost on every request
    // to defend against a caller who hands us one object and then mutates it.
    // A caller who does that gets whatever state it is in when an entry is
    // written, which is the same deal as passing it to any other function.
    owned = { ...ctx };
  } catch {
    // A hostile `ctx` with a throwing getter. It does not get to stop the
    // handler: run without an ambient identity instead.
    return fn();
  }

  return store.run(owned, fn);
}

/** The context this code is running inside, or undefined. Never throws. */
export function currentContext(): RequestContext | undefined {
  try {
    return storage?.getStore();
  } catch {
    return undefined;
  }
}

/**
 * Adds to the context this code is running inside.
 *
 * For what a request learns after it starts: the middleware opens the context
 * before authentication has happened, and the handler that identifies the
 * person fills in the `userId` afterwards.
 *
 * Outside `runWithContext`, or with no storage available, this does nothing. A
 * process-wide "current request" invented to catch those calls would be an
 * identity nobody stated, attached to whoever was served last.
 *
 * The identity fields replace: each is one value, so the last statement wins.
 * Attributes MERGE, because two callers each adding a key are describing the
 * same request from different layers, and a handler adding its own must not
 * silently erase what the middleware wrote.
 */
export function updateContext(patch: Partial<RequestContext>): void {
  const ctx = currentContext();
  if (!ctx || !patch || typeof patch !== "object") return;
  try {
    if ("deviceId" in patch) ctx.deviceId = patch.deviceId;
    if ("userId" in patch) ctx.userId = patch.userId;
    if ("sessionId" in patch) ctx.sessionId = patch.sessionId;
    if (patch.attributes) ctx.attributes = { ...ctx.attributes, ...patch.attributes };
  } catch {
    // Same reasoning as `runWithContext`: a patch object that fights back
    // leaves the context as it was and the caller none the wiser.
  }
}

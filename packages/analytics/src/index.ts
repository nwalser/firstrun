import { start, type Instance } from "@firstrun/web-tag/browser";
import type { Attrs, DeliveryMode, Entry } from "@firstrun/web-tag";

/**
 * `@firstrun/analytics`: the core, which is deliberately not a core.
 *
 * The measurement lives in `@firstrun/web-tag`: the consent rule, the session
 * cut, the vitals, the beacon. This package imports it rather than reimplements
 * it. Two copies of the consent rule is one copy too many, and the copy that
 * has `packages/web-tag/test/consent.test.ts` pointed at it is the one that
 * gets to be real. If that ever has to invert -- the tag building from here
 * instead -- the test moves with the code, not the other way round.
 *
 * What this file adds is the three things a framework integration needs and a
 * script tag does not:
 *
 *  - a module singleton, so `event()` works from a button six components deep
 *    without anyone threading a client through props;
 *  - an SSR guard, because `app/layout.tsx` and `+layout.svelte` both run this
 *    module on a server where there is no `document` to measure;
 *  - a queue, because a component can fire an event before the one that calls
 *    `init` has mounted, and losing it would be a race nobody can debug.
 *
 * Every export here is total: it returns, it does not throw, and it does not
 * block. `init` is called from inside a `useEffect` and an `onMount`, where a
 * thrown error is the customer's render crashing, not ours.
 */

export type { Attrs, DeliveryMode, Entry };

export interface AnalyticsConfig {
  /**
   * The source key from the workspace's Sources page, `fr_web_…`.
   *
   * Named `sourceKey` and not `key`: React eats a prop called `key` before the
   * component ever sees it, and a silently-unconfigured analytics tag is the
   * worst bug this package could ship.
   */
  sourceKey: string;
  /** Ingest origin, e.g. `https://t.themia.app`. */
  host: string;
  /** Page views on SPA navigations. Default true. */
  autoPage?: boolean;
  /** `outbound_click` and `file_download`. Default true. */
  autoOutbound?: boolean;
  /** Core Web Vitals. Default true. */
  autoVitals?: boolean;
  /** `form_submit`, the form's id and name only. Default true. */
  autoForms?: boolean;
  /** `page_leave`, with visible time and scroll depth. Default true. */
  trackLeave?: boolean;
  /**
   * Uncaught errors and unhandled rejections, as `exception` entries at ERROR.
   * **Default false**, and the only measurement here that is.
   *
   * It is a behaviour change for an app already running this, and its volume is
   * not something the app controls: one throwing third-party widget produces
   * entries at a rate nobody chose. Turning it on should be a decision.
   */
  autoErrors?: boolean;
  /**
   * When a send is attempted. Default `immediate`. See docs/delivery-policy.md.
   *
   * `immediate` does not mean one request per entry: entries produced together
   * coalesce into one beacon, so a page view plus three clicks is one request
   * rather than four. It is the browser default because a page does not live
   * long enough for a timer to be worth waiting for, and a visit that ends
   * before the first tick sends nothing at all.
   *
   * There is no `startup` mode: it means "drain what survived the last run",
   * and nothing survives a page. Persistence here is memory, deliberately.
   */
  mode?: DeliveryMode;
  /**
   * Send at once at or above this severity, whatever the schedule says.
   * Default 17 (ERROR).
   *
   * This is the setting that makes error reporting work from a page that is
   * about to be gone. Raise it to batch exceptions with everything else, or
   * lower it to 9 to send every entry as it is made.
   */
  flushOnSeverity?: number;
  /**
   * Upper bound between flushes, in milliseconds, in `interval` mode only.
   * Zero disables the timer. Defaults to 30 seconds, and is ignored by the
   * other two modes. The floor is still hide and pagehide.
   */
  flushEvery?: number;
  /**
   * Also expose the command API as a global, for markup that has to call it
   * (a cookie banner rendered by a third party, say). Off by default here --
   * a bundled integration has imports and does not need one.
   */
  global?: string;
}

type Pending = [string, unknown, unknown];

let instance: Instance | null = null;
let mountedKey = "";
const pending: Pending[] = [];

/** The browser is the only place any of this means anything. */
const canMeasure = () => typeof document !== "undefined";

function replay(): void {
  while (instance && pending.length) {
    const [cmd, a, b] = pending.shift()!;
    if (cmd === "event") instance.event(a as string, b as Attrs | undefined);
    else if (cmd === "error") instance.error(a, b as Attrs | undefined);
    else if (cmd === "log") instance.log(a as Entry);
    else if (cmd === "identify") instance.identify(a as string | null);
    else if (cmd === "consent") instance.consent(a as boolean);
    else if (cmd === "page") instance.page();
  }
}

function queue(cmd: string, a?: unknown, b?: unknown): void {
  // Bounded for the same reason the tag's own buffer is: a page that never
  // calls init, or that renders only on the server, would otherwise grow an
  // array forever. Past the cap the oldest queued call is dropped.
  if (pending.length >= 20) pending.shift();
  pending.push([cmd, a, b]);
}

/**
 * Mounts the tag. Idempotent for the same source key, because React 18 mounts
 * every effect twice in development and neither of those mounts is a mistake.
 *
 * Wrapped, because this runs inside the customer's effect. A sandboxed iframe,
 * a frozen `history`, a `PerformanceObserver` that does not exist: none of them
 * are reasons for their component tree to unmount with an error.
 */
export function init(config: AnalyticsConfig): void {
  if (!canMeasure()) return;
  const id = config.sourceKey + "|" + config.host;
  if (instance && mountedKey === id) return;
  if (instance) stop();

  try {
    instance = start({
      sourceKey: config.sourceKey,
      host: config.host,
      global: config.global || "",
      autoPage: config.autoPage,
      autoOutbound: config.autoOutbound,
      autoVitals: config.autoVitals,
      autoForms: config.autoForms,
      trackLeave: config.trackLeave,
      autoErrors: config.autoErrors,
      mode: config.mode,
      flushOnSeverity: config.flushOnSeverity,
      flushEvery: config.flushEvery,
    });
    mountedKey = id;
  } catch {
    // Nothing mounted, so nothing is queued against a half-built instance and
    // every call below stays a no-op. The page is unaffected.
    instance = null;
    mountedKey = "";
  }
  replay();
}

/** Tears the tag down and sends what is buffered. Framework unmount calls this. */
export function stop(): void {
  const i = instance;
  instance = null;
  mountedKey = "";
  if (i) i.stop();
}

/**
 * A conventional event entry, at INFO, under any name you like.
 *
 * There is no allowlist. `exported_csv` and `page_view` are the same kind of
 * thing to every layer below this one. Attribute values keep their type, so a
 * number stays a number and averaging one is an aggregate rather than a cast.
 */
export function event(name: string, attributes?: Attrs): void {
  if (instance) instance.event(name, attributes);
  else queue("event", name, attributes);
}

/**
 * A conventional exception entry, at ERROR.
 *
 * The name is `exception` for every one of them and the `exception.*`
 * attributes say what happened, which is OpenTelemetry's shape: "all
 * exceptions" is one name, and "this exception" is a filter on a path.
 *
 * Takes anything, because a `catch` block catches anything. Sent immediately
 * rather than at the next flush.
 */
export function error(err: unknown, attributes?: Attrs): void {
  if (instance) instance.error(err, attributes);
  else queue("error", err, attributes);
}

/**
 * The escape hatch: an entry, exactly as given.
 *
 * `event` and `error` are this function with a convention filled in. An entry
 * that follows no convention at all is stored, indexed and queried identically,
 * so a customer who only ever calls `log` loses nothing.
 */
export function log(entry: Entry): void {
  if (instance) instance.log(entry);
  else queue("log", entry);
}

/**
 * Your own id for this person, as a string. `null` signs them out.
 *
 * It sets the `user.id` attribute and nothing else: firstrun never infers one,
 * never derives one from behaviour, and never links this browser's anonymous id
 * to an id from your app or your backend. If you want a person counted once
 * across surfaces, call `identify` with the same id on each of them.
 */
export function identify(userId?: string | null): void {
  if (instance) instance.identify(userId);
  else queue("identify", userId);
}

/**
 * The answer to the cookie banner. Until this is called with `true` nothing is
 * stored and nothing is sent; called with `false` it drops the distinct id and
 * everything held while the banner was up.
 */
export function consent(granted: boolean): void {
  if (instance) instance.consent(granted);
  else queue("consent", granted);
}

/** An unconditional page view. Prefer `navigated()` from a router. */
export function page(): void {
  if (instance) instance.page();
  else queue("page");
}

/**
 * A route change. Fires a page view only if the path actually moved, so a
 * router that re-renders on every query string change costs nothing.
 */
export function navigated(): void {
  if (instance) instance.navigated();
}

/** Best effort, bounded, and never throws. There is no retry behind it. */
export function flush(): void {
  if (instance) instance.flush();
}

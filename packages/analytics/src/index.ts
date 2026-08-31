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
   * The source key from the workspace's Sources page, `fr_9f3a2b1c4d5e6f70`.
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
   * Marks everything as test data, via the `firstrun.test` attribute, so a
   * preview or staging deploy cannot move a number somebody is looking at.
   *
   * Nothing is inferred from the hostname. A tag that decided `localhost` meant
   * test would decide it again on an intranet, on a preview domain and inside
   * an Electron shell, and it is silent when it is wrong. Wire it to what your
   * build already knows, such as `process.env.VERCEL_ENV !== "production"`.
   *
   * There is no `data-` attribute for this on the script-tag build: it did not
   * fit the 4KB budget. A site pasting the snippet uses a separate source
   * instead, which is what a separate thing writing entries already is.
   */
  testMode?: boolean;
  /**
   * An id that lives in the tab and dies with it, and no consent gate.
   *
   * The default id is written to `localStorage` and read back on a later visit,
   * which is information stored on a device and therefore a question to ask
   * before storing it. This is the other trade: the keys move to
   * `sessionStorage`, nothing outlives the tab, and there is nothing persistent
   * left to ask about, so entries send from the first one.
   *
   * It costs the returning visitor. A unique becomes one tab rather than one
   * browser, which overcounts uniques across days and makes a week-over-week
   * comparison of them meaningless. Counts of entries are unaffected, which is
   * why this suits a marketing site and does not suit a product.
   *
   * Not the same thing as `session.id`, which still cuts on 30 minutes idle
   * inside this id and is unchanged by it.
   */
  ephemeral?: boolean;
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
    else if (cmd === "user") instance.user(a as string | null);
    else if (cmd === "device") instance.device(a as string | null);
    else if (cmd === "session") instance.session(a as string);
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
  // `ephemeral` is part of the identity of a mount and not just a setting on
  // one: it decides which Storage the id lives in, and that is resolved once
  // inside `start()`. Flipping it on a live instance has to tear down and
  // remount, or the tag keeps writing to the store the old mount chose.
  // Normalised to a boolean so that omitting it and passing `false` are the
  // same mount rather than two.
  const id = config.sourceKey + "|" + config.host + "|" + (config.ephemeral === true);
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
      ephemeral: config.ephemeral,
      mode: config.mode,
      flushOnSeverity: config.flushOnSeverity,
      flushEvery: config.flushEvery,
      testMode: config.testMode,
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
 * Sets the `user.id` attribute and nothing else: firstrun never infers one,
 * never derives one from behaviour, and never links an id here to an id from
 * your app or your backend. If you want a person counted once across sources,
 * call `user` with the same id on each of them.
 *
 * Naming a different person starts a new session, because a sign-in is a
 * boundary. Naming the same one again, which is what a router does on every
 * route change, does nothing at all.
 */
export function user(userId?: string | null): void {
  if (instance) instance.user(userId);
  else queue("user", userId);
}

/**
 * The machine this is running on, when you actually know it.
 *
 * For a page inside a Tauri or Electron shell that can ask the OS. On an
 * ordinary website there is nothing honest to pass here: leave it alone, or
 * switch on `fingerprint` in the tag options and accept what that is worth.
 * Nothing is ever inferred on your behalf.
 */
export function device(deviceId?: string | null): void {
  if (instance) instance.device(deviceId);
  else queue("device", deviceId);
}

/**
 * Replace the session id. There is no separate new-session call: this is it.
 *
 * The tag keeps its own session by default, cutting after thirty idle minutes
 * or on arrival from a new site, so most apps never call this.
 */
export function session(sessionId: string): void {
  if (instance) instance.session(sessionId);
  else queue("session", sessionId);
}

/**
 * The answer to the cookie banner. Until this is called with `true` nothing is
 * stored and nothing is sent; called with `false` it drops any device id and
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

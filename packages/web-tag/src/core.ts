/**
 * The tag's logic, with every browser API behind `Env`.
 *
 * Split out from the browser half because the consent rule is a promise made to
 * the people being measured, and a promise nothing tests is a promise nobody
 * keeps. With the browser mocked out, "before consent nothing is stored and
 * nothing is sent" is an assertion rather than a comment, and it has to stay
 * one now that the tag emits entries on its own instead of only when asked.
 *
 * Everything that decides *whether* and *what* lives here. The browser half
 * only measures: a number of milliseconds, a scroll offset, an href, a thrown
 * value. That is the line, and it is why `test/consent.test.ts` can cover the
 * automatic entries without a DOM.
 *
 * ## Everything emitted here is a log entry
 *
 * A page view, a Core Web Vital and an uncaught exception are the same shape:
 * a name, a severity on the 1..24 ladder, and an attribute map. There is no
 * event type, no error type and no metric type, here or anywhere downstream.
 * `event()` and `error()` fill in a convention; `log()` fills in nothing and is
 * the escape hatch for an entry the conventions have no opinion about.
 *
 * ## Conventions are copied, not imported
 *
 * The attribute keys and severities below are `packages/schema/src/conventions.ts`
 * and `severity.ts`, which are the source of truth for everything server-side.
 * They are copied rather than imported because `@firstrun/schema` pulls in zod,
 * a 12KB dependency inside a 4KB budget. If a key changes there, it changes
 * here. Nothing breaks if they drift, which is the point: an entry is never
 * rejected for the keys it chose, so a stale copy costs suggestions in a picker
 * and nothing else.
 *
 * Nothing here is on the host page's critical path. Every entry is appended to
 * a bounded buffer and posted fire-and-forget; there is no retry, no queue that
 * outlives the page, and no code path where the customer's link, form or router
 * waits on us. If the ingest host is unreachable the entries are lost, which is
 * the correct trade: telemetry is not worth a broken page.
 *
 * esbuild inlines this back into one IIFE, so the split costs nothing on the wire.
 */

/**
 * An attribute map. JSON, bounded server-side, and open by design: the backend
 * does not know what any key means, so the tag is free to send what it measured
 * without asking anybody's permission first.
 */
export type Attrs = Record<string, unknown>;

/** One entry on the wire. Short keys, because this rides a `sendBeacon`. */
export interface WireEntry {
  /** entry id */
  i: string;
  /** timestamp, ms since epoch. Client-stamped and authoritative. */
  t: number;
  /** name */
  n: string;
  /** severity_number, 1..24 */
  s?: number;
  /** attributes */
  a?: Attrs;
}

/** What `log()` takes. Every field optional except the name. */
export interface Entry {
  name: string;
  /** 1..24. Omitted means unclassified, which is not the same as INFO. */
  severity?: number;
  attributes?: Attrs;
  /** Milliseconds since epoch. Defaults to now. */
  time?: number;
}

export interface PageInfo {
  url?: string;
  referrer?: string;
  locale?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

export interface Env {
  now(): number;
  uuid(): string;
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
  /** Fire-and-forget. Must never throw and must never be awaited. */
  send(url: string, body: string): void;
  pageInfo(): PageInfo;
  /**
   * Run `fn` once, `ms` from now. The one clock this file is allowed.
   *
   * Injected rather than called directly so the coalescing window is a thing a
   * test can step through instead of wait out: `test/delivery.test.ts` runs the
   * queued callbacks by hand and counts the beacons that come out.
   */
  schedule(fn: () => void, ms: number): void;
  /**
   * A stable-ish id for this browser, derived from what it will tell us.
   *
   * Only ever called when the customer has switched `fingerprint` on AND the
   * visitor has consented. Returns undefined when it cannot be computed, and
   * undefined is a fine answer: `device.id` is optional and a browser with no
   * device to name simply does not carry one.
   *
   * Injected like everything else the DOM owns, so `core.ts` stays testable
   * without a browser and the signal list can change without touching this file.
   */
  fingerprint(): string | undefined;
}

export const KEY_CONSENT = "_frc";
/**
 * `<last-activity ms>|<referrer host>|<session id>`. One key, because three
 * would be three writes on every entry.
 *
 * The id is stored beside the clock rather than regenerated per page load. A
 * visit that crosses a full navigation is one visit, and a session id that
 * changed every time somebody clicked a server-rendered link would make
 * "sessions" a count of page loads with a longer name.
 *
 * There is no separate visitor-id key any more. `device.id` is either derived
 * from the browser on each load (fingerprinting, off by default) or handed to
 * `device()` by the customer, and neither is written here.
 */
export const KEY_SESSION = "_frs";

/**
 * The server's hard per-request entry cap, from `MAX_ENTRIES_PER_BATCH` in
 * `packages/schema/src/log.ts`. `maxBatch` is clamped to it rather than trusted:
 * a batch over the cap is rejected whole, so the queue never drains and the
 * failure presents as total silence rather than as an error anybody sees.
 */
export const MAX_BATCH = 500;

/**
 * Default `maxBatch`, and with it the bound on the buffer.
 *
 * One flush is one request, so the two numbers are the same number: past this
 * the oldest entry is dropped and counted. Fifty is an order of magnitude under
 * the server cap, which is the right side to be wrong on inside a page whose
 * memory is somebody else's.
 */
export const MAX_BUFFER = 50;
/**
 * How long `immediate` holds a batch open before sending it, in milliseconds.
 *
 * `immediate` means "do not wait for a timer", not "one request per entry". A
 * thousand `event()` calls in one loop are one beacon, and a page view followed
 * by three clicks is one or two rather than four. Short enough that a visit
 * ending during the window is covered by the pagehide backstop, long enough
 * that an ordinary burst of interaction coalesces.
 */
export const COALESCE_MS = 250;
/**
 * A visit ends after this much inactivity. Thirty minutes because that is what
 * every other tool uses, and a session number nobody can compare is not a number.
 */
export const SESSION_IDLE_MS = 1_800_000;

/**
 * The first number of each band on the OpenTelemetry ladder.
 *
 * Four numbers per band, six bands, 1 to 24. Only the three the tag itself
 * reaches for are here; a customer wanting `WARN2` passes 14 to `log()`.
 */
export const SEV_INFO = 9;
export const SEV_ERROR = 17;

/**
 * At or above this, send now rather than at the next threshold or page hide.
 *
 * A crash report that waits for a flush is a crash report that usually does not
 * arrive, because by then the page is gone. This is `flushOnSeverity` from
 * docs/delivery-policy.md, and it is most of the value of having a policy.
 */
export const FLUSH_SEVERITY = SEV_ERROR;

/**
 * When a send is attempted. `docs/delivery-policy.md` calls this the schedule.
 *
 * The policy's fourth mode, `startup`, is absent rather than rejected: it means
 * "drain what survived the last run", and nothing survives a page. It is only
 * coherent with disk persistence, and this client has none by design -- a
 * durable queue in `localStorage` is unsent analytics on the disk of a visitor
 * who never came back, which is the thing withdrawing consent is meant to
 * prevent. Naming it here would be offering a mode that can only ever send
 * nothing. An unrecognised string coerces to `immediate`.
 */
export type DeliveryMode = "immediate" | "interval" | "manual";

/**
 * Extensions that make a link a file rather than a page.
 *
 * A fixed list rather than "anything with a dot": `/v1.4/setup` is a page and
 * `/pricing.html` is not a download. Padded with spaces so the membership test
 * is one `indexOf` instead of an array.
 */
export const DOWNLOAD_EXTS =
  " pdf zip dmg exe msi pkg deb rpm appimage csv xlsx doc docx mp3 mp4 ";

/**
 * The metrics this tag knows how to report. Anything else is not one of ours.
 *
 * A list rather than the good/poor threshold pairs it used to be. The rating
 * was a comparison against `WEB_VITAL_THRESHOLDS` in
 * `packages/schema/src/conventions.ts`, and sending it meant shipping Google's
 * table twice and then storing the answer on every single row. The server has
 * the same table and the query layer classifies at read time, which is also the
 * only way a threshold change ever applies to the samples already collected.
 */
export const VITALS = " LCP INP CLS FCP TTFB ";

export interface TagConfig {
  /**
   * The source key, e.g. `fr_9f3a2b1c4d5e6f70`.
   *
   * Public by necessity: it ships in a script tag. It identifies which
   * ingestion site this is and authorises nothing, and the server is the only
   * thing that knows which workspace it belongs to.
   */
  sourceKey: string;
  host: string;
  /**
   * The schedule. Default `immediate`, which is the browser's honest default:
   * a page does not live long enough for a timer to be worth waiting for, and a
   * visit that ends before the first tick sends nothing at all.
   */
  mode?: DeliveryMode;
  /**
   * Send at once at or above this severity, whatever the schedule says.
   * Default 17 (ERROR). Zero or below sends every entry at once, which defeats
   * coalescing; a number above 24 turns the rule off.
   *
   * The other two numbers the policy names, `maxBatch` and the coalescing
   * window, are constants here rather than settings: see `MAX_BUFFER` and
   * `COALESCE_MS`. This file is the one place in the product where a knob
   * nobody turns still costs every visitor bytes, and neither has a value worth
   * choosing on a web page.
   */
  flushOnSeverity?: number;
  /**
   * Marks everything this tag sends as test data, via `firstrun.test`.
   *
   * Set from `data-test-mode` on the script tag, or by the caller. Nothing is
   * inferred from the hostname: a tag that decided for itself that `localhost`
   * meant test would be deciding it again on somebody's intranet, on a preview
   * domain and inside an Electron shell, and the failure is silent in both
   * directions. One attribute in the snippet says it out loud instead.
   */
  testMode?: boolean;
  /**
   * Identity that does not outlive the tab, and no consent gate.
   *
   * The consent gate exists because the default id is written to a device and
   * read back on a later visit. Take that away and the thing consent was
   * protecting is gone with it: `Env` is pointed at `sessionStorage` by the
   * browser half, the id cannot survive the tab, and there is nothing stored
   * for anybody to be asked about. So the gate opens here instead of waiting
   * for an answer that has no question.
   *
   * The promise in `test/consent.test.ts` is unchanged and still the default.
   * This is a second arrangement, chosen out loud by whoever installs the tag,
   * and it buys a smaller number: a unique is one tab, not one browser. See
   * `StartOptions.ephemeral`.
   */
  ephemeral?: boolean;
  /**
   * Derive a `device.id` for this browser. OFF, and off is the default that
   * matters.
   *
   * There is no device to find out in a browser. Everything reachable from a
   * page is a description of software, not of a machine, so this hashes a
   * handful of stable-ish signals and calls the result a device: it collides
   * between two identical laptops, it changes when the OS updates or the window
   * moves to another monitor, and it is worth nothing as an absolute number. It
   * is worth something as a trend, which is why it exists and why it says so
   * here rather than in a changelog.
   *
   * Gated TWICE: this flag has to be on and `consent(true)` has to have been
   * given. Deriving an id from someone's browser is the thing consent is for,
   * and it is more of that thing than the storage key ever was, so it does not
   * get a weaker gate than storage got.
   *
   * Whether it is lawful where the customer operates is the customer's
   * question, and it is off until they answer it. `device()` remains available
   * to a caller who genuinely knows the machine, such as a page inside a Tauri
   * or Electron shell, and needs neither this flag nor a hash.
   */
  fingerprint?: boolean;
}

/** Host of a URL, or "" when there is not one. `mailto:` and `tel:` land here. */
function hostOf(u: string | undefined): string {
  if (!u) return "";
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
}

/**
 * The part of a URL that makes it a different page.
 *
 * Path only. Routers rewrite the query on every filter keystroke and the hash
 * on every scroll restoration, and neither of those is a page view.
 */
function pathOf(u: string | undefined): string {
  if (!u) return "";
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

/** The download extension of an href, or "" if it is not a file link. */
function extOf(href: string): string {
  const m = /\.([a-z0-9]{2,8})(?:[?#]|$)/i.exec(href);
  const e = m ? m[1]!.toLowerCase() : "";
  return e && DOWNLOAD_EXTS.indexOf(" " + e + " ") >= 0 ? e : "";
}

/**
 * Attributes, copied and made safe to serialise.
 *
 * Unlike the props map this replaced, values keep their type: a Core Web Vital
 * is a number and stays one, so a query can average it without casting every
 * row out of text. What is dropped is what JSON cannot carry, plus the two
 * numbers that survive `typeof` and not `JSON.stringify` -- NaN and Infinity
 * both serialise as `null`, and a null that used to be a measurement is worse
 * than an absent key.
 *
 * Copying means a caller who reuses and mutates their object cannot rewrite an
 * entry we already recorded.
 */
function clean(attrs: unknown): Attrs | undefined {
  if (!attrs || typeof attrs !== "object") return undefined;
  const out: Attrs = {};
  for (const k in attrs as Attrs) {
    const v = (attrs as Attrs)[k];
    const t = typeof v;
    // An allowlist, because the things JSON cannot carry are not all the same
    // failure: a function is dropped by `stringify`, a BigInt throws out of it
    // and would cost the batch every entry in it, and NaN or Infinity survive
    // as `null`, which is worse than absent when the key was a measurement.
    if (t === "string" || t === "boolean" || t === "object") out[k] = v;
    else if (t === "number" && isFinite(v as number)) out[k] = v;
  }
  return out;
}

/** Puts a value under a key only if there is one. Keeps the wire free of nulls. */
function put(a: Attrs, k: string, v: unknown): void {
  if (v !== undefined && v !== null && v !== "") a[k] = v;
}

export function createTag(env: Env, config: TagConfig) {
  // Resolved once. An unrecognised mode is `immediate`, which is also what
  // `startup` becomes: there is no disk here for it to drain from, and a mode
  // that can only ever send nothing is worse than one that sends now.
  const manual = config.mode === "manual";
  const immediate = !manual && config.mode !== "interval";
  // Falsy means the default. Zero is not a severity on the 1..24 ladder, so
  // there is no legitimate value this rejects, and the check costs nothing.
  const flushSeverity = config.flushOnSeverity || FLUSH_SEVERITY;
  /**
   * The buffer depth that sends without waiting for the schedule.
   *
   * A full batch is a batch that can be formed, and forming one beats the only
   * other thing that happens at this depth, which is dropping the oldest entry
   * in it. `manual` is the exception and gets no threshold at all: the caller
   * said they would decide, and a bounded buffer that drops is what they chose.
   */
  const flushAt = manual ? Infinity : MAX_BUFFER;

  let consented = false;
  // The three optional identities, and all three really are optional. A tag
  // with no consent and no fingerprint sends entries carrying none of them,
  // which counts them as entries and in no unique. There is no fourth id
  // underneath holding the whole thing up any more.
  let deviceId: string | undefined;
  let userId: string | undefined;
  let sessionId = env.uuid();
  let buffer: WireEntry[] = [];
  /**
   * Entries the buffer had to drop, cumulative.
   *
   * A bounded queue that drops silently is a queue nobody can tell is dropping,
   * and a long window with a small buffer loses data without ever saying so.
   * The count rides out on the resource, so it is visible in the data rather
   * than only in a debugger.
   */
  let dropped = 0;
  /** A coalescing flush is already scheduled. One timer, not one per entry. */
  let armed = false;

  // Session state. Persisted only once there is consent to persist anything,
  // and held in memory until then so a visit that starts on the banner is still
  // one visit if the answer turns out to be yes.
  let lastSeen = 0;
  let lastRef = "";

  // Page-view state, reset by `page()`.
  let lastPath: string | null = null;
  let leaveDue = false;
  // Deliberately not reset by `page()`: vitals are per document, not per route.
  // The largest contentful paint of a SPA happened once, and re-reporting it on
  // every client-side navigation turns one measurement into a pile of copies.
  const vitalsSent: Record<string, 1> = {};

  // A returning visitor already answered the banner. A first-time visitor has
  // stored nothing, so there is nothing to read and nothing to send.
  //
  // `ephemeral` takes the same branch on the first entry rather than getting a
  // second one: the id, the session clock and the storage calls are identical
  // and only the store underneath them differs, so the mode that needs no
  // banner is the mode that behaves as though the banner was already answered.
  if (config.ephemeral || env.get(KEY_CONSENT) === "1") {
    consented = true;
    const s = (env.get(KEY_SESSION) || "").split("|");
    lastSeen = +s[0]! || 0;
    lastRef = s[1] || "";
    // Adopt the stored session rather than minting a new one, but only while
    // the clock says the visit is still open. `bump()` makes the same decision
    // one line later for the referrer, and would cut a stale one anyway; this
    // is here so the id survives an ordinary full page load.
    if (s[2] && env.now() - lastSeen <= SESSION_IDLE_MS) sessionId = s[2];
    deviceId = derivedDevice();
  }

  function push(e: WireEntry): void {
    if (buffer.length >= MAX_BUFFER) {
      buffer.shift();
      dropped++;
    }
    buffer.push(e);
  }

  /**
   * The resource: what is true of this client rather than of one entry.
   *
   * Sent once per batch and merged under every entry's own attributes at the
   * edge, so a row ends up self-contained without the wire carrying the session
   * id fifty times. `user.id` is only ever the string the customer handed to
   * `user()`, and is absent until they do. `device.id` is absent unless they
   * asked for a fingerprint or handed one over, which on the web is the
   * ordinary case rather than the degraded one.
   */
  function resource(): Attrs {
    const r: Attrs = { "session.id": sessionId };
    put(r, "user.id", userId);
    put(r, "device.id", deviceId);
    if (dropped) r["firstrun.dropped"] = dropped;
    // Only ever the boolean, and only ever when true. The dashboard matches it
    // with jsonb containment, where `"true"` is a different value from `true`.
    if (config.testMode) r["firstrun.test"] = true;
    put(r, "browser.language", env.pageInfo().locale);
    return r;
  }

  /**
   * Hand the buffer to the transport and forget about it.
   *
   * The buffer is emptied before the send, not after it succeeds, and there is
   * no retry. A retry queue is a buffer that grows while the network is down,
   * which is the one state in which it must not: an outage on our side must
   * cost the host page nothing, not a slowly filling array and a timer.
   */
  function flush(): void {
    if (!consented || buffer.length === 0) return;
    const e = buffer;
    buffer = [];
    env.send(config.host + "/v1/e", JSON.stringify({ k: config.sourceKey, r: resource(), e }));
  }

  /**
   * Appends an entry without touching the session clock. For measurements.
   *
   * The one place an entry is created, so there is one place that decides when
   * to send: a full-enough buffer, or a severity bad enough that waiting is a
   * good way to lose it.
   */
  function emit(name: string, severity?: number, attrs?: Attrs, time?: number): void {
    const e: WireEntry = { i: env.uuid(), t: time ?? env.now(), n: name };
    if (severity) e.s = severity;
    if (attrs && Object.keys(attrs).length) e.a = attrs;
    push(e);
    if (!consented) return;
    // `flushOnSeverity` outranks every schedule, `manual` included: a crash
    // report that waits for the next window is a crash report that usually does
    // not arrive, because by then the page is gone. Below it, the buffer
    // threshold, which is what keeps a full batch from becoming a dropped one.
    if ((severity || 0) >= flushSeverity || buffer.length >= flushAt) flush();
    // The coalescing window, opened by the first entry of a burst and not
    // restarted by the rest: a trailing debounce that keeps resetting is a
    // batch that never sends while somebody keeps interacting. One timer for
    // the whole window is what makes a burst of `event()` calls one beacon
    // rather than one request each.
    else if (immediate && !armed) {
      armed = true;
      env.schedule(() => {
        armed = false;
        flush();
      }, COALESCE_MS);
    }
  }

  /**
   * Marks activity, and starts a new visit if this one has expired.
   *
   * Sessions are cut here, on the client, and not on the server, because only
   * the client knows the tab is the same tab. A server sees a run of beacons
   * and would have to re-derive this same rule on every read, from worse
   * information, forever, and on the web it now has no other id to derive it
   * from at all. Cutting once at the source makes a session id a fact the rest
   * of the system can just group by.
   */
  function bump(info: PageInfo): void {
    const t = env.now();
    // A referrer pointing at our own site is an internal navigation. Treating
    // it as a new referrer would start a fresh visit on every full page load.
    let ref = hostOf(info.referrer);
    if (ref === hostOf(info.url)) ref = "";

    if (t - lastSeen > SESSION_IDLE_MS || (ref !== "" && ref !== lastRef)) {
      sessionId = env.uuid();
      lastRef = ref;
      push({ i: env.uuid(), t, n: "session_start", s: SEV_INFO });
    }
    lastSeen = t;
    saveSession();
  }

  function saveSession(): void {
    if (consented && lastSeen) env.set(KEY_SESSION, lastSeen + "|" + lastRef + "|" + sessionId);
  }

  // --- The public vocabulary ----------------------------------------------

  /**
   * The escape hatch: an entry, exactly as given.
   *
   * No convention is applied and nothing is filled in except an id and a
   * timestamp. A customer whose name matches nothing we suggest, at a severity
   * we have never used, carrying keys nobody has heard of, is stored and
   * queried identically to a page view. That is not a fallback, it is the
   * model: `event()` and `error()` below are two calls to this one with the
   * conventional fields filled in.
   */
  function log(entry: Entry): void {
    if (!entry || !entry.name) return;
    bump(env.pageInfo());
    emit(String(entry.name), entry.severity, clean(entry.attributes), entry.time);
  }

  /** A conventional event: any name the customer likes, at INFO. */
  function event(name: string, attrs?: unknown): void {
    bump(env.pageInfo());
    emit(String(name), SEV_INFO, clean(attrs));
  }

  /**
   * A conventional exception entry, at ERROR.
   *
   * The name is `exception` for every one of them and the `exception.*`
   * attributes say what happened, which is OpenTelemetry's shape. It means "all
   * exceptions" is one name and "this exception" is a filter on a path, rather
   * than a thousand names nobody can enumerate.
   *
   * Takes anything, because a `catch` block catches anything: a string, a
   * rejected promise carrying a number, an object with a `message`. Whatever it
   * is becomes a message rather than nothing.
   */
  function error(err: unknown, attrs?: unknown): void {
    const e = (err ?? {}) as { name?: unknown; message?: unknown; stack?: unknown };
    const a: Attrs = clean(attrs) || {};
    put(a, "exception.type", typeof e.name === "string" ? e.name : "Error");
    put(
      a,
      "exception.message",
      typeof e.message === "string" && e.message ? e.message : String(err)
    );
    put(a, "exception.stacktrace", typeof e.stack === "string" ? e.stack : undefined);
    bump(env.pageInfo());
    emit("exception", SEV_ERROR, a);
  }

  // --- The automatic entries ----------------------------------------------

  function page(): void {
    const info = env.pageInfo();
    bump(info);
    lastPath = pathOf(info.url);
    leaveDue = true;

    const a: Attrs = {};
    put(a, "url.full", info.url);
    put(a, "url.path", lastPath);
    put(a, "firstrun.referrer", info.referrer);
    put(a, "firstrun.referrer.host", hostOf(info.referrer));
    put(a, "firstrun.utm.source", info.utm_source);
    put(a, "firstrun.utm.medium", info.utm_medium);
    put(a, "firstrun.utm.campaign", info.utm_campaign);
    emit("page_view", SEV_INFO, a);
  }

  /**
   * A history change. Fires a page view only when the path actually moved.
   *
   * Frameworks call `replaceState` constantly (scroll restoration, shallow
   * query updates, prefetch bookkeeping) and every one of those would otherwise
   * be a page view. Returns whether it fired, so the caller knows to restart
   * its clock.
   */
  function navigated(durationMs: number, scrollPct: number): boolean {
    if (pathOf(env.pageInfo().url) === lastPath) return false;
    // The outgoing route is genuinely being left. Waiting for the tab to hide
    // would leave "time on page" describing only the last route of a visit.
    leave(durationMs, scrollPct);
    page();
    return true;
  }

  /**
   * The page is being left. Once per page view: `visibilitychange` and
   * `pagehide` both fire on the way out, and a second one would double the
   * denominator of every average.
   *
   * The duration is a number rather than a string, so "average time on page" is
   * an aggregate over the attribute instead of a cast over every row.
   */
  function leave(durationMs: number, scrollPct: number): void {
    if (!leaveDue) return;
    leaveDue = false;
    emit("page_leave", SEV_INFO, {
      "firstrun.duration_ms": Math.max(0, Math.round(durationMs)),
      "firstrun.scroll_pct": Math.min(100, Math.max(0, Math.round(scrollPct))),
    });
  }

  /**
   * One Core Web Vital. Once per metric per document.
   *
   * A measurement rather than a bespoke kind of thing: the name says it is a
   * web vital, `firstrun.metric` says which, and `firstrun.value` carries the
   * number. Exactly the shape a queue depth or an RSS sample from a desktop app
   * would use, which is why the query layer needs no special case for it.
   */
  function vital(metric: string, value: number): void {
    if (VITALS.indexOf(" " + metric + " ") < 0 || vitalsSent[metric]) return;
    vitalsSent[metric] = 1;
    emit("web_vital", SEV_INFO, {
      "firstrun.metric": metric,
      // Three decimals: enough for CLS, invisible for the millisecond metrics.
      "firstrun.value": Math.round(value * 1000) / 1000,
      // CLS is unitless, and `put` would not have dropped an empty string here.
      "firstrun.unit": metric === "CLS" ? undefined : "ms",
    });
  }

  /**
   * A click on an anchor.
   *
   * A link that is both off-site and a file is a download. What is interesting
   * is that they took the file, not that the file lived on a CDN.
   */
  function linkClick(href: string, from?: string): void {
    const h = hostOf(href);
    if (!h) return;
    const ext = extOf(href);
    if (ext) event("file_download", { "url.full": href, "firstrun.file.ext": ext });
    else if (h !== hostOf(from || env.pageInfo().url)) {
      event("outbound_click", { "url.full": href, "url.domain": h });
    }
  }

  /** A form was submitted. Identity of the form only, never what was in it. */
  function formSubmit(id?: string, name?: string): void {
    const a: Attrs = {};
    put(a, "firstrun.form.id", id);
    put(a, "firstrun.form.name", name);
    event("form_submit", a);
  }

  /**
   * The fingerprint, when it is allowed and asked for. Never otherwise.
   *
   * Both gates in one place, so there is one line to read to know whether this
   * tag can derive an id: the customer's flag, and the visitor's answer. A
   * `device()` call the customer made themselves is not touched by either, and
   * is not overwritten here.
   */
  function derivedDevice(): string | undefined {
    if (deviceId || !config.fingerprint || !consented) return deviceId;
    return env.fingerprint();
  }

  function setConsent(granted: boolean): void {
    if (granted) {
      consented = true;
      env.set(KEY_CONSENT, "1");
      deviceId = derivedDevice();
      saveSession();
      flush();
    } else {
      // Withdrawn consent drops the buffer as well as the ids. Sending what we
      // gathered while waiting for an answer, after the answer was no, is
      // exactly the behaviour a consent banner is supposed to prevent.
      //
      // The device id goes with it whether it was derived or handed to us: it
      // is the identifier consent was actually about, and keeping a customer's
      // own one alive here would be a loophole shaped like an argument.
      consented = false;
      deviceId = undefined;
      buffer = [];
      env.del(KEY_CONSENT);
      env.del(KEY_SESSION);
    }
  }

  /**
   * The customer's own id for this person, from `user()`.
   *
   * Held for the life of the page and never written to storage: it is the
   * customer's data about a signed-in user, and persisting it would be a second
   * identifier on disk that nobody answered a banner about. A reload that
   * matters re-calls `user()` from the session the customer already has.
   *
   * Naming a DIFFERENT person starts a new session, because a sign-in is a
   * boundary and one visit spanning two accounts belongs to neither. Naming the
   * same one again, which is what a router does on every route change, is a
   * no-op and must stay one. Clearing it (a sign-out) is a change like any
   * other and cuts the session too.
   */
  function user(id?: string | null): void {
    const next = id ? String(id) : undefined;
    if (next === userId) return;
    userId = next;
    session(env.uuid());
  }

  /**
   * The machine, when the caller knows it and we do not.
   *
   * For a page inside a Tauri or Electron shell that can ask the OS. It needs
   * no fingerprint flag, because nothing is being derived: this is the customer
   * telling us a fact about their own installation. It still needs consent to
   * be SENT, like everything else the tag holds.
   */
  function device(id?: string | null): void {
    deviceId = id ? String(id) : undefined;
  }

  /**
   * Replace the session id. There is no `newSession()`: this is it, with an id
   * the caller chose.
   *
   * The idle clock and the referrer rule keep running underneath. An explicitly
   * set session still ends after thirty minutes of nothing, because the
   * alternative is a "session" that is really the lifetime of a tab somebody
   * left open over a weekend.
   */
  function session(id: string): void {
    sessionId = String(id);
    lastSeen = env.now();
    saveSession();
  }

  return {
    call(cmd: string, a?: unknown, b?: unknown): unknown {
      if (cmd === "consent") return setConsent(a !== false);
      if (cmd === "event") return event(String(a), b);
      if (cmd === "error") return error(a, b);
      if (cmd === "log") return log(a as Entry);
      if (cmd === "page") return page();
      if (cmd === "user") return user(a as string | null | undefined);
      if (cmd === "device") return device(a as string | null | undefined);
      if (cmd === "session") return session(String(a));
      if (cmd === "flush") return flush();
      return undefined;
    },
    log,
    event,
    error,
    page,
    navigated,
    leave,
    vital,
    linkClick,
    formSubmit,
    flush,
    setConsent,
    user,
    device,
    session,
    hasConsent: () => consented,
    /** Entries the bounded buffer has dropped. Also sent on the resource. */
    dropped: () => dropped,
    deviceId: () => deviceId,
    sessionId: () => sessionId,
    buffered: () => buffer.length,
  };
}

export type Tag = ReturnType<typeof createTag>;

import {
  createTag,
  type Attrs,
  type DeliveryMode,
  type Entry,
  type Env,
  type PageInfo,
  type Tag,
} from "./core.js";

/**
 * The browser half of the tag: DOM, storage, the beacon, and the observers.
 *
 * No decisions are made here. This file measures -- a number of visible
 * milliseconds, a scroll offset, an href, a performance entry -- and hands the
 * numbers to `core.ts`, which decides whether they may be stored or sent. That
 * is what keeps the consent promise testable without a DOM.
 *
 * It is a module with a `start()` rather than a script that runs on import, so
 * `@firstrun/analytics` can mount the same measurement code from a framework
 * component. `tag.ts` is the script-tag entry that calls it.
 *
 * Two rules hold everywhere in this file, because this code runs inside someone
 * else's page:
 *
 *  - Nothing we do is on their critical path. We never call `preventDefault`,
 *    never delay a navigation, never rewrite an href, and never wait for a
 *    response. A link works identically whether or not this file loaded.
 *  - Nothing we do throws into them. Every listener, observer callback and
 *    public method goes through `safe()`, which swallows. An exception raised
 *    inside a patched `history.pushState` would surface as a router crash in
 *    their app, and no measurement is worth that.
 *
 * The body goes out as `text/plain` so the request stays simple. A JSON content
 * type or any custom header would add a preflight to every beacon, and a
 * preflight fired from `pagehide` does not complete.
 */

export interface StartOptions {
  /** `fr_web_…`. Public by necessity; it authorises nothing. */
  sourceKey: string;
  /** Ingest origin. Defaults to wherever the script itself was served from. */
  host?: string;
  /** Name to expose the command API under, or "" for none. */
  global?: string;
  /** Page views on SPA navigations. */
  autoPage?: boolean;
  /** `outbound_click` and `file_download` from a delegated listener. */
  autoOutbound?: boolean;
  /** Core Web Vitals via PerformanceObserver. */
  autoVitals?: boolean;
  /** `form_submit`, carrying the form's id and name and nothing else. */
  autoForms?: boolean;
  /** `page_leave`, carrying visible time and scroll depth. */
  trackLeave?: boolean;
  /**
   * Uncaught errors and unhandled rejections, as conventional `exception`
   * entries. **Off by default**, and the only automatic measurement that is.
   *
   * Two reasons it does not default on with the rest. It is a behaviour change
   * for every site already running this tag, and it is the one measurement
   * whose volume the customer does not control: a third-party widget throwing
   * on every page load, or a rejected fetch in a retry loop, produces entries
   * at a rate nothing on the page is choosing. Turning it on should be somebody
   * deciding they want it.
   */
  autoErrors?: boolean;
  /**
   * When a send is attempted. Default `immediate`. See docs/delivery-policy.md.
   *
   * `immediate` does not mean one request per entry: entries produced together
   * coalesce into one beacon. `interval` waits up to `flushEvery`. `manual`
   * sends only from `flush()`, plus the exit backstop below.
   */
  mode?: DeliveryMode;
  /**
   * Send at once at or above this severity, whatever the schedule says.
   * Default 17 (ERROR).
   */
  flushOnSeverity?: number;
  /**
   * Upper bound between flushes, in milliseconds, in `interval` mode only.
   * Zero disables the timer. Default 30000. Ignored by the other two modes.
   *
   * An upper bound rather than a promise: the floor is still `visibilitychange`
   * and `pagehide`, which is what actually fires on a page somebody reads for
   * ninety seconds. See docs/delivery-policy.md.
   */
  flushEvery?: number;
}

export interface Instance {
  /** An entry, exactly as given. The escape hatch: no convention is applied. */
  log(entry: Entry): void;
  /** A conventional event entry at INFO, under any name you like. */
  event(name: string, attributes?: Attrs): void;
  /** A conventional `exception` entry at ERROR. Takes anything a catch caught. */
  error(err: unknown, attributes?: Attrs): void;
  identify(userId?: string | null): void;
  consent(granted: boolean): void;
  page(): void;
  /** Fire a page view if the path moved. What a framework router calls. */
  navigated(): void;
  flush(): void;
  /** Removes every listener, restores `history`, and sends what is buffered. */
  stop(): void;
}

/** Entry shapes the DOM lib does not describe. */
interface ShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}
interface EventEntry extends PerformanceEntry {
  interactionId?: number;
}
interface ObserveInit {
  type: string;
  buffered?: boolean;
  durationThreshold?: number;
}

function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  let s = "";
  for (let i = 0; i < 16; i++) {
    s += b[i]!.toString(16).padStart(2, "0");
    if (i === 3 || i === 5 || i === 7 || i === 9) s += "-";
  }
  return s;
}

// Every storage access is wrapped: Safari in private mode throws on write, and
// a throwing analytics tag takes the page's other scripts down with it.
function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode, quota, blocked. Not ours to solve. */
  }
}

function del(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* as above */
  }
}

/**
 * One shot at the network, then forget it.
 *
 * Wrapped whole because `sendBeacon` throws rather than returning false when a
 * `connect-src` policy or a blocker refuses the URL, and this is reached from a
 * click handler. There is no retry: an unreachable ingest host must cost the
 * page nothing, and a queue that survives the outage is the one thing that
 * would cost it something.
 */
function send(url: string, body: string): void {
  try {
    const nav = navigator;
    if (nav && typeof nav.sendBeacon === "function") {
      if (nav.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
    }
    // Only reached when sendBeacon is absent or refused the payload. Never from
    // an unload handler on a browser that has it. The rejection is swallowed:
    // an unhandled one would show up in the page's error reporting as theirs.
    fetch(url, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => {});
  } catch {
    /* nothing left to try. The events are gone, and that is the cheap loss. */
  }
}

function pageInfo(): PageInfo {
  let q: URLSearchParams | null = null;
  try {
    q = new URLSearchParams(location.search);
  } catch {
    /* exotic embedding */
  }
  return {
    url: location.href,
    referrer: document.referrer || undefined,
    locale: navigator.language,
    utm_source: q?.get("utm_source") || undefined,
    utm_medium: q?.get("utm_medium") || undefined,
    utm_campaign: q?.get("utm_campaign") || undefined,
  };
}

interface Queued {
  q?: IArguments[];
}

export function start(opts: StartOptions): Instance {
  const globalName = opts.global === undefined ? "fr" : opts.global;
  const host = (opts.host || "").replace(/\/$/, "");
  const on = (v: boolean | undefined) => v !== false;

  const autoPage = on(opts.autoPage);
  const autoOutbound = on(opts.autoOutbound);
  const autoVitals = on(opts.autoVitals);
  const autoForms = on(opts.autoForms);
  const trackLeave = on(opts.trackLeave);
  // Opt in, not opt out. The only one of these that works that way.
  const autoErrors = opts.autoErrors === true;
  const flushEvery = opts.flushEvery === undefined ? 30_000 : opts.flushEvery;

  // Flipped by stop(). Checked in one place, `safe()`, so that a listener the
  // browser has already queued, or a PerformanceObserver callback still in
  // flight, cannot record anything after the instance was torn down.
  let stopped = false;

  /**
   * The one boundary between this file and the page it is running in.
   *
   * Everything the browser can call, and everything the customer can call, goes
   * through here. A missed event is a rounding error; an exception escaping
   * into a click handler, a submit handler or a router is a bug report against
   * their product.
   */
  function safe<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void {
    return (...a: A) => {
      if (stopped) return;
      try {
        fn(...a);
      } catch {
        /* never ours to raise */
      }
    };
  }

  // `schedule` is the coalescing window's only clock. Wrapped in `safe()` like
  // every other callback the browser will hand back to us, so a torn-down
  // instance cannot send from a timer that was already queued.
  const env: Env = {
    now: Date.now,
    uuid,
    get,
    set,
    del,
    send,
    pageInfo,
    schedule: (fn, ms) => setTimeout(safe(fn), ms),
  };

  const tag: Tag = createTag(env, {
    sourceKey: opts.sourceKey,
    host,
    mode: opts.mode,
    flushOnSeverity: opts.flushOnSeverity,
  });

  // --- The page clock -----------------------------------------------------
  // Visible time, not wall clock. A tab left open behind twelve others for an
  // hour did not hold anyone's attention for an hour, and an average that says
  // it did is worse than no average.
  let visibleSince = Date.now();
  let visibleMs = 0;
  let depth = 0;

  function elapsed(): number {
    return visibleMs + (document.visibilityState === "hidden" ? 0 : Date.now() - visibleSince);
  }

  function resetPage(): void {
    visibleMs = 0;
    visibleSince = Date.now();
    depth = 0;
  }

  function measure(): void {
    const d = document.documentElement;
    const h = Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0);
    if (h <= 0) return;
    const seen = ((window.pageYOffset || d.scrollTop || 0) + d.clientHeight) / h;
    if (seen * 100 > depth) depth = Math.min(100, seen * 100);
  }

  // --- Core Web Vitals ----------------------------------------------------
  // Observed directly rather than via the `web-vitals` package: that library is
  // most of this file's byte budget on its own, and what it mostly adds beyond
  // the numbers is attribution detail this product has nowhere to put.
  const observers: PerformanceObserver[] = [];
  let lcp = 0;
  let fcp = 0;
  let inp = 0;
  let cls = 0;
  let clsSupported = false;
  // The open five-second CLS window: running total, and its first and last shift.
  let winValue = 0;
  let winFirst = 0;
  let winLast = 0;

  function observe(init: ObserveInit, cb: (entries: PerformanceEntryList) => void): boolean {
    try {
      const wrapped = safe(cb);
      const po = new PerformanceObserver((list) => wrapped(list.getEntries()));
      po.observe(init as PerformanceObserverInit);
      observers.push(po);
      return true;
    } catch {
      // An entry type this browser does not implement. There is nothing to fall
      // back to, so the metric is simply absent -- which is the honest answer.
      return false;
    }
  }

  function startVitals(): void {
    // `buffered: true` picks up entries that happened before this script ran,
    // which for LCP and FCP is most of them.
    observe({ type: "largest-contentful-paint", buffered: true }, (es) => {
      const last = es[es.length - 1];
      if (last) lcp = last.startTime;
    });

    observe({ type: "paint", buffered: true }, (es) => {
      for (let i = 0; i < es.length; i++) {
        if (es[i]!.name === "first-contentful-paint") fcp = es[i]!.startTime;
      }
    });

    clsSupported = observe({ type: "layout-shift", buffered: true }, (es) => {
      for (let i = 0; i < es.length; i++) {
        const e = es[i] as ShiftEntry;
        if (e.hadRecentInput) continue;
        // CLS is the worst five-second window, not the sum. A long page that
        // shifts once per screenful is not worse than a page that shifts once.
        if (winValue && e.startTime - winLast < 1000 && e.startTime - winFirst < 5000) {
          winValue += e.value;
          winLast = e.startTime;
        } else {
          winValue = e.value;
          winFirst = winLast = e.startTime;
        }
        if (winValue > cls) cls = winValue;
      }
    });

    // The worst interaction, which is what INP is for anyone under fifty of
    // them. Above that the official metric drops the top outliers; a marketing
    // site that gets there has bigger questions than this one.
    observe({ type: "event", buffered: true, durationThreshold: 40 }, (es) => {
      for (let i = 0; i < es.length; i++) {
        const e = es[i] as EventEntry;
        if (e.interactionId && e.duration > inp) inp = e.duration;
      }
    });
  }

  function reportVitals(): void {
    if (lcp) tag.vital("LCP", lcp);
    if (fcp) tag.vital("FCP", fcp);
    if (inp) tag.vital("INP", inp);
    // Zero is a real CLS and a good one, so it is only reported when the
    // browser actually gave us the observer to measure it with.
    if (clsSupported) tag.vital("CLS", cls);
    try {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (nav && nav.responseStart > 0) tag.vital("TTFB", nav.responseStart);
    } catch {
      /* no navigation timing */
    }
  }

  // --- Listeners ----------------------------------------------------------
  const route = safe(() => {
    measure();
    if (tag.navigated(elapsed(), depth)) resetPage();
  });

  const onClick = safe((ev: Event) => {
    const t = ev.target as Element | null;
    if (!t || !t.closest) return;

    // `data-fr-event="name"` on any element: one event, on click, and nothing
    // else. The href, the button and the form behave exactly as they would if
    // this file had never loaded, which is the whole point -- a download button
    // is a plain link that happens to be counted.
    const marked = t.closest("[data-fr-event]");
    if (marked) {
      const name = (marked.getAttribute("data-fr-event") || "").trim();
      if (name) tag.event(name);
    }

    if (!autoOutbound) return;
    const a = t.closest("a") as HTMLAnchorElement | null;
    // We never call preventDefault and never wait for the beacon. A link that
    // is slower because it was measured is a link nobody wants measured.
    if (a && a.href) tag.linkClick(a.href, location.href);
  });

  const onSubmit = safe((ev: Event) => {
    const f = ev.target as HTMLFormElement | null;
    if (f) tag.formSubmit(f.id || undefined, f.getAttribute("name") || undefined);
  });

  const onScroll = safe(measure);

  const onHidden = safe(() => {
    if (document.visibilityState !== "hidden") {
      visibleSince = Date.now();
      return;
    }
    // Close the open stretch first: by the time this fires the document already
    // reports itself hidden, so `elapsed()` would stop counting the very
    // seconds we are here to record.
    visibleMs += Date.now() - visibleSince;
    // Hidden is the only moment the vitals are final, and the last moment
    // anything is guaranteed to be sent.
    if (autoVitals) reportVitals();
    if (trackLeave) {
      measure();
      tag.leave(visibleMs, depth);
    }
    tag.flush();
  });

  const onPageHide = safe(() => {
    if (trackLeave) {
      measure();
      tag.leave(elapsed(), depth);
    }
    tag.flush();
  });

  // History patching. `route()` cannot throw, so the caller's return value is
  // always produced and always passed through -- routers do check it, and an
  // exception raised here would look like their navigation failing.
  const h = history;
  const pushState = h.pushState;
  const replaceState = h.replaceState;
  const patchedPush = function (this: History, ...args: unknown[]) {
    const r = pushState.apply(this, args as never);
    route();
    return r;
  } as typeof pushState;
  const patchedReplace = function (this: History, ...args: unknown[]) {
    const r = replaceState.apply(this, args as never);
    route();
    return r;
  } as typeof replaceState;

  /**
   * An uncaught error. Reported, never suppressed.
   *
   * A listener rather than an assignment to `window.onerror`: assigning would
   * overwrite whatever the customer or their framework already installed, and
   * a tag that silently disables somebody's error reporting is worse than a tag
   * that reports nothing. We never call `preventDefault`, so the error still
   * reaches the console and every other listener exactly as it would have.
   *
   * A failed `<img>` or `<script>` also fires `error` on the way up, with no
   * message and no `error`. Those are not exceptions and are skipped: they
   * would otherwise turn one broken tracking pixel into an entry per page view.
   */
  const onError = safe((ev: Event) => {
    const e = ev as ErrorEvent;
    if (!e.message && !e.error) return;
    tag.error(e.error || e.message, {
      // It reached the top of the stack, which is what makes it worth an entry.
      "exception.escaped": true,
      "url.full": location.href,
    });
  });

  const onRejection = safe((ev: Event) => {
    const reason = (ev as PromiseRejectionEvent).reason;
    tag.error(reason, {
      "exception.escaped": true,
      "url.full": location.href,
      // Distinguishable from a throw without a second name to filter on.
      "firstrun.exception.source": "unhandledrejection",
    });
  });

  addEventListener("visibilitychange", onHidden);
  addEventListener("pagehide", onPageHide);
  if (autoErrors) {
    addEventListener("error", onError);
    addEventListener("unhandledrejection", onRejection);
  }
  if (trackLeave) addEventListener("scroll", onScroll, { passive: true, capture: true });
  // Capture phase on the document: a router that stops propagation on the way
  // up has not stopped us yet, and a link removed by the click handler is still
  // in the tree when we look at it. Always attached, because `data-fr-event` is
  // an explicit opt-in and not part of the automatic outbound measurement.
  document.addEventListener("click", onClick, true);
  if (autoForms) document.addEventListener("submit", onSubmit, true);
  if (autoPage) {
    h.pushState = patchedPush;
    h.replaceState = patchedReplace;
    addEventListener("popstate", route);
  }
  if (autoVitals) startVitals();

  // Only in `interval` mode, and an upper bound rather than a heartbeat: it
  // only sends when something is buffered. `immediate` has its own coalescing
  // window and needs no second timer; `manual` is not allowed one. In every
  // mode hide/pagehide remain what actually fires on a short visit.
  const timer =
    opts.mode === "interval" && flushEvery > 0
      ? setInterval(safe(() => tag.flush()), flushEvery)
      : undefined;

  const api = (cmd: string, a?: unknown, b?: unknown) => {
    if (stopped) return undefined;
    try {
      return tag.call(cmd, a, b);
    } catch {
      return undefined;
    }
  };
  const globals = globalThis as Record<string, unknown>;
  let queue: IArguments[] | undefined;
  if (globalName) {
    const existing = globals[globalName] as (Queued & Function) | undefined;
    queue = existing?.q;
    globals[globalName] = api;
  }

  safe(() => tag.page())();

  // Commands the page queued before this file arrived. One bad call in the
  // queue must not cost the rest of the queue.
  if (queue) for (let i = 0; i < queue.length; i++) api.apply(null, queue[i] as never);

  safe(() => tag.flush())();

  return {
    log: safe((entry: Entry) => tag.log(entry)),
    event: safe((name: string, attributes?: Attrs) => tag.event(name, attributes)),
    error: safe((err: unknown, attributes?: Attrs) => tag.error(err, attributes)),
    identify: safe((id?: string | null) => tag.identify(id)),
    consent: safe((granted: boolean) => tag.setConsent(granted)),
    page: safe(() => {
      tag.page();
      resetPage();
    }),
    navigated: route,
    flush: safe(() => tag.flush()),
    stop() {
      if (stopped) return;
      try {
        if (timer !== undefined) clearInterval(timer);
        removeEventListener("visibilitychange", onHidden);
        removeEventListener("pagehide", onPageHide);
        removeEventListener("error", onError);
        removeEventListener("unhandledrejection", onRejection);
        removeEventListener("scroll", onScroll, true);
        removeEventListener("popstate", route);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("submit", onSubmit, true);
        // Only if they are still ours. A router that patched `history` after we
        // did owns it now, and restoring our snapshot over the top would delete
        // their patch and break their navigation.
        if (h.pushState === patchedPush) h.pushState = pushState;
        if (h.replaceState === patchedReplace) h.replaceState = replaceState;
        for (let i = 0; i < observers.length; i++) {
          try {
            observers[i]!.disconnect();
          } catch {
            /* already gone */
          }
        }
        observers.length = 0;
        if (globalName && globals[globalName] === api) delete globals[globalName];
        tag.flush();
      } catch {
        /* teardown is best-effort too */
      }
      stopped = true;
    },
  };
}

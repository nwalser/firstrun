import { start } from "./browser.js";
import type { DeliveryMode } from "./core.js";

/**
 * The `<script>` entry: read the tag's own attributes, then start.
 *
 * Everything configurable is an attribute on the script element, because the
 * person installing this is pasting one line into a template and has nowhere
 * else to put a config object. Every automatic measurement defaults to on and
 * is turned off by writing `false`, so somebody who only wants their own
 * `event()` calls can have exactly that and nothing else.
 *
 * Error capture is the exception: absent means off, and it takes an explicit
 * `true` to switch on. It is a behaviour change for a site already running this
 * tag, and its volume is not something the page controls.
 */

const script = document.currentScript as HTMLScriptElement | null;

function attr(name: string): string | null {
  return script ? script.getAttribute(name) : null;
}

/** Absent means on. Only an explicit `false`, `0` or `off` turns something off. */
function enabled(name: string): boolean {
  const v = attr(name);
  return v !== "false" && v !== "0" && v !== "off";
}

/** Absent means off. Only an explicit `true`, `1` or `on` switches it on. */
function optIn(name: string): boolean {
  const v = attr(name);
  return v === "true" || v === "1" || v === "on";
}


// Wrapped because an uncaught error here is a `window.onerror` on somebody
// else's page, which lands in their error tracking as their bug. A tag that
// cannot start is a tag that measures nothing, and that is the whole cost.
try {
  start({
    sourceKey: attr("data-key") || "",
    // Defaults to wherever this file was served from, which is the point of
    // serving it from a path a customer can put behind their own CNAME.
    host: attr("data-host") || (script ? script.src.replace(/\/[^/]*$/, "") : ""),
    global: attr("data-global") || "fr",
    autoPage: enabled("data-auto-page"),
    autoOutbound: enabled("data-auto-outbound"),
    autoVitals: enabled("data-auto-vitals"),
    autoForms: enabled("data-auto-forms"),
    trackLeave: enabled("data-track-leave"),
    autoErrors: optIn("data-auto-errors"),
    // The delivery policy, on the one line a customer has to configure with.
    // One attribute rather than five, because the defaults are already the
    // right answer for a page: `immediate` and coalesced, ERROR and above sent
    // at once, and a flush on the way out. The schedule is the one a busy site
    // might genuinely want to change, so it is the one that gets an attribute.
    // `flushOnSeverity` is a `start()` option, for somebody who is importing
    // the package and is not paying this file's byte budget for the knob.
    // See docs/delivery-policy.md.
    mode: (attr("data-mode") || undefined) as DeliveryMode | undefined,
  });
} catch {
  /* nothing to report to, and nothing worth reporting */
}

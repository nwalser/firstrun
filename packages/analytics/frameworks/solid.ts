import { onCleanup, onMount } from "solid-js";
import { init, stop, type AnalyticsConfig } from "../src/index.js";

/**
 * `@firstrun/analytics/solid`: mount, and nothing else.
 *
 * Covers SolidStart and plain Solid. There is an irony worth writing down:
 * this is the framework the firstrun dashboard itself is written in, and it was
 * one of the last surfaces to get a wrapper, because the people who would have
 * missed it were the ones already importing the tag by hand.
 *
 * `@solidjs/router` navigates by calling `window.history.pushState` and
 * `window.history.replaceState` and by binding `popstate`, which is exactly the
 * set of three the tag patches, so `autoPage` stays on and there is no
 * `useLocation` or `useBeforeLeave` subscription here. The same reasoning as
 * `frameworks/vue.ts`, checked against a different router rather than assumed
 * from it. The dashboard happens to route with `@tanstack/solid-router`, which
 * reaches history the same way, so the conclusion does not depend on which of
 * the two is in the app.
 *
 * Every measurement lives in `@firstrun/web-tag`. This file is a lifecycle.
 */

export type AnalyticsProps = AnalyticsConfig;

/**
 * Renders nothing. Put it once, in the root layout or `App`.
 *
 * The return type is `null` rather than `JSX.Element` on purpose, the same
 * trick `frameworks/react.ts` uses: this component has nothing to draw, `null`
 * is a valid Solid node, and typing it that way keeps the package's shipped
 * declarations free of Solid's JSX types.
 */
export function Analytics(props: AnalyticsProps): null {
  onMount(() => {
    // Props are getters, so spreading them is a read of every one. This is the
    // place where that is the right thing: `onMount` runs once, outside any
    // tracking scope, and a config whose values change afterwards is a remount
    // question rather than a reactivity one. `init` is idempotent for the same
    // source key and host, so calling it again would be free anyway.
    init({ ...props });
  });
  // This tears down where `frameworks/react.ts` deliberately does not, and the
  // difference is Solid rather than a change of mind. React remounts effects in
  // development and again across a route transition, so a teardown there would
  // restart the session clock and throw away the page's scroll depth for no
  // reason. Solid mounts a component once and cleans up when it is genuinely
  // gone, so `stop()` here removes the listeners, restores `history`, and sends
  // what is buffered instead of losing it.
  onCleanup(() => stop());
  return null;
}

export {
  consent,
  error,
  event,
  flush,
  user,
  device,
  session,
  init,
  log,
  navigated,
  page,
  stop,
} from "../src/index.js";
export type { AnalyticsConfig };

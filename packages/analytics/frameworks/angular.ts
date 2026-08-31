import {
  DestroyRef,
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { init, navigated, type AnalyticsConfig } from "../src/index.js";

/**
 * `@firstrun/analytics/angular`: a provider, wired to the Router's own event.
 *
 * This is the second wrapper that subscribes to a router rather than leaving
 * the tag's `history` patch to do the work, and it is worth stating why,
 * because the easy answer is the wrong one. Angular's `Router` does reach
 * `history.pushState`: `PathLocationStrategy` goes through `PlatformLocation`,
 * which holds `window.history` and calls the method on that object, so a patch
 * installed at any time is still the method it calls. Most navigations would be
 * seen. Two would not, and both are wrong in a way nobody would ever report:
 *
 *  - `skipLocationChange: true` moves the router without touching `history` at
 *    all. A wizard that swaps its step that way is a route change with no
 *    history event behind it, and it would be missed entirely.
 *  - `urlUpdateStrategy: "eager"` writes the URL BEFORE the guards run, so a
 *    navigation that a guard then cancels has already been counted as a view of
 *    a page nobody ever saw.
 *
 * `NavigationEnd` is the event that means this navigation finished, which is
 * the thing a page view is supposed to be counted on. So `autoPage` goes off
 * and this becomes the signal, for the same reason `frameworks/next.ts` takes
 * `usePathname()` over guessing from `history` underneath the App Router.
 *
 * The peer range is Angular 19 and up. `provideEnvironmentInitializer` arrived
 * in 19 and `APP_INITIALIZER` was deprecated in the same release, and there is
 * no single import that spans both sides of that: a missing named export is a
 * build failure rather than an `undefined` something can branch on, so a
 * runtime feature check would not help. Choosing the deprecated token instead
 * would buy versions that are already outside Angular's own support window. On
 * 16 to 18, call `init({ autoPage: false })` and `navigated()` from
 * `@firstrun/analytics` directly: this file is thirty lines and none of them
 * are measurement.
 *
 * There is no injectable service here either, for the reason `useFirstrun` in
 * `frameworks/react.ts` is not a context: there is one tag per page, the
 * commands are module functions over one module singleton, and wrapping them in
 * something to inject would be ceremony with a second lifetime to get wrong.
 */

/**
 * Add to `providers` in `app.config.ts`, beside `provideRouter`:
 *
 * ```ts
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideRouter(routes),
 *     provideFirstrunAnalytics({
 *       sourceKey: "fr_5eed000000000001",
 *       host: "https://t.themia.app",
 *     }),
 *   ],
 * };
 * ```
 */
export function provideFirstrunAnalytics(config: AnalyticsConfig): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    // Unlike `useEffect`, `onMounted` and Solid's `onMount`, an environment
    // initializer runs on the server too, under `@angular/ssr`. `init` already
    // returns where there is no `document`, so this line changes no measurement:
    // it stops each server render from building a router subscription that could
    // never have anything to report.
    if (typeof document === "undefined") return;

    init({ ...config, autoPage: false });

    try {
      // Optional, because an Angular app is allowed to have no router at all,
      // and a missing provider throws out of `inject`. An analytics provider
      // that stops somebody's app from bootstrapping would be the one thing
      // this package promises never to do, so a routerless app simply gets the
      // load page view and every other automatic measurement.
      const router = inject(Router, { optional: true });
      if (!router) return;
      const destroyRef = inject(DestroyRef);
      const sub = router.events.subscribe((e) => {
        // A no-op on the first one: `init` has just viewed this exact path, and
        // `navigated` fires a view only when the path actually moved.
        if (e instanceof NavigationEnd) navigated();
      });
      // The environment injector is per application, and per request under SSR.
      // Unsubscribing on its destruction is what keeps this from being a leak in
      // a test that bootstraps a hundred of them.
      destroyRef.onDestroy(() => sub.unsubscribe());
    } catch {
      // A mocked injector in a unit test, or a bootstrap that provided neither
      // token. The tag is already mounted and everything except the SPA page
      // view is unaffected, and none of that is worth failing a bootstrap over.
    }
  });
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

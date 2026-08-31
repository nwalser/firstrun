import { defineNuxtPlugin } from "#app";
import { init, type AnalyticsConfig } from "../src/index.js";

/**
 * `@firstrun/analytics/nuxt`: a plugin, and nothing else.
 *
 * Nuxt routes with Vue Router, and Vue Router's web history is a thin wrapper
 * over `history.pushState` for a push and `history.replaceState` for a replace,
 * with `popstate` for the back button. Those are the same three things the tag
 * patches when `autoPage` is on, so route changes already arrive without this
 * file subscribing to anything. That is the same conclusion `frameworks/vue.ts`
 * reaches, and it is the same router underneath, so it had better be.
 *
 * Vue Router also calls `replaceState` on first load to attach its own state
 * object, and again for scroll restoration and shallow query updates. None of
 * those is a page view, and none of them becomes one: the tag fires a view only
 * when the path actually moved. So there is no `router.afterEach` here. A
 * wrapper that subscribed as well would report every navigation twice, and the
 * second copy would be the one nobody could find the source of.
 *
 * `defineNuxtPlugin` is imported from `#app` rather than left to Nuxt's
 * auto-imports, because auto-importing is a build-time transform over the
 * customer's own source and does not reach inside `node_modules`.
 */

/**
 * The plugin, with the config baked in. Drop it in `plugins/firstrun.client.ts`:
 *
 * ```ts
 * import { firstrunAnalytics } from "@firstrun/analytics/nuxt";
 *
 * export default firstrunAnalytics({
 *   sourceKey: "fr_5eed000000000001",
 *   host: "https://t.themia.app",
 * });
 * ```
 *
 * The `.client` suffix keeps it out of the server render. It is tidiness rather
 * than a requirement: `init` returns immediately where there is no `document`,
 * so a plugin that runs on both is simply a no-op on one of them.
 *
 * Named rather than a bare default export because a plugin needs its config,
 * and reading it out of `useRuntimeConfig()` would be this package deciding
 * where a customer's settings live.
 */
export function firstrunAnalytics(config: AnalyticsConfig) {
  return defineNuxtPlugin({
    // Named so it is identifiable in Nuxt Devtools' plugin list. No `enforce`:
    // `init` is idempotent, non-blocking and total, so nothing else in the app
    // has an ordering relationship with it.
    name: "firstrun-analytics",
    setup() {
      init(config);
    },
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

/** Declarations for `@firstrun/analytics/nuxt`. */
import type { AnalyticsConfig } from "./index.js";

export type { AnalyticsConfig };

/**
 * Builds the Nuxt plugin, with the config baked in.
 *
 * ```ts
 * // plugins/firstrun.client.ts
 * import { firstrunAnalytics } from "@firstrun/analytics/nuxt";
 * export default firstrunAnalytics({ sourceKey: "fr_…", host: "https://t.example.com" });
 * ```
 *
 * The return is typed loosely on purpose, the same way `vue.d.ts` types its
 * component: describing a Nuxt plugin properly needs Nuxt's own types, and Nuxt
 * is an optional peer dependency here. Nothing is lost by it, because the only
 * thing this value is ever used for is being the default export of a file in
 * `plugins/`.
 */
export declare function firstrunAnalytics(config: AnalyticsConfig): unknown;

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
} from "./index.js";

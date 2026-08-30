/** Declarations for `@firstrun/analytics/vue`. */
import type { AnalyticsConfig } from "./index.js";

export type { AnalyticsConfig };

/**
 * Mounts the tag and renders nothing.
 *
 * Typed loosely on purpose: describing a Vue component properly needs Vue's own
 * types, and Vue is an optional peer dependency here.
 */
export declare const Analytics: unknown;

export {
  consent,
  error,
  event,
  flush,
  identify,
  init,
  log,
  navigated,
  page,
  stop,
} from "./index.js";

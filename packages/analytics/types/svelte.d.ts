/** Declarations for `@firstrun/analytics/svelte`. */
import type { AnalyticsConfig } from "./index.js";

export type { AnalyticsConfig };

export interface FirstrunAction {
  update(config: AnalyticsConfig): void;
  destroy(): void;
}

/** A Svelte action: `<div use:firstrun={{ sourceKey, host }} />`. */
export declare function firstrun(node: Element, config: AnalyticsConfig): FirstrunAction;

/** The same thing for `onMount`. Returns the teardown. */
export declare function initFirstrun(config: AnalyticsConfig): () => void;

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

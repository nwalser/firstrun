import { init, navigated, stop, type AnalyticsConfig } from "../src/index.js";

/**
 * `@firstrun/analytics/svelte`: an action and an init helper.
 *
 * There is no Svelte import here and there does not need to be one: an action
 * is a plain function of a node, and everything else this package does is a
 * module-level call. That also means it works in Svelte 4 and 5 without a
 * version check.
 *
 * SvelteKit's client-side router navigates through `history.pushState`, so the
 * tag's own patch already sees route changes and `autoPage` can stay on.
 * `navigated()` is exported for anyone driving navigation some other way.
 */

export interface FirstrunAction {
  update(config: AnalyticsConfig): void;
  destroy(): void;
}

/**
 * `use:firstrun={{ sourceKey, host }}` on any element in the root layout.
 *
 * Usually `<div use:firstrun={config} />` in `+layout.svelte`; the element is
 * only there to give the action something to hang on.
 */
export function firstrun(_node: Element, config: AnalyticsConfig): FirstrunAction {
  init(config);
  return {
    update: (next: AnalyticsConfig) => init(next),
    destroy: () => stop(),
  };
}

/**
 * The same thing without markup, for `onMount`. Returns the teardown, so
 * `onMount(() => initFirstrun(config))` is the whole integration.
 */
export function initFirstrun(config: AnalyticsConfig): () => void {
  init(config);
  return stop;
}

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
} from "../src/index.js";
export type { AnalyticsConfig };

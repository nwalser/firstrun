/** Declarations for `@firstrun/analytics/angular` (Angular 19+). */
import type { AnalyticsConfig } from "./index.js";

export type { AnalyticsConfig };

/**
 * Structurally what `@angular/core` calls `EnvironmentProviders`.
 *
 * Declared rather than imported, because this file describes an optional peer
 * dependency and importing `@angular/core` here would make every consumer of
 * the core entry point resolve Angular's types. TypeScript is structural, so a
 * value of this type goes into `ApplicationConfig["providers"]` exactly as the
 * real one does. The brand is Angular's and has been unchanged since v14; if it
 * ever moves, this one line is the fix.
 */
export interface EnvironmentProvidersLike {
  ɵbrand: "EnvironmentProviders";
}

/**
 * Mounts the tag at bootstrap and reports routes from the Router's
 * `NavigationEnd`. Goes in `providers`, beside `provideRouter`.
 */
export declare function provideFirstrunAnalytics(
  config: AnalyticsConfig,
): EnvironmentProvidersLike;

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

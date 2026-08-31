/** Declarations for `@firstrun/analytics/solid`. */
import type { AnalyticsConfig } from "./index.js";

export type { AnalyticsConfig };
export type AnalyticsProps = AnalyticsConfig;

/**
 * Mounts the tag and renders nothing.
 *
 * Typed as returning `null` so this file needs no Solid types: `null` is a
 * valid Solid node, so `<Analytics sourceKey="…" host="…" />` type-checks in
 * any Solid project without this package having an opinion about which Solid.
 */
export declare function Analytics(props: AnalyticsProps): null;

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

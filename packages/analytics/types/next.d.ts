/** Declarations for `@firstrun/analytics/next` (App Router). */
import type { AnalyticsConfig } from "./index.js";

export type { AnalyticsConfig };
export type AnalyticsProps = AnalyticsConfig;

/** Mounts the tag, renders nothing, and reports routes from `usePathname()`. */
export declare function Analytics(props: AnalyticsProps): null;

export { useFirstrun, type Firstrun } from "./react.js";
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

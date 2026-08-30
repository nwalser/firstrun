/** Declarations for `@firstrun/analytics/react`. */
import type { AnalyticsConfig, Attrs, Entry } from "./index.js";

export type { AnalyticsConfig, Attrs, Entry };
export type AnalyticsProps = AnalyticsConfig;

/**
 * Mounts the tag and renders nothing.
 *
 * Typed as returning `null` so this file needs no React types: `null` is a
 * valid React node, so `<Analytics sourceKey="…" host="…" />` type-checks in
 * any React project without this package having an opinion about which React.
 */
export declare function Analytics(props: AnalyticsProps): null;

export interface Firstrun {
  event(name: string, attributes?: Attrs): void;
  error(err: unknown, attributes?: Attrs): void;
  log(entry: Entry): void;
  identify(userId?: string | null): void;
  consent(granted: boolean): void;
  page(): void;
  navigated(): void;
  flush(): void;
}

export declare function useFirstrun(): Firstrun;

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

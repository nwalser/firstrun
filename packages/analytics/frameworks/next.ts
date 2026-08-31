"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { init, navigated, type AnalyticsConfig } from "../src/index.js";

/**
 * `@firstrun/analytics/next`: the App Router version.
 *
 * Two differences from the plain React one, both about who reports a route
 * change. `autoPage` is forced off so the tag stops patching `history`, and
 * `usePathname()` becomes the signal instead: the App Router is the thing that
 * knows a navigation finished, and guessing from `history` under it means
 * racing the transition.
 *
 * Only `usePathname`, never `useSearchParams`. Reading the search params opts
 * the whole route out of static rendering and demands a Suspense boundary the
 * customer did not ask for -- and the tag ignores query changes anyway, since a
 * filter keystroke is not a page view.
 *
 * For the Pages Router use `@firstrun/analytics/react`: `next/router` navigates
 * through `history.pushState`, which the tag already watches.
 */

export type AnalyticsProps = AnalyticsConfig;

export function Analytics(props: AnalyticsProps): null {
  const pathname = usePathname();

  useEffect(() => {
    init({ ...props, autoPage: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sourceKey, props.host]);

  useEffect(() => {
    // A no-op on the first run: `init` has just viewed this exact path, and
    // `navigated` only fires when the path actually moved.
    navigated();
  }, [pathname]);

  return null;
}

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
} from "../src/index.js";
export type { AnalyticsConfig };

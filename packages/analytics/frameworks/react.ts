"use client";

import { useEffect } from "react";
import {
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
  type AnalyticsConfig,
} from "../src/index.js";

/**
 * `@firstrun/analytics/react`: mount, and nothing else.
 *
 * Covers plain React, Vite, Remix, and Next.js Pages Router, where client-side
 * routing goes through `history.pushState` and the tag's own patch already sees
 * it. Next.js App Router routes without touching `history` in a way we can
 * observe reliably, which is what `@firstrun/analytics/next` is for.
 *
 * Every measurement lives in `@firstrun/web-tag`. This file is an effect.
 */

export type AnalyticsProps = AnalyticsConfig;

/**
 * Renders nothing. Put it once, high in the tree.
 *
 * The return type is `null` rather than a JSX element on purpose: this
 * component has nothing to draw, and typing it that way keeps the package's
 * declarations free of React's types.
 */
export function Analytics(props: AnalyticsProps): null {
  useEffect(() => {
    init(props);
    // Deliberately not torn down on unmount. An <Analytics /> that unmounts
    // during a route transition and remounts a tick later would restart the
    // session clock and lose the page's scroll depth, and there is nothing to
    // clean up: the listeners belong to the document, which is still there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sourceKey, props.host]);
  return null;
}

export interface Firstrun {
  event: typeof event;
  error: typeof error;
  log: typeof log;
  identify: typeof identify;
  consent: typeof consent;
  page: typeof page;
  navigated: typeof navigated;
  flush: typeof flush;
}

const api: Firstrun = { event, error, log, identify, consent, page, navigated, flush };

/**
 * The commands, as a hook.
 *
 * A stable object of module-level functions rather than context: there is one
 * tag per page, a context provider around it would only be ceremony, and the
 * identity of this object never changing means it is safe in a dependency array.
 */
export function useFirstrun(): Firstrun {
  return api;
}

export { consent, error, event, flush, identify, init, log, navigated, page, stop };
export type { AnalyticsConfig };

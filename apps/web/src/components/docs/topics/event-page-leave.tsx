import LogOut from "lucide-solid/icons/log-out";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/** Transcribed from `leave()` in `packages/web-tag/src/core.ts`. */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "page_leave",
    slug: "event-page-leave",
    summary: "A page was left. Carries visible time and how far down the reader got.",
    order: 30,
    icon: LogOut,
    written: "Browser tag.",
    severity: "9 (INFO)",
    off: 'data-track-leave="false"',
    when: () => (
      <>
        <p>
          Once per page view, at whichever comes first of the tab being hidden, the page unloading,
          and a client-side navigation to a different path.
        </p>
        <p>
          Once, not twice. <code>visibilitychange</code> and <code>pagehide</code> both fire on the
          way out of a visit, and a second entry would double the denominator of every average
          built on this one.
        </p>
        <p>
          A single-page app gets one before each new <code>page_view</code>, so time on page
          describes every route rather than only the last one somebody happened to be standing on.
        </p>
      </>
    ),
    attrs: [
      {
        key: "firstrun.duration_ms",
        type: "number",
        what: "Visible milliseconds. The clock stops while the tab is hidden and starts again when it comes back.",
      },
      {
        key: "firstrun.scroll_pct",
        type: "number",
        what: "0 to 100. The deepest point reached, not where they happened to be at the end.",
      },
    ],
    never: () => (
      <>
        <p>
          <strong>No url.</strong> The entry says how long and how far, not where, so a{" "}
          <code>page_leave</code> cannot be grouped by page on its own. Its <code>session.id</code>{" "}
          is the join back to the <code>page_view</code> that preceded it.
        </p>
        <p>
          The clock is visible time and not wall clock. A tab left open behind twelve others for an
          hour did not hold anyone's attention for an hour, and an average that says it did is
          worse than no average. There is no mouse track, no heatmap and no per-element dwell.
        </p>
      </>
    ),
    questions: [
      {
        question: "Average time on page",
        how: "Name is page_leave . average of firstrun.duration_ms",
      },
      {
        question: "How far people scroll",
        how: "Name is page_leave . average of firstrun.scroll_pct",
      },
      {
        question: "Whether engagement is moving",
        how: "Name is page_leave . average of firstrun.duration_ms . bucket by day",
      },
      {
        question: "The slow tail",
        how: "Name is page_leave . 90th percentile of firstrun.duration_ms",
      },
    ],
    related: [
      { topic: "event-page-view", label: "page_view" },
      { topic: "event-session-start", label: "session_start" },
    ],
  }),
];

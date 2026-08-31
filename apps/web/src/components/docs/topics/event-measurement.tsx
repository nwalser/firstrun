import Ruler from "lucide-solid/icons/ruler";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/**
 * The shape every number in this product takes. No emitter writes it for you,
 * and `web_vital` is the same three attributes under a name of its own.
 */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "measurement",
    slug: "event-measurement",
    summary: "A plain numeric sample. The shape every number here takes.",
    order: 140,
    icon: Ruler,
    written: "Nothing. You write it.",
    severity: "9 (INFO)",
    when: () => (
      <>
        <p>
          Whenever you have a number worth keeping: a queue depth, a resident set size, how long an
          export took, how many rows somebody selected.
        </p>
        <p>
          <strong>A metric is not a different kind of thing here.</strong> There is no metrics
          table, no counter, no gauge and no histogram: a sample is one row with a name, a
          severity and an attribute map, exactly like a page view and exactly like a crash. That is
          the whole reason the query layer needs no special case for numbers, and why{" "}
          <code>web_vital</code> is these same three attributes under a name of its own.
        </p>
        <p>
          Send one sample per row rather than pre-aggregating. The percentile and the average are
          read-time questions, and a client that averaged for you would have thrown away the only
          thing that could answer them differently later.
        </p>
      </>
    ),
    attrs: [
      {
        key: "firstrun.metric",
        type: "string",
        what: "What the sample is called: queue_depth, rss_bytes, export_rows. This is what a breakdown groups on.",
      },
      {
        key: "firstrun.value",
        type: "number",
        what: "The sample itself. A number, so it is averaged without a cast over every row.",
      },
      {
        key: "firstrun.unit",
        type: "string",
        what: "The unit, when it is not obvious from the name: ms, bytes, rows.",
      },
    ],
    never: () => (
      <p>
        Nothing is derived from it. No entry is computed from another entry anywhere in this
        product, so there is no rollup table quietly filling in behind this one and no minute a
        sample is missing from because a job did not run.
      </p>
    ),
    questions: [
      {
        question: "One metric over time",
        how: "Name is measurement . firstrun.metric is queue_depth . average of firstrun.value . bucket by hour",
      },
      {
        question: "The worst case",
        how: "Name is measurement . firstrun.metric is queue_depth . maximum of firstrun.value . bucket by hour",
      },
      {
        question: "The tail rather than the mean",
        how: "Name is measurement . firstrun.metric is export_ms . 95th percentile of firstrun.value",
      },
      {
        question: "Every metric side by side",
        how: "Name is measurement . group by firstrun.metric . average of firstrun.value",
      },
    ],
    related: [
      { topic: "event-web-vital", label: "web_vital" },
      { topic: "event-http-request", label: "http.request" },
      { topic: "querying", label: "Querying" },
    ],
  }),
];

import Gauge from "lucide-solid/icons/gauge";
import { For } from "solid-js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/index.js";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/**
 * Transcribed from `vital()` in `packages/web-tag/src/core.ts` and the observers
 * in `browser.ts`. The thresholds are `WEB_VITAL_THRESHOLDS` in
 * `packages/schema/src/conventions.ts`, which is also what the query layer
 * classifies against, so the two cannot disagree without somebody noticing.
 */
const THRESHOLDS: Array<{ metric: string; measures: string; good: string; poor: string }> = [
  { metric: "LCP", measures: "Largest contentful paint: when the main thing appeared.", good: "2500 ms", poor: "4000 ms" },
  { metric: "INP", measures: "Interaction to next paint: the worst interaction of the visit.", good: "200 ms", poor: "500 ms" },
  { metric: "CLS", measures: "Cumulative layout shift: the worst five-second window of movement.", good: "0.1", poor: "0.25" },
  { metric: "FCP", measures: "First contentful paint: when anything appeared.", good: "1800 ms", poor: "3000 ms" },
  { metric: "TTFB", measures: "Time to first byte, from navigation timing.", good: "800 ms", poor: "1800 ms" },
];

export const topics: DocsTopic[] = [
  eventTopic({
    name: "web_vital",
    slug: "event-web-vital",
    summary: "One Core Web Vital sample. Five metrics, one entry each, once per document.",
    order: 70,
    icon: Gauge,
    written: "Browser tag.",
    severity: "9 (INFO)",
    off: 'data-auto-vitals="false"',
    when: () => (
      <>
        <p>
          The first time the tab is hidden, which is the first moment the numbers are final and the
          last moment anything is guaranteed to be sent.
        </p>
        <p>
          One entry per metric per document, and <strong>not</strong> repeated on client-side
          navigations: the largest contentful paint of a single-page app happened once, and
          re-reporting it on every route would turn one measurement into a pile of copies that drag
          an average around.
        </p>
        <p>
          A metric the browser does not implement is simply absent, which is the honest answer.
          CLS is the exception in the other direction: zero is a real CLS and a good one, so it is
          reported whenever the browser gave us an observer to measure it with, and left out only
          when it did not.
        </p>
      </>
    ),
    attrs: [
      { key: "firstrun.metric", type: "string", what: "LCP, INP, CLS, FCP or TTFB." },
      {
        key: "firstrun.value",
        type: "number",
        what: "The sample, rounded to three decimals: enough for CLS, invisible for the millisecond metrics.",
      },
      { key: "firstrun.unit", type: "string", what: "ms. Absent for CLS, which is unitless." },
    ],
    never: () => (
      <>
        <p>
          <strong>No rating.</strong> Sending good, needs improvement or poor would mean shipping
          Google's table inside a 4KB budget and then storing the answer on every single row. The
          server has the same table and classifies when you read, which is also the only way a
          change to the thresholds ever reaches samples already collected.
        </p>
        <p>
          No attribution either: which element was the largest paint, or which interaction was the
          slowest. That is most of what a vitals library weighs, and this product has nowhere to
          put it.
        </p>
        <p>
          <strong>And no url.</strong> The sample belongs to the document, not to a route, so it
          cannot be grouped by page on its own. Its <code>session.id</code> is the join back to the
          visit that produced it.
        </p>
      </>
    ),
    extra: {
      heading: "The thresholds",
      body: () => (
        <>
          <p>
            Google's numbers, applied at read time. Under the good column is good, over the poor
            column is poor, and in between needs improvement.
          </p>
          <Table reference>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>What it measures</TableHead>
                <TableHead>Good</TableHead>
                <TableHead>Poor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <For each={THRESHOLDS}>
                {(row) => (
                  <TableRow>
                    <TableCell class="whitespace-nowrap font-mono text-xs">{row.metric}</TableCell>
                    <TableCell>{row.measures}</TableCell>
                    <TableCell class="whitespace-nowrap font-mono text-xs">{row.good}</TableCell>
                    <TableCell class="whitespace-nowrap font-mono text-xs">{row.poor}</TableCell>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
        </>
      ),
    },
    questions: [
      {
        question: "LCP at the 75th percentile",
        how: "Name is web_vital . firstrun.metric is LCP . 75th percentile of firstrun.value",
      },
      {
        question: "Every metric at a glance",
        how: "Name is web_vital . group by firstrun.metric . 75th percentile of firstrun.value",
      },
      {
        question: "Worst layout shift seen",
        how: "Name is web_vital . firstrun.metric is CLS . maximum of firstrun.value",
      },
      {
        question: "Whether a release helped",
        how: "Name is web_vital . firstrun.metric is INP . average of firstrun.value . bucket by day",
      },
    ],
    related: [
      { topic: "event-measurement", label: "measurement" },
      { topic: "event-page-view", label: "page_view" },
    ],
  }),
];

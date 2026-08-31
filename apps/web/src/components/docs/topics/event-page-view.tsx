import Eye from "lucide-solid/icons/eye";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/** Transcribed from `page()` in `packages/web-tag/src/core.ts`. */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "page_view",
    slug: "event-page-view",
    summary: "A page or screen was viewed. The tag writes one per navigation.",
    order: 10,
    icon: Eye,
    written: "Browser tag automatically. Every SDK when you call page().",
    severity: "9 (INFO)",
    off: 'data-auto-page="false", which stops the single-page-app half. The first view of a document is always written.',
    when: () => (
      <>
        <p>
          The tag writes one as soon as it has consent, and one on every history change{" "}
          <strong>where the path actually moved</strong>. Frameworks call <code>replaceState</code>{" "}
          constantly for scroll restoration, shallow query updates and prefetch bookkeeping, and
          counting those would be counting nothing.
        </p>
        <p>
          A change of query string or fragment is therefore not a page view. Filtering a list
          twelve times is one page view, which is the number somebody reading a top-pages board
          wants.
        </p>
        <p>
          On a server or in a desktop app there is no navigation to observe, so you call{" "}
          <code>page(path)</code> yourself and <code>url.path</code> is the only attribute filled
          in for you.
        </p>
      </>
    ),
    attrs: [
      {
        key: "url.full",
        type: "string",
        what: "The whole URL, query string and fragment included.",
      },
      {
        key: "url.path",
        type: "string",
        what: "The path alone. What a breakdown by page groups on, because a query string turns one page into a thousand rows.",
      },
      {
        key: "firstrun.referrer",
        type: "string",
        what: "The full referring URL. Absent when the browser sent none.",
      },
      {
        key: "firstrun.referrer.host",
        type: "string",
        what: "The referring host alone. Absent when there was no referrer.",
      },
      {
        key: "firstrun.utm.source",
        type: "string",
        what: "utm_source, read off the landing URL. Absent when the parameter is not there.",
      },
      { key: "firstrun.utm.medium", type: "string", what: "utm_medium, same rule." },
      { key: "firstrun.utm.campaign", type: "string", what: "utm_campaign, same rule." },
    ],
    never: () => (
      <>
        <p>
          No page title, no viewport size, no scroll position, and nothing about what the reader
          then did. How long they stayed is <code>page_leave</code>, and it is a separate entry.
        </p>
        <p>
          <code>firstrun.utm.term</code> and <code>firstrun.utm.content</code> are conventional
          keys the tag does not read. Pass them yourself if your campaigns use them.
        </p>
      </>
    ),
    questions: [
      {
        question: "Which pages are read",
        how: "Name is page_view . group by url.path . count of entries . limit 20",
      },
      {
        question: "Where people arrive from",
        how: "Name is page_view . group by firstrun.referrer.host . count of entries",
      },
      {
        question: "Which campaign brought them",
        how: "Name is page_view . group by firstrun.utm.campaign . count of uniques",
      },
      { question: "Traffic over time", how: "Name is page_view . count of entries . bucket by day" },
      {
        question: "Landing pages only",
        how: "Name is page_view . firstrun.referrer.host is not set . group by url.path",
      },
    ],
    related: [
      { topic: "event-session-start", label: "session_start" },
      { topic: "event-page-leave", label: "page_leave" },
      { topic: "querying", label: "Querying" },
    ],
  }),
];

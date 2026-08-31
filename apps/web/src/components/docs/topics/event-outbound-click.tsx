import ExternalLink from "lucide-solid/icons/external-link";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/** Transcribed from `linkClick()` in `packages/web-tag/src/core.ts`. */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "outbound_click",
    slug: "event-outbound-click",
    summary: "A link to another site was followed. Counted, never intercepted.",
    order: 40,
    icon: ExternalLink,
    written: "Browser tag.",
    severity: "9 (INFO)",
    off: 'data-auto-outbound="false"',
    when: () => (
      <>
        <p>
          On a click anywhere inside an anchor whose host is not this page's, unless the link is a
          file, in which case it is a <code>file_download</code> instead and never both.
        </p>
        <p>
          The listener sits on the document in the capture phase. A router that stops propagation
          on the way up has not stopped us yet, and a link its own handler removes from the page is
          still in the tree when we look at it.
        </p>
        <p>
          <strong>Nothing is intercepted.</strong> We never call <code>preventDefault</code>, never
          rewrite the href and never wait for the beacon, so the link is exactly as fast as it
          would be if the tag had never loaded. A link that is slower because it was measured is a
          link nobody wants measured.
        </p>
      </>
    ),
    attrs: [
      {
        key: "url.full",
        type: "string",
        what: "The destination href, exactly as it was written in the markup.",
      },
      {
        key: "url.domain",
        type: "string",
        what: "The host it points at. What a breakdown by destination groups on.",
      },
    ],
    never: () => (
      <p>
        Not the page the click happened on, not the text of the link, and not where on the page it
        sat. The current URL is read to decide whether the link is off-site and is then thrown
        away. If you need to know which page sends traffic to a partner, write your own event on
        the click and put the page in it.
      </p>
    ),
    questions: [
      {
        question: "Which outbound links get used",
        how: "Name is outbound_click . group by url.full . count of entries . limit 20",
      },
      {
        question: "Which destinations get traffic",
        how: "Name is outbound_click . group by url.domain . count of entries",
      },
      { question: "How many people click out at all", how: "Name is outbound_click . count of uniques" },
    ],
    related: [
      { topic: "event-file-download", label: "file_download" },
      { topic: "event-page-view", label: "page_view" },
    ],
  }),
];

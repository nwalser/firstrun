import ScrollText from "lucide-solid/icons/scroll-text";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/** Transcribed from the level helpers in every SDK. `NAME.LOG` in `conventions.ts`. */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "log",
    slug: "event-log",
    summary: "A free-form line. What the level helpers name an entry.",
    order: 120,
    icon: ScrollText,
    written: "Every SDK, from trace(), debug(), info(), warn(), errorLog() and fatal().",
    severity: "1 to 24, whichever helper you called",
    when: () => (
      <>
        <p>
          Whenever you write a line rather than record an occurrence of something. The sentence
          travels in the <code>body</code> attribute and the level is the severity, not a word
          inside the text.
        </p>
        <p>
          A line still needs a name, because <code>name</code> is the column a board groups on, and
          every client spells that name the same way. It is what keeps lines separable from events
          without either of them needing a type: filter the name out and a board of your own
          events is unaffected by however much your server logs.
        </p>
        <p>
          The browser tag has no level helpers, so it never writes this. Use <code>log()</code>{" "}
          there with a name and a severity of your own.
        </p>
      </>
    ),
    attrs: [
      {
        key: "body",
        type: "string",
        what: "The line itself. OpenTelemetry has body as a top-level field; five columns are promoted here and no more, so it travels as an attribute under the spec's own name.",
      },
    ],
    never: () => (
      <p>
        No logger name, no file, no line number and no thread. Anything of that sort is yours to
        put in the attribute map, where it is filtered and grouped exactly like the keys we
        suggest.
      </p>
    ),
    questions: [
      {
        question: "Warnings and worse, over time",
        how: "Name is log . severity is at least 13 . count of entries . bucket by hour",
      },
      {
        question: "The noisiest builds",
        how: "Name is log . group by service.version . count of entries",
      },
      {
        question: "One phrase, wherever it appears",
        how: "Name is log . body contains timeout . count of entries . bucket by day",
      },
    ],
    related: [
      { topic: "event-exception", label: "exception" },
      { topic: "log-entries", label: "Log event reference" },
    ],
  }),
];

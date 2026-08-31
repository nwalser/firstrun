import OctagonAlert from "lucide-solid/icons/octagon-alert";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/** Transcribed from `error()` in every client, and the handlers in `web-tag/src/browser.ts`. */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "exception",
    slug: "event-exception",
    summary: "Something threw. One name for every exception, with the detail in attributes.",
    order: 110,
    icon: OctagonAlert,
    written: "Every client, on error(). The browser tag can also catch uncaught ones, if you ask.",
    severity: "17 (ERROR)",
    off: 'data-auto-errors is off by default, so the tag catches nothing on its own until you set it to "true". Your own error() calls are unaffected.',
    when: () => (
      <>
        <p>
          Whenever you call <code>error()</code>. It takes anything, because a catch block catches
          anything: an error, a string, a rejected promise carrying a number, an object with a
          message. Whatever it is becomes a message rather than nothing.
        </p>
        <p>
          One name for every exception, with the <code>exception.*</code> attributes saying which.
          Every exception is then one name and one particular exception is a filter on a path,
          rather than a thousand names nobody can enumerate.
        </p>
        <p>
          <strong>It is a log entry like any other.</strong> There is no error table, no error
          pipeline and no separate ingest path. It is an error because of its severity and its
          attributes, and nothing in the backend branches on either.
        </p>
        <p>
          Turned on, the browser tag also catches uncaught errors and unhandled rejections. That is
          the one automatic measurement that is off by default: it is a behaviour change for a site
          already running the tag, and it is the only one whose volume you do not control, because
          a third-party widget throwing on every page load produces entries at a rate nothing on
          the page is choosing.
        </p>
      </>
    ),
    attrs: [
      {
        key: "exception.type",
        type: "string",
        what: "The class of the thrown thing. Error when it did not have one.",
      },
      {
        key: "exception.message",
        type: "string",
        what: "Its message, or the thrown thing itself as a string when it was not an error.",
      },
      {
        key: "exception.stacktrace",
        type: "string",
        what: "The formatted stack, as one string with newlines. Absent when there was none. The Node client appends the cause chain to it.",
      },
      {
        key: "body",
        type: "string",
        what: "The message again as the human-readable line. Node client only.",
      },
      {
        key: "exception.escaped",
        type: "boolean",
        what: "true when it reached the top of the stack. Written by the tag's automatic handler, since escaping is what makes it worth an entry.",
      },
      {
        key: "url.full",
        type: "string",
        what: "Where it happened. Written by the tag's automatic handler only.",
      },
      {
        key: "firstrun.exception.source",
        type: "string",
        what: "unhandledrejection when it was a rejected promise rather than a throw. Absent otherwise, so the two stay one name and one filter.",
      },
    ],
    never: () => (
      <>
        <p>
          No minidump, no symbol upload and no symbolication. A stack arrives as the string your
          runtime produced it as, and nothing here resolves it further.
        </p>
        <p>
          Nothing is suppressed on the way past. The tag listens rather than assigning{" "}
          <code>window.onerror</code>, and never calls <code>preventDefault</code>, so the error
          still reaches the console and every other handler exactly as it would have. A tag that
          silently disabled somebody's error reporting would be worse than a tag that reported
          nothing.
        </p>
        <p>
          A failed image or script tag is skipped. Those fire an error event on the way up with no
          message and no error object, and counting them would turn one broken tracking pixel into
          an entry per page view.
        </p>
      </>
    ),
    questions: [
      {
        question: "What is breaking most",
        how: "Name is exception . group by exception.type . count of entries . limit 20",
      },
      {
        question: "How many people it hits",
        how: "Name is exception . count of uniques . bucket by day",
      },
      {
        question: "Whether a release fixed it",
        how: "Name is exception . group by service.version . count of entries",
      },
      {
        question: "Only the ones that escaped",
        how: "Name is exception . exception.escaped is true . group by url.full",
      },
      {
        question: "Everything at ERROR or worse, whatever it is called",
        how: "Severity is at least 17 . count of entries . bucket by hour",
      },
    ],
    related: [
      { topic: "event-log", label: "log" },
      { topic: "log-entries", label: "Log event reference" },
      { topic: "troubleshooting", label: "Troubleshooting" },
    ],
  }),
];

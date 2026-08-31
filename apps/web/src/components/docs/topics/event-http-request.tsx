import Route from "lucide-solid/icons/route";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/**
 * A convention with no emitter behind it. The name and the `http.*` keys are in
 * every server SDK's vocabulary so that two projects logging a request spell it
 * the same way, and nothing writes one for you.
 */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "http.request",
    slug: "event-http-request",
    summary: "One request served. A name we suggest, written by you.",
    order: 130,
    icon: Route,
    written: "Nothing. You write it.",
    severity: "9 (INFO), or higher when the request failed",
    when: () => (
      <>
        <p>
          When you decide. There is no middleware here and no automatic instrumentation of any
          kind: firstrun never sits in front of a request, and a client that wrapped your handler
          would be exactly the thing rule seven exists to prevent.
        </p>
        <p>
          The name and the keys below are in the vocabulary so that two services logging a request
          spell it the same way and one board reads both. Write it with <code>event()</code> or{" "}
          <code>log()</code> after the response has gone back, so that recording it never delays
          it.
        </p>
      </>
    ),
    attrs: [
      { key: "http.request.method", type: "string", what: "GET, POST, and the rest." },
      {
        key: "http.route",
        type: "string",
        what: "The route template rather than the resolved path. A resolved path groups into one row per user id; a template groups into one row per endpoint.",
      },
      { key: "http.response.status_code", type: "number", what: "The status that went back." },
      { key: "url.path", type: "string", what: "The path that was actually asked for, when you want both." },
      { key: "firstrun.duration_ms", type: "number", what: "How long you took to serve it." },
    ],
    never: () => (
      <p>
        No header, no body, no query string and no client address, unless you put them there
        yourself. Consider carefully before you do: a server client is covered by your own privacy
        policy, and an attribute map is a durable place for something a request only needed for a
        moment.
      </p>
    ),
    questions: [
      {
        question: "Slowest endpoints",
        how: "Name is http.request . group by http.route . 95th percentile of firstrun.duration_ms",
      },
      {
        question: "Error rate by endpoint",
        how: "Name is http.request . http.response.status_code is at least 500 . group by http.route",
      },
      {
        question: "Traffic shape",
        how: "Name is http.request . count of entries . bucket by hour",
      },
      {
        question: "Which methods are used where",
        how: "Name is http.request . group by http.route and http.request.method",
      },
    ],
    related: [
      { topic: "event-log", label: "log" },
      { topic: "event-measurement", label: "measurement" },
      { topic: "install-node", label: "Node.js" },
    ],
  }),
];

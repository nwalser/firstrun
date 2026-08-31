import Play from "lucide-solid/icons/play";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/** Transcribed from `bump()` in `packages/web-tag/src/core.ts` and the SDK start-ups. */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "session_start",
    slug: "event-session-start",
    summary: "The first entry of a visit or a run. What a visits number counts.",
    order: 20,
    icon: Play,
    written:
      "Browser tag automatically. .NET and Tauri at start-up with lifecycle tracking on, and on every session rotation.",
    severity: "9 (INFO)",
    off: "Nothing in the browser: it is part of how a visit is defined. In a desktop app it is part of lifecycle tracking, which is off unless you ask for it.",
    when: () => (
      <>
        <p>
          In the browser, on the first entry after 30 minutes of inactivity, and whenever the
          referring host changes. A referrer pointing at your own site is an internal navigation
          and does not cut a visit: without that rule every full page load would start a new one.
        </p>
        <p>
          Sessions are cut on the client, once, and never re-derived on the server. Only the client
          knows the tab is the same tab. A server sees a run of entries carrying one anonymous id
          and would have to guess the same rule from worse information, on every read, forever.
        </p>
        <p>
          In a desktop app one run is one session. .NET and Tauri announce it at start-up when
          lifecycle tracking is on, and again whenever the session is rotated: a session nothing
          ever announces sits on every later entry and is counted by nothing. The Python client
          does not write it, and the Node and Go clients have no lifecycle at all.
        </p>
      </>
    ),
    attrs: [],
    never: () => (
      <p>
        The new session id is not a payload on this entry. It is on the resource, which puts it on
        this entry and on every other entry of the visit equally, and that is what makes grouping
        by session work at all.
      </p>
    ),
    questions: [
      {
        question: "Visits per day",
        how: "Name is session_start . count of entries . bucket by day",
      },
      {
        question: "How many people visited",
        how: "Name is session_start . count of uniques . bucket by week",
      },
      {
        question: "Runs by build",
        how: "Name is session_start . group by service.version . count of entries",
      },
      {
        question: "Visits on one operating system",
        how: "Name is session_start . os.type is windows . count of entries",
      },
    ],
    related: [
      { topic: "event-page-view", label: "page_view" },
      { topic: "event-app-launch", label: "app_launch" },
      { topic: "identity", label: "Identity" },
    ],
  }),
];

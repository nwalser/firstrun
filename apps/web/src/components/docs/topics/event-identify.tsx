import UserRound from "lucide-solid/icons/user-round";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/** Transcribed from `user()` in every client. The browser tag is the odd one out. */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "identify",
    slug: "event-identify",
    summary: "A client learned which user it belongs to. Written only when you say so.",
    order: 100,
    icon: UserRound,
    written: "Every SDK, on user(). Not the browser tag.",
    severity: "9 (INFO)",
    when: () => (
      <>
        <p>
          When you call <code>user()</code> with an id. The entry exists so the id lands on a row
          immediately instead of waiting for the next thing that happens to be recorded, and from
          then on <code>user.id</code> rides on everything the client sends.
        </p>
        <p>
          Naming a <em>different</em> person also replaces the session id, because a sign-in is a
          boundary and one session spanning two accounts belongs to neither. Naming the same person
          again does nothing at all, so a router may call it on every route change.
        </p>
        <p>
          Calling it with null writes nothing. There is no entry meaning somebody stopped being
          somebody: the client simply goes back to anonymous, keeping any <code>device.id</code>,
          because that belongs to the machine rather than to whoever signed in.
        </p>
        <p>
          <strong>The browser tag does not write this entry.</strong> Its <code>user()</code> sets{" "}
          <code>user.id</code> for the rest of the page and nothing else, and the id is never
          written to storage: it is your data about a signed-in person, and persisting it would put
          a second identifier on a visitor's disk that nobody answered a consent banner about.
        </p>
      </>
    ),
    attrs: [
      {
        key: "user.id",
        type: "string",
        what: "Exactly the string you passed, clamped to the length limit. It rides on this entry and on every later one.",
      },
    ],
    never: () => (
      <>
        <p>
          <strong>Nothing is inferred, derived, looked up or merged.</strong> A user id is only
          ever the string you handed over. There is no probabilistic matching, no IP or
          fingerprint heuristic, and no cross-surface resolution anywhere in this product.
        </p>
        <p>
          Two sources in one project are not linked to each other. The same person on your site and
          in your app is two uniques, and that is the correct answer. If you want them joined, call{" "}
          <code>user()</code> with the same id on both: your data, your decision, not something we
          reconstruct from behaviour.
        </p>
        <p>
          Naming somebody does not rewrite history. Entries already written keep whatever identity
          they had; nothing is back-filled, and nothing records what the id was before.
        </p>
      </>
    ),
    questions: [
      {
        question: "How many people signed in",
        how: "Name is identify . count of uniques . bucket by week",
      },
      { question: "Sign-ins over time", how: "Name is identify . count of entries . bucket by day" },
      {
        question: "Whether one account is active",
        how: "user.id is acct_8812 . count of entries . bucket by day",
      },
    ],
    related: [
      { topic: "identity", label: "Identity" },
      { topic: "event-session-start", label: "session_start" },
      { topic: "privacy", label: "Privacy and consent" },
    ],
  }),
];

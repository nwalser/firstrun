import Rocket from "lucide-solid/icons/rocket";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/** Transcribed from the lifecycle blocks in `clients/dotnet`, `sdk/tauri` and `clients/python`. */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "app_launch",
    slug: "event-app-launch",
    summary: "Any launch of an installed app, including the first one.",
    order: 90,
    icon: Rocket,
    written: ".NET, Tauri and Python, with lifecycle tracking on.",
    severity: "9 (INFO)",
    off: "Lifecycle tracking is off unless you ask for it, so this is written only if you turned it on.",
    when: () => (
      <>
        <p>
          Once per run, at start-up, after <code>app_install</code> on the first run and after{" "}
          <code>session_start</code> on .NET and Tauri.
        </p>
        <p>
          A launch is not a visit and not a person. It is one process starting on one installation,
          which is what makes it worth counting next to installs: the ratio between them is
          retention, and it is a ratio you can read without anybody being identified.
        </p>
        <p>
          The entry is <strong>queued, not sent</strong>. A desktop client writes to a durable
          queue and uploads later, so a launch on a laptop that is offline all week arrives on
          Friday carrying Monday's timestamp, and every board buckets it on Monday. That is the
          single most common cause of a number that looks wrong and is not.
        </p>
      </>
    ),
    attrs: [],
    questions: [
      { question: "Launches per day", how: "Name is app_launch . count of entries . bucket by day" },
      {
        question: "How many installs are still running it",
        how: "Name is app_launch . count of uniques . bucket by week",
      },
      {
        question: "Which build people are on",
        how: "Name is app_launch . group by service.version . count of uniques",
      },
      {
        question: "Whether an old version lingers",
        how: "Name is app_launch . service.version is 1.4.0 . count of uniques . bucket by week",
      },
    ],
    related: [
      { topic: "event-app-install", label: "app_install" },
      { topic: "event-session-start", label: "session_start" },
      { topic: "troubleshooting", label: "Troubleshooting" },
    ],
  }),
];

import PackagePlus from "lucide-solid/icons/package-plus";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/** Transcribed from the lifecycle blocks in `clients/dotnet`, `sdk/tauri` and `clients/python`. */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "app_install",
    slug: "event-app-install",
    summary: "This installation ran for the first time. One per install, ever.",
    order: 80,
    icon: PackagePlus,
    written: ".NET, Tauri and Python, with lifecycle tracking on.",
    severity: "9 (INFO)",
    off: "Lifecycle tracking is off unless you ask for it, so this is written only if you turned it on.",
    when: () => (
      <>
        <p>
          On the run that <strong>created</strong> the anonymous id, which is once per installation
          and never again. It is written before the launch entry of that same run.
        </p>
        <p>
          Off by default, and that is deliberate rather than an oversight. A source has no kind, so
          a client cannot know whether an install and a launch mean anything where it is running:
          in a request handler they mean nothing at all. The application says.
        </p>
        <p>
          It counts an <strong>installation, not a person</strong>. The anonymous id lives in
          machine-local storage, so one human on three machines is three installs, and that is the
          correct answer rather than a bug to fix. On Windows that means{" "}
          <code>%LOCALAPPDATA%</code> and never <code>%APPDATA%</code>, because a roaming profile
          would sync one id between machines and report three installs as one.
        </p>
      </>
    ),
    attrs: [],
    never: () => (
      <>
        <p>
          Nothing about where the installer came from. There is no download token, no landing page,
          no campaign carried across, and no join back to a <code>file_download</code> on your
          marketing site. That join was once the stated product here and was deleted rather than
          deprecated.
        </p>
        <p>
          If you want to know which campaign an install came from, the only honest way is for your
          installer to carry something you chose and for your app to send it as an attribute you
          own.
        </p>
      </>
    ),
    questions: [
      { question: "Installs per day", how: "Name is app_install . count of entries . bucket by day" },
      {
        question: "Installs by operating system",
        how: "Name is app_install . group by os.type . count of entries",
      },
      {
        question: "Installs by build",
        how: "Name is app_install . group by service.version . count of entries",
      },
      {
        question: "Installs on the beta channel",
        how: "Name is app_install . firstrun.channel is beta . count of entries",
      },
    ],
    related: [
      { topic: "event-app-launch", label: "app_launch" },
      { topic: "event-file-download", label: "file_download" },
      { topic: "identity", label: "Identity" },
    ],
  }),
];

import Download from "lucide-solid/icons/download";
import { eventTopic } from "../event-reference.js";
import type { DocsTopic } from "../registry.js";

/** Transcribed from `linkClick()` and `DOWNLOAD_EXTS` in `packages/web-tag/src/core.ts`. */
export const topics: DocsTopic[] = [
  eventTopic({
    name: "file_download",
    slug: "event-file-download",
    summary: "A link to a file was followed. A count, and not a proxy.",
    order: 50,
    icon: Download,
    written: "Browser tag.",
    severity: "9 (INFO)",
    off: 'data-auto-outbound="false", the same switch as outbound_click.',
    when: () => (
      <>
        <p>
          On a click on an anchor whose path ends in one of a fixed list: <code>pdf</code>,{" "}
          <code>zip</code>, <code>dmg</code>, <code>exe</code>, <code>msi</code>, <code>pkg</code>,{" "}
          <code>deb</code>, <code>rpm</code>, <code>appimage</code>, <code>csv</code>,{" "}
          <code>xlsx</code>, <code>doc</code>, <code>docx</code>, <code>mp3</code>,{" "}
          <code>mp4</code>.
        </p>
        <p>
          A fixed list rather than anything with a dot in it, because <code>/v1.4/setup</code> is a
          page and <code>/pricing.html</code> is not a download.
        </p>
        <p>
          A link that is both off-site and a file is a download only. What is interesting is that
          somebody took the file, not that the file happened to live on a CDN.
        </p>
        <p>
          <strong>firstrun is not in the way of the file.</strong> No href is rewritten, no
          redirect is inserted and nothing is proxied. The download starts exactly as it would have
          if the tag had never loaded, and it still works when we are down.
        </p>
      </>
    ),
    attrs: [
      { key: "url.full", type: "string", what: "The href of the file." },
      {
        key: "firstrun.file.ext",
        type: "string",
        what: "The lower-cased extension that made it a file link. What a breakdown by platform usually groups on.",
      },
    ],
    never: () => (
      <>
        <p>
          Whether the download finished, how large the file was, or how long it took. This is a
          click on a link and does not claim to be anything else.
        </p>
        <p>
          <strong>It is not an install.</strong> Nothing here is joined to a later{" "}
          <code>app_install</code>, and no such join exists anywhere in the product: two sources in
          one project are two separate anonymous id spaces, deliberately. If you want installs,
          report <code>app_install</code> from the application itself.
        </p>
      </>
    ),
    questions: [
      {
        question: "What people download",
        how: "Name is file_download . group by url.full . count of entries",
      },
      {
        question: "Which platform they take",
        how: "Name is file_download . group by firstrun.file.ext . count of entries",
      },
      {
        question: "Downloads over time",
        how: "Name is file_download . count of entries . bucket by day",
      },
      {
        question: "Downloads from a campaign",
        how: "Name is file_download . firstrun.utm.source is set . count of entries",
      },
    ],
    related: [
      { topic: "event-app-install", label: "app_install" },
      { topic: "event-outbound-click", label: "outbound_click" },
      { topic: "identity", label: "Identity" },
    ],
  }),
];

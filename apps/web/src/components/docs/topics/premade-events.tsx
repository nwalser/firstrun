import { Link } from "@tanstack/solid-router";
import Zap from "lucide-solid/icons/zap";
import { For } from "solid-js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/index.js";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";

/**
 * The catalogue, and the one place the resource attributes are written down.
 *
 * Each event has its own page (`event-*.tsx`, built by `event-reference.tsx`),
 * because a reader arrives here from a board already knowing which name they
 * are looking up and wants that one name answered in full. This page is the
 * index over those, plus the two things that are true of all of them: what
 * every entry carries underneath, and that none of it is a fixed list.
 *
 * Every event page links back here for the resource table rather than repeating
 * it fourteen times, which is also what stops fourteen copies drifting.
 */

const RESOURCE: Array<{ key: string; from: string; what: string }> = [
  {
    key: "session.id",
    from: "Every client",
    what: "The visit or the run. The tag cuts a new one after 30 minutes idle or a new external referrer; an SDK holds one for the process until you rotate it.",
  },
  {
    key: "user.id",
    from: "Every client, after identify()",
    what: "Only ever the string you passed. Absent until you pass one, and never inferred from anything.",
  },
  {
    key: "browser.language",
    from: "Every client",
    what: "A BCP-47 tag. The tag reads it off the browser; an SDK sends what you configured.",
  },
  {
    key: "service.name",
    from: "SDKs",
    what: "What your software is called. Configured, never guessed.",
  },
  {
    key: "service.version",
    from: "SDKs",
    what: "The build that wrote the entry. What a crash-by-version breakdown groups on.",
  },
  { key: "os.type", from: "SDKs", what: "windows, darwin, linux. Defaults to the platform." },
  { key: "host.arch", from: "SDKs", what: "The machine architecture. Defaults to the platform." },
  { key: "firstrun.channel", from: "SDKs", what: "stable, beta, nightly. Configured." },
  {
    key: "firstrun.test",
    from: "Every client, in test mode",
    what: "The JSON boolean true, and only ever when true. Production omits the key rather than sending false, so a staging build cannot move a number somebody is looking at.",
  },
  {
    key: "firstrun.dropped",
    from: "Every client, when it has dropped",
    what: "Entries the bounded queue discarded, cumulative. Absent while nothing has been lost.",
  },
];

interface CatalogueRow {
  name: string;
  topic: string;
  written: string;
  what: string;
}

const AUTOMATIC: CatalogueRow[] = [
  {
    name: "page_view",
    topic: "event-page-view",
    written: "Browser tag",
    what: "A page or screen was viewed, including single-page-app navigations.",
  },
  {
    name: "session_start",
    topic: "event-session-start",
    written: "Browser tag, .NET, Tauri",
    what: "The first entry of a visit or a run.",
  },
  {
    name: "page_leave",
    topic: "event-page-leave",
    written: "Browser tag",
    what: "A page was left, with visible time and scroll depth.",
  },
  {
    name: "outbound_click",
    topic: "event-outbound-click",
    written: "Browser tag",
    what: "A link to another site was followed.",
  },
  {
    name: "file_download",
    topic: "event-file-download",
    written: "Browser tag",
    what: "A link to a file was followed.",
  },
  {
    name: "form_submit",
    topic: "event-form-submit",
    written: "Browser tag",
    what: "A form was submitted. The form, never its contents.",
  },
  {
    name: "web_vital",
    topic: "event-web-vital",
    written: "Browser tag",
    what: "One Core Web Vital sample, once per metric per document.",
  },
  {
    name: "app_install",
    topic: "event-app-install",
    written: ".NET, Tauri, Python",
    what: "This installation ran for the first time. Lifecycle tracking only.",
  },
  {
    name: "app_launch",
    topic: "event-app-launch",
    written: ".NET, Tauri, Python",
    what: "Any run of an installed app. Lifecycle tracking only.",
  },
];

const ON_YOUR_CALL: CatalogueRow[] = [
  {
    name: "exception",
    topic: "event-exception",
    written: "error()",
    what: "Something threw. The tag can also catch uncaught ones, if you turn it on.",
  },
  {
    name: "log",
    topic: "event-log",
    written: "trace() through fatal()",
    what: "A free-form line, with the level as the severity.",
  },
  {
    name: "identify",
    topic: "event-identify",
    written: "identify()",
    what: "This client now knows its user id. Every SDK, not the browser tag.",
  },
  {
    name: "page_view",
    topic: "event-page-view",
    written: "page()",
    what: "The same name a browser writes automatically, from a server or a desktop app.",
  },
];

const YOURS: CatalogueRow[] = [
  {
    name: "http.request",
    topic: "event-http-request",
    written: "You",
    what: "One request served, with the http.* attributes.",
  },
  {
    name: "measurement",
    topic: "event-measurement",
    written: "You",
    what: "A plain numeric sample. The shape every number here takes.",
  },
];

function Catalogue(props: { rows: CatalogueRow[]; wroteBy: string }) {
  return (
    <Table reference>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>{props.wroteBy}</TableHead>
          <TableHead>What it means</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <For each={props.rows}>
          {(row) => (
            <TableRow>
              <TableCell class="whitespace-nowrap font-mono text-xs">
                <Link to="/docs/$topic" params={{ topic: row.topic }}>
                  {row.name}
                </Link>
              </TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">{row.written}</TableCell>
              <TableCell>{row.what}</TableCell>
            </TableRow>
          )}
        </For>
      </TableBody>
    </Table>
  );
}

export const topics: DocsTopic[] = [
  {
    slug: "premade-events",
    title: "All events",
    summary: "The names our clients write for you, and what every one of them carries.",
    section: "Premade events",
    order: 0,
    icon: Zap,
    render: () => (
      <DocsProse>
        <p>
          These are the names our clients write without being asked. Every one of them is an
          ordinary log entry: <strong>nothing in the backend branches on any name here</strong>,
          and an event you invent yourself is stored, indexed, filtered and grouped identically.
          What a premade event buys you is a spelling two projects agree on, and a starting-point
          board that already knows where to look.
        </p>
        <p>Each has its own page, with every attribute it carries and what it never carries.</p>

        <h2>Written for you</h2>
        <p>
          Measured by the client, with no call of yours involved. Everything the browser tag does
          is behind consent: before consent is granted nothing is stored and nothing is sent,
          unless the tag is in{" "}
          <Link to="/docs/$topic" params={{ topic: "privacy" }}>
            ephemeral mode
          </Link>
          , which keeps nothing on the device and so has no banner to wait for. Lifecycle tracking
          in a desktop app is off until you turn it on, because a source has no kind and a client
          cannot know whether an install means anything where it is running.
        </p>
        <Catalogue rows={AUTOMATIC} wroteBy="Written by" />

        <h2>Written when you call</h2>
        <p>
          The helpers fill in a convention and nothing more. Everything they produce,{" "}
          <code>log()</code> can produce by hand, and an entry that follows no convention at all is
          stored and queried identically.
        </p>
        <Catalogue rows={ON_YOUR_CALL} wroteBy="From" />

        <h2>Suggested, but written by nobody</h2>
        <p>
          Two names with no emitter behind them. They are in the vocabulary so that two projects
          logging the same thing spell it the same way, and the keys are what the pickers offer.
        </p>
        <Catalogue rows={YOURS} wroteBy="Written by" />

        <h2>What rides on every entry</h2>
        <p>
          A client sends a <strong>resource</strong> once per batch: what is true of the client
          rather than of one entry. It is merged underneath each entry's own attributes at the
          edge, so a row ends up self-contained without the session id travelling fifty times over
          the wire. None of the event pages repeats these.
        </p>
        <Table reference>
          <TableHeader>
            <TableRow>
              <TableHead>Attribute</TableHead>
              <TableHead>Sent by</TableHead>
              <TableHead>What it holds</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={RESOURCE}>
              {(row) => (
                <TableRow>
                  <TableCell class="whitespace-nowrap font-mono text-xs">{row.key}</TableCell>
                  <TableCell class="whitespace-nowrap text-muted-foreground">{row.from}</TableCell>
                  <TableCell>{row.what}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>
        <p>
          The server then stamps <code>project_id</code>, <code>firstrun.source.id</code> and{" "}
          <code>ingested_at</code>, and those win outright: a client cannot claim to have arrived
          through a source other than the one whose key it used. The full row shape is in the{" "}
          <Link to="/docs/$topic" params={{ topic: "log-entries" }}>
            log event reference
          </Link>
          .
        </p>

        <h2>One event of your own, with no code</h2>
        <p>
          Any element carrying <code>data-fr-event="name"</code> writes an event of that name when
          it is clicked, with no attributes and no change to what the element already did. A
          download button stays a plain link that happens to be counted, and it keeps working
          whether or not the tag loaded.
        </p>

        <h2>None of this is a fixed list</h2>
        <p>
          An event with a name nobody here has heard of, at a severity we have never used, carrying
          keys we do not suggest, is stored and queried exactly like a page view. Following a
          convention buys a suggestion in a picker and a shared spelling with the next project. It
          buys nothing else, and skipping one costs nothing.
        </p>
      </DocsProse>
    ),
  },
];

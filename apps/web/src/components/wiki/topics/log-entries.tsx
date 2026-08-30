import ListIcon from "lucide-solid/icons/list";
import { For } from "solid-js";
import type { WikiTopic } from "../registry.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/index.js";
import { WikiProse } from "../shell.js";

/**
 * The reference page: what one row is, and the words we suggest putting in it.
 *
 * Tables rather than prose, because every line here is a fact to look up rather
 * than an argument to follow. Transcribed from `packages/schema/src/`:
 * `severity.ts` for the ladder, `conventions.ts` for the names and keys,
 * `attributes.ts` for the bounds. Keep it in step with those files rather than
 * adding vocabulary here.
 */

interface Row {
  key: string;
  what: string;
}

const SHAPE: Row[] = [
  { key: "time", what: "When it happened. Stamped by the client, and what every query buckets on." },
  { key: "name", what: "What happened. Any string up to 128 characters." },
  { key: "severity", what: "1 to 24. A number, not a word. See the ladder below." },
  { key: "distinct_id", what: "The anonymous id that surface generated for itself. Required." },
  { key: "attributes", what: "Everything else, as JSON. Up to 64 keys, 4 levels deep." },
];

const STAMPED: Row[] = [
  { key: "project_id", what: "Resolved from your source key. Never sent, never claimed." },
  { key: "firstrun.source.id", what: "Which source the entry arrived through." },
  { key: "firstrun.source.surface", what: "web, desktop, mobile, server or other, from that source." },
  { key: "ingested_at", what: "Arrival time. Debugging only: nothing sorts or buckets on it." },
];

const SEVERITY: Array<{ band: string; range: string; what: string }> = [
  { band: "TRACE", range: "1 to 4", what: "Step-by-step detail nobody reads until something is wrong." },
  { band: "DEBUG", range: "5 to 8", what: "Developer detail." },
  { band: "INFO", range: "9 to 12", what: "Ordinary things happening. Every event helper lands here." },
  { band: "WARN", range: "13 to 16", what: "Something recovered, or is about to stop recovering." },
  { band: "ERROR", range: "17 to 20", what: "Something threw. The error helper lands here." },
  { band: "FATAL", range: "21 to 24", what: "The process is going down." },
];

const NAMES: Array<{ name: string; from: string }> = [
  { name: "page_view", from: "Browser tag, or you" },
  { name: "session_start", from: "Browser tag" },
  { name: "app_install", from: "Desktop SDK, first run only" },
  { name: "app_launch", from: "Desktop SDK, every run" },
  { name: "identify", from: "Any client, on identify()" },
  { name: "page_leave", from: "Browser tag" },
  { name: "outbound_click", from: "Browser tag" },
  { name: "file_download", from: "Browser tag" },
  { name: "form_submit", from: "Browser tag" },
  { name: "exception", from: "Any client, on error()" },
  { name: "web_vital", from: "Browser tag" },
  { name: "http.request", from: "Server SDKs" },
  { name: "measurement", from: "You, for a numeric sample" },
];

const ATTRIBUTES: Array<{ key: string; what: string }> = [
  { key: "exception.type", what: "The class of the thrown thing." },
  { key: "exception.message", what: "The message on it." },
  { key: "exception.stacktrace", what: "The formatted stack, as one string." },
  { key: "session.id", what: "The visit or the run this belongs to." },
  { key: "user.id", what: "Whatever you passed to identify(). Never anything else." },
  { key: "service.version", what: "The build of your software that wrote this." },
  { key: "os.type", what: "windows, darwin, linux, ios, android." },
  { key: "host.arch", what: "The machine architecture." },
  { key: "url.path", what: "The path alone. What a breakdown by page groups on." },
  { key: "url.full", what: "The whole URL, query string included." },
  { key: "http.route", what: "The route template, not the resolved path." },
  { key: "http.response.status_code", what: "The status that went back." },
  { key: "browser.language", what: "The BCP-47 tag the client reported." },
  { key: "firstrun.referrer.host", what: "The referring host alone." },
  { key: "firstrun.utm.source", what: "Also .medium, .campaign, .term, .content." },
  { key: "firstrun.channel", what: "stable, beta, nightly." },
  { key: "firstrun.duration_ms", what: "How long something took." },
  { key: "firstrun.metric", what: "What a numeric sample is called: LCP, queue_depth." },
  { key: "firstrun.value", what: "The sample itself, as a number." },
  { key: "firstrun.unit", what: "The unit it is in, when that is not obvious." },
];

export const topics: WikiTopic[] = [
  {
    slug: "log-entries",
    title: "Log entry reference",
    summary: "One row shape for errors, events and measurements, and the conventions we suggest.",
    section: "Reference",
    order: 10,
    icon: ListIcon,
    render: () => (
      <WikiProse>
        <p>
          An error, an event and a measurement are the <strong>same row</strong>. They differ in
          the severity they carry and the attributes they fill in, never in where they go.
        </p>

        <h2>What you write</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>What it is</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={SHAPE}>
              {(row) => (
                <TableRow>
                  <TableCell class="whitespace-nowrap font-mono text-xs">{row.key}</TableCell>
                  <TableCell>{row.what}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>
        <p>
          Names follow <code>^[A-Za-z0-9][A-Za-z0-9_.-]&#123;0,127&#125;$</code>. <code>:</code>{" "}
          and <code>&gt;</code> are reserved, because internal query keys are delimited with them.
        </p>

        <h2>What the server adds</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>What it is</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={STAMPED}>
              {(row) => (
                <TableRow>
                  <TableCell class="whitespace-nowrap font-mono text-xs">{row.key}</TableCell>
                  <TableCell>{row.what}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>

        <h2>Severity</h2>
        <p>
          The OpenTelemetry ladder: six bands of four. The band is what you filter on; the four
          steps inside it are there so a logger with nine levels of its own can map onto this one
          without losing the order.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Band</TableHead>
              <TableHead>Numbers</TableHead>
              <TableHead>What it means</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={SEVERITY}>
              {(row) => (
                <TableRow>
                  <TableCell class="whitespace-nowrap font-mono text-xs">{row.band}</TableCell>
                  <TableCell class="font-mono text-xs">{row.range}</TableCell>
                  <TableCell>{row.what}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>

        <h2>Conventional names</h2>
        <p>
          Suggestions, not law. Any other name you send is stored, indexed and queried
          identically, and no entry is ever rejected for the name it carries.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Usually written by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={NAMES}>
              {(row) => (
                <TableRow>
                  <TableCell class="whitespace-nowrap font-mono text-xs">{row.name}</TableCell>
                  <TableCell>{row.from}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>

        <h2>Conventional attributes</h2>
        <p>
          The OpenTelemetry semantic conventions where they exist, and <code>firstrun.*</code>{" "}
          where they do not. These are the keys the pickers offer before your project has written
          anything.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>What it holds</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={ATTRIBUTES}>
              {(row) => (
                <TableRow>
                  <TableCell class="whitespace-nowrap font-mono text-xs">{row.key}</TableCell>
                  <TableCell>{row.what}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>
        <p>
          <strong>Any other key works identically.</strong> Write <code>order.total</code> or{" "}
          <code>tenant</code> or <code>rows_exported</code> and it is stored, filtered, grouped and
          aggregated exactly like the ones above. Following a convention buys you a suggestion in a
          picker and a shared spelling with the next project. It buys nothing else, and skipping
          one costs nothing.
        </p>

        <h2>Limits</h2>
        <ul>
          <li>64 top-level attribute keys, nested 4 levels deep, 128 items per array or object.</li>
          <li>Keys up to 128 characters, string values up to 4096.</li>
          <li>
            Values are JSON: strings, numbers, booleans, null, arrays and objects. A number stays a
            number.
          </li>
        </ul>
      </WikiProse>
    ),
  },
];

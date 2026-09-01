import Terminal from "lucide-solid/icons/terminal";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";
import { Snippet } from "../snippet.js";

/**
 * The wire format, for somebody who is not going to install anything.
 *
 * Every other install page hands over an SDK. This one hands over the endpoint,
 * because the SDKs are a convenience and not the product: a shell script, a
 * Cloudflare Worker, an Arduino, a language we have never written a client for
 * and a customer who simply does not want a dependency all have the same right
 * to report, and until this page existed the only way to find that out was to
 * read `packages/schema/src/log.ts`.
 *
 * It is a REFERENCE page rather than a guide, so it states the whole contract:
 * the two required fields, every optional one, every bound, and what each status
 * code means. A page that showed one curl and stopped would send somebody back
 * to the source the first time they hit a 400.
 *
 * Every number here is transcribed from the code that enforces it --
 * `packages/schema/src/{log,attributes,severity}.ts` and
 * `packages/ingest/src/{config,handlers}.ts` -- and a change to any of them is a
 * change to this page. They are written out rather than interpolated because
 * this file renders in the browser and those modules are the contract, not a
 * runtime the documentation is allowed to depend on.
 */

export const topics: DocsTopic[] = [
  {
    slug: "http-api",
    title: "HTTP API",
    summary: "Post events yourself. One endpoint, one body shape, no SDK.",
    section: "Install guides",
    // Last in the section: somebody who has a client for their language should
    // reach for it, and this is what is left when nobody does.
    order: 90,
    icon: Terminal,
    render: (ctx) => (
      <DocsProse>
        <p>
          The SDKs are a convenience. Anything that can make an HTTPS request can report, and
          the whole interface is one endpoint that takes one body shape.
        </p>

        <h2>Send a batch</h2>

        <Snippet
          title="One event, from a shell"
          lang="bash"
          code={
            `curl -X POST ${ctx.vars.origin}/v1/e \\\n` +
            `  -H 'Content-Type: application/json' \\\n` +
            `  -d '{\n` +
            `    "k": "${ctx.vars.key}",\n` +
            `    "r": { "device.id": "install-a1b2c3", "service.version": "1.4.0" },\n` +
            `    "e": [\n` +
            `      {\n` +
            `        "i": "0f8fad5b-d9cb-469f-a165-70867728950e",\n` +
            `        "t": 1788100000000,\n` +
            `        "n": "export_finished",\n` +
            `        "s": 9,\n` +
            `        "a": { "rows": 4210, "format": "csv" }\n` +
            `      }\n` +
            `    ]\n` +
            `  }'`
          }
          note={
            <>
              No authorization header. The source key in <code>k</code> is the whole of it: it is
              public by necessity, it names a destination and it authorises nothing. Nothing you
              can read is reachable with one.
            </>
          }
        />

        <h2>The body</h2>

        <p>
          Three fields at the top level, two of them required. The keys are one letter because the
          browser tag posts this from <code>sendBeacon</code> on a page that is closing, where
          bytes are the constraint. Everything else sends the same shape, so there is one format
          to implement rather than a compact one and a verbose one.
        </p>

        <ul>
          <li>
            <code>k</code> &mdash; <strong>required.</strong> Your source key,{" "}
            <code>fr_</code> followed by sixteen hex characters.
          </li>
          <li>
            <code>r</code> &mdash; the resource. Attributes true of the whole client rather than of
            one event, such as <code>service.version</code>, <code>os.type</code> and the three
            identity keys. They are merged <em>under</em> each event&rsquo;s own attributes, so an
            event that sets the same key wins.
          </li>
          <li>
            <code>e</code> &mdash; <strong>required.</strong> One to 500 events.
          </li>
        </ul>

        <h2>An event</h2>

        <ul>
          <li>
            <code>i</code> &mdash; <strong>required.</strong> A UUID you generate. It is the
            deduplication key: replaying a queue after a crash sends the same id and stores one
            row, so a client that cannot be sure a batch landed should simply send it again.
          </li>
          <li>
            <code>t</code> &mdash; <strong>required.</strong> Milliseconds since the epoch, stamped
            by <em>you</em>, at the moment the thing happened. Not when you send it. An app that
            was offline on Tuesday and uploads on Friday is counted on Tuesday, and every chart in
            the product buckets on this field.
          </li>
          <li>
            <code>n</code> &mdash; <strong>required.</strong> The name. Any string matching{" "}
            <code>[A-Za-z0-9][A-Za-z0-9_.-]&#123;0,127&#125;</code>. There is no allowlist
            anywhere: <code>exception</code>, <code>page_view</code> and{" "}
            <code>queue_depth_sampled</code> are the same kind of thing and take the same path.
          </li>
          <li>
            <code>s</code> &mdash; the severity, 1 to 24, on OpenTelemetry&rsquo;s ladder. Absent
            means unclassified, which is not the same as INFO.
          </li>
          <li>
            <code>a</code> &mdash; the attributes. A JSON object of anything you want to query by
            later.
          </li>
        </ul>

        <h2>Severity</h2>

        <p>
          Each band owns four numbers, and the first of each is the plain, unqualified one. Send{" "}
          <code>9</code> for an ordinary event and <code>17</code> for something that threw.
        </p>

        <Snippet
          lang="js"
          code={
            `TRACE  1  2  3  4\n` +
            `DEBUG  5  6  7  8\n` +
            `INFO   9 10 11 12\n` +
            `WARN  13 14 15 16\n` +
            `ERROR 17 18 19 20\n` +
            `FATAL 21 22 23 24`
          }
        />

        <h2>Identity</h2>

        <p>
          There is no id field. Identity is three <strong>optional</strong> attributes you put in{" "}
          <code>r</code>: <code>user.id</code>, <code>device.id</code> and <code>session.id</code>.
          A batch that carries none of them is accepted like any other, and its events count as
          events and in no unique.
        </p>

        <p>
          Send <code>device.id</code> only where there honestly is a machine, and persist it to{" "}
          <strong>machine-local</strong> storage when you do: on Windows that means{" "}
          <code>%LOCALAPPDATA%</code> and never <code>%APPDATA%</code>, because a roaming profile
          syncs between machines and one person on three of them would report as one install
          instead of three.
        </p>

        <p>
          Every id is scoped to this one source and nothing here is ever joined to an id from
          another source. To count one person once across two of them, send <code>user.id</code>{" "}
          with the same value on both.
        </p>

        <h2>What comes back</h2>

        <Snippet lang="json" code={`{ "accepted": 1, "duplicates": 0, "dropped": 0 }`} />

        <ul>
          <li>
            <code>202</code> &mdash; stored. <code>duplicates</code> counts events whose{" "}
            <code>i</code> had already arrived, and <code>dropped</code> counts ones rejected for
            their shape while the rest of the batch went through.
          </li>
          <li>
            <code>400</code> &mdash; the body is not JSON, or not a batch this endpoint can read.
          </li>
          <li>
            <code>404</code> &mdash; the source key does not resolve. A typo and a deleted source
            look the same from here, on purpose.
          </li>
          <li>
            <code>413</code> &mdash; the body is over 1&nbsp;MB.
          </li>
        </ul>

        <h2>Limits</h2>

        <ul>
          <li>500 events per batch, 1&nbsp;MB per body.</li>
          <li>
            64 attributes per map, nested at most 4 deep, keys up to 128 characters, strings up to
            4096, arrays up to 128 items.
          </li>
          <li>
            Each identity attribute is up to 512 characters, and so is any id-shaped attribute.
          </li>
        </ul>

        <p>
          An event that breaks one of these is dropped and counted in <code>dropped</code>; the
          rest of the batch is stored. A batch that breaks one is refused whole.
        </p>

        <h2>Write it like a client would</h2>

        <p>
          Nothing above requires the discipline the SDKs have, and everything you build on it
          should still have it. Queue and batch rather than posting per event, bound the queue and
          drop the oldest when it is full, never block a path a human is waiting on, and never let
          a failure here reach the program you are instrumenting. Losing telemetry is always the
          right trade against affecting your own software.
        </p>
      </DocsProse>
    ),
  },
];

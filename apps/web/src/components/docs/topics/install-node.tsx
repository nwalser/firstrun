import Braces from "lucide-solid/icons/braces";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";
import { Callout, Snippet } from "../snippet.js";

/**
 * Node: the server-side JavaScript client, not the browser tag.
 *
 * Transcribed from `clients/node/README.md` and `src/`. A reader who lands here
 * from a framework page needs to know within a sentence that this is the other
 * package, so the first line says server.
 */

export const topics: DocsTopic[] = [
  {
    slug: "install-node",
    title: "Node.js",
    summary: "Server-side JavaScript and TypeScript for Node 18+, ESM and CommonJS.",
    section: "Install guides",
    order: 70,
    icon: Braces,
    render: (ctx) => (
      <DocsProse>
        <p>
          For a backend, not a browser. Every call puts an event on a bounded queue and returns:
          nothing throws into your code, nothing is awaited on the hot path, and if firstrun is
          unreachable your program keeps working. No runtime dependencies.
        </p>

        <h2>Install the package</h2>
        <Snippet lang="bash" code="npm install @firstrun/node" />

        <h2>Create the client</h2>
        <Snippet
          lang="ts"
          code={
            `import { Firstrun } from "@firstrun/node";\n\n` +
            `const firstrun = new Firstrun({\n` +
            `  sourceKey: process.env.FIRSTRUN_SOURCE_KEY!,   // fr_9f3a2b1c4d5e6f70\n` +
            `  host: "${ctx.vars.origin}",\n` +
            `  serviceVersion: process.env.GIT_SHA,\n` +
            `  onDiagnostic: (d) => log.warn({ firstrun: d }),\n` +
            `});`
          }
          note={
            <>
              A bad key or host <strong>disables the client and reports it</strong> rather than
              throwing, because a typo in an environment variable must not stop your service
              booting. <code>onDiagnostic</code> is the only reporting channel: nothing is ever
              written to stdout or stderr.
            </>
          }
        />

        <h2>Write events</h2>
        <Snippet
          lang="ts"
          code={
            `firstrun.event("exported_csv", { rows: rows.length }, { distinctId: req.user.id });\n\n` +
            `firstrun.error(err, { "http.route": "/reports/:id" }, { distinctId: req.user.id });\n\n` +
            `firstrun.log({\n` +
            `  name: "queue_depth",\n` +
            `  severity: 9,\n` +
            `  distinctId: "worker-3",\n` +
            `  attributes: { "firstrun.metric": "queue_depth", "firstrun.value": depth },\n` +
            `});\n\n` +
            `await firstrun.close(2000);   // on exit. Bounded, never rejects`
          }
          note={
            <>
              Not awaited, and there is nothing here to await. <code>event</code> writes at INFO
              and <code>error</code> at ERROR, both filling in the conventional attributes;{" "}
              <code>log</code> takes any name, any severity and any attributes. Values are JSON, so
              a number stays a number. A long-running service needs no <code>close()</code>:{" "}
              <code>beforeExit</code>, <code>SIGTERM</code> and <code>SIGINT</code> already flush
              with a budget. A CLI or a one-shot job should call it.
            </>
          }
        />

        <Callout title="distinctId is yours to supply">
          A browser has a visitor id and a desktop install has one on disk. A server has neither,
          so pass an id you already have per call. An event without one is{" "}
          <strong>dropped and reported</strong> rather than sent under an invented id: a loud
          failure beats a silently wrong number nobody can spot from a dashboard. Set the
          client-level <code>distinctId</code> only when the process really is the subject, such
          as a CLI or a device agent.
        </Callout>
      </DocsProse>
    ),
  },
];

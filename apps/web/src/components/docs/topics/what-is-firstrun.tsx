import Route from "lucide-solid/icons/route";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";

/**
 * The page a signed-out evaluator lands on first.
 *
 * Deliberately the shortest page in the documentation. Somebody deciding in ninety
 * seconds wants three facts: what it replaces, what it costs them, and what it
 * refuses to do. Anything longer is a page they scroll past on the way to an
 * install guide, so the detail lives on the pages that are read on purpose.
 */

export const topics: DocsTopic[] = [
  {
    slug: "what-is-firstrun",
    title: "What firstrun is",
    summary: "One structured log for everything you ship, on your own Postgres.",
    section: "Getting started",
    order: 0,
    icon: Route,
    render: (ctx) => (
      <DocsProse>
        <p>
          firstrun is <strong>one structured log for everything you ship</strong>, running on your
          own Postgres. The marketing site, the desktop app, the mobile app and the backend all
          write to <code>{ctx.vars.origin}</code>, into one table, under one project.
        </p>

        <h2>Errors, events and measurements are one thing</h2>
        <p>
          A crash, a page view and a latency sample are the <strong>same row</strong>: a time, a
          name, a severity, and an attribute map. Nothing is special-cased by name or by severity
          anywhere in the backend, and there is no separate error product to buy or wire up.
        </p>

        <h2>You choose the vocabulary</h2>
        <p>
          The names and attribute keys we suggest follow the OpenTelemetry conventions, and
          nothing enforces them. Write <code>order.total</code> and it is stored, filtered,
          grouped and aggregated exactly like <code>os.type</code>. An event is never rejected for
          not looking like ours.
        </p>

        <h2>Ask your own questions</h2>
        <p>
          A card is a saved query: a filter, a group by, an aggregate, a time bucket and a limit,
          over any attribute anything has ever written. Attributes are discovered rather than
          declared, so a key starts working the day you ship the build that sends it.
        </p>

        <h2>An SDK for everything you ship</h2>
        <p>
          A 4KB browser tag with framework wrappers, plus .NET, Node, Python, Go and a Rust crate
          for Tauri. The same calls everywhere: <code>init</code>, <code>event</code>,{" "}
          <code>error</code>, <code>log</code>, <code>identify</code>, <code>flush</code>. Read one
          and you have read all of them.
        </p>

        <h2>Never in your critical path</h2>
        <p>
          firstrun does not proxy, redirect or sit in front of anything. Every client is
          fire-and-forget and bounded: it is allowed to lose events, and it is not allowed to
          throw, block, retry unboundedly or grow without limit. If firstrun is completely down,
          every feature of your software still works and nobody notices.
        </p>

        <h2>What it is not</h2>
        <p>
          Session replay, feature flags, experiments, minidumps and symbol upload, alerting and
          on-call, and billing. It is a place to write what your software did and a way to ask
          about it afterwards.
        </p>
      </DocsProse>
    ),
  },
];

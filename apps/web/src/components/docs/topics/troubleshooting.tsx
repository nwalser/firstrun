import { Link } from "@tanstack/solid-router";
import LifeBuoy from "lucide-solid/icons/life-buoy";
import { Show } from "solid-js";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";

/**
 * One page for every surface, because the three ways a number goes wrong are
 * the same everywhere: nothing arrives, it arrives late, or it is counted in a
 * scope the reader did not expect.
 *
 * Bullets rather than a procedure. A reader here is annoyed and matching a
 * symptom, not following steps.
 */

export const topics: DocsTopic[] = [
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    summary: "Nothing arriving, events arriving late, and uniques that look wrong.",
    section: "Install guides",
    order: 90,
    icon: LifeBuoy,
    render: (ctx) => (
      <DocsProse>
        <Show when={ctx.source}>
          {(source) => (
            <p>
              Start with{" "}
              <Link
                to="/w/$wslug/$pslug/sources"
                params={{ wslug: source().workspaceSlug, pslug: source().projectSlug }}
              >
                the row for {source().name} on the Sources page
              </Link>
              . It says either "never seen" or when it last reported in, which splits the list
              below in half.
            </p>
          )}
        </Show>

        <h2>Nothing is arriving</h2>
        <ul>
          <li>
            <strong>Consent.</strong> On a website nothing is stored and nothing is sent until{" "}
            <code>consent(true)</code>. No error appears anywhere: the page works and the
            dashboard stays empty.
          </li>
          <li>
            <strong>The key.</strong> A key that does not resolve to a source is dropped at
            ingest. Check for a placeholder that was pasted and never replaced.
          </li>
          <li>
            <strong>The host.</strong> Requests go to <code>POST /v1/e</code> at the ingest
            origin. A wrong host, a CNAME that is not pointed yet, or a CORS failure all look
            identical from the dashboard.
          </li>
          <li>
            <strong>A blocker.</strong> Content blockers stop the browser tag on the reader's own
            machine. Desktop, mobile and server clients are unaffected, so a website with nothing
            and an app with events is usually this.
          </li>
        </ul>

        <h2>Events arrive late</h2>
        <ul>
          <li>
            <code>time</code> is stamped by the client and is what every chart buckets on. An
            event that reaches us on Friday and happened on Tuesday is counted on Tuesday.
          </li>
          <li>
            App and desktop clients queue to disk. A laptop that was offline, or a process the OS
            killed, sends on the next launch, which can be days later. This is designed for and
            is not a fault.
          </li>
          <li>
            So yesterday's number can rise tomorrow. A window that ends in the last day or two is
            still filling in.
          </li>
        </ul>

        <h2>A card is empty</h2>
        <ul>
          <li>
            <strong>An attribute nobody writes.</strong> Grouping or filtering on a key no event
            carries is not an error: it matches nothing and the card is blank. The pickers only
            offer keys seen in the window you are looking at, so widen the range before assuming
            the key is wrong.
          </li>
          <li>
            <strong>A severity filter.</strong> &ldquo;Errors and worse&rdquo; means 17 and above.
            An event your logger calls <code>warning</code> is 13 and is outside it.
          </li>
          <li>
            <strong>The range.</strong> Every query is bounded by the board&rsquo;s window. A
            weekly job shows nothing in a window of a day.
          </li>
        </ul>

        <h2>Uniques look wrong</h2>
        <ul>
          <li>
            A unique is one anonymous id within <strong>one surface</strong>. The same person on
            your site and in your app is two uniques, and that is the correct answer.
          </li>
          <li>
            Surfaces are never linked to each other and never merged. Nothing is inferred from an
            address, a device or a coincidence in timing.
          </li>
          <li>
            To count one person once across surfaces, call <code>identify()</code> with the same
            id on each. That is the only thing that joins them.
          </li>
          <li>
            Never add uniques from two surfaces together. Adding two counts of distinct ids gives
            a number that is larger than the truth by however many people used both.
          </li>
        </ul>
      </DocsProse>
    ),
  },
];

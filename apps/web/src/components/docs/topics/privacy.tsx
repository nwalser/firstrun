import { Link } from "@tanstack/solid-router";
import ShieldCheck from "lucide-solid/icons/shield-check";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";
import { Callout, Snippet } from "../snippet.js";

/**
 * Written so a customer can link their own privacy page straight at it.
 *
 * That means describing behaviour rather than intent: every sentence here is a
 * statement about what the shipped code does, and the three lines at the end
 * are meant to be copied into a notice as they stand.
 */

export const topics: DocsTopic[] = [
  {
    slug: "privacy",
    title: "Privacy and consent",
    summary: "What is collected, what happens before consent, and where the data lives.",
    section: "Reference",
    order: 20,
    icon: ShieldCheck,
    render: (ctx) => (
      <DocsProse>
        <h2>Self-hosted</h2>
        <p>
          firstrun runs on the operator&rsquo;s own infrastructure and stores everything in their
          own Postgres. Events go to <code>{ctx.vars.origin}</code> and nowhere else. There is no
          vendor account, no third party in the path, and no data shared between operators.
        </p>

        <h2>The browser tag is consent-gated</h2>
        <p>
          Before consent the tag writes <strong>nothing</strong> to the browser and sends{" "}
          {/* A row in the browser's own storage, not one of ours. */}
          <strong>nothing</strong> to a server: no cookie, no storage entry, no visitor id. What
          it observes is held in memory, so a visit that begins on your banner is still counted as
          one visit if the answer is yes. Withdrawing consent deletes the id, the session state
          and anything still held.
        </p>
        <Snippet
          lang="js"
          code={'fr("consent", true);   // yes\nfr("consent", false);  // no, or withdrawn later'}
          note="Call it from whatever consent banner you already run. The tag does not ship one."
        />
        <p>
          Desktop, mobile and server clients are not gated, because there is no third party on the
          other end to ask: they are your own software reporting on itself, covered by your own
          privacy notice.
        </p>

        <h2>What is collected</h2>
        <ul>
          <li>
            <strong>From the browser, after consent:</strong> pages viewed, referrer, UTM
            parameters, session boundaries, time and scroll depth on a page, outbound and file
            link clicks, form submissions, Core Web Vitals, and a random visitor id stored in that
            browser.
          </li>
          <li>
            <strong>From an app or a server:</strong> the events that software writes, plus
            app version, release channel, operating system, architecture, locale, and a random id
            generated on that machine or supplied per request.
          </li>
          <li>
            <strong>From you:</strong> whatever you choose to put in a name, an attribute, or an{" "}
            <code>identify()</code> call. An error event carries the exception type, message and
            stack you hand it.
          </li>
        </ul>

        <h2>What is not collected</h2>
        <ul>
          <li>No session replay, no keystrokes, no screenshots, no form field contents.</li>
          <li>
            No browser fingerprinting and no hardware fingerprinting. Every id is a random value
            the person&rsquo;s own device stores and can delete.
          </li>
          <li>
            No stored IP address, no geolocation lookup, no advertising identifiers, no
            third-party pixels, no cross-site tracking.
          </li>
          <li>
            No linking of one surface to another, and no identity shared between projects. See{" "}
            <Link to="/docs/$topic" params={{ topic: "identity" }}>
              Identity
            </Link>
            .
          </li>
        </ul>

        <h2>What you can tell your users</h2>
        <p>Three sentences that are true and that most privacy notices can absorb as they are:</p>
        <ul>
          <li>Analytics on this site store nothing and send nothing until you accept them.</li>
          <li>
            If you accept, we record which pages you view, under a random id kept in your browser.
          </li>
          <li>
            Your IP address is not stored, and the data is held on our own servers rather than
            sent to an analytics company.
          </li>
        </ul>

        <Callout title="Behaviour, not legal advice">
          This page describes what the software does. Whether that needs consent where you
          operate, and what your notice has to say, is a question for somebody qualified to answer
          it.
        </Callout>
      </DocsProse>
    ),
  },
];

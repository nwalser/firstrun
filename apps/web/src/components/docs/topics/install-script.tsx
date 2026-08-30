import CodeXml from "lucide-solid/icons/code-xml";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";
import { Snippet } from "../snippet.js";

/**
 * The tag, with no build step.
 *
 * One page per framework rather than one page with tabs: a reader arrives
 * already knowing which stack they are on, and the tabs only ever showed them
 * five things they were not going to read. Everything that is not the install,
 * the init and the write call belongs on a concept page.
 *
 * Every attribute here is transcribed from `packages/web-tag/src/tag.ts`.
 */

export const topics: DocsTopic[] = [
  {
    slug: "install-script",
    title: "Script tag",
    summary: "Two lines in the head. No build step and no package.",
    section: "Install guides",
    order: 10,
    icon: CodeXml,
    render: (ctx) => (
      <DocsProse>
        <h2>Add the tag</h2>
        <Snippet
          filename="every page, in the head"
          lang="html"
          code={
            `<script>window.fr=window.fr||function(){(fr.q=fr.q||[]).push(arguments)}</script>\n` +
            `<script async\n` +
            `        src="${ctx.vars.origin}/t.js"\n` +
            `        data-key="${ctx.vars.key}"></script>`
          }
          note={
            <>
              The first line queues calls made before the tag has loaded. The tag posts to wherever
              it was served from, so a first-party CNAME is one setting rather than two:{" "}
              <code>data-host</code> overrides it.
            </>
          }
        />

        <h2>Ask for consent</h2>
        <p>Nothing is stored and nothing is sent until consent is granted.</p>

        <Snippet lang="js" code={`fr("consent", true);\nfr("consent", false);  // withdraw`} />

        <h2>Send your own events</h2>
        <p>Then write events.</p>

        <Snippet
          lang="js"
          code={
            `fr("event", "download_clicked", { platform: "windows" });\n` +
            `fr("error", err);\n` +
            `fr("log", { name: "checkout_stalled", severity: 13, attributes: { step: 3 } });\n` +
            `fr("identify", "u_42");`
          }
          note={
            <>
              <code>event</code> writes at INFO and <code>error</code> at ERROR, both filling in
              the conventional attributes. <code>log</code> takes any event you like: any name, any
              severity, any attributes, and your own <code>time</code> if you are recording
              something after the fact. Attribute values are JSON, so a number stays a number. Any
              element carrying <code>data-fr-event="name"</code> fires that event when clicked, and
              keeps its own behaviour whether or not the tag loaded.
            </>
          }
        />

        <p>
          With consent granted the tag also writes <code>page_view</code> (SPA navigations
          included), <code>session_start</code>, <code>page_leave</code>,{" "}
          <code>outbound_click</code>, <code>file_download</code>, <code>form_submit</code> and{" "}
          <code>web_vital</code> on its own. Each group is off when its attribute is{" "}
          <code>false</code>: <code>data-auto-page</code>, <code>data-auto-outbound</code>,{" "}
          <code>data-auto-vitals</code>, <code>data-auto-forms</code>,{" "}
          <code>data-track-leave</code>.
        </p>
      </DocsProse>
    ),
  },
];

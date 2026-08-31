import Rocket from "lucide-solid/icons/rocket";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";
import { Snippet } from "../snippet.js";

/**
 * Astro: the component that renders a script rather than an island.
 *
 * `frameworks/astro/Analytics.astro` emits the tag inline, so an Astro site
 * that ships no client JavaScript still ships none of ours beyond the tag.
 */

export const topics: DocsTopic[] = [
  {
    slug: "install-astro",
    title: "Astro",
    summary: "A component in the head that emits the script, not an island.",
    section: "Install guides",
    order: 50,
    icon: Rocket,
    render: (ctx) => (
      <DocsProse>
        <h2>Install the package</h2>
        <Snippet lang="bash" code="npm i @firstrun/analytics" />

        <h2>Add the component</h2>
        <Snippet
          filename="src/layouts/Layout.astro"
          lang="astro"
          code={
            `---\n` +
            `import Analytics from "@firstrun/analytics/astro";\n` +
            `---\n\n` +
            `<html lang="en">\n` +
            `  <head>\n` +
            `    <Analytics sourceKey="${ctx.vars.key}" host="${ctx.vars.origin}" />\n` +
            `  </head>\n` +
            `  <body><slot /></body>\n` +
            `</html>`
          }
          note={
            <>
              A <strong>default</strong> import: the component has no named export. It emits the
              script tag rather than importing a module, so a site that ships no client JavaScript
              still ships none of ours beyond the tag itself.
            </>
          }
        />

        <h2>Without a consent banner</h2>
        <Snippet
          filename="src/layouts/Layout.astro"
          lang="astro"
          code={`<Analytics sourceKey="${ctx.vars.key}" host="${ctx.vars.origin}" ephemeral />`}
          note={
            <>
              <code>ephemeral</code> puts the visitor id in <code>sessionStorage</code>, so it is
              gone when the tab closes and there is nothing persistent to ask about. The tag sends
              from the first entry with no <code>consent</code> call. The cost is the returning
              visitor: a unique becomes one tab rather than one browser. Counts of entries are
              unaffected.
            </>
          }
        />

        <h2>Send your own events</h2>
        <p>
          Without <code>ephemeral</code>, nothing is stored and nothing is sent until consent is
          granted.
        </p>

        <Snippet
          lang="js"
          code={
            `fr("consent", true);\n` +
            `fr("event", "download_clicked", { platform: "windows" });\n` +
            `fr("error", err);\n` +
            `fr("log", { name: "checkout_stalled", severity: 13, attributes: { step: 3 } });\n` +
            `fr("identify", "u_42");`
          }
          note={
            <>
              The Astro component installs the <code>fr()</code> command queue, so these are
              called through it from any inline script. <code>event</code> writes at INFO and{" "}
              <code>error</code> at ERROR; <code>log</code> takes any event you like. Any element
              carrying <code>data-fr-event="name"</code> fires that event when it is clicked.
            </>
          }
        />

        <p>
          Once it is sending, the tag also writes <code>page_view</code> (view transitions
          included), <code>session_start</code>, <code>page_leave</code>,{" "}
          <code>outbound_click</code>, <code>file_download</code>, <code>form_submit</code> and{" "}
          <code>web_vital</code>. The props <code>autoPage</code>, <code>autoOutbound</code>,{" "}
          <code>autoVitals</code>, <code>autoForms</code> and <code>trackLeave</code> each turn one
          group off.
        </p>
      </DocsProse>
    ),
  },
];

import Atom from "lucide-solid/icons/atom";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";
import { Snippet } from "../snippet.js";

/**
 * React, Vite and Remix: the same page, because they are the same integration.
 *
 * All three route through `history.pushState`, which the tag patches itself, so
 * the wrapper's whole job is to call `init` once from an effect. Next.js App
 * Router is the one that needs its own page, and has one.
 *
 * Transcribed from `packages/analytics/frameworks/react.ts`.
 */

export const topics: DocsTopic[] = [
  {
    slug: "install-react",
    title: "React",
    summary: "React, Vite and Remix. One component, mounted once.",
    section: "Install guides",
    order: 20,
    icon: Atom,
    render: (ctx) => (
      <DocsProse>
        <h2>Install the package</h2>
        <Snippet lang="bash" code="npm i @firstrun/analytics" />

        <h2>Add the component</h2>
        <Snippet
          filename="src/main.tsx"
          lang="tsx"
          code={
            `import { Analytics } from "@firstrun/analytics/react";\n\n` +
            `createRoot(document.getElementById("root")!).render(\n` +
            `  <>\n` +
            `    <App />\n` +
            `    <Analytics sourceKey="${ctx.vars.key}" host="${ctx.vars.origin}" />\n` +
            `  </>\n` +
            `);`
          }
          note={
            <>
              Once, above your routes. It is <code>sourceKey</code> and not <code>key</code>{" "}
              because React consumes a prop called <code>key</code> before the component ever sees
              it. Vite, Remix and the Next.js Pages Router are all this import.
            </>
          }
        />

        <h2>Send your own events</h2>
        <p>Nothing is stored and nothing is sent until consent is granted.</p>

        <Snippet
          lang="ts"
          code={
            `import { consent, event, error, log, identify } from "@firstrun/analytics";\n\n` +
            `consent(true);\n` +
            `event("download_clicked", { platform: "windows" });\n` +
            `error(err, { "url.path": location.pathname });\n` +
            `log({ name: "checkout_stalled", severity: 13, attributes: { step: 3 } });\n` +
            `identify("u_42");`
          }
          note={
            <>
              <code>event</code> writes at INFO and <code>error</code> at ERROR, both filling in
              the conventional attributes. <code>log</code> takes any event you like. Attribute
              values are JSON, so a number stays a number. <code>useFirstrun()</code> returns the
              same functions if you prefer a hook.
            </>
          }
        />

        <p>
          With consent granted the component also writes <code>page_view</code> (SPA navigations
          included), <code>session_start</code>, <code>page_leave</code>,{" "}
          <code>outbound_click</code>, <code>file_download</code>, <code>form_submit</code> and{" "}
          <code>web_vital</code> on its own. The props <code>autoPage</code>,{" "}
          <code>autoOutbound</code>, <code>autoVitals</code>, <code>autoForms</code> and{" "}
          <code>trackLeave</code> each turn one group off.
        </p>
      </DocsProse>
    ),
  },
];

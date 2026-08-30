import Flame from "lucide-solid/icons/flame";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";
import { Snippet } from "../snippet.js";

/**
 * SvelteKit: one call in the root layout.
 *
 * `packages/analytics/frameworks/svelte.ts` imports nothing from Svelte, so
 * this is the same page for Svelte 4 and 5 and does not need a version note.
 */

export const topics: DocsTopic[] = [
  {
    slug: "install-sveltekit",
    title: "SvelteKit",
    summary: "One call in the root layout, inside onMount.",
    section: "Install guides",
    order: 40,
    icon: Flame,
    render: (ctx) => (
      <DocsProse>
        <h2>Install the package</h2>
        <Snippet lang="bash" code="npm i @firstrun/analytics" />

        <h2>Add the component</h2>
        <Snippet
          filename="src/routes/+layout.svelte"
          lang="svelte"
          code={
            `<script lang="ts">\n` +
            `  import { onMount } from "svelte";\n` +
            `  import { initFirstrun } from "@firstrun/analytics/svelte";\n\n` +
            `  onMount(() =>\n` +
            `    initFirstrun({ sourceKey: "${ctx.vars.key}", host: "${ctx.vars.origin}" })\n` +
            `  );\n` +
            `</script>\n\n` +
            `<slot />`
          }
          note={
            <>
              Inside <code>onMount</code>, because the tag reads the document and{" "}
              <code>localStorage</code> and neither exists during SvelteKit's server render.{" "}
              <code>initFirstrun</code> returns its own teardown, which is why it can be returned
              straight out of <code>onMount</code>. There is a <code>use:firstrun</code> action
              taking the same config if you would rather write it in markup.
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
            `error(err);\n` +
            `log({ name: "checkout_stalled", severity: 13, attributes: { step: 3 } });\n` +
            `identify("u_42");`
          }
          note={
            <>
              <code>event</code> writes at INFO and <code>error</code> at ERROR, both filling in
              the conventional attributes. <code>log</code> takes any event you like. Attribute
              values are JSON, so a number stays a number.
            </>
          }
        />

        <p>
          With consent granted the tag also writes <code>page_view</code> on every client-side
          navigation (SvelteKit routes through <code>history.pushState</code>, which the tag
          watches), plus <code>session_start</code>, <code>page_leave</code>,{" "}
          <code>outbound_click</code>, <code>file_download</code>, <code>form_submit</code> and{" "}
          <code>web_vital</code>. The config fields <code>autoPage</code>,{" "}
          <code>autoOutbound</code>, <code>autoVitals</code>, <code>autoForms</code> and{" "}
          <code>trackLeave</code> each turn one group off.
        </p>
      </DocsProse>
    ),
  },
];

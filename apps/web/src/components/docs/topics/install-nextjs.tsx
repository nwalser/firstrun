import Triangle from "lucide-solid/icons/triangle";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";
import { Callout, Snippet } from "../snippet.js";

/**
 * Next.js, both routers.
 *
 * The two routers are one page because the choice between them is a two-line
 * decision, and a reader who lands on the wrong one of two pages gets a working
 * install that silently stops counting navigations.
 *
 * Transcribed from `packages/analytics/frameworks/next.ts` and `react.ts`.
 */

export const topics: DocsTopic[] = [
  {
    slug: "install-nextjs",
    title: "Next.js",
    summary: "App Router and Pages Router, which take different imports.",
    section: "Install guides",
    order: 30,
    icon: Triangle,
    render: (ctx) => (
      <DocsProse>
        <h2>Install the package</h2>
        <Snippet lang="bash" code="npm i @firstrun/analytics" />

        <h2>Add the component</h2>
        <Snippet
          title="App Router"
          filename="app/layout.tsx"
          lang="tsx"
          code={
            `import { Analytics } from "@firstrun/analytics/next";\n\n` +
            `export default function RootLayout({ children }: { children: React.ReactNode }) {\n` +
            `  return (\n` +
            `    <html lang="en">\n` +
            `      <body>\n` +
            `        {children}\n` +
            `        <Analytics sourceKey="${ctx.vars.key}" host="${ctx.vars.origin}" />\n` +
            `      </body>\n` +
            `    </html>\n` +
            `  );\n` +
            `}`
          }
          note={
            <>
              The component is already <code>"use client"</code>; the layout does not have to be.
              Routes come from <code>usePathname()</code> alone, so no Suspense boundary is needed.
              It is <code>sourceKey</code> and not <code>key</code> because React consumes a prop
              called <code>key</code> before the component ever sees it.
            </>
          }
        />

        <Snippet
          title="Pages Router"
          filename="pages/_app.tsx"
          lang="tsx"
          code={
            `import type { AppProps } from "next/app";\n` +
            `import { Analytics } from "@firstrun/analytics/react";\n\n` +
            `export default function App({ Component, pageProps }: AppProps) {\n` +
            `  return (\n` +
            `    <>\n` +
            `      <Component {...pageProps} />\n` +
            `      <Analytics sourceKey="${ctx.vars.key}" host="${ctx.vars.origin}" />\n` +
            `    </>\n` +
            `  );\n` +
            `}`
          }
        />

        <Callout title="The two imports are not interchangeable">
          <code>/next</code> turns the tag's own history watching off and reports routes from{" "}
          <code>usePathname()</code> instead. <code>next/navigation</code> does not exist in the
          Pages Router, and the App Router does not move through <code>history</code> in a way the
          tag can watch, so <code>/react</code> there under-reports navigations.
        </Callout>

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
          With consent granted the component also writes <code>page_view</code>,{" "}
          <code>session_start</code>, <code>page_leave</code>, <code>outbound_click</code>,{" "}
          <code>file_download</code>, <code>form_submit</code> and <code>web_vital</code> on its
          own. The props <code>autoPage</code>, <code>autoOutbound</code>,{" "}
          <code>autoVitals</code>, <code>autoForms</code> and <code>trackLeave</code> each turn one
          group off.
        </p>
      </DocsProse>
    ),
  },
];

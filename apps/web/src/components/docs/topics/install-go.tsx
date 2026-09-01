import Server from "lucide-solid/icons/server";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";
import { Callout, Snippet } from "../snippet.js";

/**
 * Go: standard library only, 1.21+.
 *
 * Transcribed from `clients/go/README.md`, `firstrun.go` and `wire.go`. Unlike
 * the Node client this one installs no signal handler, so `Close` is shown on a
 * path the reader already has rather than implied to appear by itself.
 */

export const topics: DocsTopic[] = [
  {
    slug: "install-go",
    title: "Go",
    summary: "Server-side Go 1.21+, standard library only, one sender goroutine.",
    section: "Install guides",
    order: 74,
    icon: Server,
    render: (ctx) => (
      <DocsProse>
        <p>
          Every call puts an event on a bounded channel and returns, taking no lock a request path
          would contend on: nothing panics into your code, nothing blocks, and if firstrun is
          unreachable your program keeps working. No dependencies.
        </p>

        <h2>Install the package</h2>
        <Snippet lang="bash" code="go get firstrun.dev/go" />

        <h2>Create the client</h2>
        <Snippet
          lang="go"
          code={
            `import firstrun "firstrun.dev/go"\n\n` +
            `analytics, err := firstrun.New(firstrun.Options{\n` +
            `\tSourceKey:      os.Getenv("FIRSTRUN_SOURCE_KEY"), // fr_9f3a2b1c4d5e6f70\n` +
            `\tHost:           "${ctx.vars.origin}",\n` +
            `\tServiceVersion: os.Getenv("GIT_SHA"),\n` +
            `\tOnDiagnostic: func(d firstrun.Diagnostic) {\n` +
            `\t\tslog.Warn("firstrun", "code", d.Code, "msg", d.Message)\n` +
            `\t},\n` +
            `})`
          }
          note={
            <>
              Bad configuration returns an error <strong>and</strong> a usable, disabled client,
              so ignoring the error is safe and a typo in an environment variable cannot stop your
              service booting. <code>OnDiagnostic</code> is the only reporting channel and runs
              inline on the calling goroutine, so keep it cheap and safe for concurrent use.
            </>
          }
        />

        <h2>Write events</h2>
        <Snippet
          lang="go"
          code={
            `analytics.Event("exported_csv", firstrun.Attrs{"rows": len(rows)},\n` +
            `\tfirstrun.With{UserID: user.ID})\n\n` +
            `analytics.Error(err, firstrun.Attrs{"http.route": "/reports/{id}"},\n` +
            `\tfirstrun.With{UserID: user.ID})\n\n` +
            `analytics.Log(firstrun.Entry{\n` +
            `\tName:       "queue_depth",\n` +
            `\tSeverity:   firstrun.INFO,\n` +
            `\tDeviceID:   "worker-3",\n` +
            `\tAttributes: firstrun.Attrs{"firstrun.metric": "queue_depth", "firstrun.value": depth},\n` +
            `})\n\n` +
            `_ = analytics.Close(ctx)   // on shutdown. Bounded by the context, idempotent`
          }
          note={
            <>
              Not deferred, not waited on, and nothing here can fail. <code>Event</code> writes at
              INFO and <code>Error</code> at ERROR, both filling in the conventional attributes;{" "}
              <code>Log</code> takes any name, any severity and any attributes. Values go on the
              wire as JSON, so an <code>int</code> stays a number. A zero <code>Time</code> means
              now. This client installs no signal handler of its own, so call <code>Close</code>{" "}
              on the shutdown path you already have.
            </>
          }
        />

        <Callout title="Identity is yours to supply, and all of it is optional">
          This client fills in nothing. A desktop install has a machine to name and a browser has a
          visit; a server has neither, so <code>UserID</code>, <code>DeviceID</code> and{" "}
          <code>SessionID</code> stay empty until you pass one. An event with none of them is sent
          and stored like any other: it counts as an event and in no unique, which is the honest
          answer rather than an invented id nobody could spot from a dashboard.
          <br />
          <br />
          They travel as <strong>one unit</strong>. Setting any of the three on an entry means that
          entry&rsquo;s identity comes from the entry, and neither the scoped handle nor the client
          options are consulted for the other two. Set them in <code>Options</code> only when the
          process really is the subject, such as a CLI or a device agent.
        </Callout>
      </DocsProse>
    ),
  },
];

import SquareCode from "lucide-solid/icons/square-code";
import type { WikiTopic } from "../registry.js";
import { WikiProse } from "../shell.js";
import { Callout, Snippet } from "../snippet.js";

/**
 * .NET: one package for WPF, WinForms, Avalonia, MAUI, console tools, worker
 * services and ASP.NET, because `Firstrun` targets `netstandard2.0` as well as
 * `net8.0`.
 *
 * Transcribed from `clients/dotnet/README.md` and `src/Firstrun/`. The desktop
 * half carries the reader's own key; the server half reads configuration,
 * because a server key belongs there rather than in a snippet somebody pastes
 * into a repository.
 */

export const topics: WikiTopic[] = [
  {
    slug: "install-dotnet",
    title: ".NET",
    summary: "One package for WPF, WinForms, Avalonia, MAUI, console tools and ASP.NET.",
    section: "Install guides",
    appliesTo: "desktop",
    order: 60,
    icon: SquareCode,
    render: (ctx) => (
      <WikiProse>
        <p>
          Every call appends to a bounded in-memory queue and returns: nothing throws into your
          code, nothing blocks your thread, and if firstrun is unreachable your application is
          unaffected. No dependencies on any target framework.
        </p>

        <Snippet
          lang="bash"
          code={
            `dotnet add package Firstrun\n` +
            `dotnet add package Firstrun.Extensions.Hosting   # ASP.NET and IHost only`
          }
        />

        <Snippet
          title="A desktop app"
          filename="App.xaml.cs"
          lang="csharp"
          code={
            `using Firstrun;\n\n` +
            `Analytics = new FirstrunClient(new FirstrunOptions\n` +
            `{\n` +
            `    SourceKey   = "${ctx.vars.key}",\n` +
            `    Host        = "${ctx.vars.origin}",\n` +
            `    ServiceName = "${ctx.vars.app}",   // names the folder the anonymous id lives in\n` +
            `    Channel     = "stable",\n` +
            `});`
          }
          note={
            <>
              <code>app_install</code> on the first run ever and <code>app_launch</code> on every
              run are queued by the constructor. <code>ServiceVersion</code> defaults to the entry
              assembly, and the operating system, architecture and locale to the machine. Set{" "}
              <code>ServiceName</code> so the anonymous id on disk survives a key rotation. For
              ASP.NET, <code>builder.Services.AddFirstrunServer(sourceKey, host)</code> registers
              the same client as a singleton and flushes on shutdown.
            </>
          }
        />

        <Snippet
          lang="csharp"
          code={
            `Analytics.Event("exported_project", new FirstrunAttributes()\n` +
            `    .Set("format", "pdf")\n` +
            `    .Set("pages", 12));\n\n` +
            `Analytics.Error(ex);\n\n` +
            `Analytics.Log(new FirstrunEntry("render_stalled")\n` +
            `{\n` +
            `    Severity   = Severity.Warn,\n` +
            `    Attributes = new FirstrunAttributes().Set("frames_dropped", 41),\n` +
            `});\n\n` +
            `Analytics.Identify("acct_8812");   // your own id, when they sign in\n` +
            `Analytics.Dispose();               // on exit. Optional: the worker is a background thread`
          }
          note={
            <>
              <code>Event</code> writes at INFO and <code>Error</code> at ERROR, both filling in
              the conventional attributes; <code>Log</code> takes any name, any severity and any
              attributes. Values go on the wire as JSON and <code>Set</code> converts with the
              invariant culture, so a German machine does not send <code>1,5</code>.
            </>
          }
        />

        <Callout title="On a server, distinctId is yours to supply">
          A desktop install has a per-machine id on disk. A server process serves thousands of
          different people and has nothing correct to default to, so pass an id you already have
          per call: a cookie, a session key, an account id. Leave it out and every entry in your
          fleet collapses onto a handful of ids, and your unique counts become a count of your
          processes.
        </Callout>
      </WikiProse>
    ),
  },
];

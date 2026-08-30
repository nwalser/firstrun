import Terminal from "lucide-solid/icons/terminal";
import type { WikiTopic } from "../registry.js";
import { WikiProse } from "../shell.js";
import { Callout, Snippet } from "../snippet.js";

/**
 * Python: standard library only, 3.9+.
 *
 * Transcribed from `clients/python/README.md` and `src/firstrun/`. The fork
 * behaviour used to have a section here; it is a note on the init snippet now,
 * because this page is an install, an init and a write call.
 */

export const topics: WikiTopic[] = [
  {
    slug: "install-python",
    title: "Python",
    summary: "Python 3.9+, standard library only, safe across a fork.",
    section: "Install guides",
    appliesTo: "server",
    order: 72,
    icon: Terminal,
    render: (ctx) => (
      <WikiProse>
        <p>
          Every call appends to a bounded in-memory queue and returns: nothing raises into your
          code, nothing blocks your thread, and if firstrun is unreachable your program is
          unaffected. No dependencies, the transport is <code>urllib.request</code>.
        </p>

        <Snippet lang="bash" code="pip install firstrun" />

        <Snippet
          lang="python"
          code={
            `import os\n` +
            `import firstrun\n\n` +
            `firstrun.configure(\n` +
            `    source_key=os.environ["FIRSTRUN_SOURCE_KEY"],   # fr_server_...\n` +
            `    host="${ctx.vars.origin}",\n` +
            `    service_name="etl",\n` +
            `    persist_distinct_id=False,      # on a server the id belongs to the request\n` +
            `)`
          }
          note={
            <>
              Before <code>configure()</code> every module-level function is a silent no-op, so a
              library that writes entries costs nothing in a program that never configures a
              client. Calling <code>configure()</code> before a fork is fine: Gunicorn, uWSGI and
              Celery are handled by an <code>os.register_at_fork</code> handler that replaces the
              locks, starts a fresh sender and drops the inherited queue so parent and child do
              not both send it. The anonymous id survives, because a fork is not a second
              installation.
            </>
          }
        />

        <Snippet
          lang="python"
          code={
            `firstrun.event(\n` +
            `    "order_placed",\n` +
            `    {"currency": order.currency, "total": order.total},\n` +
            `    distinct_id=request.session.session_key or "anon",\n` +
            `)\n\n` +
            `firstrun.error(exc, {"http.route": "/orders"})\n\n` +
            `firstrun.log({\n` +
            `    "name": "queue_depth",\n` +
            `    "severity": 9,\n` +
            `    "attributes": {"firstrun.metric": "queue_depth", "firstrun.value": depth},\n` +
            `})\n\n` +
            `firstrun.identify("acct_8812")   # sets user.id from here on\n` +
            `firstrun.shutdown(timeout=5)     # atexit already does this with a 3s budget`
          }
          note={
            <>
              <code>event</code> writes at INFO and <code>error</code> at ERROR, both filling in
              the conventional attributes; <code>log</code> takes any name, any severity and any
              attributes. Values go on the wire as JSON, so an <code>int</code> stays a number and
              a <code>bool</code> stays a boolean. Pass <code>time=</code> for something you are
              recording after the fact. Calling any of these from a coroutine is fine: there is
              nothing to await on the hot path.
            </>
          }
        />

        <Callout title="On a server, distinct_id is yours to supply">
          A server process serves thousands of different people and has nothing correct to default
          to, so pass an id you already have: a session key, a cookie, an account id. Leave it out
          and every entry in your fleet collapses onto a handful of ids, and your unique counts
          become a count of your workers.
        </Callout>
      </WikiProse>
    ),
  },
];

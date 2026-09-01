import Terminal from "lucide-solid/icons/terminal";
import type { DocsTopic } from "../registry.js";
import { DocsProse } from "../shell.js";
import { Callout, Snippet } from "../snippet.js";

/**
 * Python: standard library only, 3.9+.
 *
 * Transcribed from `clients/python/README.md` and `src/firstrun/`. The fork
 * behaviour used to have a section here; it is a note on the init snippet now,
 * because this page is an install, an init and a write call.
 */

export const topics: DocsTopic[] = [
  {
    slug: "install-python",
    title: "Python",
    summary: "Python 3.9+, standard library only, safe across a fork.",
    section: "Install guides",
    order: 72,
    icon: Terminal,
    render: (ctx) => (
      <DocsProse>
        <p>
          Every call appends to a bounded in-memory queue and returns: nothing raises into your
          code, nothing blocks your thread, and if firstrun is unreachable your program is
          unaffected. No dependencies, the transport is <code>urllib.request</code>.
        </p>

        <h2>Install the package</h2>
        <Snippet lang="bash" code="pip install firstrun" />

        <h2>Create the client</h2>
        <Snippet
          lang="python"
          code={
            `import os\n` +
            `import firstrun\n\n` +
            `firstrun.configure(\n` +
            `    source_key=os.environ["FIRSTRUN_SOURCE_KEY"],   # fr_9f3a2b1c4d5e6f70\n` +
            `    host="${ctx.vars.origin}",\n` +
            `    service_name="etl",\n` +
            `    # No identity is set: on a server it belongs to the request, not the box\n` +
            `)`
          }
          note={
            <>
              Before <code>configure()</code> every module-level function is a silent no-op, so a
              library that writes events costs nothing in a program that never configures a
              client. Calling <code>configure()</code> before a fork is fine: Gunicorn, uWSGI and
              Celery are handled by an <code>os.register_at_fork</code> handler that replaces the
              locks, starts a fresh sender and drops the inherited queue so parent and child do
              not both send it.
            </>
          }
        />

        <h2>Write events</h2>
        <Snippet
          lang="python"
          code={
            `firstrun.event(\n` +
            `    "order_placed",\n` +
            `    {"currency": order.currency, "total": order.total},\n` +
            `    session_id=request.session.session_key,\n` +
            `)\n\n` +
            `firstrun.error(exc, {"http.route": "/orders"})\n\n` +
            `firstrun.log({\n` +
            `    "name": "queue_depth",\n` +
            `    "severity": 9,\n` +
            `    "attributes": {"firstrun.metric": "queue_depth", "firstrun.value": depth},\n` +
            `})\n\n` +
            `firstrun.user("acct_8812")       # sets user.id from here on\n` +
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

        <Callout title="On a server, identity is yours to supply">
          A server process serves thousands of different people and has nothing correct to default
          to, so this client sets nothing at all: no device, no session, no user. Pass an id you
          already have, per call or through <code>firstrun.context()</code>: a session key, a
          cookie, an account id. An event with none of them counts as an event and in no unique,
          which is the truthful answer for a process that was never told who a request was for.
        </Callout>
      </DocsProse>
    ),
  },
];

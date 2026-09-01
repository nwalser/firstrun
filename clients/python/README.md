# firstrun for Python

One structured log for everything you ship, for [firstrun](../../README.md).
Python 3.9+, standard library only.

```
pip install firstrun
```

Everything this library sends is a **log entry**. An error is a log entry, a product event is a
log entry, a measurement is a log entry. `log()` is the whole API:

```python
firstrun.log("order_placed", severity=firstrun.INFO, attributes={"total": 41.20})
```

`event()`, `error()` and the level helpers below build one for you with the conventional fields
filled in. **They are examples of a good shape, not a schema.** Nothing they produce is
privileged; write the same entry yourself with `log()` and it is stored, indexed and queried
identically.

## Why you can trust it in your program

This is the whole design, and it outranks every feature in the library.

**If firstrun is unreachable, slow, or returning errors, your program is unaffected.**

- `log()` and every helper over it append to an in-memory queue and return. They never touch
  a socket on your thread, and they are safe to call from a request handler, a signal handler,
  or a tight loop.
- **Nothing raises into your code.** Not a bad entry name, not a dead host, not a read-only
  filesystem, not a closed client, not `log(None)`. The constructor does not raise either: a
  missing source key disables the client and reports a diagnostic. Check `.enabled` if you want
  a test to fail loudly instead.
- **The queue is bounded** at `max_queued_entries` (default 10,000). Past that the *oldest*
  entries are dropped and counted in `stats().dropped_from_overflow`. A process that has been
  offline for a week cannot grow your RSS.
- **Sending is bounded too.** A 10s socket timeout, capped exponential backoff with jitter, and
  a circuit breaker that stops dialling entirely after 5 consecutive failures and stays shut for
  5 minutes. There is no retry storm and no thundering herd when a host comes back.
- **A 4xx is dropped, not retried.** A malformed batch or a dead source key would otherwise
  wedge every later entry behind it. 408, 429 and 5xx are retried; `Retry-After` is honoured.
  A redirect is refused rather than followed.
- **Nothing is written to your stdout, stderr, or `logging`.** The only output is the
  `diagnostics` callback, which you opt into. Exceptions from your callback are swallowed.
- **Exit cannot hang.** The worker is a daemon thread, so the interpreter never waits on it. An
  `atexit` hook flushes with a 3 second budget by default; `flush(timeout)` and `close(timeout)`
  are bounded and optional.
- **The schedule never overrides any of the above.** A timer does not fire while the breaker is
  open or a retry delay is running, `immediate` coalesces rather than sending per entry, and an
  entry at or above `flush_on_severity` is put at the front of the queue rather than onto your
  thread. See **When it sends** below.
- **`fork()` is handled.** See below.

The trade is explicit: when we cannot send, we lose analytics. Losing analytics is always better
than affecting your software.

### Dependencies

None. The transport is `urllib.request`, not `requests` or `httpx`, because a telemetry library
has no business adding a package to the dependency graph of the program it is measuring, or
being the reason two of your packages disagree about a `urllib3` version. The cost is a fresh
connection per batch instead of a pooled one, which at one batch every fifteen seconds is a
handshake we can afford.

## A script

```python
import firstrun

firstrun.configure(
    source_key="fr_9f3a2b1c4d5e6f70",
    host="https://t.example.com",
    app_name="etl",
)

firstrun.event("import_started", {"source": "salesforce"})
...
firstrun.event("import_finished", {"rows": 41_233, "seconds": 92.4, "partial": False})

# A line, when you have a sentence rather than an occurrence of a thing.
firstrun.info("reconciled 41k rows against the ledger")

# An exception, unwrapped for you into exception.type / .message / .stacktrace.
try:
    load()
except Exception as exc:
    firstrun.error(exc, {"source": "salesforce"})

# Optional: atexit already does this with a 3s budget.
firstrun.shutdown(timeout=5)
```

Before `configure()`, every module-level function is a silent no-op, so a library that calls
`firstrun.event()` costs nothing in a program that never configures a client.

## When it sends

Two settings, because they answer two questions. `delivery` decides **when a send is attempted**.
`persistence` decides **what is still there after the process is gone**. They look like one
setting and are not: "send once per launch" is a schedule that never fires during the run
combined with a queue that survives to the next one, and neither half expresses it alone.

```python
firstrun.configure(
    source_key="fr_9f3a2b1c4d5e6f70",
    host="https://t.example.com",
    delivery="interval",        # immediate | interval | startup | manual
    persistence="memory",       # memory | disk
    flush_interval=15.0,        # the `interval` period
    max_batch_size=200,         # ...or this many entries, whichever comes first
    flush_on_severity=firstrun.ERROR,
    flush_on_exit=True,
)
```

| `delivery` | when it sends |
|---|---|
| `immediate` | as soon as a batch can be formed. **Not one request per entry:** see below |
| `interval` | every `flush_interval`, or when `max_batch_size` is reached, whichever is first. **The default** |
| `startup` | drains what survived the last run, then never again during this one. One burst per launch |
| `manual` | only when you call `flush()` |

| `persistence` | what survives |
|---|---|
| `memory` | nothing. The queue dies with the process. **The default** |
| `disk` | the pending queue is mirrored to a file and drained on the next start |

### The defaults, and why

**`interval` at 15 seconds, in memory.** A server process is long-lived, so a short period costs
one small request every fifteen seconds and coalesces everything in between into it.

**Disk persistence is usually wrong for a server, which is why it is not the default.** A server
that crashes is not generally restarted in place by something that preserves local state: it is
restarted by a supervisor, a new container, or a new pod, and the filesystem the queue was written
to is gone before anything can drain it. Writing telemetry into a container filesystem is also a
surprise: it is a read-only image in more deployments than not, it is a disk quota in the rest, and
in an autoscaled fleet the instance holding the unsent entries is the one that just went away.
Turn it on when the process really does restart on the same machine with the same volume, and give
it a `queue_path` on a volume you chose rather than the default under the user's data directory.

### `immediate` batches. It is not one request per entry

`immediate` means "do not wait for a timer". It does not mean synchronous, and it does not mean a
request per call. Entries produced in the same tick coalesce into one batch: the worker is woken
once for a burst rather than once per entry, and it lets `coalesce_delay` (50ms) of that burst
land before it builds the body.

Measured, with a local ingest server counting requests: a loop calling `event()` a thousand times
in `immediate` mode produces **5 requests of 200 entries**, not 1,000 requests, and the loop itself
returns in 5ms. Anything else would put this library in your critical path, which is the one thing
it is not allowed to be.

### `flush_on_severity` (default `ERROR`)

Any entry at or above this severity is sent at the moment it is logged, whatever the schedule says.
It is most of the value of having a policy at all: a crash report that waits five minutes for the
next tick is a crash report that usually never arrives, because the process is gone by then. It
costs nothing at rest, since most runs log no errors.

It does not buy an exemption from anything else. The entry joins the same queue and the same batch,
your thread does not wait for it, and it cannot be sent while the circuit breaker is open.

Pass `flush_on_severity=None` to turn it off, or a higher band (`firstrun.FATAL`) to narrow it.

### `flush_on_exit` (default `True`)

A best-effort flush at `atexit` and on `close()`, **time-bounded** at `atexit_timeout` (3 seconds)
so a slow network cannot hold your process open. The worker is a daemon thread, so even a hung
socket cannot stop the interpreter exiting.

The one exception is `delivery="startup"`, where it defaults to `False`: flushing at exit would
make it two bursts per launch and would empty the queue the next launch was supposed to drain.
Pass it explicitly to override that.

### `startup` needs `disk`, and says so

`startup` with `memory` is incoherent: nothing survives the run, so a schedule that only fires at
the start of the next one would never send anything at all. Rather than silently sending nothing,
the client **coerces persistence to `disk` and emits a `config_coerced` diagnostic**. If the disk
is unusable as well (a read-only filesystem, no home directory), it falls back to `interval` in
memory with another diagnostic, because a client that sends late is better than a client that is
silent.

### `max_batch_size` and the server's cap

The server rejects any body carrying more than **500** entries, and a rejected body is dropped
rather than retried. A `max_batch_size` above that cap would mean every request rejected, a queue
that never drains, and total silence that reads like a network fault. The value is clamped to the
cap taken from the wire contract, so it cannot be set wrong.

### The disk queue

`persistence="disk"` mirrors the pending queue to one line-delimited file, rewritten
temp-then-`os.replace` (atomic on POSIX and Windows) whenever it has changed, at most every
`persist_interval` (5s), and once more after the worker stops in `close()`. It is bounded twice
over, at `max_disk_entries` (defaults to `max_queued_entries`) and `max_disk_bytes` (8 MiB), and
the oldest go first, the same rule the in-memory queue uses.

| OS | Default path |
|---|---|
| Windows | `%LOCALAPPDATA%\firstrun\{app}\queue.jsonl` |
| macOS | `~/Library/Application Support/firstrun/{app}/queue.jsonl` |
| Linux / other Unix | `$XDG_DATA_HOME/firstrun/{app}/queue.jsonl`, or `~/.local/share/firstrun/{app}/queue.jsonl` |

Set `queue_path` to put it somewhere you chose. Read the resolved path from `client.queue_path`,
or compute one with `firstrun.queue_path("etl")`.

The file is **not** deleted when it is read. It is overwritten by the next save with whatever is
still pending, so a crash between the two replays entries instead of losing them. Replaying is
safe: every entry carries the id it was created with and the server deduplicates on it.

### One burst per launch

```python
firstrun.configure(
    source_key="fr_9f3a2b1c4d5e6f70",
    host="https://t.example.com",
    delivery="startup",         # coerces persistence to disk on its own
    queue_path="/var/lib/myapp/firstrun-queue.jsonl",
)
```

## Ambient request identity

On a server the identity belongs to the request rather than to the process, so every call in a
handler ends up repeating `device_id=` and `user_id=`. Say it once instead:

```python
with firstrun.context(device_id=session_key, user_id=account_id):
    firstrun.event("order_placed", {"total": order.total})
    firstrun.event("receipt_queued")
```

Both entries carry the identity and neither call names it. The precedence is the call, then the
context, then the client's own, so an entry that passes `device_id=` still wins.

It is a [context variable](https://docs.python.org/3/library/contextvars.html), which is the
design rather than an implementation detail. A module global is shared by every request in the
process, so two concurrent requests take turns overwriting each other's user id and both report
the wrong one. A `threading.local` fixes threads and nothing else: two coroutines interleaved on
one thread share it. A context variable is copied into each task at the moment the task is
created, so an identity set at the front door reaches everything the handler awaits and reaches
nothing being served alongside it.

**Nothing is inferred.** No cookie is read, no header parsed, no session looked up, no address
hashed. The context carries what you put in it, and `user.id` is only ever a string you passed.

Attributes work the same way and sit under the entry's own:

```python
with firstrun.context(device_id=visitor, attributes={"tenant": tenant.slug}):
    firstrun.event("report_run", {"rows": 1200})     # carries tenant as well
```

Nesting adds rather than replaces, so a handler can attach a detail without restating who the
request is from. `**attrs` is the short form and only reaches keys that are Python identifiers;
the conventional keys are dotted, so those go in `attributes`.

### Middleware, where there is nowhere to put a `with`

`replace_context()` returns a token and `reset_context(token)` puts back whatever was there. Reset
in a `finally`: one request's identity left in scope would be stamped on the next one's entries.

```python
token = firstrun.replace_context(device_id=visitor_id, user_id=account_id)
try:
    return handle(request)
finally:
    firstrun.reset_context(token)
```

**`replace_context` at a front door, `set_context` and `context` everywhere else.** The difference
is what `None` means. Inside a handler, `None` means "keep what the middleware said", which is why
`context()` nests. At the front door it has to mean anonymous: an id your extractor did not return
must not fall back on whatever is ambient on that worker thread, or a request with no account gets
stamped with the `user.id` of the request before it. That is an identity you never passed, which is
the one thing this library will not do, so the middleware states the whole identity or states there
is none.

`reset_context(None)` is a no-op, so the `finally` needs no branch. `current_context()` returns
the `RequestContext` in force, or None outside one.

You do not have to write that for Django, Flask or anything ASGI. The middleware below already
does it, and writes the entry for the request as well.

## HTTP middleware

`firstrun.integrations` ships one per framework, and each does the same three things: it puts the
request's identity in scope, it writes **one `http.request` entry** for the request, and it takes
the identity back down in a `finally`, because one request's identity left in scope is the next
request's entries stamped with somebody else's.

**Every identity extractor is optional, and all of them are yours.** None of them reads a cookie, a header,
a session or an address on its own initiative, and `user.id` is only ever the string your own
function returned. An id we invented would describe the server rather than whoever is on the other
end of it, and one we guessed at from the request would be identity inference, which this product
does not do anywhere.

The identity a middleware installs **replaces** whatever was in scope rather than layering onto it
(`replace_context`, above). An extractor that returns nothing means the request is anonymous, so a
`user.id` cannot arrive from the request before this one, from a second middleware in the same
chain, or from a `set_context()` in a worker-init hook. Those are all identities you never passed
for this request, which is the same rule read from the other end.

The entry is an ordinary log entry, the kind you could write yourself with `log()`:

| attribute | |
|---|---|
| `http.request.method` | `"GET"` |
| `http.route` | the route **template**, `/orders/<int:pk>`. Left off when there is not one |
| `http.response.status_code` | a number, so "5xx" is a comparison and not a string match |
| `url.path` | the path that was asked for |
| `firstrun.duration_ms` | a number |
| `firstrun.client_aborted` | `true`, and only when the caller hung up. Absent otherwise |

Severity is INFO, except a 5xx, which is ERROR. **A 4xx is not an error.** It is the client's
mistake, and a board full of ERROR entries because a scanner is walking your site looking for
`/wp-login.php` is noise that hides the ones that are yours.

A request whose exception escapes the whole chain is recorded at ERROR with `exception.type`,
`exception.message` and `exception.stacktrace` on that same entry, and with **no** status code: we
did not see a response, and 500 would be a guess that `propagate_exceptions` makes a wrong one. The
exception itself carries on to your handler untouched, which is the only thing it could do. You
will rarely see this under Django, which turns a view that raised into a 500 response before it
reaches us.

**With one exception, and it is a cancellation.** An `asyncio.CancelledError` out of an ASGI app is
the task running the request being cancelled, which is what a server does when the socket goes away
and again on shutdown, not something of yours that failed: a timeout of yours surfaces as
`TimeoutError`, and a task you cancelled yourself does not escape your own handler. It stays at
INFO and carries `firstrun.client_aborted` instead of `exception.type` and a stack, because an app
with SSE, long polling, streaming downloads or users who close tabs would otherwise have an error
board that is mostly cancellations. The entry is still written: the request happened, and how long
it ran before the caller left is worth having. The exception is re-raised untouched like any other,
cancellation semantics included.

`http.route` is the template and never the resolved path. `/users/12345` in that key would make a
breakdown by route one row per user, which is the single thing the key exists to prevent. Where
the framework has no template to give (a 404 that matched nothing, a response returned before
routing) the key is left off rather than filled in with a guess, and `url.path` still says what was
asked for.

`ignore_paths` takes a path prefix or a list of them, and `ignore` takes a predicate. An ignored
request gets no entry and no context.

None of these modules imports its framework at the top, so `firstrun` still has no dependencies and
`import firstrun.integrations.asgi` works in an environment with no Starlette in it. One that
cannot be configured disables itself and passes every request through, because a constructor here
does not raise into a program that is trying to boot. Read `.enabled` if you would rather a startup
check failed loudly.

### Django

```python
# settings.py
import firstrun

firstrun.configure(
    source_key="fr_9f3a2b1c4d5e6f70",
    host="https://t.example.com",
    track_lifecycle=False,
)

MIDDLEWARE = [
    ...,
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "firstrun.integrations.django.FirstrunMiddleware",
]

FIRSTRUN_DISTINCT_ID = "myapp.telemetry.visitor_id"    # a callable, or its dotted path
FIRSTRUN_USER_ID = "myapp.telemetry.account_id"        # optional
FIRSTRUN_IGNORE_PATHS = ["/static/", "/healthz"]       # optional
```

```python
# myapp/telemetry.py: what identifies a request is your decision. Use whatever
# you already have (a session key, a cookie, an account id). We never invent one.
def visitor_id(request):
    return request.session.session_key

def account_id(request):
    return str(request.user.pk) if request.user.is_authenticated else None
```

Put it **after** `AuthenticationMiddleware`, or `request.user` is not resolved when the extractor
asks for it. A dotted path is accepted as well as a callable because a settings module that has to
import the view layer is a settings module with an import cycle waiting in it.

The other spelling takes the extractors directly, which is the one that keeps a lambda possible:

```python
# myapp/telemetry.py
from firstrun.integrations.django import firstrun_middleware

identity = firstrun_middleware(
    device_id=lambda request: request.session.session_key,
    ignore_paths=["/static/"],
)
# settings.py: MIDDLEWARE = [..., "myapp.telemetry.identity"]
```

Either way, the view names no identity at all:

```python
# views.py
import firstrun

def checkout(request):
    order = place_order(request)
    firstrun.event("order_placed", {"currency": order.currency, "total": order.total})
    return redirect("thanks")
```

Passing `device_id=` on a call still works and still wins: the context is the default, not a
lock.

Both request modes are supported. Under WSGI Django hands it a synchronous `get_response` and it
is a synchronous middleware; under ASGI it is an asynchronous one. Declaring only one of the two
would make Django adapt the other with a thread hop per request, in your critical path, which is
not ours to spend.

Under Gunicorn or uWSGI with pre-forked workers, `configure()` in `settings.py` runs in the
master and each worker inherits a client that repairs itself in the child (see **fork** below).
Configuring inside `post_fork` works too and is marginally tidier.

### Flask

```python
import firstrun
from flask import Flask, request, session
from firstrun.integrations.flask import FirstrunExtension

firstrun.configure(
    source_key="fr_9f3a2b1c4d5e6f70",
    host="https://t.example.com",
    track_lifecycle=False,
)

telemetry = FirstrunExtension(
    user_id=lambda: session.get("account_id"),
    session_id=lambda: request.cookies.get("session"),
    ignore_paths=["/static/"],
)

app = Flask(__name__)
telemetry.init_app(app)          # or FirstrunExtension(app, device_id=...)

@app.post("/orders")
def create_order():
    order = place_order(request.json)
    firstrun.event("order_placed", {"total": order.total})
    return {"ok": True}
```

The extractors take no argument, because Flask's `request` is already the thing you would have
been handed, and anything you can read in a view you can read in one of these.

It is `before_request` to put the identity in scope, `after_request` to read the status, and
`teardown_request` to write the entry and take the identity back down. Teardown is the half that
matters: it runs for a request whose view raised and `after_request` does not, so a failed request
cannot leave its identity on the next one.

There is a fourth hook on `teardown_appcontext`, and it exists because Flask walks the teardown
functions in reverse with no `try` around the calls: ours is registered first, so it runs last,
and a teardown hook of yours that raises would skip it. The app context pops in a `finally` around
that loop, so the backstop runs anyway and takes the identity down. It writes no entry, because by
then there is no request left to describe, and it says so once through your diagnostics sink,
because a teardown chain that raises means every request served under it goes unmeasured and
nothing else here would tell you.

**The backstop is not a guarantee, and there is no arrangement in Flask that would make it one.**
Registered first, it also runs last in its own list, so a `teardown_appcontext` hook of yours that
raises gets in front of it and the request's identity stays in scope on that worker thread. There
is no list after that one and nothing later to register in. The damage is bounded: the identity a
middleware installs replaces what was in scope rather than layering onto it, so the next request
this extension measures on that thread is stamped with its own and nothing else. What a leak can
still reach is an entry you write yourself between requests, and a request on an ignored path.

Call `init_app` before the app registers its own `after_request` hooks, which an application
factory does naturally. Flask walks those in reverse, so the one registered first runs last and
reads the status after everybody else has finished with the response. `before_request` is
registered last on purpose: a hook of ours is live on an app only when the teardown that undoes it
registered on that same app.

`init_app` can be called for several apps, and what one app's failure costs is that app. An app
that would not take the hooks is reported and left unmeasured; an app that already took them keeps
measuring, and a later `init_app` still registers. `.enabled` turning False says something did not
register, which is a startup check worth failing on. It is not a switch, and nothing reads it once
a request is being served.

### FastAPI, Starlette, and anything else ASGI

```python
import firstrun
from fastapi import FastAPI
from firstrun.integrations.asgi import FirstrunMiddleware

firstrun.configure(
    source_key="fr_9f3a2b1c4d5e6f70",
    host="https://t.example.com",
    track_lifecycle=False,
)

def visitor_id(scope):
    # Your decision, from something that exists before the app runs: a header, a
    # cookie, or whatever an outer middleware put on the scope. In Starlette the
    # outermost middleware is the one added LAST, so add this one first.
    for key, value in scope["headers"]:
        if key == b"x-visitor-id":
            return value.decode("latin-1")
    return None

app = FastAPI()
app.add_middleware(FirstrunMiddleware, device_id=visitor_id, ignore_paths=["/healthz"])

@app.post("/orders/{order_id}")
async def create_order(order_id: int):
    firstrun.event("order_placed", {"order_id": order_id})
    return {"ok": True}
```

That request's entry carries `http.route` of `/orders/{order_id}`, not `/orders/12345`, which is
the difference between a breakdown by route and a list of every order anybody has ever placed.

It is a plain three-argument ASGI callable rather than a Starlette `BaseHTTPMiddleware`, so the
same object works under FastAPI, Starlette, Litestar, Quart, Django's ASGI handler, or an app you
wrote by hand:

```python
app = FirstrunMiddleware(app, device_id=visitor_id)
```

`BaseHTTPMiddleware` buys its friendlier API by running the endpoint in a separate task with a
stream between the two, which changes how context variables, background tasks and streaming
responses behave. A middleware whose whole job is to put a context variable in scope has no
business using the one wrapper that moves the endpoint somewhere else.

## Async

The client is already non-blocking, so there is nothing to await on the hot path: call `log()`
straight from a coroutine. Two helpers move the *bounded waits* off the event loop, and there is
no second transport implementation to keep in step:

```python
client = firstrun.get_client()
await client.aflush(timeout=3)     # flush without stalling the loop
await client.aclose(timeout=3)     # on shutdown

async with firstrun.Firstrun("fr_9f3a2b1c4d5e6f70", "https://t.example.com") as fr:
    fr.event("job_done")
```

`firstrun.context()` works from a coroutine and is the reason it is built on `contextvars`: the
identity is copied into every task created inside the block, and is invisible to whatever else
the loop is serving at that moment.

## fork

`os.fork()` copies the memory but only the calling thread. In the child, the sender thread does
not exist, and the lock it was holding at the instant of the fork is copied in its **locked**
state. A client that ignored this would deadlock on the child's first `log()`.

`firstrun` registers an `os.register_at_fork(after_in_child=...)` handler that, for every live
client:

- replaces the lock and condition variable with fresh ones, so no inherited lock can be stuck;
- **drops the queued events** and lets the parent keep them, because parent and child both
  holding the same pending events would send each of them twice;
- forgets the thread, so the next `log()` starts a new sender in the child;
- resets the failure count, the backoff and the circuit, since they described the parent's
  network, not the child's;
- **keeps the identity exactly as it was**, because a fork does not make a second person, a
  second machine or a second visit, and this client mints no id of any kind to have to reconcile;
- **drops the disk queue** and runs the child in memory, if you had turned persistence on. One
  file cannot have two writers: parent and child would take turns rewriting it with their own idea
  of what is pending, and whichever wrote last would erase the other's entries. A child under
  `delivery="startup"` is moved to `interval` for the same reason, since `startup` over a memory
  queue would leave it silent for its whole life. Both are reported in the `forked` diagnostic.
  A pre-forked server that really wants a durable queue per worker should configure inside
  `post_fork` with its own `queue_path`.

This is registered only where `os.register_at_fork` exists, which is POSIX. Windows has no
`fork` and needs no handler.

The practical consequence for pre-forked servers (Gunicorn, uWSGI, Celery with `prefork`):
configuring before the fork is fine. Events tracked in the master before forking are sent by the
master. Each worker sends its own from a clean queue.

## This client sets no identity at all

`user.id`, `device.id` and `session.id` are three OPTIONAL attributes and this client fills in
none of them. There is no per-install id, no persisted file, and no fallback: a server process is
not a machine and not a person, and an id invented so that every entry had something to be
attributed to would be a number nobody could tell apart from a real one.

An entry carrying none of the three is sent and stored like any other. It counts as an entry and
in no unique, which is the honest answer for a backend that was never told who a request was for.

State what you actually know, per call or through `firstrun.context()`:

```python
firstrun.user("acct_8812")                 # from here on. None signs out
firstrun.device("worker-7")                # a host you pinned this process to
firstrun.session(request.session.session_key)
```

They travel as **one unit**. Stating any of the three on a call means that call's identity comes
from the call, and the surrounding context and the client's own defaults are not consulted for
the other two. Filling them in one `or` chain each is how a background job recorded inside a
request keeps the requester's `user.id` while naming its own device, and a unique coalesces
`user.id` first, so that job would be counted as that customer.

Naming a **different** person also starts a new session, because a sign-in is a boundary. Naming
the same one again does nothing at all.

## Public API

```python
class Firstrun:
    def __init__(self, source_key: str, host: str, *,
                 app_name: str | None = None,
                 service_name: str | None = None,
                 service_version: str | None = None,
                 channel: str | None = None,
                 os_name: str | None = None,          # default: windows/macos/linux
                 arch: str | None = None,             # default: x86_64/aarch64/...
                 locale: str | None = None,           # default: a BCP-47 tag, or None
                 resource: Mapping[str, Any] | None = None,
                 default_attributes: Mapping[str, Any] | None = None,
                 min_severity: int = 0,
                 user_id: str | None = None,
                 device_id: str | None = None,
                 session_id: str | None = None,
                 track_lifecycle: bool | None = None,          # default: desktop/mobile only
                 # when it sends
                 delivery: str = "interval",          # immediate | interval | startup | manual
                 persistence: str = "memory",         # memory | disk
                 flush_on_severity: Any = firstrun.ERROR,      # None turns it off
                 flush_on_exit: bool | None = None,   # default True, False under "startup"
                 coalesce_delay: float = 0.05,        # how long "immediate" gathers a burst
                 persist_interval: float = 5.0,       # disk only
                 queue_path: str | None = None,       # disk only
                 max_disk_entries: int | None = None, # disk only, default max_queued_entries
                 max_disk_bytes: int = 8 * 1024 * 1024,
                 max_queued_entries: int = 10_000,
                 max_batch_size: int = 200,           # clamped to the server's 1..500
                 flush_interval: float = 15.0,
                 timeout: float = 10.0,
                 retry_base_delay: float = 1.0,
                 retry_max_delay: float = 60.0,
                 circuit_breaker_threshold: int = 5,
                 circuit_breaker_cooldown: float = 300.0,
                 diagnostics: Callable[[Diagnostic], None] | None = None,
                 enabled: bool = True,
                 register_atexit: bool | None = None, # older name for flush_on_exit; still wins
                 atexit_timeout: float = 3.0,         # the bound on the exit flush
                 ssl_context: ssl.SSLContext | None = None) -> None

    # The raw escape hatch. Everything below is one call to this one.
    def log(self, name: str, *, body: str | None = None, severity: Any = None,
            attributes: Mapping[str, Any] | None = None,
            device_id: str | None = None, user_id: str | None = None,
            session_id: str | None = None, timestamp: float | None = None,
            trace_id: str | None = None, span_id: str | None = None) -> None

    # Convenience helpers. Conventional entries, not a schema.
    def event(self, name: str, attributes=None, **kwargs) -> None       # at INFO
    def error(self, error: BaseException, attributes=None, **kwargs) -> None  # at ERROR, unwrapped
    def trace(self, body: str, attributes=None, **kwargs) -> None
    def debug(self, body: str, attributes=None, **kwargs) -> None
    def info(self, body: str, attributes=None, **kwargs) -> None
    def warn(self, body: str, attributes=None, **kwargs) -> None
    def error_log(self, body: str, attributes=None, **kwargs) -> None
    def fatal(self, body: str, attributes=None, **kwargs) -> None
    def page(self, path: str, attributes=None, **kwargs) -> None
    def user(self, user_id: str | None, attributes=None) -> None
    def device(self, device_id: str | None) -> None
    def session(self, session_id: str | None) -> None

    def flush(self, timeout: float | None = None) -> bool
    def close(self, timeout: float = 3.0) -> bool
    shutdown = close
    async def aflush(self, timeout: float = 3.0) -> bool
    async def aclose(self, timeout: float = 3.0) -> None
    def stats(self) -> Stats
    # context manager: __enter__/__exit__ and __aenter__/__aexit__

    enabled: bool                 # property
    user_id: str | None           # property
    device_id: str | None         # property
    session_id: str | None        # property
    queue_path: str | None        # None unless persistence == "disk"
    source_key: str;  host: str
    resource: dict[str, Any];  default_attributes: dict[str, Any];  min_severity: int
    delivery: str;  persistence: str        # as resolved, which is not always as passed
    flush_on_severity: int | None;  flush_on_exit: bool

# module level, over one process-wide client
firstrun.configure(source_key, host, **options) -> Firstrun
firstrun.get_client() -> Firstrun | None
firstrun.log(name, **kwargs) -> None
firstrun.event(name, attributes=None, **kwargs) -> None
firstrun.error(err, attributes=None, **kwargs) -> None
firstrun.trace / debug / info / warn / error_log / fatal(body, attributes=None, **kwargs) -> None
firstrun.page(path, attributes=None, **kwargs) -> None
firstrun.user(user_id, attributes=None) -> None
firstrun.device(device_id) -> None
firstrun.session(session_id) -> None
firstrun.flush(timeout=None) -> bool
firstrun.shutdown(timeout=3.0) -> bool
firstrun.stats() -> Stats | None
firstrun.queue_path(app_folder) -> str

# ambient identity for one request. A context variable, so it does not leak
# between concurrent requests and does follow a task the handler awaits.
firstrun.context(user_id=None, *, device_id=None, session_id=None,
                 attributes=None, **attrs)                    # with firstrun.context(...):
firstrun.current_context() -> RequestContext | None
firstrun.set_context(...) -> Token | None       # same arguments, layers like context()
firstrun.replace_context(...) -> Token | None   # same arguments, REPLACES: for a front door
firstrun.reset_context(token) -> None           # accepts None

class RequestContext:            # frozen
    device_id: str | None
    user_id: str | None
    session_id: str | None
    attributes: Mapping[str, Any]

# HTTP middleware. The device_id extractor is required in all three, and none
# of these modules imports its framework at the top.
from firstrun.integrations.django import FirstrunMiddleware, firstrun_middleware
FirstrunMiddleware(get_response, **config)      # config from settings when named in MIDDLEWARE
firstrun_middleware(device_id=None, *, user_id=None, ignore_paths=None,
                    ignore=None, client=None)   # -> the factory MIDDLEWARE wants

from firstrun.integrations.flask import FirstrunExtension
FirstrunExtension(app=None, device_id=None, *, user_id=None, ignore_paths=None,
                  ignore=None, client=None)     # extractors take no argument
    .init_app(app) -> None
    .enabled: bool

from firstrun.integrations.asgi import FirstrunMiddleware
FirstrunMiddleware(app, device_id=None, *, user_id=None, ignore_paths=None,
                   ignore=None, client=None)    # extractors take the ASGI scope

class Stats(NamedTuple):
    queued: int
    accepted: int
    dropped_from_overflow: int
    dropped_from_rejection: int
    refused: int
    circuit_open: bool
    consecutive_failures: int

class Diagnostic(NamedTuple):
    kind: str      # batch_sent | batch_retrying | batch_rejected | queue_overflow
                   # event_refused | circuit_opened | circuit_closed | internal_error | forked
                   # config_coerced | queue_restored | queue_persisted
    message: str
    event_count: int = 0
    error: BaseException | None = None

# delivery and persistence, as constants
firstrun.IMMEDIATE, INTERVAL, STARTUP, MANUAL, DELIVERY_MODES
firstrun.MEMORY, DISK, PERSISTENCE_MODES

# helpers
firstrun.is_log_name(name) -> bool
firstrun.severity_number(text) -> int | None      # "warn" -> 13, "ERROR2" -> 18
firstrun.severity_text(number) -> str             # 9 -> "INFO", 10 -> "INFO2"
firstrun.SOURCE_KEY_RE, LOG_NAME_RE, LOG_NAME_MAX

# the severity ladder
firstrun.TRACE, DEBUG, INFO, WARN, ERROR, FATAL      # 1, 5, 9, 13, 17, 21

# conventional entry names, suggestions rather than an allowlist:
firstrun.PAGE_VIEW, SESSION_START, APP_INSTALL, APP_LAUNCH, IDENTIFY,
         EXCEPTION, HTTP_REQUEST, MEASUREMENT, LOG

# conventional attribute keys, same status:
firstrun.ATTR_BODY, ATTR_EXCEPTION_TYPE, ATTR_EXCEPTION_MESSAGE,
         ATTR_EXCEPTION_STACKTRACE, ATTR_SESSION_ID, ATTR_USER_ID,
         ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_URL_PATH,
         ATTR_HTTP_ROUTE, ATTR_HTTP_REQUEST_METHOD,
         ATTR_HTTP_RESPONSE_STATUS_CODE, ATTR_CHANNEL,
         ATTR_DURATION_MS, ATTR_VALUE, ATTR_METRIC, ATTR_UNIT
```

The package ships `py.typed`, so mypy and pyright see the annotations.

## The log entry model

**Everything this library sends is a log entry.** An error is a log entry. A product event is a
log entry. A measurement is a log entry. There is no event type, no error type and no metric
type, and there is no second table or second pipeline behind any of them.

`log()` is the whole API. `event()`, `error()` and the level helpers are **convenience helpers
that build a conventional entry. They are examples of a good shape, not a schema.** Nothing they
produce is privileged: write the same entry yourself with `log()` and it is stored, indexed and
queried identically.

Meaning is assigned by convention when an entry is written and by query when it is read, never
by a closed set of types in the backend:

- An **exception** is an entry named `exception`, at severity `ERROR`, carrying
  `exception.type`, `exception.message` and `exception.stacktrace`. `error()` unwraps a Python
  exception into exactly that, including the `__cause__` chain, so you never write it by hand.
- A **measurement** is an entry carrying `firstrun.metric` and `firstrun.value`.
- A **product event** is an entry with a name and whatever attributes you thought worth keeping.

Names must match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`; an invalid name is dropped and counted in
`stats().refused` rather than raising. `:` and `>` are excluded deliberately, because the
dashboard's internal keys are delimited with them. There is no allowlist: `log("page_view")` and
`log("exported_csv")` are the same kind of thing to everything downstream.

**Severity** is the OpenTelemetry ladder, 1..24 in six bands of four. Pass a number, a name
(`"warn"`, `"ERROR2"`, `"critical"`), or a `logging` level; `None` means you had nothing to say
and is left off the wire. An entry with no severity is honestly unclassified, and one silently
filed as INFO is a lie a filter will act on.

**Attributes** keep their type. A duration is a number and stays one, so a query can average it
without casting every row out of text. Strings, numbers, booleans, `None`, lists and nested
dicts up to four levels all survive; a `datetime` becomes ISO-8601, a `UUID` or `Decimal`
becomes its text, and anything unserialisable is dropped rather than costing the batch its
existence. The mapping is copied at call time, so mutating yours afterwards cannot rewrite an
entry already recorded.

Only four things are columns: `project_id`, `time`, `severity` and `name`.
Everything else, including `body`, `session.id`, `user.id`, `os.type` and `service.version`,
lives in attributes and is queried from there. A closed set of columns is a closed set of
questions, and which question you need is the one thing nobody can know in advance.

Identity is two fields and no inference:

- `device_id` is anonymous, per install or per request, required on every entry.
- `user.id` is only ever the string you passed to `user()` or to `log(user_id=...)`. We
  never invent, derive, look up or merge one, and this surface is never linked to your website's
  visitors. If you want the same person on both, call `user` with the same id on both. That
  is your data and your decision.

`time` is stamped when you call `log()`, not when the batch is sent. An entry that happened on
Friday and uploaded on Monday is a Friday entry, and the server treats it that way. Pass
`timestamp=` for something you are recording after the fact. Entry ids are generated on the
client so a request that timed out can be retried and deduped rather than double-counted.

## What goes on the wire

One `POST {host}/v1/e` per batch, `Content-Type: application/json`:

```json
{
  "k": "fr_9f3a2b1c4d5e6f70",
  "d": "0e9f…",
  "r": {
    "service.version": "2.4.1",
    "firstrun.channel": "stable",
    "os.type": "linux",
    "host.arch": "x86_64",
    "browser.language": "en-GB"
  },
  "e": [
    {
      "i": "…",
      "t": 1756400000000,
      "n": "order_placed",
      "s": 9,
      "a": { "total": 41.20, "currency": "GBP", "user.id": "acct_8812", "session.id": "…" }
    }
  ]
}
```

The keys are one letter because this is the same body the browser tag posts from `sendBeacon` on
a page being unloaded, where bytes are the constraint: `k` is the source key, `r` the resource
and `e` the entries. There is no top-level id field: identity is three optional attributes and
they travel inside `r`. One shape for every client rather than a compact
browser dialect beside a verbose SDK one.

`r` is the **resource**: what is true of the whole process rather than of one entry. It sits once
per body because it does not change between two entries in the same request, and the edge merges
it under each entry's own attributes, so an entry that sets the same key wins.

`r` sits on the batch, not the entry, so entries with different resources are grouped into
separate batches automatically. That is what makes passing them per call safe. `user.id` and
`session.id` are per-entry attributes and never split a batch.

No cookies, no auth header, and nothing identifying beyond a `firstrun-python` user agent.

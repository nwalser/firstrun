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
    source_key="fr_server_9f3a2b1c4d5e6f70",
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
    source_key="fr_server_9f3a2b1c4d5e6f70",
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
    source_key="fr_server_9f3a2b1c4d5e6f70",
    host="https://t.example.com",
    delivery="startup",         # coerces persistence to disk on its own
    queue_path="/var/lib/myapp/firstrun-queue.jsonl",
)
```

## Django

```python
# settings.py
import firstrun

firstrun.configure(
    source_key="fr_server_9f3a2b1c4d5e6f70",
    host="https://t.example.com",
    persist_distinct_id=False,   # on a server the id belongs to the request, not the box
    track_lifecycle=False,
)
```

```python
# views.py
import firstrun

def checkout(request):
    order = place_order(request)

    # Pass the identity per call. Use whatever you already have: a session key, a
    # cookie, an account id. We never invent one and never derive one.
    firstrun.event(
        "order_placed",
        {"currency": order.currency, "total": order.total},
        distinct_id=request.session.session_key or "anon",
        user_id=str(request.user.pk) if request.user.is_authenticated else None,
    )
    return redirect("thanks")
```

Under Gunicorn or uWSGI with pre-forked workers, `configure()` in `settings.py` runs in the
master and each worker inherits a client that repairs itself in the child (see **fork** below).
Configuring inside `post_fork` works too and is marginally tidier.

## Flask

```python
import firstrun
from flask import Flask, request, g

app = Flask(__name__)
firstrun.configure(
    source_key="fr_server_9f3a2b1c4d5e6f70",
    host="https://t.example.com",
    persist_distinct_id=False,
    track_lifecycle=False,
)

@app.post("/orders")
def create_order():
    order = place_order(request.json)
    firstrun.event(
        "order_placed",
        {"total": order.total},
        distinct_id=request.cookies.get("visitor", "anon"),
        user_id=g.get("user_id"),
    )
    return {"ok": True}
```

## Async

The client is already non-blocking, so there is nothing to await on the hot path: call `log()`
straight from a coroutine. Two helpers move the *bounded waits* off the event loop, and there is
no second transport implementation to keep in step:

```python
client = firstrun.get_client()
await client.aflush(timeout=3)     # flush without stalling the loop
await client.aclose(timeout=3)     # on shutdown

async with firstrun.Firstrun("fr_server_…", "https://t.example.com") as fr:
    fr.event("job_done")
```

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
- starts a new `session_id`, because the child is a different run of the program;
- **keeps the anonymous id**, because it describes the installation and a fork does not make a
  second installation;
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

## Where the anonymous id is stored

`distinct_id` is anonymous, generated on this machine, and scoped to this surface. It is never
sent to you by the server, never derived from anything, and never joined to a browser visitor or
to another app. Exact paths:

| OS | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\firstrun\{app}\distinct_id`  (e.g. `C:\Users\you\AppData\Local\firstrun\etl\distinct_id`) |
| macOS | `~/Library/Application Support/firstrun/{app}/distinct_id` |
| Linux / other Unix | `$XDG_DATA_HOME/firstrun/{app}/distinct_id`, or `~/.local/share/firstrun/{app}/distinct_id` when `XDG_DATA_HOME` is unset |

`{app}` is `app_name` lowercased and slugged, or the source key when `app_name` is not set. Set
`app_name` so the id survives a source key rotation. Read the resolved path at runtime from
`client.distinct_id_path`, or compute one with `firstrun.distinct_id_path("etl")`.

The file is written temp-then-`os.replace`, which is atomic on both POSIX and Windows, so a
crash mid-write leaves either no file or a complete one. If the write fails (read-only
filesystem, no `HOME`, a container), the client uses a per-process id and reports a diagnostic.
It never raises.

**On a server, pass `persist_distinct_id=False`** and supply `distinct_id` per call. A server's
anonymous id is a property of the request, not of the container.

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
                 distinct_id: str | None = None,
                 persist_distinct_id: bool = True,
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
            distinct_id: str | None = None, user_id: str | None = None,
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
    def identify(self, user_id: str | None, attributes=None) -> None
    def reset(self) -> None
    def new_session(self) -> str

    def flush(self, timeout: float | None = None) -> bool
    def close(self, timeout: float = 3.0) -> bool
    shutdown = close
    async def aflush(self, timeout: float = 3.0) -> bool
    async def aclose(self, timeout: float = 3.0) -> None
    def stats(self) -> Stats
    # context manager: __enter__/__exit__ and __aenter__/__aexit__

    enabled: bool                 # property
    distinct_id: str              # property
    user_id: str | None           # property
    session_id: str               # property
    surface: str                  # "web" | "desktop" | "mobile" | "server" | "other"
    is_first_run: bool
    distinct_id_path: str | None
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
firstrun.identify(user_id, attributes=None) -> None
firstrun.reset() -> None
firstrun.flush(timeout=None) -> bool
firstrun.shutdown(timeout=3.0) -> bool
firstrun.stats() -> Stats | None
firstrun.distinct_id_path(app_folder) -> str
firstrun.queue_path(app_folder) -> str

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
firstrun.surface_from_source_key(key) -> str | None
firstrun.SURFACES, SOURCE_KEY_RE, LOG_NAME_RE, LOG_NAME_MAX

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

Only five things are columns: `project_id`, `time`, `distinct_id`, `severity` and `name`.
Everything else, including `body`, `session.id`, `user.id`, `os.type` and `service.version`,
lives in attributes and is queried from there. A closed set of columns is a closed set of
questions, and which question you need is the one thing nobody can know in advance.

Identity is two fields and no inference:

- `distinct_id` is anonymous, per install or per request, required on every entry.
- `user.id` is only ever the string you passed to `identify()` or to `log(user_id=...)`. We
  never invent, derive, look up or merge one, and this surface is never linked to your website's
  visitors. If you want the same person on both, call `identify` with the same id on both. That
  is your data and your decision.

`time` is stamped when you call `log()`, not when the batch is sent. An entry that happened on
Friday and uploaded on Monday is a Friday entry, and the server treats it that way. Pass
`timestamp=` for something you are recording after the fact. Entry ids are generated on the
client so a request that timed out can be retried and deduped rather than double-counted.

## What goes on the wire

One `POST {host}/v1/e` per batch, `Content-Type: application/json`:

```json
{
  "k": "fr_server_9f3a2b1c4d5e6f70",
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
a page being unloaded, where bytes are the constraint: `k` is the source key, `d` the distinct
id, `r` the resource and `e` the entries. One shape for every client rather than a compact
browser dialect beside a verbose SDK one.

`r` is the **resource**: what is true of the whole process rather than of one entry. It sits once
per body because it does not change between two entries in the same request, and the edge merges
it under each entry's own attributes, so an entry that sets the same key wins.

`d` sits on the batch, not the entry, so entries with different distinct ids are grouped into
separate batches automatically. That is what makes passing them per call safe. `user.id` and
`session.id` are per-entry attributes and never split a batch.

No cookies, no auth header, and nothing identifying beyond a `firstrun-python` user agent.

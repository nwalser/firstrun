# firstrun-sdk

Analytics for a Tauri desktop app. An anonymous per-install id, a bounded log
queue, and one background thread that ships batches to `POST /v1/e`.

By default the queue is **in memory** and goes out as one burst when your app
closes, so nothing of yours is left on the user's machine between runs. Anything
at or above `ERROR` does not wait for that: see [When it sends](#when-it-sends),
which also states plainly what that default costs you on a hard crash.

## One shape for everything

firstrun stores **one thing: a log entry.** An error is a log entry. A product
event is a log entry. A frame-time sample is a log entry. The model is
[OpenTelemetry's log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/):
a timestamp, an observed timestamp, a severity number on the 1..24 ladder, a
body, and an attribute map. Meaning is assigned by **convention when you write**
and by **query when you read**, never by a closed set of types in the backend.

So this crate has one recording call, `log`, and everything else builds one:

```rust
use firstrun_sdk::LogEntry;
use firstrun_sdk::wire::SEVERITY_DEBUG;

analytics.log(
    LogEntry::new("render.frame")
        .severity(SEVERITY_DEBUG)
        .attr("firstrun.metric", "frame_ms")
        .attr("firstrun.value", 16.4)
        .attr("layers", 12),
);
```

`event`, `error`, `info`, `warn` and the rest are **convenience helpers that
build a conventional entry. They are examples of a good shape, not a schema.**
Nothing they produce is privileged, and nothing you send without them is second
class. If a helper does not say what you mean, build the entry yourself.

## Why you can trust it in your app

**If firstrun is unreachable, slow, or returning errors, your application is
unaffected.** That outranks every feature here, so this is exactly how it is
kept:

- Every recording call puts a message on a channel and returns. No I/O, no lock
  a UI thread contends on, and nothing that can panic into your code.
- `Analytics::start` returns an `Analytics`, not a `Result`. A missing source key
  or a thread that will not spawn give you a client that accepts every call and
  sends nothing. A platform with nowhere to write falls back to the memory queue
  and says so. Your startup path never handles an analytics failure. Check
  `is_enabled()` in a test if you want it to be loud.
- The queue is bounded at 5,000 entries and 2 MB, whichever it is kept in. Past
  either, the **oldest** entries are dropped and counted in
  `stats().dropped_overflow`. A month offline cannot fill somebody's disk, and a
  session nobody ever closes cannot grow your heap.
- Attributes are bounded on this side too (64 keys, 4 levels, 4096-character
  strings), so one oversized value costs itself rather than costing the whole
  batch its existence to a rejection at the edge.
- Sending is bounded: a 5s connect and 10s request timeout, capped exponential
  backoff with jitter, and a circuit breaker that stops dialling after five
  consecutive failures and stays shut for five minutes. No retry storm, and no
  thundering herd when a host comes back.
- A `4xx` is dropped, not retried. It would otherwise wedge every later entry
  behind it. 408, 429 and 5xx are retried, and `Retry-After` is honoured.
- **Nothing is written to your stdout or stderr.** The only output is the
  `on_diagnostic` hook you opt into, and a panic inside your hook is caught.
- One sender thread. Dropping the value flushes and stops it, bounded by
  `shutdown_timeout` (2s), so shutdown cannot hang and no thread outlives it.
- No schedule dials on a clock while the breaker is open or a backoff is
  pending. The delivery policy never overrides any of the above.

The trade is explicit: when we cannot send, we lose entries. Losing analytics is
always better than affecting your software.

## Install

```toml
[dependencies]
firstrun-sdk = { path = "../../sdk/tauri" }
```

## Use

```rust
use firstrun_sdk::{Analytics, Config};
use std::time::Duration;

let analytics = Analytics::start(Config {
    source_key: "fr_9f3a2b1c4d5e6f70".into(),
    host: "https://t.example.com".into(),
    app_name: "Themia".into(),
    service_version: Some(env!("CARGO_PKG_VERSION").into()),
    channel: Some("stable".into()),
    ..Config::default()
});

tauri::Builder::default().manage(analytics);
```

Hold the value for the life of the app: Tauri's managed state is the natural
place. `app_install` on the run that creates the anonymous id and `app_launch`
on every run are queued for you. Nothing else is ever sent for you.

```rust
// Something worth counting.
analytics.event("exported_project", &[("format", "pdf"), ("pages", "12")]);

// A line, at a severity.
analytics.warn("the sample cache was rebuilt from scratch", &[]);

// Something threw. This is the helper worth reaching for first.
if let Err(e) = std::fs::read(&path) {
    analytics.error(&e, &[("path", "project.json")]);
}

analytics.user(Some("acct_8812"));   // your own id, when they sign in
analytics.user(None);                // on sign out

analytics.flush(Duration::from_secs(2)); // optional: dropping the handle already
                                         // flushes, bounded the same way
```

`error` unwraps the error for you: `exception.type` from its type,
`exception.message` from its `Display`, and `exception.stacktrace` from its
`source()` chain. Rust carries no stack on an error value, and the chain is the
closest thing that is actually useful to read. There is no error table and no
error pipeline behind that call: it writes a log entry named `exception` at
severity 17, stored exactly like every other entry.

Any name matching `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$` is legal and nothing is
special-cased: `event("download_clicked")` and `event("exported_csv")` are the
same kind of thing. An invalid name is counted in `stats().refused` rather than
returned or panicked.

`timestamp` is stamped when you make the call, not when the batch is sent, so a
launch that happened on Friday and uploaded on Monday is a Friday launch. Entry
ids are generated here, so a request that timed out is retried and deduplicated
by the server rather than counted twice.

## When it sends

Two settings, and treating them as one is the mistake. `delivery` decides **when
a send is attempted**; `persistence` decides **what is still there after a crash
or a kill**. "Send once at launch" is not a schedule on its own: it is a schedule
that never fires during the run plus a queue that survives to the next one, which
is why they are separate.

```rust
use firstrun_sdk::{Config, DeliveryMode, Persistence};
use firstrun_sdk::wire::SEVERITY_ERROR;

Config {
    delivery: DeliveryMode::Manual,        // default
    persistence: Persistence::Memory,      // default
    flush_on_severity: Some(SEVERITY_ERROR), // default
    flush_on_exit: true,                   // default
    max_batch: 200,                        // clamped to the server's cap of 500
    flush_interval: Duration::from_secs(30),   // DeliveryMode::Interval only
    coalesce_window: Duration::from_millis(10), // DeliveryMode::Immediate only
    ..Config::default()
}
```

| `delivery` | when a send is attempted |
|---|---|
| `Manual` | **default.** `flush()`, and shutdown while `flush_on_exit` is set |
| `Immediate` | as soon as a batch can be formed. Not one request per entry: see below |
| `Interval` | every `flush_interval`, or at `max_batch` entries, whichever is first |
| `Startup` | drains what survived the last run, then never again during this one |

| `persistence` | what survives |
|---|---|
| `Memory` | **default.** Nothing of yours is written to the user's disk, and nothing survives the run |
| `Disk` | the pending queue is written beside the anonymous id and drained at the next start |

`Startup` on a memory queue would send nothing for the life of the app, so it is
never accepted: it is coerced to disk and reported through `on_diagnostic`.
`delivery()` and `persistence()` tell you what is actually in force.

**`Immediate` coalesces.** It means "do not wait for a timer", never "one request
per entry". Every entry recorded while the `coalesce_window` is open joins the
same batch, so a loop calling `event()` a thousand times is five requests at the
default `max_batch`, not a thousand. The window is waited out on the sender
thread, so it costs a caller nothing.

**`max_batch` is clamped to 500**, the server's per-request cap
(`MAX_BATCH_ENTRIES` in `packages/schema/src/log.ts`). Over it, every request
fails validation and the queue never drains, which would present as total
silence. Asking for more is clamped and reported rather than obeyed.

### What the memory default costs you, and the way out

A memory queue flushed at exit is **precisely the configuration in which a crash
loses everything, including the report of the crash.** The process died, there
was no clean exit, and the buffer went with it. The most valuable single entry a
desktop app can send is the one describing why it just stopped.

`flush_on_severity` is the mitigation, and it is why the default is `ERROR`: an
entry at or above that level is sent the moment it is logged rather than at exit,
so it leaves the process while the process still exists. It costs nothing at
rest, because most runs log no errors at all. An entry with no severity is never
urgent: unclassified is not a classification.

**A residual gap remains, and only disk closes it.** A hard crash can kill the
process before an in-flight request completes, and a request that never left is a
request that is gone. `flush_on_severity` narrows the window to the length of one
HTTP request; it does not remove it. If crash coverage matters to you more than
leaving no trace, turn the queue durable:

```rust
Config {
    persistence: Persistence::Disk,
    ..Config::default()
}
```

The queue then lives at `%LOCALAPPDATA%\firstrun\<app>\events.ndjson` beside the
anonymous id, survives a kill, and is replayed at the next launch. It is
append-only NDJSON: a crash can corrupt only the final line, and that line is
skipped on read.

`docs/delivery-policy.md` describes a narrower version of this, where **only**
entries at or above ERROR are persisted and ordinary telemetry stays in memory.
**That split is not implemented here**, and it is the one part of the policy this
crate does not offer: today durability is one choice for the whole queue. Setting
`min_severity: SEVERITY_ERROR` alongside `Persistence::Disk` gets the disk
footprint the policy describes, at the cost of not collecting ordinary events at
all, which is a different trade rather than the same one.

One burst per launch and nothing else, for an app that would rather be silent
while it runs:

```rust
Config {
    delivery: DeliveryMode::Startup,
    persistence: Persistence::Disk,
    flush_on_exit: false,
    ..Config::default()
}
```

## Public API

```rust
impl Analytics {
    pub fn start(config: Config) -> Analytics;          // never fails

    // The raw escape hatch. Everything below builds one of these.
    pub fn log(&self, entry: LogEntry);

    // Convenience helpers. Conventional entries, not a schema.
    pub fn event(&self, name: &str, attributes: &[(&str, &str)]);
    pub fn error<E: std::error::Error + ?Sized>(&self, err: &E, attributes: &[(&str, &str)]);
    pub fn trace(&self, body: &str, attributes: &[(&str, &str)]);
    pub fn debug(&self, body: &str, attributes: &[(&str, &str)]);
    pub fn info(&self, body: &str, attributes: &[(&str, &str)]);
    pub fn warn(&self, body: &str, attributes: &[(&str, &str)]);
    pub fn error_log(&self, body: &str, attributes: &[(&str, &str)]);
    pub fn fatal(&self, body: &str, attributes: &[(&str, &str)]);
    pub fn page(&self, path: &str, attributes: &[(&str, &str)]);
    pub fn user(&self, user_id: Option<&str>);

    pub fn flush(&self, timeout: Duration) -> bool;     // bounded, never required
    pub fn device_id(&self) -> &str;
    pub fn session_id(&self) -> &str;
    pub fn is_enabled(&self) -> bool;
    pub fn delivery(&self) -> DeliveryMode;             // what is actually in force
    pub fn persistence(&self) -> Persistence;
    pub fn stats(&self) -> Stats;
}
```

What each helper actually writes:

| Call | `name` | Severity | Attributes it adds |
|---|---|---|---|
| `event(n, a)` | `n` | 9 (`INFO`) | yours |
| `error(e, a)` | `exception` | 17 (`ERROR`) | `exception.type`, `exception.message`, `exception.stacktrace` |
| `trace` / `debug` / `info` / `warn` / `error_log` / `fatal` | `log` | 1 / 5 / 9 / 13 / 17 / 21 | yours |
| `page(p, a)` | `page_view` | 9 | `url.path` |
| `user(u)` | `identify` | 9 | `user.id`, on this and every later entry |

`error_log` exists because `error` is taken by the helper that unwraps an error
value, which is the one worth the shorter name. Use `error_log` when you have a
sentence and no error.

The string-pair attribute form is what a desktop call site almost always has.
Reach for `LogEntry` when a value is a number, a boolean or a nested object.

`Config` needs `source_key`, `host` and `app_name`. Every other field (the
resource attributes, `min_severity`, the queue limits, the delivery policy, the
timeouts, the backoff, the breaker, `enabled` and `on_diagnostic`) has a default
that is safe in production and is documented on the struct.

## Severity

`SEVERITY_TRACE` (1), `SEVERITY_DEBUG` (5), `SEVERITY_INFO` (9),
`SEVERITY_WARN` (13), `SEVERITY_ERROR` (17), `SEVERITY_FATAL` (21). Each band
owns four numbers, so `SEVERITY_WARN + 1` is a slightly worse warning and still
filters as a warning: a logger with nine levels maps on without losing its
ordering.

`wire::severity_number("warning")` parses the spellings people already have
(`verbose`, `notice`, `warning`, `severe`, `critical`, `panic`, `INFO2`) and
returns `None` for anything else. `None` rather than a default, because guessing
is worse than having none: an entry with no severity is honestly unclassified,
and one silently filed as INFO is a lie a filter will act on. `min_severity`
never drops an unclassified entry for the same reason.

The number is what travels; text is derived from it for display.

## Attributes

Anything that is not one of the four promoted columns (`project_id`, `time`,
`device_id`, `severity`, `name`) lives in `attributes` and is queried from
there. That includes the operating system, the app version, the session id and
the user id.

`wire::ATTR_*` holds the conventional spellings (`exception.type`, `url.path`,
`firstrun.duration_ms`, ...). They are suggestions. A key you invent works
identically; what you lose is only that the dashboard's pickers will not suggest
it before you have sent one.

Resource attributes (`service.name`, `service.version`, `os.type`, `host.arch`,
`firstrun.channel`, `browser.language`) describe the installation rather than one
entry, so they sit once per request rather than on every entry.

## Identity

Two fields, and nothing is inferred.

`device_id` is anonymous, generated on this machine, and scoped to this
surface. It is never received from the server, never derived from anything, and
never linked to a website visitor or to another app. The same human on your site
and in your app is two anonymous subjects, and that is the correct answer. If
you want them joined, call `user` with the same id on both.

`user.id` is only ever the string you passed to `user`, and it is stamped
onto an entry by the sender thread using the id that was in force when the entry
was queued: an entry from before somebody signed in is not theirs.
`user(None)` goes back to anonymous and keeps the anonymous id, because it
belongs to the installation rather than to whoever was signed in.

| OS | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\firstrun\<app>\device_id` |
| macOS | `~/Library/Application Support/firstrun/<app>/device_id` |
| Linux | `$XDG_DATA_HOME/firstrun/<app>/device_id`, or `~/.local/share/...` |

Local application data on Windows rather than roaming, on purpose: this id
identifies one installation, so a roaming profile carrying it to a second
machine would report two installs as one and quietly break every per-install
number. The file is written temp-then-rename, so a crash leaves either no file
or a complete one, and a failed write costs the id's continuity rather than
raising anything.

## The queue

One queue with two backings, chosen by `persistence`. Both are bounded at 5,000
entries and 2 MB, dropping the **oldest** past either limit, because what a
dashboard reads is recent behaviour. Both count the same bytes, so switching one
for the other does not quietly change how much is kept.

**In memory** (the default) it is a deque and it dies with the process. Nothing
of your telemetry reaches the user's disk; the anonymous id still does, because
it identifies the installation and has to survive a restart.

**On disk** it is NDJSON, append-only, beside the id.

- A crash can only ever corrupt the last line, and a corrupt line is skipped on
  read. Nothing else in the file is at risk.
- Rewrites go through a temp file and a rename, so a crash leaves either the old
  queue or the new one.
- Entry ids are generated before the write, so a request that timed out is
  retried from disk and deduplicated by the server rather than counted twice.

A batch is the whole peeked run either way. The resource is the only thing
sitting on the body, and it does not change while the process runs, so there is
no grouping pass: the three identity keys vary per entry and ride in that
entry's own attributes.

`cargo test` covers all of the above, including a deliberately half-written final
line, and `tests/delivery.rs` covers the schedules against a real socket: that
`Immediate` turns a thousand calls into five requests, that `Manual` sends
nothing until the app closes, that an ERROR goes out on its own, and that a run
killed with `flush_on_exit: false` is replayed by the next one under `Startup`.

## What goes on the wire

One `POST {host}/v1/e` per batch, `Content-Type: application/json`, body exactly the `LogBatch`
shape from `packages/schema/src/log.ts`:

```json
{
  "k": "fr_9f3a2b1c4d5e6f70",
  "d": "0e9f...",
  "r": {
    "service.name": "Themia",
    "service.version": "2.4.1",
    "firstrun.channel": "stable",
    "os.type": "windows",
    "host.arch": "x86_64"
  },
  "e": [
    {
      "i": "...",
      "t": 1756400000000,
      "n": "exported_project",
      "s": 9,
      "a": {
        "session.id": "...",
        "user.id": "acct_8812",
        "format": "pdf",
        "pages": "12"
      }
    },
    {
      "i": "...",
      "t": 1756400012400,
      "n": "exception",
      "s": 17,
      "a": {
        "body": "could not save the project",
        "exception.type": "themia::project::SaveError",
        "exception.message": "could not save the project",
        "exception.stacktrace": "SaveError: permission denied (os error 13)"
      }
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

`i` is generated here, so a request that times out and is retried is deduplicated by the server
rather than counted twice. `t` is stamped when the thing happens and is authoritative: an entry
queued during an outage and delivered later is still counted at the moment it occurred.

There are five entry fields and no sixth. `body`, `trace_id` and `span_id` are **attributes**,
under the spec's own names, because this product promotes four columns and no more: `project_id`,
`time`, `device_id`, `severity` and `name`. Promoting one of them later is a generated column
over `attributes` rather than a schema break.

No cookies, no auth header, and nothing identifying beyond the user agent.

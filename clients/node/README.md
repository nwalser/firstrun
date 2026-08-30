# @firstrun/node

Server-side firstrun client for Node 18+. TypeScript, ESM and CommonJS, no runtime dependencies.

## One shape for everything

firstrun stores **one thing: a log entry.** An error is a log entry. A product event is a log
entry. A metric sample is a log entry. The model is
[OpenTelemetry's log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/):
a timestamp, an observed timestamp, a severity number on the 1..24 ladder, a body, and an
attribute map. Meaning is assigned by **convention when you write** and by **query when you
read**, never by a closed set of types in the backend.

So this library has exactly one recording call, `log()`, and everything else builds one for you:

```ts
firstrun.log({
  name: "job.finished",
  severity: "info",
  body: "nightly reindex finished",
  attributes: { "firstrun.duration_ms": 41_220, rows: 18_400, dry_run: false },
  distinctId: tenant.id,
});
```

`event`, `error`, `info`, `warn` and the rest are **convenience helpers that build a conventional
entry. They are examples of a good shape, not a schema.** Nothing they produce is privileged and
nothing you send without them is second class. If a helper does not say what you mean, write the
entry yourself with `log()` and it is stored, indexed and queried identically.

## The promise this library makes

**If firstrun is unreachable, slow, or returning errors, your program keeps working perfectly.**

That is the reason to trust it, so here is exactly how it is kept:

- Every recording call puts an entry on an in-memory queue and returns. It performs no I/O, awaits
  nothing, and cannot throw. Not on a network error, not on a bad argument, not on a bug in this
  library.
- The queue is bounded (10,000 entries by default). When it is full the **oldest** entries are
  dropped and counted, so a long outage costs you stale analytics rather than your process's
  memory.
- Every request has a whole-attempt timeout (5s default). Failures back off exponentially with
  full jitter, and after five consecutive failures a **circuit breaker** opens: a server that is
  down stops receiving traffic from you rather than receiving a retry storm. While it is open the
  interval stops rather than ticking into it, so a dead server gets one probe per cooldown and not
  one request per period.
- A `4xx` is not retried. The server understood the body and said no; it will say no again.
- Nothing is ever written to stdout or stderr. The only reporting channel is the optional
  `onDiagnostic` hook, so this library cannot corrupt your program's log output.
- The background timer is unreferenced, so a queued entry can never be the reason your process
  refuses to exit. The flush on exit is time-bounded, and a flush that runs out of time is not
  attempted a second time: entries are worth losing, your shutdown is not worth delaying.
  `flush()` is available on shutdown and is never required.
- A misconfigured client (bad source key, bad host) **disables itself and reports it**. It does
  not throw, because a typo in an environment variable must not stop your service from booting.

The trade is stated plainly: this client is allowed to lose entries. It is not allowed to throw,
block, retry unboundedly, or grow without limit.

## Install

```
npm install @firstrun/node
```

## Use

```ts
import { Firstrun } from "@firstrun/node";

const firstrun = new Firstrun({
  sourceKey: process.env.FIRSTRUN_SOURCE_KEY!,   // fr_server_9f3a...
  host: "https://t.example.com",
  serviceVersion: process.env.GIT_SHA,
});

// distinctId identifies WHO, and you must supply it. See below.
firstrun.event("invoice_generated", { plan: account.plan, lines: invoice.lines.length }, {
  distinctId: account.id,
});
```

### Errors

`error()` unwraps the exception for you. This is the helper worth reaching for first.

```ts
try {
  await renderInvoice(invoice);
} catch (err) {
  // exception.type, exception.message and exception.stacktrace are filled in
  // from the Error itself, with any `cause` chain appended to the stack.
  firstrun.error(err, { invoice: invoice.id }, { distinctId: account.id });
  throw err;
}
```

There is no error table and no error pipeline behind that call. It writes a log entry named
`exception` at severity 17 with `exception.*` attributes, and it is stored exactly like every
other entry. What makes it findable is a query, not a type.

### A service

```ts
import express from "express";
import { Firstrun } from "@firstrun/node";

const firstrun = new Firstrun({
  sourceKey: process.env.FIRSTRUN_SOURCE_KEY!,
  host: process.env.FIRSTRUN_HOST!,
  serviceName: "billing-api",
  serviceVersion: process.env.GIT_SHA,
  onDiagnostic: (d) => log[d.level === "debug" ? "debug" : "warn"]({ firstrun: d }),
});

const app = express();

app.post("/api/export", async (req, res) => {
  const rows = await exportCsv(req.user.id);
  // Not awaited, and there is nothing here to await. The handler is unaffected
  // by anything firstrun does or fails to do.
  firstrun.event("exported_csv", { rows: rows.length }, { distinctId: req.user.id });
  res.json({ ok: true });
});

app.listen(3000);
// Nothing else needed: SIGTERM and beforeExit already flush with a timeout.
```

### A CLI or a one-shot job

A short-lived process should flush before it ends, because there may be no idle moment for the
background timer to fire in.

```ts
#!/usr/bin/env node
import { Firstrun } from "@firstrun/node";
import { randomUUID } from "node:crypto";

const firstrun = new Firstrun({
  sourceKey: process.env.FIRSTRUN_SOURCE_KEY!,
  host: process.env.FIRSTRUN_HOST!,
  // A CLI run genuinely is one subject, so a client-level id is right here.
  // Persist it somewhere per machine if you want runs to count as one user.
  distinctId: process.env.MY_CLI_INSTALL_ID ?? randomUUID(),
});

const started = Date.now();
try {
  await doTheWork();
  firstrun.event("cli_run", { ok: true, "firstrun.duration_ms": Date.now() - started });
} catch (err) {
  firstrun.error(err, { "firstrun.duration_ms": Date.now() - started });
  throw err;
} finally {
  // Bounded, and it never rejects. The worst case is that it returns false.
  await firstrun.close(2000);
}
```

## When entries are sent

Two settings, not one, and conflating them is the mistake this section exists to prevent.

**Schedule** decides when a send is attempted. **Durability** decides what is still there after a
crash or a kill. "Send once at startup" is not a schedule on its own: it is a schedule that never
fires during the run, plus a queue that survives to the next one.

```ts
const firstrun = new Firstrun({
  sourceKey: process.env.FIRSTRUN_SOURCE_KEY!,
  host: process.env.FIRSTRUN_HOST!,
  delivery: {
    mode: "interval",        // immediate | interval | startup | manual
    every: 15_000,
    maxBatch: 250,
    persistence: "memory",   // memory | disk
    flushOnSeverity: "error",
    flushOnExit: true,
  },
});
```

**The defaults are `interval` every 15s over a `memory` queue**, and every one of them is
overridable. The full policy, including what the browser tag and the desktop clients do
differently, is `docs/delivery-policy.md`.

### Schedule

| `mode` | What it does |
|---|---|
| `immediate` | Send as soon as a batch can be formed. **Coalesced per tick, never one request per entry.** |
| `interval` | Every `every` ms, or when `maxBatch` entries are queued, whichever comes first. The default. |
| `startup` | Drain whatever survived the last run, then never again during this run. Needs `disk`. |
| `manual` | Only when you call `flush()`. |

**`immediate` does not mean synchronous, and it does not mean one request per entry.** It means
"do not wait for a timer". Entries produced in the same turn of the event loop coalesce into one
drain: a loop calling `event()` a thousand times produces four requests at the default
`maxBatch`, not a thousand. Nothing about it puts firstrun in your critical path, which is the
rule that outranks the whole policy.

### Durability

`memory` keeps nothing across a crash. `disk` writes the pending queue to a bounded NDJSON file
and drains it on the next start.

**Memory is the default here, and on a server it is usually the right one.** A server process
that crashes is generally restarted by something that will not preserve local state: a new
container, a new pod, a new dyno. Writing telemetry into a container filesystem is a surprise,
and on an ephemeral one it is a surprise that does not even survive to be read back. Turn `disk`
on when the process runs on a machine that stays the same machine, or when `startup` is what you
want.

Entry ids are generated when the entry is recorded, so a queue that is replayed after a crash
deduplicates server-side rather than double counting.

`startup` with `memory` is incoherent: nothing survives the run, so nothing would ever be sent.
It is **coerced to `disk` with a `config` diagnostic** rather than accepted, because a client that
silently sends nothing is the worst of the available behaviours.

### `flushOnSeverity`, and why it is the setting that matters

An entry at or above `flushOnSeverity` (default `ERROR`, 17) is sent at once, whatever the
schedule says.

A crash report that waits five minutes for the next tick is a crash report that usually never
arrives, because by then the process is gone. This costs nothing at rest: most runs log no errors
at all, so nothing is sent off-schedule. It does not become a request storm either, because one
sender runs at a time and it drains the whole queue, so five hundred errors in one tick still
leave as a handful of batches.

Set `flushOnSeverity: false` to switch it off. That is for a test that wants a strictly manual
client, not for production.

### `flushOnExit`

Best-effort and **time-bounded** (`flushTimeoutMs`, 2s), on `beforeExit`, `SIGTERM` and `SIGINT`.
A flush that runs out of time is not retried at the next `beforeExit`: retrying it there is a loop
that keeps a process alive for exactly as long as the server stays slow, which is what the bound
exists to prevent. Defaults to true, except in `startup` mode, whose entire point is one burst per
launch.

### `maxBatch`

Entries per HTTP request. Default 250, and **hard-capped at the server's per-request limit of
500** (`MAX_ENTRIES_PER_BATCH`, read out of the wire contract). Ask for more and you get 500 plus a
`config` diagnostic saying so. This matters more than it looks: the edge rejects an oversized body
whole, so an uncapped `maxBatch` means every request fails, the queue never drains, and the whole
thing presents as total silence.

## How this differs from the browser tag

Three differences, all of them deliberate.

**No consent gating.** The browser tag will not store or send anything before consent, because
there is a person on the other end of a web page who has to be asked. A server process has no end
user present to ask, and your backend's own telemetry is covered by the privacy policy of your own
software. If you put personal data in `attributes`, that is your disclosure to make.

**No automatic entries.** The tag measures page views, SPA navigations, sessions, time on page,
outbound and file clicks, form submits and Core Web Vitals on its own. This client measures
nothing on its own. Every entry exists because you called for it.

**`distinctId` must be supplied by you, per call.** This is the one that matters.

A browser has a persistent per-visitor id in `localStorage`, and a desktop app has a per-install
id on disk. A server has neither. It handles thousands of different people from one process, so
there is nothing for this library to default to that would be correct. Get it wrong and every
entry in your fleet collapses onto a handful of ids, and your unique counts become a count of
your server processes.

So `distinctId` is required, and an entry without one is **dropped and reported** through
`onDiagnostic` rather than sent under an invented id. A loud failure beats a silently wrong
number that nobody can spot from a dashboard.

Set the client-level `distinctId` option only when the process really is the subject: a CLI, a
single-tenant worker, a device agent.

**And one consequence of the wire format.** Entries cost one HTTP request per distinct id and
resource pair per flush, because the wire carries the distinct id and the resource attributes once
per body rather than once per entry. Entries for the same person are grouped into one request.

## API

```ts
new Firstrun(options: FirstrunOptions)

// The raw escape hatch. Everything below builds one of these.
log(entry: LogEntryInput): void

// Convenience helpers. Conventional entries, not a schema.
event(name: string, attributes?: AttributesInput, params?: EntryParams): void
error(err: unknown, attributes?: AttributesInput, params?: EntryParams): void
trace(body: string, attributes?: AttributesInput, params?: EntryParams): void
debug(body: string, attributes?: AttributesInput, params?: EntryParams): void
info(body: string, attributes?: AttributesInput, params?: EntryParams): void
warn(body: string, attributes?: AttributesInput, params?: EntryParams): void
errorLog(body: string, attributes?: AttributesInput, params?: EntryParams): void
fatal(body: string, attributes?: AttributesInput, params?: EntryParams): void
identify(distinctId: string, userId: string, params?: EntryParams): void
page(path?: string, attributes?: AttributesInput, params?: EntryParams): void

flush(timeoutMs?: number): Promise<boolean>   // true if drained; never rejects
close(timeoutMs?: number): Promise<void>      // idempotent; never rejects
stats(): Stats

readonly closed: boolean
enabled: boolean
```

What each helper actually writes:

| Call | `name` | Severity | Attributes it adds |
|---|---|---|---|
| `event(n, a)` | `n` | 9 (`INFO`) | yours |
| `error(err, a)` | `exception` | 17 (`ERROR`) | `exception.type`, `exception.message`, `exception.stacktrace` |
| `trace` / `debug` / `info` / `warn` / `errorLog` / `fatal` | `log` | 1 / 5 / 9 / 13 / 17 / 21 | yours |
| `identify(d, u)` | `identify` | 9 | `user.id` |
| `page(p, a)` | `page_view` | 9 | `url.path` |

`errorLog` exists because `error` is taken by the helper that unwraps a thrown thing, which is the
one worth the shorter name. Use `errorLog` when you have a sentence and no `Error`.

Every `name` is any string matching `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. There is no allowlist:
`event("download_clicked")` and `event("exported_csv")` are treated identically by the whole
system. `:` and `>` are rejected because the server reserves them.

`identify(distinctId, userId)` takes both ids explicitly. There is no remembered "current user",
because in a server process that would be whoever was served last. It writes an `identify` entry
carrying `user.id`; from then on, entries you send with that `userId` count as the same unique.
Nothing is merged retroactively, and identities are never inferred.

### Severity

`severity` takes a number on the 1..24 ladder or a name. Names are case-insensitive and the
spellings people actually have in their loggers all land somewhere sensible: `warning` and `warn`
are both 13, `critical` and `panic` are both 21. `INFO2` through `INFO4` are the spare steps
inside the band, for a logger with more levels than six.

| Band | First number | Also accepted |
|---|---|---|
| `TRACE` | 1 | `verbose`, `finer`, `finest` |
| `DEBUG` | 5 | `fine` |
| `INFO` | 9 | `notice`, `information` |
| `WARN` | 13 | `warning` |
| `ERROR` | 17 | `err`, `severe` |
| `FATAL` | 21 | `critical`, `alert`, `emergency`, `panic` |

The number is what travels; the text is derived from it for display. An entry with **no** severity
is honestly unclassified, and `minSeverity` never drops one: a threshold filters what you
classified, not what you left alone.

### Attributes

Anything that is not one of the five promoted columns (`project_id`, `time`, `distinct_id`,
`severity`, `name`) lives in `attributes` and is queried from there. That includes `os`,
`app_version`, `url`, `session.id` and `user.id`.

Values may be strings, numbers, booleans, null, arrays or nested objects, up to 4 levels deep.
`undefined`, functions and non-finite numbers are dropped on the way in. Dates become ISO-8601
strings. The map is copied, so mutating your object afterwards cannot rewrite an entry that was
already recorded.

The bounds are the edge's own, mirrored here so one oversized attribute costs itself rather than
costing the whole batch: 64 top-level keys, 128-character keys, 4096-character strings, 128 items
per array or nested object.

`ATTR` exports the conventional spellings (`ATTR.EXCEPTION_TYPE`, `ATTR.URL_PATH`,
`ATTR.DURATION_MS`, ...). They are suggestions. A key you invent works identically; what you lose
is only that the pickers in the dashboard will not suggest it before you have sent one.

### Options

| Option | Default | |
|---|---|---|
| `sourceKey` | required | `fr_server_...`. Public by necessity; it identifies and authorises nothing |
| `host` | required | Origin only, e.g. `https://t.example.com` |
| `distinctId`, `userId` | none | Client-level defaults. Leave unset in a multi-tenant server |
| `serviceName`, `serviceVersion`, `channel`, `os`, `arch`, `locale` | none | Resource attributes, overridable per call |
| `resource` | none | Extra resource attributes: anything true of the process |
| `defaultAttributes` | none | Stamped onto every entry. An entry's own attributes win |
| `enabled` | `true` | `false` makes every call a no-op |
| `minSeverity` | `0` | Drop classified entries below this. Never drops unclassified ones |
| `delivery` | see below | When entries are sent, and what survives a crash |
| `maxQueueEntries` | `10000` | Then the oldest are dropped |
| `maxEntriesPerFlush` | `2000` | Entries drained per cycle |
| `maxRequestsPerFlush` | `32` | So one cycle cannot monopolise your event loop |
| `requestTimeoutMs` | `5000` | Whole attempt: connect, send and response |
| `maxRetries` | `5` | Then the batch is abandoned and reported |
| `retryBaseMs` / `retryMaxMs` | `500` / `30000` | Exponential backoff with full jitter |
| `breakerThreshold` | `5` | Consecutive failures that open the breaker |
| `breakerResetMs` | `30000` | Cooldown before one probe request |
| `onDiagnostic` | none | The only reporting channel |
| `fetch`, `now`, `uuid` | globals | Overridable, for tests |

`delivery` is the policy from the section above:

| `delivery.*` | Default | |
|---|---|---|
| `mode` | `"interval"` | `immediate`, `interval`, `startup` or `manual` |
| `every` | `15000` | Interval period. `interval` only |
| `maxBatch` | `250` | Entries per request. Capped at the server's 500 |
| `flushAt` | `maxBatch` | Queue depth that sends without waiting for the timer. `interval` only |
| `coalesceMs` | `0` | How long `immediate` collects before draining. 0 is "end of this turn" |
| `persistence` | `"memory"` | `memory` or `disk` |
| `diskPath` | OS temp dir | Where a `disk` queue lives |
| `maxDiskEntries` | `maxQueueEntries` | Then the oldest persisted entries are dropped |
| `maxDiskBytes` | `8388608` | The durable queue stops growing rather than filling a disk |
| `flushOnSeverity` | `17` (`ERROR`) | Send at once at or above this. `false` switches it off |
| `flushOnExit` | `true` | Except in `startup` mode. Always time-bounded |
| `flushTimeoutMs` | `2000` | Budget for `flush()` and for the exit flush |

`fetch` has no separate connect timeout without pulling in an undici `Agent`, and this package has
no runtime dependencies, so `requestTimeoutMs` aborts the whole attempt instead. That bounds the
same failure. Pass your own `fetch` if you need a dispatcher with finer control.

### Shutdown hooks

With `delivery.flushOnExit` (the default) the library flushes on `beforeExit`, `SIGTERM` and
`SIGINT`, with a `delivery.flushTimeoutMs` budget, once.

The listeners are **installed once per process and shared by every client**, not once per client:
Node warns on stderr at eleven listeners for an event, and this library is not allowed to write
there. They are removed again when the last client closes.

Signals are handled carefully, because adding a `SIGTERM` listener stops Node from terminating on
`SIGTERM` and that would change how your program behaves. If you already have a handler, we flush
alongside it and touch nothing: exiting stays your decision. If you do not, we flush, remove
ourselves, and re-raise the signal, which restores exactly the exit you would have had.

### Diagnostics

```ts
new Firstrun({
  /* ... */
  onDiagnostic: (d) => {
    // d.code: rejected | dropped | sent | retry | abandoned
    //       | breaker_open | breaker_close | flush_timeout
    //       | config | persistence | internal
    // d.level: debug | warn | error
    myLogger[d.level === "debug" ? "debug" : "warn"]({ firstrun: d });
  },
});
```

A `rejected` at error level naming `distinctId` is the one worth alerting on: it means entries are
being thrown away at the call site. `dropped` means the queue overflowed. `breaker_open` means we
have stopped trying for a while. `config` is worth reading once at boot: every one of them is a
setting that was corrected rather than obeyed, which means it does not do what it says.

Your hook throwing is caught and ignored. There is nowhere left to report it that this library is
allowed to write to.

## Build

```
npm install
npm run build       # dist/esm and dist/cjs, plus .d.ts
npm run typecheck
```

## What goes on the wire

One `POST` per identity-and-resource group to `{host}/v1/e`, `Content-Type: application/json`,
body exactly the `LogBatch` shape from `packages/schema/src/log.ts`:

```json
{
  "k": "fr_server_0123456789abcdef",
  "d": "account_9f3a",
  "r": {
    "service.name": "billing-api",
    "service.version": "2.1.0"
  },
  "e": [
    {
      "i": "0f8c...",
      "t": 1756400000000,
      "n": "invoice_generated",
      "s": 9,
      "a": { "user.id": "u_412", "plan": "pro", "lines": 14 }
    },
    {
      "i": "51ab...",
      "t": 1756400001120,
      "n": "exception",
      "s": 17,
      "a": {
        "body": "ECONNRESET writing the PDF",
        "exception.type": "Error",
        "exception.message": "ECONNRESET writing the PDF",
        "exception.stacktrace": "Error: ECONNRESET...\n    at render (invoice.ts:88)"
      }
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

`i` is generated here, so a request that times out and is retried is deduplicated by the server
rather than counted twice. `t` is stamped when the thing happens and is authoritative: an entry
queued during an outage and delivered later is still counted at the moment it occurred.

There are five entry fields and no sixth. `body`, `trace_id` and `span_id` are **attributes**,
under the spec's own names, because this product promotes five columns and no more: `project_id`,
`time`, `distinct_id`, `severity` and `name`. Promoting one of them later is a generated column
over `attributes` rather than a schema break.

`traceId` and `spanId` are accepted by `log()` and travel as the `trace_id` and `span_id`
attributes, but nothing in the product reads them yet.

# Firstrun for .NET

One structured log for everything you ship, for [firstrun](../../README.md). Targets `net8.0`
and `netstandard2.0`, so one package covers WPF, WinForms, Avalonia, MAUI, console tools, worker
services and ASP.NET.

Everything this library sends is a **log entry**. An error is a log entry, a product event is a
log entry, a measurement is a log entry. `Log` is the whole API; `Event`, `Error` and the level
helpers build one for you with the conventional fields filled in. **They are examples of a good
shape, not a schema.** Nothing they produce is privileged; write the same entry yourself with
`Log` and it is stored, indexed and queried identically.

```
dotnet add package Firstrun
dotnet add package Firstrun.Extensions.Hosting   # ASP.NET / IHost only
```

## Why you can trust it in your app

This is the whole design, and it outranks every feature in the library.

**If firstrun is unreachable, slow, or returning errors, your application is unaffected.**

- `Track`, `Page` and `Identify` append to an in-memory queue and return. They never touch a
  socket on your thread, and they are safe to call from a UI thread, a request handler, or a
  tight loop.
- **Nothing throws into your code.** Not a bad event name, not a dead host, not a full disk,
  not a disposed client, not a null argument. The constructor does not throw either: a missing
  source key disables the client and reports a diagnostic. Check `IsEnabled` if you want a test
  to fail loudly instead.
- **The queue is bounded** at `MaxQueuedEntries` (default 10,000). Past that the *oldest* entries
  are dropped and counted in `Stats.DroppedFromOverflow`. An app that has been offline for a
  week cannot grow your heap.
- **Sending is bounded too.** A 10s request timeout (5s to connect on net8.0), capped
  exponential backoff with jitter, and a circuit breaker that stops dialling entirely after 5
  consecutive failures and stays shut for 5 minutes. There is no retry storm and no thundering
  herd when a host comes back.
- **A 4xx is dropped, not retried.** A malformed batch or a dead source key would otherwise
  wedge every later event behind it. 408, 429 and 5xx are retried; `Retry-After` is honoured.
- **Nothing is written to your stdout, stderr, or logging framework.** The only output is the
  `Diagnostics` callback, which you opt into. Exceptions from your callback are swallowed.
- **Shutdown cannot hang you.** The worker is a background thread. `Flush(timeout)` is bounded
  and optional, `Dispose` gives the queue one final pass bounded by `ExitFlushTimeout` (2s), and
  a process that exits without disposing still exits: the client hooks `ProcessExit` and takes
  the same bounded pass there.

The trade is explicit: when we cannot send, we lose analytics. Losing analytics is always
better than affecting your software.

### Dependencies

None, on any target framework. JSON is written by a small internal writer rather than
`System.Text.Json`, because on `netstandard2.0` that is a NuGet package, and a telemetry library
has no business putting a serializer version into your dependency graph where it can conflict
with the one you already pinned. `Firstrun.Extensions.Hosting` depends only on the
`Microsoft.Extensions.*` abstractions an ASP.NET app already has.

## Desktop (WPF, WinForms, Avalonia, MAUI)

```csharp
using Firstrun;

public partial class App : Application
{
    public static FirstrunClient Analytics { get; private set; } = null!;

    protected override void OnStartup(StartupEventArgs e)
    {
        Analytics = new FirstrunClient(new FirstrunOptions
        {
            SourceKey = "fr_desktop_9f3a2b1c4d5e6f70",
            Host      = "https://t.example.com",
            AppName   = "Themia",          // names the folder the anonymous id lives in
            Channel   = "stable",
        });
        // app_install (first run only) and app_launch have already been queued.
        // On a desktop source key nothing goes out until the app closes, except
        // anything at ERROR or above. See "When it sends" for how to change that.

        base.OnStartup(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        // Optional: the client hooks process exit and flushes there anyway. Doing it
        // here just does it sooner, at a moment you chose, and it is bounded either way.
        Analytics.Dispose();
        base.OnExit(e);
    }
}

// Anywhere, on any thread:
App.Analytics.Event("exported_project", new FirstrunAttributes()
    .Set("format", "pdf")
    .Set("pages", 12));

// An exception, unwrapped for you into exception.type / .message / .stacktrace.
try { Export(); }
catch (Exception ex) { App.Analytics.Error(ex); }

// A line, when you have a sentence rather than an occurrence of a thing.
App.Analytics.Info("render pipeline warmed");

App.Analytics.Page("/settings/appearance");
App.Analytics.Identify("acct_8812");   // your own user id, when they sign in
App.Analytics.Reset();                 // on sign out
```

`ServiceVersion` defaults to the entry assembly's informational version, `Os`, `Arch` and
`Locale` to the running machine. Set any of them yourself to override.

## ASP.NET Core

```csharp
using Firstrun;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddFirstrunServer(
    sourceKey: "fr_server_9f3a2b1c4d5e6f70",
    host: "https://t.example.com");

var app = builder.Build();

app.MapPost("/orders", (FirstrunClient analytics, HttpContext http, Order order) =>
{
    // On a server the anonymous id belongs to the request, not to the machine, so
    // pass it per call. Use whatever you already have: a cookie, a session id, an
    // account id. We never invent one and never derive one.
    analytics.Event("order_placed",
        new FirstrunAttributes().Set("currency", order.Currency).Set("total", order.Total),
        distinctId: http.Request.Cookies["visitor"] ?? http.Connection.Id,
        userId: http.User.Identity?.Name);

    return Results.Ok();
});

app.Run();
```

`AddFirstrunServer` registers the client as a **singleton** (one thread, one `HttpClient`, one
queue) plus an `IHostedService` that flushes inside the graceful shutdown window, bounded by
`ExitFlushTimeout`. It sets
`PersistDistinctId = false` and `TrackLifecycleEvents = false`, which is what a server wants.
`AddFirstrun(options => ...)` is the general form. Neither can fail your startup: the hosted
service does no work in `StartAsync`.

If you have not supplied your own `Diagnostics` callback, the DI extension wires one to
`ILogger` at `Trace` (and `Debug` for internal errors). Analytics does not belong in a
production error log.

## When it sends

Two settings, not one. **`Mode`** decides when a send is attempted. **`Persistence`** decides what
is still there after a crash. "Send once at startup" is both of them together (a schedule that
never fires during the run, plus a queue that survives it), which is why folding them into a single
setting would make the thing most people actually want inexpressible.

| `Mode` | |
|---|---|
| `Immediate` | Send as soon as a batch can be formed. Does not wait for a timer. |
| `Interval` | Every `FlushInterval`, or as soon as `MaxBatchSize` entries are waiting. |
| `Startup` | Drain what survived the last run, then nothing else during this run. Needs `Disk`. |
| `Manual` | Only when you call `Flush()`. |

| `Persistence` | |
|---|---|
| `Memory` | Nothing is written to the user's disk. Nothing survives the process. |
| `Disk` | The pending queue is mirrored to a file and drained on the next start. |

The defaults come from the surface in your source key, and every one of them is overridable:

| surface | `Mode` | `Persistence` | `FlushOnSeverity` |
|---|---|---|---|
| desktop, mobile | `Manual`, plus the flush on exit | `Memory` | `Error` |
| server, web, other | `Interval` at 15s | `Memory` | `Error` |

Read what you got at runtime from `client.DeliveryMode`, `client.Persistence` and
`client.QueuePath` rather than assuming.

**`Immediate` is not one request per entry.** It means "do not wait for a timer". Entries produced
in the same tick coalesce into one batch, because the sender takes everything that is queued by the
time it wakes up. A loop of 1,000 `Event()` calls at the default batch size of 200 produces 5
requests, not 1,000, and the loop itself costs a few microseconds per call because appending to a
queue is all any of them does.

**`Startup` with `Memory` would send nothing, ever**, so it is not accepted quietly: the client
coerces the persistence to `Disk` and reports a `ConfigAdjusted` diagnostic saying so. Sending
nothing silently is the worst of the three answers available.

**`FlushOnSeverity` (default `Error`) outranks the schedule.** An entry at or above it is sent the
moment it is logged, whatever `Mode` says. An entry with no severity never triggers it, because
unclassified is not the same as urgent.

**`FlushOnExit` (default true) is best effort and time bounded** by `ExitFlushTimeout` (default 2
seconds, capped at 10). It runs from `Dispose`, from `DisposeAsync`, from the hosted service's
`StopAsync` on ASP.NET, and from an `AppDomain.ProcessExit` handler the client installs so a
desktop app that closes without any teardown still sends its run. A slow network cannot hold your
process open, and a shutdown that runs both paths only flushes once.

**`MaxBatchSize` is clamped to the server's per-request cap of 500** (`Wire.MaxBatchEntries`, which
is `MAX_BATCH_ENTRIES` in the wire schema), with a `ConfigAdjusted` diagnostic if yours was higher.
That is not politeness. A batch over the cap is rejected before anything is stored, so every
request fails, the queue never drains, and the whole library presents as silence.

None of this overrides the reliability rules, which it cannot: a timer never fires into an open
circuit breaker or a pending backoff. The schedule waits, the backoff wins, and a queue that is
dropping says so through `Stats.DroppedFromOverflow` and a `QueueOverflow` diagnostic.

### The desktop default, and what it costs

A desktop app gets a memory queue flushed at exit. Nothing is written to the user's disk, and a
run's telemetry leaves as one burst when the application closes.

**That is precisely the configuration in which a crash loses everything, including the report of
the crash.** There was no clean exit, nothing flushed, and the buffer went with the process. The
most valuable single entry a desktop app can send is the one describing why it just stopped, and
this default is the one least able to send it. That is a real cost and it is worth knowing about
before you accept the default rather than after.

`FlushOnSeverity` defaults to `Error` as the mitigation: an error leaves at the moment it is
logged, while the process still exists, instead of waiting for an exit that may never come. It
costs nothing at rest, because most runs log no errors at all.

**A residual gap remains, and only disk persistence closes it.** A hard crash can kill the process
before an in-flight request completes, and a request that never left is a request that is gone.
Sending from an unhandled exception handler is a race with the process's own death, so bound it and
accept that you will sometimes lose it:

```csharp
AppDomain.CurrentDomain.UnhandledException += (sender, e) =>
{
    Analytics.Error(e.ExceptionObject as Exception ?? new Exception("unhandled"));
    Analytics.Flush(TimeSpan.FromSeconds(2));   // bounded, and still never throws
};
```

If crash coverage matters more to you than leaving no trace, turn the durable queue on. The narrow
version writes only the entries worth crashing over and keeps ordinary telemetry in memory, so a
normal run still touches nothing but the anonymous id:

```csharp
Persistence         = FirstrunPersistence.Disk,
PersistFromSeverity = FirstrunSeverity.Error,
```

The queue file sits beside the anonymous id (`%LOCALAPPDATA%\firstrun\{app}\queue.ndjson` on
Windows; see the table below for the other platforms), or wherever you point `QueuePath`. It is one
line per entry, appended by the sender thread and never by yours, bounded at `MaxQueuedEntries` and
`MaxPersistedBytes` and dropping the oldest past either. A line half written when the process died
is discarded on the next read, and the entries the server accepts are removed from it.

One consequence of `Manual` worth stating: a long session that records more than `MaxQueuedEntries`
entries drops the oldest of them, because nothing is sent until the app closes. If you would rather
have the whole session, use `Interval` with a period that suits you. It is one line of options.

## Where the anonymous id is stored

`distinct_id` is anonymous, generated on this machine, and scoped to this surface. It is never
sent to you by the server, never derived from anything, and never joined to a browser visitor
or to another app. Exact paths:

| OS | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\firstrun\{app}\distinct_id`  (e.g. `C:\Users\you\AppData\Local\firstrun\themia\distinct_id`) |
| macOS | `~/Library/Application Support/firstrun/{app}/distinct_id` |
| Linux / other Unix | `$XDG_DATA_HOME/firstrun/{app}/distinct_id`, or `~/.local/share/firstrun/{app}/distinct_id` when `XDG_DATA_HOME` is unset |

`{app}` is `AppName` lowercased and slugged, or the source key when `AppName` is not set. Set
`AppName` so the id survives a source key rotation. Read the resolved path at runtime from
`client.DistinctIdPath`.

Local (`%LOCALAPPDATA%`, not `%APPDATA%`) on Windows: `distinct_id` identifies an
INSTALLATION, not a person. On a roaming profile the roaming folder syncs between machines, so
one person signing in to three of them would share a single id and report as one install instead
of three. That is a real trade-off and it cuts the other way for anyone who wanted person-level
counting, but tying somebody together across machines is exactly what `identify()` is for, and
doing it silently and anonymously instead would make a number nobody could explain. Every
firstrun client stores this the same way, so the same install counts the same everywhere.

The file is written temp-then-rename, so a crash mid-write leaves either no file or a complete
one. If the write fails (read-only filesystem, full disk), the client uses a per-process id and
reports a diagnostic. It never throws.

`PersistDistinctId = false` skips the disk entirely; `DistinctId = "..."` supplies your own.

## Public API

```csharp
class FirstrunClient : IDisposable, IAsyncDisposable   // IAsyncDisposable on net8.0 only
    FirstrunClient(FirstrunOptions options)

    // The raw escape hatch. Everything below is one call to this one.
    void  Log(string name, string? body = null, int severity = 0,
              IReadOnlyDictionary<string,object?>? attributes = null,
              string? distinctId = null, string? userId = null, string? sessionId = null,
              long timestampMs = 0, string? traceId = null, string? spanId = null)

    // Convenience helpers. Conventional entries, not a schema.
    void  Event(string name, IReadOnlyDictionary<string,object?>? attributes = null,
                string? distinctId = null, string? userId = null, string? sessionId = null)
    void  Error(Exception error, IReadOnlyDictionary<string,object?>? attributes = null,
                string? distinctId = null, string? userId = null, string? sessionId = null)
    void  Trace(string body, IReadOnlyDictionary<string,object?>? attributes = null)
    void  Debug(string body, IReadOnlyDictionary<string,object?>? attributes = null)
    void  Info(string body, IReadOnlyDictionary<string,object?>? attributes = null)
    void  Warn(string body, IReadOnlyDictionary<string,object?>? attributes = null)
    void  ErrorLog(string body, IReadOnlyDictionary<string,object?>? attributes = null)
    void  Fatal(string body, IReadOnlyDictionary<string,object?>? attributes = null)
    void  Page(string path, IReadOnlyDictionary<string,object?>? attributes = null)
    void  Identify(string? userId, IReadOnlyDictionary<string,object?>? attributes = null)
    void  Reset()
    void  NewSession()

    void  Flush()                       // fire and forget
    bool  Flush(TimeSpan timeout)       // bounded wait; never required
    Task<bool> FlushAsync(TimeSpan timeout)
    void  Dispose()
    ValueTask DisposeAsync()            // net8.0

    FirstrunSurface Surface { get; }
    bool            IsEnabled { get; }
    bool            IsFirstRun { get; }
    string?         DistinctIdPath { get; }
    string          DistinctId { get; }
    string?         UserId { get; }
    string          SessionId { get; }
    FirstrunStats   Stats { get; }

    // The delivery policy this client resolved, after the per-surface defaults.
    FirstrunDeliveryMode DeliveryMode { get; }
    FirstrunPersistence  Persistence { get; }
    string?              QueuePath { get; }     // null when nothing is written to disk
    bool                 FlushOnExit { get; }
    TimeSpan             ExitFlushTimeout { get; }

class FirstrunAttributes : Dictionary<string,object?>
    FirstrunAttributes Set(string key, string? value)   // null removes the key
    FirstrunAttributes Set(string key, long value)
    FirstrunAttributes Set(string key, double value)
    FirstrunAttributes Set(string key, bool value)
    FirstrunAttributes Set(string key, object? value)   // nested object or array

class FirstrunStats
    int  Queued; long Accepted; long DroppedFromOverflow; long DroppedFromRejection;
    long Refused; bool CircuitOpen; long ConsecutiveFailures

class FirstrunDiagnosticEvent
    FirstrunDiagnosticKind Kind; string Message; int Count; Exception? Exception
enum FirstrunDiagnosticKind
    BatchSent, BatchRetrying, BatchRejected, QueueOverflow,
    EventRefused, CircuitOpened, CircuitClosed, InternalError,
    ConfigAdjusted, QueueRestored

enum FirstrunSurface { Web, Desktop, Mobile, Server, Other }

// The two axes of the delivery policy. Orthogonal on purpose: see "When it sends".
enum FirstrunDeliveryMode { Immediate, Interval, Startup, Manual }
enum FirstrunPersistence { Memory, Disk }

// The severity ladder, 1..24 in six bands of four.
static class FirstrunSeverity
    Trace = 1, Debug = 5, Info = 9, Warn = 13, Error = 17, Fatal = 21
    Min = 1, Max = 24

// Conventional entry names. Suggestions, not law.
static class FirstrunNames
    PageView, SessionStart, AppInstall, AppLaunch, Identify,
    Exception, HttpRequest, Measurement, Log

// Conventional attribute keys. Same status.
static class FirstrunAttr
    Body, TraceId, SpanId,
    ExceptionType, ExceptionMessage, ExceptionStacktrace, ExceptionEscaped,
    SessionId, UserId, ServiceName, ServiceVersion,
    OsType, HostArch, BrowserLanguage, UrlPath, UrlFull,
    HttpRequestMethod, HttpResponseStatusCode, HttpRoute,
    Channel, DurationMs, Value, Metric, Unit

static class Wire
    bool  IsValidLogName(string? name)
    bool  IsValidSourceKey(string? key)
    FirstrunSurface? SurfaceFromSourceKey(string? key)
    long  NowMs();  string OsName();  string ArchName();  string? LocaleName()
    const int LogNameMaxLength = 128, IdMaxLength = 512

static class DistinctIdStore
    string ResolvePath(string appFolder)
    (string Id, bool FirstRun) LoadOrCreate(string appFolder, Action<Exception>? onError)

// Firstrun.Extensions.Hosting
static class FirstrunServiceCollectionExtensions
    IServiceCollection AddFirstrun(this IServiceCollection, Action<FirstrunOptions> configure)
    IServiceCollection AddFirstrunServer(this IServiceCollection, string sourceKey, string host,
                                         Action<FirstrunOptions>? configure = null)
class FirstrunHostedService : IHostedService
```

`Error(ex)` is the helper worth reaching for first. It unwraps the exception into
`exception.type`, `exception.message` and `exception.stacktrace` (including the inner-exception
chain), names the entry `exception`, and files it at `FirstrunSeverity.Error`:

```csharp
try { Export(); }
catch (Exception ex) { client.Error(ex, new FirstrunAttributes().Set("rows", rows.Count)); }
```

### Options

| Option | Default | What it does |
|---|---|---|
| `SourceKey` | required | `fr_<surface>_<16 chars>`. Public; identifies a destination and authorises nothing. |
| `Host` | required | Ingest origin, e.g. `https://t.example.com`. |
| `AppName` | source key | Names the folder holding the anonymous id. |
| `ServiceName` | `null` | Sent as the `service.name` resource attribute. |
| `ServiceVersion` | entry assembly | Sent as the `service.version` resource attribute. |
| `Channel`, `Os`, `Arch`, `Locale` | detected | Sent as `firstrun.channel`, `os.type`, `host.arch`, `browser.language`. |
| `Resource` | `null` | Extra resource attributes; the named options above win on a clash. |
| `DefaultAttributes` | `null` | Stamped onto every entry; an entry's own attributes win. |
| `MinSeverity` | `0` | Entries classified below this are dropped. Unclassified ones never are. |
| `DistinctId` | from disk | Override the anonymous id. |
| `PersistDistinctId` | `true` | False keeps it in memory only. |
| `TrackLifecycleEvents` | desktop/mobile | Emits `app_install` on first run and `app_launch` on every run. |
| `Mode` | by surface | The schedule: `Immediate`, `Interval`, `Startup` or `Manual`. See below. |
| `Persistence` | `Memory` | `Disk` mirrors the pending queue to a file and drains it next start. |
| `FlushOnSeverity` | `Error` (17) | Entries at or above this send at once, whatever the schedule says. 0 turns it off. |
| `FlushOnExit` | `true` | One bounded pass at the queue on Dispose and on process exit. |
| `ExitFlushTimeout` | `2s` | The budget for that pass. Capped at 10s. |
| `QueuePath` | beside the id | Where the durable queue lives, when there is one. |
| `MaxPersistedBytes` | 8 MiB | Ceiling for that file. Oldest are dropped past it. |
| `PersistFromSeverity` | `0` | With `Disk`, write only entries at or above this. 0 writes everything. |
| `MaxQueuedEntries` | `10000` | Queue ceiling. Oldest are dropped past it. |
| `MaxBatchSize` | `200` | Entries per request. Clamped to the server's cap of 500. |
| `FlushInterval` | `15s` | How long a partial batch waits under `Interval`. Ignored by the other modes. |
| `RequestTimeout` | `10s` | Whole request. |
| `ConnectTimeout` | `5s` | net8.0 only; `netstandard2.0` has no separate connect timeout. |
| `RetryBaseDelay` / `RetryMaxDelay` | `1s` / `60s` | Capped exponential backoff, equal jitter. |
| `CircuitBreakerThreshold` | `5` | Consecutive failures before we stop dialling. |
| `CircuitBreakerCooldown` | `5m` | How long we stay stopped, then one probe. |
| `Diagnostics` | `null` | The only output this library produces. |
| `Enabled` | `true` | False accepts every call and sends nothing. |
| `HttpClient` | `null` | Supply your own; we will not dispose it or set its timeouts. |

## The log entry model

**Everything this library sends is a log entry.** An error is a log entry. A product event is a
log entry. A measurement is a log entry. There is no event type, no error type and no metric
type, and there is no second table or second pipeline behind any of them.

`Log` is the whole API. `Event`, `Error` and the level helpers are **convenience helpers that
build a conventional entry. They are examples of a good shape, not a schema.** Nothing they
produce is privileged: write the same entry yourself with `Log` and it is stored, indexed and
queried identically.

Meaning is assigned by convention when an entry is written and by query when it is read, never by
a closed set of types in the backend:

- An **exception** is an entry named `exception`, at `FirstrunSeverity.Error`, carrying
  `exception.type`, `exception.message` and `exception.stacktrace`. `Error(ex)` unwraps a .NET
  exception into exactly that, inner exceptions included, so you never write it by hand.
- A **measurement** is an entry carrying `firstrun.metric` and `firstrun.value`.
- A **product event** is an entry with a name and whatever attributes you thought worth keeping.

Names must match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`; an invalid name is dropped and counted in
`Stats.Refused` rather than throwing. `:` and `>` are excluded deliberately, because the
dashboard's internal keys are delimited with them. There is no allowlist:
`Event("download_clicked")` and `Event("page_view")` are the same kind of thing to everything
downstream.

**Severity** is the OpenTelemetry ladder, 1..24 in six bands of four. The three spare steps in
each band exist so a logger with nine levels can map on without losing the ordering. Zero means
you had nothing to say and is left off the wire: an entry with no severity is honestly
unclassified, and one silently filed as INFO is a lie a filter will act on.

**Attributes** keep their type. A page count is a number and stays one, so a query can average it
without casting every row out of text. Strings, numbers, booleans, null, lists and nested
dictionaries up to four levels all survive; a `DateTime` becomes ISO-8601, a `Guid` becomes its
text, and anything unserialisable is dropped rather than costing the batch its existence. Numbers
are written with the invariant culture, so a German machine does not send `1,5`. The dictionary
is copied at call time, so mutating yours afterwards cannot rewrite an entry already recorded.

Only five things are columns: `project_id`, `time`, `distinct_id`, `severity` and `name`.
Everything else, including `body`, `session.id`, `user.id`, `os.type` and `service.version`,
lives in attributes and is queried from there. A closed set of columns is a closed set of
questions, and which question you need is the one thing nobody can know in advance.

Identity is two fields and no inference:

- `distinct_id` is anonymous, per install, required on every entry.
- `user.id` is only ever the string you passed to `Identify`. We never invent, derive, look up
  or merge one, and this surface is never linked to your website's visitors. If you want the
  same person on both, call `Identify` with the same id on both. That is your data and your
  decision.

`time` is stamped when you call `Log`, not when the batch is sent. An entry that happened on
Friday and uploaded on Monday is a Friday entry, and the server treats it that way. Entry ids are
generated on the client so a request that timed out can be retried and deduped rather than
double-counted.

## What goes on the wire

One `POST {Host}/v1/e` per batch, `Content-Type: application/json`:

```json
{
  "k": "fr_desktop_9f3a2b1c4d5e6f70",
  "d": "0e9f...-...",
  "r": {
    "service.version": "2.4.1",
    "firstrun.channel": "stable",
    "os.type": "windows",
    "host.arch": "x86_64",
    "browser.language": "en-GB"
  },
  "e": [
    {
      "i": "…",
      "t": 1756400000000,
      "n": "exported_project",
      "s": 9,
      "a": { "format": "pdf", "pages": 12, "user.id": "acct_8812", "session.id": "…" }
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
separate batches automatically. That is what makes the server overload safe. `user.id` and
`session.id` are per-entry attributes and never split a batch.

No cookies, no auth header, and nothing identifying beyond a `firstrun-dotnet` user agent.

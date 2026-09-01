# firstrun.dev/go

Server-side firstrun client for Go 1.21+. Standard library only, no dependencies.

Everything this library sends is a **log entry**. An error is a log entry, a product event is a
log entry, a measurement is a log entry. `Log` is the whole API; `Event`, `Error` and the level
helpers build one for you with the conventional fields filled in. **They are examples of a good
shape, not a schema.** Nothing they produce is privileged; write the same entry yourself with
`Log` and it is stored, indexed and queried identically.

The module path is `firstrun.dev/go`. The repository implies no other domain, so this is the one
to change if the project settles on a different host: it appears in `go.mod` and nowhere else.

## The promise this library makes

**If firstrun is unreachable, slow, or returning errors, your program keeps working perfectly.**

That is the reason to trust it, so here is exactly how it is kept:

- `Log`, and every helper built on it, puts an entry on a buffered channel and returns. It performs
  no I/O, blocks on nothing, takes no lock a request path would contend on, and cannot panic into
  the caller. This holds under every delivery schedule, `immediate` included.
- The channel is bounded (10,000 events by default). When it is full the **oldest** events are
  discarded and counted, so a long outage costs you stale analytics rather than your process's
  memory.
- Every request has a connect timeout (2s) and a whole-request timeout (5s). Failures back off
  exponentially with full jitter, and after five consecutive failures a **circuit breaker** opens:
  a server that is down stops receiving traffic from you rather than receiving a retry storm.
- A `4xx` is not retried. The server understood the body and said no; it will say no again.
- Nothing is ever written to stdout or stderr. The only reporting channel is the optional
  `OnDiagnostic` hook, so this library cannot corrupt your program's log output. A panic inside
  your hook is recovered and discarded.
- One sender goroutine, and `Close` leaves none running.
- Bad configuration returns an error **and** a usable, disabled client. Ignoring the error is safe,
  so a typo in an environment variable cannot stop your service from booting.

The trade is stated plainly: this client is allowed to lose events. It is not allowed to panic,
block, retry unboundedly, or grow without limit.

## Install

```
go get firstrun.dev/go
```

## A service

```go
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	firstrun "firstrun.dev/go"
)

func main() {
	analytics, err := firstrun.New(firstrun.Options{
		SourceKey:  os.Getenv("FIRSTRUN_SOURCE_KEY"), // fr_9f3a2b1c4d5e6f70
		Host:       os.Getenv("FIRSTRUN_HOST"),       // https://t.example.com
		ServiceVersion: os.Getenv("GIT_SHA"),
		OnDiagnostic: func(d firstrun.Diagnostic) {
			slog.Warn("firstrun", "code", d.Code, "msg", d.Message)
		},
	})
	if err != nil {
		// Worth knowing about, but not worth refusing to start over: the client
		// returned above is a working no-op.
		slog.Warn("firstrun disabled", "err", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/export", func(w http.ResponseWriter, r *http.Request) {
		user := userFrom(r)
		rows := exportCSV(user)

		// Not deferred, not waited on, and nothing here can fail. The handler is
		// unaffected by anything firstrun does or fails to do.
		analytics.Event("exported_csv",
			firstrun.Attributes{"rows": len(rows)},
			firstrun.Entry{DeviceID: user.ID})

		w.WriteHeader(http.StatusOK)
	})

	srv := &http.Server{Addr: ":8080", Handler: mux}
	go func() { _ = srv.ListenAndServe() }()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	// Bounded by the same context, and it never blocks past it.
	_ = analytics.Close(ctx)
}
```

Unlike the Node client, this one installs no signal handler of its own. Go programs handle signals
explicitly, and a library reaching into `signal.Notify` behind your back would be a surprise. Call
`Close` on the shutdown path you already have.

## A CLI or a one-shot job

A short-lived process should flush before it ends, because there may be no idle moment for the
background ticker to fire in.

```go
package main

import (
	"context"
	"os"
	"time"

	firstrun "firstrun.dev/go"
)

func main() {
	analytics, _ := firstrun.New(firstrun.Options{
		SourceKey: os.Getenv("FIRSTRUN_SOURCE_KEY"),
		Host:      os.Getenv("FIRSTRUN_HOST"),
		// A CLI run genuinely is one subject, so a client-level id is right
		// here. Persist it per machine if you want runs to count as one user.
		DeviceID:     installID(),
		ServiceVersion: version,
	})
	// Bounded, and it never blocks past the context. Safe even if it already ran.
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = analytics.Close(ctx)
	}()

	started := time.Now()
	if err := run(); err != nil {
		// The exception attributes are unwrapped for you.
		analytics.Error(err, firstrun.Attributes{
			firstrun.AttrDurationMS: time.Since(started).Milliseconds(),
		}, firstrun.Entry{})
		os.Exit(1)
	}
	analytics.Event("cli_run", firstrun.Attributes{
		"ok":                    true,
		firstrun.AttrDurationMS: time.Since(started).Milliseconds(),
	}, firstrun.Entry{})
}
```

## API

```go
func New(opts Options) (*Client, error)   // always returns a usable client

// The raw escape hatch. Everything below is one call to this one.
func (c *Client) Log(e Entry)

// Convenience helpers. Conventional entries, not a schema.
func (c *Client) Event(name string, attrs Attributes, e Entry)   // at INFO
func (c *Client) Error(err error, attrs Attributes, e Entry)     // at ERROR, unwrapped
func (c *Client) Trace(body string, attrs Attributes, e Entry)
func (c *Client) Debug(body string, attrs Attributes, e Entry)
func (c *Client) Info(body string, attrs Attributes, e Entry)
func (c *Client) Warn(body string, attrs Attributes, e Entry)
func (c *Client) ErrorLog(body string, attrs Attributes, e Entry)
func (c *Client) Fatal(body string, attrs Attributes, e Entry)
func (c *Client) User(userID string, e Entry)
func (c *Client) Page(path string, e Entry)

func (c *Client) Flush(ctx context.Context) error   // nil, ctx.Err(), or ErrClosed
func (c *Client) Close(ctx context.Context) error   // idempotent, safe twice
func (c *Client) Stats() Stats

// Request-scoped identity. See "Identity on a context" below.
func NewContext(ctx context.Context, id Identity) context.Context
func FromContext(ctx context.Context) (Identity, bool)
func (c *Client) Ctx(ctx context.Context) *Scoped

// One http.request entry per served request. See "The HTTP middleware" below.
func (c *Client) Middleware(opts MiddlewareOptions) func(http.Handler) http.Handler
```

Nothing here waits for anything except `Flush` and `Close`. The context on `Ctx`, `NewContext` and
`FromContext` is carrying identity, not a deadline: `Ctx` performs no I/O, and cancelling that
context does not cancel a send.

```go
type Entry struct {
	Name       string     // what KIND of thing this is
	Body       string     // the human-readable line, when there is one
	Severity   int        // 1..24 on the ladder; 0 means you had nothing to say
	Attributes Attributes // map[string]any, copied on the way in; reuse your map freely

	DeviceID string     // REQUIRED unless Options.DeviceID is set
	UserID     string     // the customer's own id; lands in the user.id attribute
	SessionID  string     // optional; lands in the session.id attribute
	Time       time.Time  // zero means now; authoritative

	TraceID, SpanID string // reserved by the log model, unused by the product today

	ServiceVersion, Channel, OS, Arch, Locale string // per-call resource overrides
}
```

The third parameter carries identity, which a server needs per call. The zero `Entry` is fine
where `Options.DeviceID` is set:

```go
c.Event("exported_csv", firstrun.Attributes{"rows": 1200}, firstrun.Entry{DeviceID: userID})
c.Error(err, nil, firstrun.Entry{DeviceID: userID})
c.Info("cache warmed", firstrun.Attributes{"keys": 4096}, firstrun.Entry{})
```

`Log` accepts any name matching `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. There is no allowlist:
`Log(Entry{Name: "download_clicked"})` and `Log(Entry{Name: "page_view"})` are treated
identically by the whole system. `:` and `>` are rejected because the server reserves them as key
delimiters.

`Error(err, ...)` is the helper worth reaching for first. It unwraps the error into
`exception.type`, `exception.message` and `exception.stacktrace` (the chain `errors.Unwrap`
walks, which is the nearest thing Go has to a stack on an error value), names the entry
`exception`, and files it at `SeverityError`. That is OpenTelemetry's shape: "all exceptions" is
one name and "this exception" is a filter on a path, rather than a thousand names nobody can
enumerate.

`User(deviceID, userID, e)` takes both ids explicitly. There is no remembered "current
user", because in a server process that would be whoever was served last. It emits an `identify`
entry; from then on, entries carrying that `userID` count as the same unique. Nothing is merged
retroactively, and identities are never inferred.

`Page(path, e)` emits `page_view` with the path as the conventional `url.path` attribute. There
is no url column: everything that is not one of the four promoted columns lives in attributes and
is queried from there.

### Identity on a context

Passing identity per call is right for a server and it is also tedious, because it means threading
an id through every function that might record something, including the ones five layers down that
otherwise have no reason to know who they are working for. Go's answer to that is
`context.Context`, so this client takes it.

```go
func withIdentity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// visitorID is YOUR function. This library never works out who somebody
		// is on its own initiative: no cookie, no header, no IP, no session.
		ctx := firstrun.NewContext(r.Context(), firstrun.Identity{
			DeviceID: visitorID(r),
			UserID:     userIDFrom(r), // "" when nobody is signed in
			Attributes: firstrun.Attributes{"tenant": tenantFrom(r)},
		})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func exportHandler(w http.ResponseWriter, r *http.Request) {
	rows := exportCSV(r)
	// No id at the call site, and none needed: the context has one.
	analytics.Ctx(r.Context()).Event("exported_csv",
		firstrun.Attributes{"rows": len(rows)}, firstrun.Entry{})
}
```

`Ctx` returns a `*Scoped`, which mirrors every recording method (`Log`, `Event`, `Error`, `Trace`,
`Debug`, `Info`, `Warn`, `ErrorLog`, `Fatal`, `Page`) with the same arguments. Precedence is one
rule and it does not vary by helper or by field: **what the call site states wins, then what the
context carries, then what the client was configured with in `Options`.** An `Entry` with its own
`DeviceID` uses that one; everything else gets the request's. `Identity.Attributes` sit under the
entry's own attributes for the same reason.

A nil context, or one carrying no identity, gives a handle that behaves exactly like the client
itself, so wrapping a call in `Ctx` is never worse than not wrapping it. The handle is a value
derived from the client rather than a second client: one queue, one sender goroutine and one set of
counters however many of them exist, and making one per request costs an allocation and no I/O.

`Identity.Attributes` is copied by `NewContext` and by `FromContext`, because the stored map is read
by every goroutine holding the context and a concurrent map write is the one failure Go does not let
anybody recover from. An empty `Identity` is stored like any other, so a handler can clear an
ambient identity by putting one on rather than having the outer one leak through.

Copying an attribute that is an `error` means calling your `Error` method, so neither function is a
pure copy and neither is allowed to panic into you: a typed-nil error in that map costs the ambient
attributes for that context and nothing else. `NewContext` on a nil parent returns a usable context
rather than panicking, for the same reason.

`Flush` and `Close` have no scoped form: they are lifecycle, and a per-request handle is not where a
process decides to stop. Neither has `User`, which needs no shorter form here:
`s.Event(firstrun.NameIdentify, nil, firstrun.Entry{UserID: id})` is the same entry.

### The HTTP middleware

`Middleware` records one `http.request` entry per served request, and puts the identity on the
request context on the way past, so every handler underneath can record against it without being
handed anything.

```go
mw := analytics.Middleware(firstrun.MiddlewareOptions{
	// visitorID is YOUR function. This library never works out who somebody is
	// on its own initiative: no cookie, no header, no IP, no session.
	DeviceID: visitorID,
	UserID:     func(r *http.Request) string { return sessionUser(r) },
	Ignore:     func(r *http.Request) bool { return r.URL.Path == "/healthz" },
	Route: func(r *http.Request) string {
		return chi.RouteContext(r.Context()).RoutePattern()
	},
})

// Registered INSIDE the router. Wrapping it from outside as mw(router) works
// for everything except Route, which cannot see what the router matched.
router := chi.NewRouter()
router.Use(mw)

log.Fatal(http.ListenAndServe(":8080", router))
```

What it emits is an ordinary entry. There is no request table, no request pipeline and no second
code path: it is one `Log` call you could have written by hand.

| attribute | |
|---|---|
| `http.request.method` | `"GET"` |
| `http.route` | the route TEMPLATE, and only when `Route` returned one |
| `http.response.status_code` | a number, and only when net/http actually sent one |
| `url.path` | the path that was asked for, copied before a router could rewrite it |
| `firstrun.duration_ms` | a number, milliseconds at microsecond resolution |

Severity is `INFO`, or `ERROR` for a 5xx. **A 4xx stays at `INFO`.** It is the caller's mistake
rather than the server's, and a board where every 404 is an error is a board nobody can filter back
down.

`DeviceID` is required, and it is a function you write for the same reason `Identity` is: identity
is never inferred here. Return your own visitor cookie, your own header, your own session, whatever
your application already treats as one browser or one installation. Returning `""` costs the entry
rather than inventing a subject for it.

**An extractor you set owns its field, and `""` is an answer.** A front door is where an application
states who a request is from, so "nobody is signed in" is a statement rather than a gap to be filled
in from whatever an outer context happened to be carrying. If you set `UserID` and it returns `""`,
the request carries no user id, even when an outer middleware of yours had put one on: inheriting it
would attribute an entry to somebody your own code just said was not there, and it would not stop at
that entry, because the id goes onto the request context and every `Ctx` call underneath would pick
it up. The same holds for `DeviceID`. A field you leave **nil** keeps whatever the context had, and
so do the session id and the ambient attributes, which nothing here has an opinion about.

`Route` must return the route TEMPLATE (`/users/{id}`), never the resolved path (`/users/8814`). A
template groups a million requests into one readable row; the path groups them into a million rows
of one. When your router cannot give you a template, return `""` and the attribute is left off,
because an absent key is honest and `url.path` is on the entry anyway.

**`Route` only works when the middleware is registered inside your router**, and that is not a
detail: a router does not annotate the request it was handed. It derives a new one during dispatch
and gives that to the handler it matched, so a wrapper sitting outside the router never sees what
was matched, and the attribute is simply absent.

| router | register it as | and read the template with |
|---|---|---|
| chi | `router.Use(mw)` | `chi.RouteContext(r.Context()).RoutePattern()` |
| gorilla/mux | `router.Use(mw)` | `route := mux.CurrentRoute(r)`, then `tmpl, err := route.GetPathTemplate()` |
| net/http `ServeMux` | per route: `mux.Handle("/users/{id}", mw(h))` | `r.Pattern` on Go 1.23+, or the literal pattern you registered |

`mux.CurrentRoute` returns `nil` when there was no match and `GetPathTemplate` returns
`(string, error)`, so both need checking before use. Everything else the middleware does works the
same wrapped around the router as inside it, so `mw(router)` is a fine wiring if you are not asking
for `http.route`.

**The `ResponseWriter` keeps the interfaces it had.** Capturing a status code means wrapping the
writer, and a naive wrapper hides `http.Flusher`, `http.Hijacker` and `io.ReaderFrom` from the
handler underneath: streaming responses stop streaming, websocket upgrades stop upgrading, and
sendfile turns back into a copy through userspace. Our telemetry quietly degrading your server is
the same failure as our telemetry blocking it. So the wrapper is one of eight shapes, chosen to
match exactly what the real writer implemented, and it implements `Unwrap` so
`http.NewResponseController` reaches the connection for deadlines. Two interfaces are not carried
across: `http.CloseNotifier`, deprecated since Go 1.11 in favour of the request context, which is
untouched; and `http.Pusher`, the HTTP/2 push no browser still implements. Both are asked for behind
an "if it supports it" test, so a handler that wants one gets a no and its own fallback.

**A panic in your handler is yours.** The middleware does not recover it: your recovery middleware
still sees it, net/http still logs it, and the connection still closes the way it would have. It is
recorded anyway, at `ERROR` with `exception.escaped`, and with no status code unless your handler
had already written one, because net/http answers a panicking handler by closing the connection
rather than by sending a 500. A 200 there would be a number nobody could check.

Every piece of your code the middleware calls, it calls inside a recover: all four extractors, and
`Options.Now` if you replaced the clock. A panic in one of them costs an id, a route or a timestamp
and nothing else, and on every path through the middleware `next.ServeHTTP` is called exactly once.
An `Ignore` that returns true passes the request through untouched: no wrapper, no context, no
entry. A disabled client returns your handler unchanged.

### Severity

The OpenTelemetry ladder, 1..24 in six bands of four:

```go
firstrun.SeverityTrace  // 1
firstrun.SeverityDebug  // 5
firstrun.SeverityInfo   // 9
firstrun.SeverityWarn   // 13
firstrun.SeverityError  // 17
firstrun.SeverityFatal  // 21
```

The three spare steps inside each band exist so a program whose own logger has nine levels can
map onto this without losing the ordering: `SeverityWarn + 1` is a slightly worse warning and
still filters as a warning. Zero means unclassified and is left off the wire, because an entry
with no severity is honest and one silently filed as INFO is a lie a filter will act on.

### Conventions

`Name*` and `Attr*` constants hold the conventional spellings. **They are suggestions, not law.**
Nothing is enforced: an entry using keys nobody has heard of gets the same storage, the same
indexing and the same query surface.

```go
firstrun.NamePageView, NameSessionStart, NameAppInstall, NameAppLaunch,
         NameIdentify, NameException, NameHTTPRequest, NameMeasurement, NameLog

firstrun.AttrBody, AttrExceptionType, AttrExceptionMessage, AttrExceptionStacktrace,
         AttrSessionID, AttrUserID, AttrServiceName, AttrServiceVersion,
         AttrOSType, AttrHostArch, AttrBrowserLanguage, AttrURLPath, AttrURLFull,
         AttrHTTPRequestMethod, AttrHTTPResponseStatusCode, AttrHTTPRoute,
         AttrChannel, AttrDurationMS, AttrValue, AttrMetric, AttrUnit
```

### Options

| Field | Default | |
|---|---|---|
| `SourceKey` | required | `fr_<16 hex>`. Public by necessity; it identifies and authorises nothing |
| `Host` | required | Origin only, e.g. `https://t.example.com` |
| `DeviceID`, `UserID` | none | Client-level defaults. Leave empty in a multi-tenant server |
| `ServiceName`, `ServiceVersion`, `Channel`, `OS`, `Arch`, `Locale` | none | Resource attributes, overridable per call |
| `Resource` | none | Extra resource attributes; the named options above win on a clash |
| `DefaultAttributes` | none | Stamped onto every entry; an entry's own attributes win |
| `MinSeverity` | `0` | Entries classified below this are dropped. Unclassified ones never are |
| `Disabled` | `false` | Makes every call a no-op |
| `QueueSize` | `10000` | Then the oldest are dropped |
| `Schedule` | `interval` | When a send is attempted. See [Delivery policy](#delivery-policy) |
| `Persistence` | `memory` | What survives a crash |
| `Every` | `15s` | The `interval` cadence. The other schedules have no timer |
| `MaxBatch` | `250` | Entries per request, and the count that makes `interval` send early. Capped at the server's 500 |
| `FlushOnSeverity` | `SeverityError` | At or above this, an entry goes at once whatever the schedule says. `SeverityNever` turns it off |
| `FlushOnExit` | `ToggleDefault` | Last best-effort send in `Close`. Default is yes, except under `startup` |
| `ExitFlushTimeout` | `2s` | Bounds that send, so a slow network cannot hold a process open |
| `QueuePath` | under `os.UserCacheDir` | The durable queue file, `disk` only |
| `QueueMaxBytes` | `8 MiB` | Bounds that file; oldest dropped first |
| `ConnectTimeout` | `2s` | Dial and TLS handshake |
| `RequestTimeout` | `5s` | One whole attempt |
| `MaxRetries` | `5` | Then the batch is held for a later cycle. Negative means none |
| `RetryBase`, `RetryMax` | `500ms`, `30s` | Exponential backoff with full jitter |
| `BreakerThreshold` | `5` | Consecutive failures that pause sending |
| `BreakerReset` | `30s` | Cooldown before one probe request |
| `HTTPClient` | built-in | Yours if you set it, timeouts included |
| `OnDiagnostic` | none | The only reporting channel |
| `Now` | `time.Now` | For tests |

`OnDiagnostic` is called from the sender goroutine **and** from `Log`, so it must be safe for
concurrent use. Keep it cheap: it runs inline on whichever goroutine called `Log`.

Diagnostic codes are `rejected`, `dropped`, `retry`, `abandoned`, `breaker_open`, `breaker_close`,
`config` and `restored`. A `rejected` at `LevelError` naming `DeviceID` is the one worth alerting
on: it means entries are being thrown away at the call site. A `config` at `LevelWarn` means a
delivery setting could not be honoured as written and says what was used instead.

## Delivery policy

`docs/delivery-policy.md` in the firstrun repository is the specification; this is how Go
implements it.

**Two axes, and conflating them is the mistake.** `Schedule` decides when a send is attempted.
`Persistence` decides what is still there after a crash or a kill. "Send once at startup" is not a
schedule on its own: it is a schedule that never fires during the run, combined with a queue that
survives to the next one. Two settings, because one enum cannot say that.

| `Schedule` | |
|---|---|
| `ScheduleImmediate` | Send as soon as a batch can be formed |
| `ScheduleInterval` | Every `Every`, or when `MaxBatch` is waiting, whichever first. **Default** |
| `ScheduleStartup` | Drain what survived the last run, then never again during this one |
| `ScheduleManual` | Only when `Flush` is called |

```go
c, _ := firstrun.New(firstrun.Options{
	SourceKey: key,
	Host:      host,
	Schedule:  firstrun.ScheduleInterval, // the default; here for the sake of the example
	Every:     15 * time.Second,
	MaxBatch:  250,
})
```

**`immediate` still batches and still never blocks.** It means "do not wait for a timer", not "one
request per entry". Everything already queued joins the same pass of the sender loop, so entries
produced while a request is in flight coalesce into the next one. A loop calling `Event` a thousand
times produces single-digit requests; `TestImmediateCoalesces` holds that number under 100 and
`TestImmediateNeverBlocks` holds the call itself in the low microseconds. Reading "live" as
synchronous would put this library in your critical path, which is the one thing it may never do.

**`MaxBatch` is capped at 500**, the server's per-request entry limit, read from the wire contract
rather than guessed. A larger body is rejected whole, so a `MaxBatch` above it means every request
fails, the queue never drains, and the symptom is total silence. Ask for more and you get 500 and a
`config` diagnostic.

**`FlushOnSeverity` defaults to `SeverityError`.** An entry at or above it goes out at the moment
it is logged, whatever the schedule says, `manual` and `startup` included. This is most of the
value of having a policy at all: a crash report that waits fifteen seconds for the next tick is a
crash report that usually does not arrive, because the process is gone by then. It costs nothing at
rest, because most runs log no errors. Set `SeverityNever` to turn it off.

**`FlushOnExit` defaults to on**, bounded by `ExitFlushTimeout` (2s) as well as by the context you
pass to `Close`. Bounded, because a slow network must not hold your process open. Under
`ScheduleStartup` it defaults to off, since that mode's whole point is leaving this run's entries
for the next launch; set it to `ToggleOn` to override.

### Persistence, and why a server should not use disk

**The default is `memory`, and that is deliberate.** Disk persistence sounds like strictly more
safety and is not, for a server:

- A server that crashes is generally being restarted by something that does not preserve local
  state. A container is replaced, not repaired, and the queue file goes with the old filesystem.
- Writing telemetry into a container filesystem is a surprise. It is not what an operator expects a
  telemetry client to do to a read-mostly image, and on a busy service it is write traffic nobody
  budgeted for.
- A replicated deployment has many processes and one image. A durable queue per replica is a
  scattered backlog nothing collects.

What closes the gap instead is `FlushOnSeverity`: the entries actually worth surviving leave the
process at the moment they are logged, while the process still exists.

Reach for `PersistenceDisk` where the machine is the same machine next time: a CLI, a device agent,
a single-tenant worker on a real disk. It mirrors the pending queue to `QueuePath` as
newline-delimited JSON, appended as entries join the backlog and rewritten when the backlog shrinks,
so what a crash leaves behind is exactly what had not been sent. Entry ids are generated on this
side, so replaying a file whose entries did reach the server costs a duplicate the server
deduplicates rather than a double count.

The file is bounded by `QueueMaxBytes` and drops oldest first, the same trade the in-memory queue
makes. If it cannot be written at all, the client says so once through `OnDiagnostic` and carries on
in memory: losing durability is a worse client, and taking your program down over it would be a
worse library.

`ScheduleStartup` with `PersistenceMemory` is incoherent, because nothing survives the run and so
nothing would ever be sent. It is coerced to `disk` with a `config` diagnostic rather than accepted,
because a client that silently sends nothing is the worst outcome available.

```go
// One burst of requests per launch, and nothing in between.
c, _ := firstrun.New(firstrun.Options{
	SourceKey:   key,
	Host:        host,
	DeviceID:  installID(),
	Schedule:    firstrun.ScheduleStartup,
	Persistence: firstrun.PersistenceDisk,
})
```

### Backing off is not a schedule

A timer must not fire on schedule while the circuit breaker is open or a backoff is running. Both
the ticker and an arrival under `immediate` are gated on that, so a wakeup during an outage costs a
loop iteration rather than a request: a fleet that retried on its interval regardless of outcome is
a load generator pointed at an incident.

The reliability rules outrank all of the above and none of them move. No schedule blocks the caller,
throws into your program, retries unboundedly, grows without limit, writes to your stdout or stderr,
or leaves a goroutine behind after `Close`.

## `DeviceID` is yours to supply

This is the one thing to get right.

A browser has a persistent per-visitor id in `localStorage`, and a desktop app has a per-install
id on disk. A server has neither. It handles thousands of different people from one process, so
there is nothing this library could default to that would be correct. Get it wrong and every event
in your fleet collapses onto a handful of ids, and your unique counts become a count of your
server processes.

So `DeviceID` is required, and an event without one is **dropped and reported** through
`OnDiagnostic` rather than sent under an invented id. A loud failure beats a silently wrong number
that nobody can spot from a dashboard.

Set `Options.DeviceID` only when the process really is the subject: a CLI, a single-tenant
worker, a device agent.

## What goes on the wire

One `POST` per identity group to `{Host}/v1/e`, `Content-Type: application/json`, body exactly the
`LogBatch` shape from `packages/schema/src/log.ts`:

```json
{
  "k": "fr_0123456789abcdef",
  "d": "account_9f3a",
  "r": { "service.version": "2.1.0", "os.type": "linux", "host.arch": "x86_64" },
  "e": [
    {
      "i": "0f8c…",
      "t": 1756400000000,
      "n": "invoice_generated",
      "s": 9,
      "a": { "plan": "pro", "lines": 14, "user.id": "u_412" }
    }
  ]
}
```

The keys are one letter because this is the same body the browser tag posts from `sendBeacon` on
a page being unloaded, where bytes are the constraint: `k` is the source key, `r` the resource
and `e` the entries. There is no top-level id field: identity is three optional attributes and
they travel inside `r`. One shape for every client rather than a compact
browser dialect beside a verbose SDK one.

`r` is the **resource**: what is true of the whole process rather than of one entry. It is
carried once per body, not once per entry, because it does not change between two entries in the
same request, and the edge merges it under each entry's own attributes so an entry that sets the
same key wins.

`d` sits on the batch too, so entries for the same person are grouped into one request and a
flush costs one request per device id. `user.id` and `session.id` are per-entry attributes and
never split a batch. `i` is generated here, so a request that times out and is retried is
deduplicated by the server rather than counted twice. `t` is stamped when the thing happens and
is authoritative: an entry queued during an outage and delivered later is still counted at the
moment it occurred.

## Develop

```
go build ./...
go vet ./...
go test -race ./...
gofmt -l .
```

`delivery_test.go` is the delivery policy written down: that `immediate` coalesces, that
`FlushOnSeverity` outranks the schedule, that `startup` sends nothing during its own run and drains
the last one, and that `Close` twice leaves no goroutine behind.

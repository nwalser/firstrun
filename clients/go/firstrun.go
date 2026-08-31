// Package firstrun is a server-side client for a self-hosted firstrun
// analytics backend.
//
// The promise this package makes: if firstrun is unreachable, slow, or
// returning errors, the program using it keeps working perfectly. Log puts an
// entry on a buffered channel and returns. It performs no I/O, blocks on
// nothing, allocates a bounded amount, and cannot panic into the caller.
// Everything that can fail happens on one background goroutine that is
// time-boxed, breaker-guarded, and silent: this package never writes to stdout
// or stderr, because a library that prints into a host program's logs corrupts
// that program's output.
//
// The trade is stated plainly: this client is allowed to lose entries. It is not
// allowed to panic, block, retry unboundedly, or grow without limit.
//
// # One shape for everything
//
// Everything this package sends is a LOG ENTRY. Log is the whole API; Event,
// Error and the level helpers are convenience helpers that build a CONVENTIONAL
// entry. They are examples of a good shape, not a schema: nothing they produce
// is privileged, and nothing you send without them is second class.
package firstrun

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ErrClosed is returned by Flush on a client that has been closed.
var ErrClosed = errors.New("firstrun: client is closed")

// DiagnosticLevel classifies a Diagnostic.
type DiagnosticLevel string

const (
	LevelDebug DiagnosticLevel = "debug"
	LevelWarn  DiagnosticLevel = "warn"
	LevelError DiagnosticLevel = "error"
)

// Diagnostic codes.
const (
	// CodeRejected: an event was refused before it entered the queue.
	CodeRejected = "rejected"
	// CodeDropped: events were discarded because a buffer was full.
	CodeDropped = "dropped"
	// CodeRetry: a batch failed and will be tried again.
	CodeRetry = "retry"
	// CodeAbandoned: a batch was given up on, or the server rejected it.
	CodeAbandoned = "abandoned"
	// CodeBreakerOpen: sending has paused after repeated failures.
	CodeBreakerOpen = "breaker_open"
	// CodeBreakerClose: the server answered again and sending resumed.
	CodeBreakerClose = "breaker_close"
	// CodeConfig: a delivery-policy setting could not be honoured as written and
	// was coerced, or the durable queue gave up and sending continues in memory.
	CodeConfig = "config"
	// CodeRestored: entries that survived the last run were loaded from disk.
	CodeRestored = "restored"
)

// Diagnostic is the only way this package reports anything.
type Diagnostic struct {
	Code    string
	Level   DiagnosticLevel
	Message string
}

// Stats is a snapshot of what the client has done. Safe to call at any time.
type Stats struct {
	// Queued is events waiting in the channel. Approximate by nature.
	Queued int
	// Rejected is events refused before the queue: bad name, over-long id, or
	// a closed client.
	Rejected int64
	// Dropped is events discarded because a buffer was full or a batch was
	// abandoned.
	Dropped int64
	// Sent is events the server accepted.
	Sent int64
	// FailedRequests is HTTP attempts that failed, including ones later retried
	// successfully.
	FailedRequests int64
	// BreakerOpen reports whether sending is currently paused.
	BreakerOpen bool
	// Closed reports whether Close has been called.
	Closed bool
}

// Entry is one log entry: the raw escape hatch, and the shape every helper in
// this package builds. The zero value is valid: identity is optional.
//
// The model is OpenTelemetry's log data model, so if you already know that one
// you already know this. There is nothing Event, Error or the level helpers can
// produce that you cannot write here by hand.
type Entry struct {
	// Name is the name column: what KIND of thing this is.
	//
	// Any string matching the entry-name rule. There is no allowlist and no
	// privileged name: the Name* constants in this package are conventions, and
	// they are suggestions.
	Name string

	// Body is the human-readable line, when there is one. It travels as the
	// body attribute, because this product promotes four columns and no more.
	Body string

	// Severity is 1..24 on the OpenTelemetry ladder. Zero means you had nothing
	// to say, and is left off the wire: an entry with no severity is honestly
	// unclassified, and one silently filed as INFO is a lie a filter acts on.
	Severity int

	// Attributes is everything else about this entry. The backend does not know
	// what any key means, which is the point: a closed set of columns is a
	// closed set of questions. The Attr* constants are the conventional
	// spellings, so two projects that mean the same thing agree.
	//
	// Copied on the way in, so the caller may reuse the map.
	Attributes Attributes

	// UserID, DeviceID and SessionID are the three identity attributes, and all
	// three are OPTIONAL. An entry carrying none of them is a legal entry, and
	// on a server it is the ordinary one: it counts as an entry and in no
	// unique. Nothing here is ever inferred, derived or looked up.
	//
	// IDENTITY IS ONE UNIT. Setting any of the three means this entry's identity
	// comes from this entry, and neither the surrounding Scoped handle nor the
	// client Options are consulted for the other two. Resolving them field by
	// field is how a background job that names its own device keeps the
	// requester's user.id, and since a unique coalesces user.id first, that job
	// is then counted as that customer.
	//
	// UserID is the customer's own id for this person, and lands in user.id.
	// DeviceID names a machine, when there is one to name, and lands in
	// device.id: a server process is not a machine, so this stays empty unless
	// the caller genuinely has one. SessionID lands in session.id.
	UserID    string
	DeviceID  string
	SessionID string

	// Time is when it happened. Zero means now. Authoritative: the server
	// buckets on it and never rebuckets.
	Time time.Time

	// TraceID and SpanID are reserved by the log data model and unused by this
	// product today. They travel as attributes under the spec's own names.
	TraceID string
	SpanID  string

	// Per-call overrides of the client-level resource attributes.
	ServiceVersion string
	Channel        string
	OS             string
	Arch           string
	Locale         string
}

// Options configures a Client. Every field except SourceKey and Host has a
// working default.
type Options struct {
	// SourceKey is fr_<16 hex>. Public by necessity: it identifies a
	// destination and authorises nothing.
	SourceKey string
	// Host is the origin of the firstrun edge, e.g. https://t.example.com.
	// No path.
	Host string

	// UserID, DeviceID and SessionID are client-level defaults for calls and
	// scopes that state no identity of their own.
	//
	// NOTHING is on by default. This client generates no id of any kind: there
	// is no per-process id, no persisted file, and no fallback. A server that
	// sets none of these sends entries carrying no identity, which is the
	// honest answer for a backend.
	//
	// Leave them empty in a multi-tenant server: passing identity per call, or
	// per scope through Ctx, is the whole point. Set them only where the
	// process genuinely is the subject, such as a CLI or a single-tenant
	// worker. They are a unit here too: a call or a scope that states any
	// identity replaces all three.
	UserID    string
	DeviceID  string
	SessionID string

	// ServiceName and ServiceVersion name the customer's own software. They are
	// sent as the service.name and service.version resource attributes.
	ServiceName    string
	ServiceVersion string
	// Channel is stable, beta or nightly. Sent as firstrun.channel.
	Channel string
	// OS is sent as os.type, Arch as host.arch, Locale as browser.language,
	// which is what the convention calls it.
	OS     string
	Arch   string
	Locale string

	// Resource is extra resource attributes: anything true of this PROCESS
	// rather than of one entry. Merged under the named options above, which win
	// on a clash.
	Resource Attributes

	// TestMode marks everything this client sends as test data, via the
	// firstrun.test resource attribute. The dashboard shows one world or the
	// other and never both, so a staging binary with this set cannot move a
	// number anybody is looking at.
	//
	// Nothing is inferred. A server has no equivalent of "running from the
	// IDE", and a client that guessed would eventually guess wrong on a
	// production box, silently and in the direction nobody checks.
	TestMode bool

	// DefaultAttributes are stamped onto every entry this client sends, for
	// what is true of every entry but is not a property of the process: a
	// tenant, a region, a deployment id. An entry's own attributes win.
	DefaultAttributes Attributes

	// MinSeverity drops entries below it before they are queued. Default 0,
	// which sends everything.
	//
	// Entries with no severity are never dropped by this: an unclassified entry
	// is not a quiet one, and silently discarding it would make the threshold a
	// filter on a field the caller did not set.
	MinSeverity int

	// Disabled makes every call a no-op that still returns immediately.
	Disabled bool

	// QueueSize is how many entries are held before the oldest are dropped.
	// Default 10000.
	QueueSize int

	// --- Delivery policy: docs/delivery-policy.md ---------------------------
	//
	// Two axes. Schedule decides WHEN a send is attempted; Persistence decides
	// what is still there afterwards. "Send once at startup" is the combination
	// of the two, which is why they are separate settings.

	// Schedule is when a send is attempted. Default ScheduleInterval, which is
	// right for a long-lived server process.
	Schedule Schedule
	// Persistence is what survives a crash or a kill. Default
	// PersistenceMemory: a server that crashes is generally restarted by
	// something that will not preserve local state, and writing telemetry into a
	// container filesystem is a surprise. See the README.
	Persistence Persistence

	// Every is the ScheduleInterval cadence. Default 15s. Ignored by the other
	// schedules, which have no timer at all.
	Every time.Duration
	// MaxBatch is entries per HTTP request, and the buffered count that makes
	// ScheduleInterval send without waiting for the next tick. Default 250,
	// capped at the server's per-request limit of 500: above that every request
	// is rejected, the queue never drains, and it presents as total silence.
	MaxBatch int

	// FlushOnSeverity sends an entry at or above this severity immediately,
	// whatever the schedule says. Default SeverityError; set SeverityNever to
	// turn it off.
	//
	// This is most of the value of having a policy at all. A crash report that
	// waits five minutes for the next tick is a crash report that usually does
	// not arrive, because the process is gone by then.
	FlushOnSeverity int
	// FlushOnExit decides whether Close makes one last best-effort send.
	// ToggleDefault means yes, except under ScheduleStartup, whose whole point
	// is leaving this run's entries for the next launch.
	FlushOnExit Toggle
	// ExitFlushTimeout bounds that last send. Default 2s, because a slow
	// network must not hold a process open.
	ExitFlushTimeout time.Duration

	// QueuePath is the durable queue file, used only with PersistenceDisk.
	// Default: a per-source-key file under os.UserCacheDir, which is
	// %LOCALAPPDATA% on Windows and never the roaming folder.
	QueuePath string
	// QueueMaxBytes bounds that file. Default 8 MiB, oldest dropped first.
	QueueMaxBytes int64

	// ConnectTimeout bounds dialling and the TLS handshake. Default 2s.
	ConnectTimeout time.Duration
	// RequestTimeout bounds one whole attempt. Default 5s.
	RequestTimeout time.Duration

	// MaxRetries is retries per batch before it is held over for a later
	// cycle. Default 5; set it negative for none.
	MaxRetries int
	// RetryBase is the first backoff step. Default 500ms.
	RetryBase time.Duration
	// RetryMax is the backoff ceiling. Default 30s.
	RetryMax time.Duration

	// BreakerThreshold is consecutive request failures that pause sending.
	// Default 5.
	BreakerThreshold int
	// BreakerReset is how long sending stays paused before one probe.
	// Default 30s.
	BreakerReset time.Duration

	// HTTPClient overrides the built-in one. When set, ConnectTimeout and
	// RequestTimeout are yours to configure on it.
	HTTPClient *http.Client

	// OnDiagnostic is the only reporting channel. It is called from the sender
	// goroutine and from Track; keep it cheap and non-blocking. A panic in it
	// is recovered and discarded.
	OnDiagnostic func(Diagnostic)

	// Now overrides the clock, for tests.
	Now func() time.Time
}

// Client is a firstrun client. Create one with New and share it: every method
// is safe to call from any goroutine.
type Client struct {
	opts     Options
	url      string
	http     *http.Client
	ownsHTTP bool
	disabled bool

	ch       chan item
	flushReq chan chan struct{}
	quit     chan struct{}
	done     chan struct{}

	// persist is nil unless Persistence is disk.
	persist *diskQueue

	closeOnce sync.Once
	closed    atomic.Bool

	rejected atomic.Int64
	dropped  atomic.Int64
	sent     atomic.Int64
	failed   atomic.Int64
	brkOpen  atomic.Bool

	// Touched only by the sender goroutine.
	brk breaker
	// nextAttempt is the earliest moment another request may be made. A timer
	// firing before it is a wakeup with nothing to do, not permission to send.
	nextAttempt time.Time
	// deadline bounds the shutdown flush. Zero outside it.
	deadline time.Time
}

// applyDefaults fills every unset option in and returns whatever the caller has
// to be told about a setting that could not be honoured as written.
func (o *Options) applyDefaults() []Diagnostic {
	diags := o.resolvePolicy()

	if o.QueueSize <= 0 {
		o.QueueSize = 10000
	}
	if o.MaxBatch > o.QueueSize {
		o.MaxBatch = o.QueueSize
	}
	if o.ConnectTimeout <= 0 {
		o.ConnectTimeout = 2 * time.Second
	}
	if o.RequestTimeout <= 0 {
		o.RequestTimeout = 5 * time.Second
	}
	if o.MaxRetries == 0 {
		o.MaxRetries = 5
	}
	if o.MaxRetries < 0 {
		o.MaxRetries = 0
	}
	if o.RetryBase <= 0 {
		o.RetryBase = 500 * time.Millisecond
	}
	if o.RetryMax <= 0 {
		o.RetryMax = 30 * time.Second
	}
	if o.RetryMax < o.RetryBase {
		o.RetryMax = o.RetryBase
	}
	if o.BreakerThreshold <= 0 {
		o.BreakerThreshold = 5
	}
	if o.BreakerReset <= 0 {
		o.BreakerReset = 30 * time.Second
	}
	if o.Now == nil {
		o.Now = time.Now
	}

	// Bounded once here rather than on every call. These are client-level maps: an
	// oversized key in one of them would otherwise be copied onto every entry and
	// cost the whole batch its existence, over and over, for the life of the process.
	o.Resource = clampAttributes(o.Resource)
	o.DefaultAttributes = clampAttributes(o.DefaultAttributes)

	return diags
}

// New returns a client.
//
// It ALWAYS returns a usable, non-nil client, even when it returns an error:
// on bad configuration the client is disabled and every call becomes a no-op.
// Ignoring the error is therefore safe, and a typo in an environment variable
// cannot stop a service from booting. Log it if you would rather know.
func New(opts Options) (*Client, error) {
	diags := opts.applyDefaults()

	c := &Client{opts: opts, brk: breaker{threshold: opts.BreakerThreshold, reset: opts.BreakerReset}}

	// Reported through the caller's own hook rather than returned, because none
	// of them stops the client working and an error nobody can act on differently
	// is an error that gets ignored.
	for _, d := range diags {
		c.diag(d)
	}

	if err := validate(&opts); err != nil {
		c.disabled = true
		c.closed.Store(true)
		c.diag(Diagnostic{Code: CodeRejected, Level: LevelError, Message: "disabled: " + err.Error()})
		return c, err
	}
	if opts.Disabled {
		c.disabled = true
		c.closed.Store(true)
		return c, nil
	}

	c.url = strings.TrimRight(opts.Host, "/") + ingestPath
	if opts.HTTPClient != nil {
		c.http = opts.HTTPClient
	} else {
		c.ownsHTTP = true
		c.http = &http.Client{
			Timeout: opts.RequestTimeout,
			Transport: &http.Transport{
				DialContext: (&net.Dialer{
					Timeout:   opts.ConnectTimeout,
					KeepAlive: 30 * time.Second,
				}).DialContext,
				TLSHandshakeTimeout:   opts.ConnectTimeout,
				ResponseHeaderTimeout: opts.RequestTimeout,
				ExpectContinueTimeout: time.Second,
				MaxIdleConns:          4,
				MaxIdleConnsPerHost:   4,
				IdleConnTimeout:       90 * time.Second,
				ForceAttemptHTTP2:     true,
			},
		}
	}

	c.ch = make(chan item, opts.QueueSize)
	c.flushReq = make(chan chan struct{})
	c.quit = make(chan struct{})
	c.done = make(chan struct{})

	// Read before the sender starts, so the backlog from the last run is already
	// pending when the first tick or the first entry arrives. The file stays as
	// it is until a delivery actually changes what is queued: a crash between
	// here and the first send leaves the backlog exactly where it was.
	var restored []item
	if opts.Persistence == PersistenceDisk {
		c.persist = newDiskQueue(opts.QueuePath, opts.QueueMaxBytes, c.diag)
		restored = c.persist.load(opts.QueueSize, opts.FlushOnSeverity)
	}

	go c.run(restored)
	return c, nil
}

func validate(o *Options) error {
	if !sourceKeyRE.MatchString(o.SourceKey) {
		return errors.New("invalid SourceKey: expected fr_<16 hex>")
	}
	u, err := url.Parse(strings.TrimRight(o.Host, "/"))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" {
		return errors.New("invalid Host: expected an http(s) origin with no path, e.g. https://t.example.com")
	}
	return nil
}

// -----------------------------------------------------------------------------
// Recording
// -----------------------------------------------------------------------------

// Log records an entry. It returns immediately, does no I/O, and never blocks
// or panics.
//
// Name may be any string matching ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$. There is
// no allowlist: "download_clicked" and "exported_csv" are treated identically by
// the whole system.
//
// When the entry is at or above Options.FlushOnSeverity it is marked for
// immediate delivery whatever the schedule says. That still happens on the
// sender goroutine: nothing here waits for a request.
func (c *Client) Log(e Entry) {
	// Attributes and error values are the caller's own types, and formatting one
	// runs the caller's String or Error method on this goroutine. A panic in there
	// is the host's bug and is still not allowed to become the host's crash: the
	// entry is lost, which is the trade this package is allowed to make.
	defer func() {
		if r := recover(); r != nil {
			c.rejected.Add(1)
			c.diag(Diagnostic{
				Code:    CodeRejected,
				Level:   LevelError,
				Message: fmt.Sprintf("recovered a panic while recording %s", e.Name),
			})
		}
	}()

	if c.disabled {
		return
	}
	if c.closed.Load() {
		c.rejected.Add(1)
		c.diag(Diagnostic{Code: CodeRejected, Level: LevelWarn, Message: "client is closed, dropping " + e.Name})
		return
	}
	if !isLogName(e.Name) {
		c.rejected.Add(1)
		c.diag(Diagnostic{Code: CodeRejected, Level: LevelWarn, Message: "invalid entry name: " + e.Name})
		return
	}

	severity := clampSeverity(e.Severity)
	// A threshold filters entries the caller CLASSIFIED. One with no severity is
	// unclassified rather than quiet, so it is never dropped here.
	if severity != 0 && severity < c.opts.MinSeverity {
		return
	}

	// Identity is one unit, taken from one layer: the entry if it states any of
	// the three, otherwise the client defaults. Scoped.fill has already applied
	// the same rule for a scope, so by here there are only two layers left.
	userID, deviceID, sessionID := e.UserID, e.DeviceID, e.SessionID
	if userID == "" && deviceID == "" && sessionID == "" {
		userID, deviceID, sessionID = c.opts.UserID, c.opts.DeviceID, c.opts.SessionID
	}

	// Over-length ids are refused rather than truncated. Truncating two ids to
	// the same 512 bytes would merge two people into one unique, and that is a
	// wrong number nobody would ever find.
	if len(userID) > maxIDLen || len(deviceID) > maxIDLen || len(sessionID) > maxIDLen {
		c.rejected.Add(1)
		c.diag(Diagnostic{
			Code:    CodeRejected,
			Level:   LevelWarn,
			Message: fmt.Sprintf("identifier longer than %d bytes, dropping %s", maxIDLen, e.Name),
		})
		return
	}

	// Identity sits UNDER the caller's own attributes, so an entry that names
	// user.id explicitly wins over the client-level default. Anything else would
	// make a per-call override silently ineffective.
	identity := make(Attributes, 3)
	if userID != "" {
		identity[AttrUserID] = userID
	}
	if deviceID != "" {
		identity[AttrDeviceID] = deviceID
	}
	if sessionID != "" {
		identity[AttrSessionID] = sessionID
	}

	// body, trace_id and span_id are attributes, not columns: this product
	// promotes four columns and no more, and the spec's vocabulary is not ours
	// to promote. The dedicated field wins over a same-named attribute, because
	// naming it explicitly is the more specific statement.
	spec := make(Attributes, 3)
	if e.Body != "" {
		spec[AttrBody] = clampBody(e.Body)
	}
	if e.TraceID != "" {
		spec[AttrTraceID] = e.TraceID
	}
	if e.SpanID != "" {
		spec[AttrSpanID] = e.SpanID
	}

	at := e.Time
	if at.IsZero() {
		at = c.opts.Now()
	}

	resource := c.resourceFor(e)
	c.enqueue(item{
		group:      resourceKey(resource),
		resource:   resource,
		// An unclassified entry is never urgent: severity 0 means the caller
		// said nothing, and treating silence as ERROR would flush on every
		// entry that skipped the field.
		urgent: severity != 0 && severity >= c.opts.FlushOnSeverity,
		entry: wireEntry{
			ID:       newUUID(),
			Time:     at.UnixMilli(),
			Name:     e.Name,
			Severity: severity,
			Attributes: mergeAttributes(
				c.opts.DefaultAttributes,
				identity,
				clampAttributes(e.Attributes),
				spec,
			),
		},
	})
}

// Event records a conventional product event: any name you like, at INFO.
//
// One call to Log with the conventional fields filled in. An example of a good
// shape, not a schema: nothing it produces is privileged, and nothing you send
// without it is second class.
func (c *Client) Event(name string, attrs Attributes, e Entry) {
	// The clamping below reads the caller's own values, and an attribute that
	// is an error has its Error method called: the caller's code, on this
	// goroutine, BEFORE c.Log and therefore outside Log's guard. A typed-nil
	// error in an attribute map panics on its nil receiver. This is also the
	// helper the scoped handle and Page and User all funnel through, so an
	// unguarded panic here lands in a request handler. The entry is lost
	// instead, which is the trade this package is always allowed to make.
	defer func() {
		if r := recover(); r != nil {
			c.rejected.Add(1)
			c.diag(Diagnostic{
				Code:    CodeRejected,
				Level:   LevelError,
				Message: "recovered a panic while recording " + name,
			})
		}
	}()

	e.Name = name
	e.Attributes = mergeAttributes(clampAttributes(e.Attributes), clampAttributes(attrs))
	if e.Severity == 0 {
		e.Severity = SeverityInfo
	}
	c.Log(e)
}

// Error records a conventional exception entry, at ERROR.
//
// The single most valuable helper here, because it does the unwrapping the
// caller would otherwise do at every error site: the concrete type, the message,
// and the wrapped chain that errors.Unwrap walks, as exception.type,
// exception.message and exception.stacktrace.
//
// The name is "exception" for every one of them and the attributes say what
// happened, which is OpenTelemetry's shape. It means "all exceptions" is one
// name and "this exception" is a filter on a path, rather than a thousand names
// nobody can enumerate.
//
// This is a log entry like every other one. There is no error table and no error
// pipeline: it is only an error because of its severity and its attributes.
func (c *Client) Error(err error, attrs Attributes, e Entry) {
	if err == nil {
		return
	}
	// The unwrapping below calls err.Error() and formats the concrete type, both of
	// which are the caller's code. Log has its own guard, but this runs before it.
	defer func() {
		if r := recover(); r != nil {
			c.rejected.Add(1)
			c.diag(Diagnostic{
				Code:    CodeRejected,
				Level:   LevelError,
				Message: "recovered a panic while unwrapping an error",
			})
		}
	}()

	e.Name = NameException
	if e.Severity == 0 {
		e.Severity = SeverityError
	}
	if e.Body == "" {
		e.Body = err.Error()
	}
	e.Attributes = mergeAttributes(
		exceptionAttributes(err),
		clampAttributes(e.Attributes),
		clampAttributes(attrs),
	)
	c.Log(e)
}

// Trace records a line at TRACE.
func (c *Client) Trace(body string, attrs Attributes, e Entry) {
	c.line(SeverityTrace, body, attrs, e)
}

// Debug records a line at DEBUG.
func (c *Client) Debug(body string, attrs Attributes, e Entry) {
	c.line(SeverityDebug, body, attrs, e)
}

// Info records a line at INFO.
func (c *Client) Info(body string, attrs Attributes, e Entry) {
	c.line(SeverityInfo, body, attrs, e)
}

// Warn records a line at WARN.
func (c *Client) Warn(body string, attrs Attributes, e Entry) {
	c.line(SeverityWarn, body, attrs, e)
}

// ErrorLog records a line at ERROR with no error to unwrap.
//
// Error is taken by the helper that unwraps a thrown thing, which is the one
// worth the shorter name. This is for the case where you have a sentence and no
// error value.
func (c *Client) ErrorLog(body string, attrs Attributes, e Entry) {
	c.line(SeverityError, body, attrs, e)
}

// Fatal records a line at FATAL.
func (c *Client) Fatal(body string, attrs Attributes, e Entry) {
	c.line(SeverityFatal, body, attrs, e)
}

func (c *Client) line(severity int, body string, attrs Attributes, e Entry) {
	// Same hazard as Event, and the same trade: the clamping calls the Error
	// method of anything in the map that is one, before Log's guard is in scope.
	defer func() {
		if r := recover(); r != nil {
			c.rejected.Add(1)
			c.diag(Diagnostic{
				Code:    CodeRejected,
				Level:   LevelError,
				Message: "recovered a panic while recording " + NameLog,
			})
		}
	}()

	// A free-form line still needs a name, because name is the column a
	// dashboard groups on. NameLog is this client's convention for "a line, not
	// an occurrence of a thing"; pass your own name to Log for anything you want
	// to count.
	e.Name = NameLog
	e.Body = body
	if e.Severity == 0 {
		e.Severity = severity
	}
	e.Attributes = mergeAttributes(clampAttributes(e.Attributes), clampAttributes(attrs))
	c.Log(e)
}

// User records a conventional identify entry carrying user.id.
//
// The id is explicit and is not remembered, because a server process is not a
// person: it handles many at once, and any stored "current user" would be
// whoever was served last. Nothing is merged and nothing is back-filled; from
// here on, entries carrying this userID count as the same unique.
func (c *Client) User(userID string, e Entry) {
	e.UserID = userID
	c.Event(NameIdentify, nil, e)
}

// Page records a server-rendered page view.
//
// The path travels as the conventional url.path attribute. There is no url
// column: everything that is not one of the four promoted columns lives in
// attributes and is queried from there.
func (c *Client) Page(path string, e Entry) {
	var attrs Attributes
	if path != "" {
		attrs = Attributes{AttrURLPath: path}
	}
	c.Event(NamePageView, attrs, e)
}

// resourceFor builds the resource attributes for one entry: what is true of the
// process rather than of one entry.
//
// Returned nil when there is nothing to say, so an empty map never splits a
// batch in two.
func (c *Client) resourceFor(e Entry) Attributes {
	named := [...][2]string{
		{AttrServiceName, c.opts.ServiceName},
		{AttrServiceVersion, firstNonEmpty(e.ServiceVersion, c.opts.ServiceVersion)},
		{AttrChannel, firstNonEmpty(e.Channel, c.opts.Channel)},
		{AttrOSType, firstNonEmpty(e.OS, c.opts.OS)},
		{AttrHostArch, firstNonEmpty(e.Arch, c.opts.Arch)},
		{AttrBrowserLanguage, firstNonEmpty(e.Locale, c.opts.Locale)},
	}

	out := make(Attributes, len(named)+len(c.opts.Resource))
	for k, v := range c.opts.Resource {
		out[k] = v
	}
	for _, pair := range named {
		if pair[1] != "" {
			out[pair[0]] = pair[1]
		}
	}
	// Separate from the loop above because that array is string-typed and this
	// value has to reach the wire as a JSON boolean rather than as "true".
	if c.opts.TestMode {
		out[AttrTest] = true
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// enqueue never blocks. When the buffer is full it discards the oldest events
// to make room.
//
// Dropping the oldest rather than refusing the newest is what keeps the host
// honest under a long outage: what is lost is the stale tail of a backlog, not
// what is happening right now, and memory is capped either way.
func (c *Client) enqueue(it item) {
	// A bounded number of attempts, because other goroutines are pushing too
	// and an unbounded loop here would be a way to block after all.
	for i := 0; i < 8; i++ {
		select {
		case c.ch <- it:
			return
		default:
		}
		select {
		case <-c.ch:
			c.dropped.Add(1)
		default:
			// Someone else made room; try the send again.
		}
	}
	c.dropped.Add(1)
}

// -----------------------------------------------------------------------------
// Waiting
// -----------------------------------------------------------------------------

// Flush sends what is queued and waits for it, bounded by ctx.
//
// Awaiting it is optional everywhere. It exists for shutdown, for short-lived
// processes that may never reach a background tick, and for tests. It returns
// ctx.Err() if the budget runs out and ErrClosed on a closed client; neither
// means the events are lost, only that they are not confirmed sent.
func (c *Client) Flush(ctx context.Context) error {
	if c.disabled {
		return nil
	}
	if c.closed.Load() {
		return ErrClosed
	}
	req := make(chan struct{})
	select {
	case c.flushReq <- req:
	case <-ctx.Done():
		return ctx.Err()
	case <-c.done:
		return ErrClosed
	}
	select {
	case <-req:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-c.done:
		return ErrClosed
	}
}

// Close stops the client: one last best-effort send, then the sender goroutine
// exits and nothing of this client is left running.
//
// It is idempotent and safe to call twice, from any goroutine. The shutdown
// send makes one attempt per batch rather than retrying, because a shutdown
// path must not wait out a backoff ladder, and the whole of it is bounded by
// ExitFlushTimeout as well as by ctx: a slow network may not hold a process
// open. Set FlushOnExit to ToggleOff to skip it, which ScheduleStartup does by
// default.
//
// With PersistenceDisk, whatever did not make it out is written to the queue
// file here and is the backlog the next run starts with.
//
// If ctx expires first, Close returns ctx.Err() and the goroutine finishes on
// its own within one ExitFlushTimeout.
func (c *Client) Close(ctx context.Context) error {
	if c.disabled {
		return nil
	}
	c.closeOnce.Do(func() {
		// Set before the signal, so nothing new is queued behind the last send.
		c.closed.Store(true)
		close(c.quit)
	})
	select {
	case <-c.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Stats returns a snapshot of what the client has done.
func (c *Client) Stats() Stats {
	s := Stats{
		Rejected:       c.rejected.Load(),
		Dropped:        c.dropped.Load(),
		Sent:           c.sent.Load(),
		FailedRequests: c.failed.Load(),
		BreakerOpen:    c.brkOpen.Load(),
		Closed:         c.closed.Load(),
	}
	if c.ch != nil {
		s.Queued = len(c.ch)
	}
	return s
}

// -----------------------------------------------------------------------------
// The sender
// -----------------------------------------------------------------------------

// run is the single sender goroutine. It owns the pending slice, the breaker,
// the durable queue and every HTTP request; nothing else in this package
// performs I/O.
//
// pending starts as whatever survived the last run.
func (c *Client) run(pending []item) {
	defer close(c.done)
	if c.ownsHTTP {
		defer c.http.CloseIdleConnections()
	}
	if c.persist != nil {
		defer c.persist.close()
	}

	// Only interval carries a ticker. immediate reacts to arrivals, manual to
	// Flush, and startup to nothing at all, so a ticker in those modes would be
	// a wakeup that can never have anything to do.
	var tick <-chan time.Time
	if c.opts.Schedule == ScheduleInterval {
		ticker := time.NewTicker(c.opts.Every)
		defer ticker.Stop()
		tick = ticker.C
	}

	// retry is how a schedule without a ticker comes back to a batch that
	// failed, and how every schedule waits out an open breaker instead of
	// attempting on time regardless of outcome.
	retry := time.NewTimer(time.Hour)
	if !retry.Stop() {
		<-retry.C
	}
	defer retry.Stop()
	armed := false

	arm := func(d time.Duration) {
		// startup and manual have no timers by definition: a retry timer in
		// either would be exactly the scheduled send they promise not to make.
		if armed || c.opts.Schedule == ScheduleStartup || c.opts.Schedule == ScheduleManual {
			return
		}
		if d < time.Millisecond {
			d = time.Millisecond
		}
		retry.Reset(d)
		armed = true
	}
	disarm := func() {
		if !armed {
			return
		}
		if !retry.Stop() {
			select {
			case <-retry.C:
			default:
			}
		}
		armed = false
	}

	// Whatever survived the last run. startup exists for this one send and makes
	// no other; the rest treat it as a backlog their own schedule carries on
	// from here. manual is left alone, because manual means Flush and nothing
	// else.
	if len(pending) > 0 && c.opts.Schedule != ScheduleManual {
		pending = c.send(pending)
	}

	for {
		if len(pending) == 0 {
			disarm()
		} else if wait := c.nextAttempt.Sub(c.opts.Now()); wait > 0 {
			arm(wait)
		}

		select {
		case it := <-c.ch:
			at := len(pending)
			pending = append(pending, it)
			// Coalesce. Everything already queued joins this same pass, which is
			// what keeps `immediate` a handful of requests for a thousand calls
			// rather than a thousand requests.
			pending = c.drain(pending)
			// Read before admit, which may trim the front of pending and shift
			// everything in the backing array underneath a subslice of it.
			urgent := anyUrgent(pending[at:])
			pending = c.admit(pending, at)
			if c.sendNow(pending, urgent) {
				pending = c.send(pending)
			}

		case <-tick:
			pending = c.send(pending)

		case <-retry.C:
			armed = false
			pending = c.send(pending)

		case req := <-c.flushReq:
			// Flush is the caller overriding the schedule by hand, so it sends
			// under every one of them, startup and manual included.
			at := len(pending)
			pending = c.drain(pending)
			pending = c.admit(pending, at)
			pending = c.send(pending)
			close(req)

		case <-c.quit:
			disarm()
			at := len(pending)
			pending = c.drain(pending)
			pending = c.admit(pending, at)
			if c.opts.flushesOnExit() {
				// Time-bounded, because a slow network must not hold a process
				// open. quit is already closed, so the backoff inside attempt
				// returns at once: one try per batch, then done.
				//
				// A running backoff is cleared because there is no later attempt
				// for it to protect: the process is going. An OPEN BREAKER is
				// not, because that one has concluded the server is down, and
				// spending the shutdown budget finding out again helps nobody.
				c.nextAttempt = time.Time{}
				c.deadline = c.opts.Now().Add(c.opts.ExitFlushTimeout)
				pending = c.deliver(pending)
			}
			if c.persist != nil {
				// The last word on what did not make it out. Whatever is left
				// here is what the next run starts with.
				pending, _ = c.persist.sync(pending)
			}
			return
		}
	}
}

// sendNow reports whether a backlog that has just grown should go out now.
//
// urgent is whether anything that arrived in this pass is at or above
// FlushOnSeverity; anything older has already had its turn at this question.
func (c *Client) sendNow(pending []item, urgent bool) bool {
	if urgent {
		// flushOnSeverity outranks the schedule, manual and startup included.
		// An entry worth this severity leaves the process while the process
		// still exists, or it does not leave at all.
		return true
	}
	switch c.opts.Schedule {
	case ScheduleImmediate:
		return true
	case ScheduleInterval:
		return len(pending) >= c.opts.MaxBatch
	default:
		return false
	}
}

func anyUrgent(items []item) bool {
	for _, it := range items {
		if it.urgent {
			return true
		}
	}
	return false
}

// admit takes in everything that has just arrived: it mirrors the new entries to
// the durable queue and keeps the backlog bounded.
//
// The bound matters most under the schedules that do not send on a timer. The
// channel drops its own oldest when full, but once entries have moved into
// pending nothing else would ever cap them, and a manual client nobody flushes
// would grow for the life of the process.
func (c *Client) admit(pending []item, from int) []item {
	if c.persist != nil && from < len(pending) {
		c.persist.append(pending[from:])
	}
	before := len(pending)
	pending = c.trim(pending)
	if c.persist != nil && (len(pending) != before || c.persist.overCap()) {
		var dropped int
		pending, dropped = c.persist.sync(pending)
		c.noteDropped(dropped, "queue file full")
	}
	return pending
}

// send delivers and keeps the durable mirror in step with what is left over.
func (c *Client) send(pending []item) []item {
	before := len(pending)
	out := c.deliver(pending)
	if c.persist != nil && len(out) != before {
		var dropped int
		out, dropped = c.persist.sync(out)
		c.noteDropped(dropped, "queue file full")
	}
	return out
}

// drain moves everything currently buffered into pending, without blocking.
func (c *Client) drain(pending []item) []item {
	for {
		select {
		case it := <-c.ch:
			pending = append(pending, it)
		default:
			return pending
		}
	}
}

// deliver sends what it can and returns what is left to try later.
func (c *Client) deliver(pending []item) []item {
	if len(pending) == 0 {
		return pending
	}
	now := c.opts.Now()

	// Backing off is not the same as being on a timer. While a backoff is
	// running or the breaker is open, a scheduled wakeup must not turn into a
	// request: a fleet that retried on its interval regardless of outcome is a
	// load generator pointed at an incident.
	if now.Before(c.nextAttempt) || !c.brk.allow(now) {
		c.holdOff(now)
		return c.trim(pending)
	}

	batches := c.group(pending)
	for i, b := range batches {
		switch c.attempt(b.body) {
		case outcomeOK:
			c.sent.Add(int64(len(b.body.Entries)))

		case outcomePermanent:
			// The server understood us and said no. It will say no again.
			c.dropped.Add(int64(len(b.body.Entries)))

		default:
			// Everything from here on stays queued, oldest first.
			leftover := make([]item, 0, len(pending))
			for _, rest := range batches[i:] {
				leftover = append(leftover, rest.items...)
			}
			c.holdOff(c.opts.Now())
			return c.trim(leftover)
		}
	}
	c.nextAttempt = time.Time{}
	return pending[:0]
}

// holdOff sets the earliest moment another request may be made.
//
// The breaker's cooldown wins when it is longer, because the breaker is the
// thing that has concluded the server is down rather than merely slow.
func (c *Client) holdOff(now time.Time) {
	wait := c.opts.RetryBase
	if cool := c.brk.retryAfter(now); cool > wait {
		wait = cool
	}
	c.nextAttempt = now.Add(wait)
}

// trim bounds the held-over slice the same way the channel is bounded.
func (c *Client) trim(pending []item) []item {
	if len(pending) <= c.opts.QueueSize {
		return pending
	}
	excess := len(pending) - c.opts.QueueSize
	c.noteDropped(excess, "buffer full")
	return append(pending[:0], pending[excess:]...)
}

// noteDropped counts entries this client threw away and says so, because a
// queue that is dropping has to be visible from outside: a long interval with a
// small queue loses data quietly otherwise.
func (c *Client) noteDropped(n int, why string) {
	if n <= 0 {
		return
	}
	c.dropped.Add(int64(n))
	c.diag(Diagnostic{
		Code:    CodeDropped,
		Level:   LevelWarn,
		Message: fmt.Sprintf("%s: dropped %d of the oldest entries", why, n),
	})
}

type outcome int

const (
	outcomeOK outcome = iota
	outcomeTransient
	outcomePermanent
)

type batch struct {
	body  logBatch
	items []item
}

// group splits pending into request bodies, one per identity-and-resource pair,
// each no larger than the server accepts.
//
// Insertion order is kept explicitly, because Go randomises map iteration and an
// analytics client that sends the same backlog in a different order every run is
// one nobody can reason about.
func (c *Client) group(pending []item) []batch {
	order := make([]string, 0, 8)
	byGroup := make(map[string][]item, 8)
	for _, it := range pending {
		if _, seen := byGroup[it.group]; !seen {
			order = append(order, it.group)
		}
		byGroup[it.group] = append(byGroup[it.group], it)
	}

	out := make([]batch, 0, len(order))
	for _, key := range order {
		group := byGroup[key]
		for start := 0; start < len(group); start += c.opts.MaxBatch {
			end := start + c.opts.MaxBatch
			if end > len(group) {
				end = len(group)
			}
			chunk := group[start:end]
			entries := make([]wireEntry, len(chunk))
			for i, it := range chunk {
				entries[i] = it.entry
			}
			head := chunk[0]
			out = append(out, batch{
				body: logBatch{
					SourceKey: c.opts.SourceKey,
					Resource:  head.resource,
					Entries:   entries,
				},
				items: chunk,
			})
		}
	}
	return out
}

// attempt sends one batch, retrying transient failures with backoff.
func (c *Client) attempt(body logBatch) outcome {
	for try := 0; ; try++ {
		if !c.deadline.IsZero() && !c.opts.Now().Before(c.deadline) {
			// The shutdown budget is spent. Not a failed request, because no
			// request was made, and counting one would push the breaker over on
			// the way out for nothing.
			return outcomeTransient
		}

		result, reason := c.post(body)

		if result == outcomeOK {
			if c.brk.onSuccess() {
				c.brkOpen.Store(false)
				c.diag(Diagnostic{Code: CodeBreakerClose, Level: LevelDebug, Message: "server is answering again; sending resumed"})
			}
			return outcomeOK
		}

		c.failed.Add(1)

		if result == outcomePermanent {
			if c.brk.onSuccess() {
				c.brkOpen.Store(false)
			}
			c.diag(Diagnostic{
				Code:    CodeAbandoned,
				Level:   LevelError,
				Message: fmt.Sprintf("server rejected a batch of %d entries (%s)", len(body.Entries), reason),
			})
			return outcomePermanent
		}

		if c.brk.onFailure(c.opts.Now()) {
			c.brkOpen.Store(true)
			c.diag(Diagnostic{
				Code:    CodeBreakerOpen,
				Level:   LevelWarn,
				Message: "sending paused after repeated failures (" + reason + ")",
			})
		}

		if try >= c.opts.MaxRetries {
			return outcomeTransient
		}
		delay := backoff(try, c.opts.RetryBase, c.opts.RetryMax)
		c.diag(Diagnostic{
			Code:    CodeRetry,
			Level:   LevelDebug,
			Message: fmt.Sprintf("retrying %d entries in %s (%s)", len(body.Entries), delay, reason),
		})
		if !c.sleep(delay) {
			// Shutting down. Hand the batch back rather than sleeping through it.
			return outcomeTransient
		}
	}
}

// post makes one HTTP attempt. It never returns an error to the caller: every
// failure a request can produce is one of two outcomes.
func (c *Client) post(body logBatch) (outcome, string) {
	payload, err := json.Marshal(body)
	if err != nil {
		// Unreachable with these types, and still not worth retrying if it were.
		return outcomePermanent, "encode: " + err.Error()
	}

	// During shutdown the whole flush has a budget, and one request may not
	// spend more of it than is left. Outside shutdown the deadline is zero and
	// the request timeout stands alone.
	timeout := c.opts.RequestTimeout
	if !c.deadline.IsZero() {
		left := c.deadline.Sub(c.opts.Now())
		if left <= 0 {
			return outcomeTransient, "shutdown flush budget spent"
		}
		if left < timeout {
			timeout = left
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(payload))
	if err != nil {
		return outcomePermanent, "request: " + err.Error()
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return outcomeTransient, err.Error()
	}
	// Drained and closed so the connection returns to the pool. Leaving a body
	// undrained leaks a connection per flush.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	_ = resp.Body.Close()

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return outcomeOK, ""
	// 408 and 429 are the server asking us to come back, not a bad body.
	case resp.StatusCode == http.StatusRequestTimeout, resp.StatusCode == http.StatusTooManyRequests:
		return outcomeTransient, fmt.Sprintf("http %d", resp.StatusCode)
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		return outcomePermanent, fmt.Sprintf("http %d", resp.StatusCode)
	default:
		return outcomeTransient, fmt.Sprintf("http %d", resp.StatusCode)
	}
}

// sleep waits, or gives up early because the client is closing. It reports
// whether the full delay elapsed.
func (c *Client) sleep(d time.Duration) bool {
	if d <= 0 {
		select {
		case <-c.quit:
			return false
		default:
			return true
		}
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-c.quit:
		return false
	}
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// diag reports through the caller's hook, if there is one.
//
// A panic in that hook is the host's bug and is still not allowed to become
// ours, and there is nowhere left to report it that this package is permitted
// to write to, so it stops here.
func (c *Client) diag(d Diagnostic) {
	hook := c.opts.OnDiagnostic
	if hook == nil {
		return
	}
	defer func() { _ = recover() }()
	hook(d)
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// resourceKey flattens a resource map into a stable comparable string.
//
// Sorted, because Go randomises map iteration and two identical resources that
// hashed to different keys would double the number of requests for nothing. The
// separators are control bytes rather than punctuation, because attribute keys
// and values are customer data and could contain any separator we might have
// picked: a collision here would put one resource's entries under another's.
func resourceKey(r Attributes) string {
	if len(r) == 0 {
		return ""
	}
	keys := make([]string, 0, len(r))
	for k := range r {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k)
		b.WriteByte(0x01)
		fmt.Fprintf(&b, "%v", r[k])
		b.WriteByte(0x02)
	}
	return b.String()
}

// exceptionAttributes unwraps an error into the conventional exception.*
// attributes.
//
// Go has no stack on an error value, so exception.stacktrace carries the wrapped
// chain that errors.Unwrap walks, which is the nearest thing Go has to one and
// is what a reader actually wants: the layers a failure passed through.
func exceptionAttributes(err error) Attributes {
	out := Attributes{
		AttrExceptionType:    fmt.Sprintf("%T", err),
		AttrExceptionMessage: err.Error(),
	}

	var chain []string
	// Bounded, because an error chain can be a cycle and this runs on the
	// caller's goroutine.
	for wrapped, i := errors.Unwrap(err), 0; wrapped != nil && i < 32; wrapped, i = errors.Unwrap(wrapped), i+1 {
		chain = append(chain, fmt.Sprintf("%T: %s", wrapped, wrapped.Error()))
	}
	if len(chain) > 0 {
		stack := strings.Join(chain, "\n")
		if len(stack) > maxAttributeString {
			stack = stack[:maxAttributeString]
		}
		out[AttrExceptionStacktrace] = stack
	}

	if len(out[AttrExceptionMessage].(string)) > maxAttributeString {
		out[AttrExceptionMessage] = out[AttrExceptionMessage].(string)[:maxAttributeString]
	}
	return out
}

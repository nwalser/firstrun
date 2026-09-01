package firstrun

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"time"
)

// An HTTP middleware for net/http.
//
// One served request is ONE ORDINARY LOG ENTRY: the name "http.request", with
// the method, the route, the path, the status and the duration as attributes.
// There is no request table, no request pipeline and no second code path.
// Everything here ends in the same Log call a hand-written entry would, and it
// is only an http entry because of the name and the attributes on it.
//
// What this file does not do is work out who anybody is. Every identity is a
// function the caller supplies, and nothing below reads a cookie, a header, a
// session or a remote address on its own initiative. A library that guessed
// would be manufacturing uniques out of network trivia, and the customer would
// have no way to tell the invented ones from the real ones.
//
// Rule 7 governs the rest, and it has a second edge here that it does not have
// anywhere else in this package. The usual promise is that we never block or
// panic into the host. A middleware can also take capability AWAY: wrapping a
// ResponseWriter naively hides http.Flusher, http.Hijacker and io.ReaderFrom
// from the handler underneath, which breaks streaming responses, websocket
// upgrades and sendfile. Our telemetry quietly degrading their server is the
// same failure as our telemetry blocking it, so the wrapper below preserves the
// exact set of interfaces the real writer had.

// MiddlewareOptions configures Middleware.
//
// Every field is a function rather than a value, because every one of them is a
// question only the caller can answer: what an id is, what a route template is
// and which requests are not worth measuring are all facts about their
// application, not about HTTP.
type MiddlewareOptions struct {
	// UserID returns your own id for the person behind this request, or "" when
	// nobody is signed in. It lands in the user.id attribute and is only ever
	// the string you return: never derived, never looked up, never guessed.
	//
	// ALL THREE ARE OPTIONAL, and a middleware that sets none of them is a
	// legitimate configuration: the request is still measured, and its entries
	// carry no identity and count in no unique. Identity is never inferred
	// here, so read your own cookie, your own header, your own session, or set
	// nothing at all.
	//
	// Setting a field makes it the answer. What it returns, INCLUDING "", is
	// what the request context carries from here down: a value an outer
	// middleware of yours had put on is replaced rather than fallen back on,
	// because a front door that says "nobody" has answered the question. Leave
	// a field nil to defer to that context entirely.
	UserID func(*http.Request) string

	// DeviceID returns a machine this request names, when there is one. Lands
	// in device.id. A server has no device of its own, so leave this nil unless
	// your own protocol carries one.
	DeviceID func(*http.Request) string

	// SessionID returns your own session id for this request. Lands in
	// session.id. A request is not a session, so this is nil unless you have
	// one to give.
	SessionID func(*http.Request) string

	// Route returns the ROUTE TEMPLATE for this request, e.g. "/users/{id}".
	//
	// Never the resolved path. A template groups a million requests into one
	// readable row; the path groups them into a million rows of one, which is a
	// breakdown nobody can read and a high-cardinality group by the query layer
	// has to bound. When your router cannot give you a template, return "" and
	// the attribute is omitted: an absent key is honest, and url.path is on the
	// entry anyway.
	//
	// It is called AFTER the handler has run, because that is when a router
	// knows what it matched, and it is called on the request THIS MIDDLEWARE
	// was given. That is why a Route extractor only works when the middleware
	// is registered INSIDE the router (chi's and gorilla's router.Use, or per
	// route on a net/http mux) rather than wrapped around it. A router does not
	// annotate the request it was handed: it derives a new one during dispatch
	// and gives that to the matched handler, and the derived request never
	// comes back out to a wrapper sitting outside. Wrapped from outside, the
	// router lookup you write here comes back empty or nil on every request and
	// http.route is simply absent.
	Route func(*http.Request) string

	// Ignore reports whether this request should not be measured at all: health
	// checks, static assets, the readiness probe your orchestrator fires twice a
	// second. An ignored request passes through untouched, with no wrapper, no
	// identity on its context and no entry.
	Ignore func(*http.Request) bool
}

// Middleware returns net/http middleware that records one http.request entry per
// served request.
//
//	mw := analytics.Middleware(firstrun.MiddlewareOptions{
//		// sessionUser is YOUR function. This library never works out who
//		// somebody is on its own initiative, and setting none of these is fine.
//		UserID: func(r *http.Request) string { return sessionUser(r) },
//		Ignore:     func(r *http.Request) bool { return r.URL.Path == "/healthz" },
//		Route: func(r *http.Request) string {
//			return chi.RouteContext(r.Context()).RoutePattern()
//		},
//	})
//
//	// Registered INSIDE the router, not around it. Wrapped around it as
//	// mw(router), everything still works except Route: see that field.
//	router := chi.NewRouter()
//	router.Use(mw)
//	http.ListenAndServe(":8080", router)
//
// The identity is put on the request context, so a handler underneath records
// against the same request without being handed anything:
//
//	analytics.Ctx(r.Context()).Event("exported_csv", nil, firstrun.Entry{})
//
// The entry is at INFO, or at ERROR for a 5xx. A 4xx is the caller's mistake
// rather than the server's, and a board where every 404 is an ERROR is a board
// nobody can filter back down.
//
// Nothing here waits for anything. The entry goes on a channel after the handler
// has returned and the response is already on its way.
func (c *Client) Middleware(opts MiddlewareOptions) func(http.Handler) http.Handler {
	// A nil or disabled client hands back the customer's own handler, unwrapped.
	// The nil check is not paranoia about our own code: New returns a usable
	// client beside its error, so the value that reaches this call is whatever
	// the caller's wiring produced, and this is the one method in the package
	// whose failure would cost every request rather than one entry.
	if c == nil || c.disabled {
		return passthrough
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if c.ignores(opts.Ignore, r) {
				next.ServeHTTP(w, r)
				return
			}

			started := c.now()

			// The extractors run before the handler, on the request as it
			// arrived. They have to: the context this builds is the one the
			// handler is given, so there is no later moment at which putting an
			// identity on it would still reach anybody.
			userID := c.extract(opts.UserID, r, "UserID")
			deviceID := c.extract(opts.DeviceID, r, "DeviceID")
			sessionID := c.extract(opts.SessionID, r, "SessionID")

			ctx := r.Context()
			// An extractor you configured OWNS its field, and its answer is the
			// answer even when the answer is "". A front door is where an
			// application states who a request is from, so "nobody is signed in"
			// is a statement rather than a gap for us to fill in from whatever an
			// outer context happened to be carrying. Inheriting a user id there
			// would put the previous holder of that context onto an entry the
			// customer's own extractor said had no user, and an identity that
			// arrives from ambient state instead of from this request is exactly
			// the thing this library is not allowed to do, however harmless the
			// value looks. It would also not stop at the one entry: the id goes
			// onto the request context, so every Ctx call in every handler
			// underneath would inherit it too.
			//
			// A field with NO extractor keeps what was already there, and so do
			// the ambient attributes: nothing here has an opinion about those,
			// and replacing the identity wholesale would wipe an outer
			// middleware of the customer's own.
			ambient, _ := identityFrom(ctx)
			id := ambient
			if opts.UserID != nil {
				id.UserID = userID
			}
			if opts.DeviceID != nil {
				id.DeviceID = deviceID
			}
			if opts.SessionID != nil {
				id.SessionID = sessionID
			}
			// Stored only when one of the fields actually changed. Rebuilding
			// an identical identity would cost a context and a clamped copy of
			// the ambient attributes on every request for nothing. identityFrom
			// rather than FromContext for the same reason: FromContext copies the
			// map so a caller cannot race the holders, and NewContext copies it
			// again on the way in, so reading it through the public door here
			// would clamp the same map twice per request.
			// Field by field: Identity carries an Attributes map, and a struct
			// with a map in it is not comparable with ==.
			if id.UserID != ambient.UserID ||
				id.DeviceID != ambient.DeviceID ||
				id.SessionID != ambient.SessionID {
				ctx = NewContext(ctx, id)
				r = r.WithContext(ctx)
			}

			rw, sw := wrapWriter(w)
			// The method and the path are copied now rather than read later,
			// because routers rewrite them: a handler that strips a prefix or
			// rewrites a path in place would otherwise have us report the path
			// it rewrote to instead of the one that was asked for.
			f := inFlight{
				scoped:  c.Ctx(ctx),
				req:     r,
				method:  r.Method,
				path:    pathOf(r),
				writer:  sw,
				started: started,
			}

			// Deferred so the entry is recorded on both ways out, including the
			// one where the handler panics: a request that blew up is the one
			// most worth having on the board.
			//
			// This closure does NOT call recover, and that is the whole design.
			// A recover here would stop the handler's panic dead and silently
			// change the customer's error handling: their own recovery
			// middleware would never see it, net/http would never log it, and a
			// crash would become a hung-looking 200. finish has its own recover
			// instead, which catches a panic finish itself caused (a
			// misbehaving Route extractor, say) and cannot catch this frame's,
			// because recover only answers the deferred call of the frame the
			// panic is unwinding. So their panic passes through untouched and
			// ours never escapes.
			defer func() { c.finish(&f, opts.Route) }()

			next.ServeHTTP(rw, r)
			// Reached only on a normal return. Everything else (a panic, a
			// runtime.Goexit) leaves this false, which is how finish knows the
			// response was never completed without recovering to find out.
			f.returned = true
		})
	}
}

// passthrough is the middleware a nil or disabled client returns: the handler,
// exactly as it was.
func passthrough(next http.Handler) http.Handler { return next }

// inFlight is one request being watched.
//
// It exists so the deferred call takes one pointer rather than eight arguments,
// and so everything the entry is built from is captured before the handler is
// allowed to touch the request.
type inFlight struct {
	scoped  *Scoped
	req     *http.Request
	method  string
	path    string
	writer  *statusWriter
	started time.Time
	// returned reports that the handler came back normally. False means it
	// panicked or called runtime.Goexit, which is a question this package can
	// answer without recovering and therefore without interfering.
	returned bool
}

// finish records the one entry for a served request.
//
// Called from a deferred closure, which means it may be running while the
// handler's panic is unwinding. It must not make that panic worse and it must
// not make it disappear.
func (c *Client) finish(f *inFlight, route func(*http.Request) string) {
	// Ours alone. During the handler's unwind this recover returns nil, because
	// the panic belongs to the frame that deferred the call to finish and not to
	// finish: only that frame's own deferred function can answer for it. What it
	// does catch is a panic raised inside finish, which is a panic we caused and
	// are not allowed to pass on.
	defer func() {
		if p := recover(); p != nil {
			c.rejected.Add(1)
			c.diag(Diagnostic{
				Code:    CodeRejected,
				Level:   LevelError,
				Message: "recovered a panic while recording " + NameHTTPRequest,
			})
		}
	}()

	elapsed := c.now().Sub(f.started)
	if elapsed < 0 {
		elapsed = 0
	}

	attrs := make(Attributes, 6)
	attrs[AttrHTTPRequestMethod] = f.method
	if f.path != "" {
		attrs[AttrURLPath] = f.path
	}
	// Only ever the extractor's answer. Substituting the path when there is no
	// template would quietly turn one readable row into one row per id, and the
	// customer would have no way to tell which of their routes were templates
	// and which were guesses.
	//
	// Called here, after the handler, because a router knows what it matched
	// only once it has matched, and called on f.req, which is the request this
	// middleware handed down. There is no other request to call it on: routers
	// derive a new one during dispatch and give THAT to the matched handler, and
	// a wrapper outside the router never sees it. gorilla attaches the route to
	// the derived request, Go 1.23's ServeMux sets Request.Pattern on it, and chi
	// is the near miss, because the RouteContext it fills in is reachable through
	// an ancestor context, but only when chi found one already installed, which
	// is true from router.Use and false from outside. So the middleware belongs
	// inside the router. Outside it, those lookups come back empty or nil on
	// every request (and a lookup that dereferences the nil panics, which extract
	// recovers), so http.route is absent: missing rather than wrong, which is the
	// only acceptable way for this attribute to fail.
	if template := c.extract(route, f.req, "Route"); template != "" {
		attrs[AttrHTTPRoute] = template
	}
	// Milliseconds with microsecond resolution, not whole milliseconds: a
	// handler that answered in 400us is not a handler that answered in 0ms, and
	// on a server most of them are under one.
	attrs[AttrDurationMS] = float64(elapsed.Microseconds()) / 1000

	severity := SeverityInfo
	if status, ok := f.writer.sent(f.returned); ok {
		attrs[AttrHTTPResponseStatusCode] = status
		// A 5xx is the server answering for itself. A 4xx is the client's
		// mistake, and a board full of ERROR 404s is noise that drowns the
		// entries somebody actually needs to see.
		if status >= 500 {
			severity = SeverityError
		}
	}
	if !f.returned {
		severity = SeverityError
		// OpenTelemetry's key for an exception that got out of the scope it was
		// raised in, which is exactly what happened: the panic left the handler.
		// The panic value itself is not here, because catching it to read it is
		// the one thing this middleware may not do.
		attrs[AttrExceptionEscaped] = true
	}

	f.scoped.Log(Entry{
		Name:     NameHTTPRequest,
		Severity: severity,
		// Stamped when the request arrived rather than when it finished, so a
		// slow request lands in the bucket it started in and the duration
		// attribute says the rest. Bucketing on the end would move every long
		// request off the minute that caused it.
		Time:       f.started,
		Attributes: attrs,
	})
}

// extract calls one of the caller's extractors and returns "" if it panics.
//
// These functions are the customer's own code, running on the request path
// because we asked them to. A panic in one is their bug, and it is still not
// allowed to become their outage: the entry loses an id or a route, which is
// the trade this package is always allowed to make.
func (c *Client) extract(f func(*http.Request) string, r *http.Request, which string) (s string) {
	if f == nil {
		return ""
	}
	defer func() {
		if p := recover(); p != nil {
			s = ""
			c.diag(Diagnostic{
				Code:    CodeRejected,
				Level:   LevelError,
				Message: "recovered a panic in MiddlewareOptions." + which,
			})
		}
	}()
	return f(r)
}

// ignores asks the caller whether to skip this request.
//
// A panicking Ignore measures the request. Of the two ways to be wrong, an entry
// nobody wanted is cheaper than silently dropping the traffic somebody installed
// this middleware to see.
func (c *Client) ignores(f func(*http.Request) bool, r *http.Request) (skip bool) {
	if f == nil {
		return false
	}
	defer func() {
		if p := recover(); p != nil {
			skip = false
			c.diag(Diagnostic{
				Code:    CodeRejected,
				Level:   LevelError,
				Message: "recovered a panic in MiddlewareOptions.Ignore",
			})
		}
	}()
	return f(r)
}

// now is Options.Now, guarded, falling back to the real clock.
//
// Every other read of that clock is either on the sender goroutine or already
// inside a recover. The one at the top of the request path is neither: it runs
// before the deferred finish exists, so a panic in a clock the caller replaced
// would not cost an entry, it would cost the request, and the handler
// underneath would never be reached at all. That is the one thing this
// middleware promises cannot happen, and the guard costs nothing to keep it
// true. It also covers a Now that is nil, which is a Client that never had
// applyDefaults run over it.
func (c *Client) now() (t time.Time) {
	defer func() {
		if p := recover(); p != nil {
			t = time.Now()
			c.diag(Diagnostic{
				Code:    CodeRejected,
				Level:   LevelError,
				Message: "recovered a panic in Options.Now",
			})
		}
	}()
	return c.opts.Now()
}

// pathOf is the path that was asked for. Guarded because a middleware above us
// is free to hand the handler chain a request it built itself.
func pathOf(r *http.Request) string {
	if r == nil || r.URL == nil {
		return ""
	}
	return r.URL.Path
}

// statusWriter is the response, watched.
//
// It records what net/http actually put on the wire and nothing else: it does
// not buffer, does not copy the body, and adds one branch to a write. Its fields
// are touched only from the handler's own goroutine, which is the only place
// net/http permits a ResponseWriter to be used at all.
type statusWriter struct {
	http.ResponseWriter

	status int
	// wrote reports that the response has started, by any of the four routes
	// that start one: WriteHeader, Write, Flush and ReadFrom.
	wrote bool
	// hijacked reports that the handler took the connection over, after which
	// net/http sends no status line of its own and there is nothing here to
	// report.
	hijacked bool
}

func (w *statusWriter) WriteHeader(code int) {
	// 1xx is an informational response and does NOT settle the status: the
	// handler goes on to call WriteHeader again with the real one. The exception
	// is 101, which is final, and this is the same test net/http itself applies
	// before deciding whether a WriteHeader finished the response.
	if code >= 100 && code <= 199 && code != http.StatusSwitchingProtocols {
		w.ResponseWriter.WriteHeader(code)
		return
	}
	if !w.wrote {
		w.status = code
		w.wrote = true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	// net/http sends 200 on the first write when nobody named a status, so the
	// status is settled here even though nothing said so. A WriteHeader after
	// this point is the superfluous call net/http logs and ignores, and it must
	// not be allowed to rewrite the number we report either.
	w.wrote = true
	return w.ResponseWriter.Write(b)
}

// Unwrap lets http.NewResponseController reach the real writer, so a handler
// setting a read or write deadline still reaches the connection underneath.
// Flush and Hijack do not need it: the controller tries the writer it was given
// first, and finds the ones below.
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// sent reports the status net/http actually put on the wire, and whether there
// was one at all.
//
// returned says whether the handler came back normally, which is what separates
// the two silent cases: a handler that returns without writing anything gets a
// 200 from net/http, and a handler that panicked gets no response line at all
// because net/http logs the panic and closes the connection. Reporting 200 for
// the second would be a number nobody could check.
func (w *statusWriter) sent(returned bool) (int, bool) {
	if w.hijacked {
		return 0, false
	}
	if w.wrote || returned {
		return w.status, true
	}
	return 0, false
}

// The three optional interfaces, each delegated through a shim rather than
// embedded raw, because all three of them start the response and the wrapper has
// to know that they did.
type (
	flusher struct {
		on *statusWriter
		fl http.Flusher
	}
	hijacker struct {
		on *statusWriter
		hj http.Hijacker
	}
	readFrom struct {
		on *statusWriter
		rf io.ReaderFrom
	}
)

// Flush starts the response when nothing has written yet, the same as a Write,
// which is what net/http does with a flush on an unwritten response.
func (f flusher) Flush() {
	f.on.wrote = true
	f.fl.Flush()
}

// Hijack hands the connection to the handler. Marked only on success, because a
// Hijack that failed (an HTTP/2 request, say) left net/http in charge of the
// response and its status still counts.
func (h hijacker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, buf, err := h.hj.Hijack()
	if err == nil {
		h.on.hijacked = true
	}
	return conn, buf, err
}

// ReadFrom is the sendfile path: io.Copy to a ResponseWriter finds it and hands
// the body to the kernel. It writes the body, so it starts the response.
func (r readFrom) ReadFrom(src io.Reader) (int64, error) {
	r.on.wrote = true
	return r.rf.ReadFrom(src)
}

// The seven shapes that carry at least one optional interface. The suffix names
// which: F for http.Flusher, H for http.Hijacker, R for io.ReaderFrom. The
// eighth shape is the bare statusWriter, for a writer that had none of them.
//
// Seven types rather than one that implements all three, because one wrapper
// implementing everything would answer yes to every type assertion regardless of
// what the real writer could do. A handler that got a Hijacker out of an HTTP/2
// response would take the upgrade path and fail there, which is worse than being
// told up front that it cannot hijack. The handler has to see exactly what it
// would have seen without us.
type (
	writerF struct {
		*statusWriter
		flusher
	}
	writerH struct {
		*statusWriter
		hijacker
	}
	writerR struct {
		*statusWriter
		readFrom
	}
	writerFH struct {
		*statusWriter
		flusher
		hijacker
	}
	writerFR struct {
		*statusWriter
		flusher
		readFrom
	}
	writerHR struct {
		*statusWriter
		hijacker
		readFrom
	}
	writerFHR struct {
		*statusWriter
		flusher
		hijacker
		readFrom
	}
)

// wrapWriter returns a writer with the same interfaces w had, and the recorder
// reading it.
//
// Two interfaces are deliberately not carried across: http.CloseNotifier, which
// has been deprecated since Go 1.11 in favour of the request context this
// middleware leaves alone, and http.Pusher, the HTTP/2 server push no browser
// still implements. Both are behind an "if it supports it" test at every call
// site that uses them, so a handler asking for one gets a no and its fallback,
// and covering them would have made this thirty-two shapes instead of eight.
func wrapWriter(w http.ResponseWriter) (http.ResponseWriter, *statusWriter) {
	// 200 up front, because that is what net/http sends for a handler that
	// writes a body, or nothing at all, without ever naming a status.
	sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}

	fl, hasFlusher := w.(http.Flusher)
	hj, hasHijacker := w.(http.Hijacker)
	rf, hasReaderFrom := w.(io.ReaderFrom)

	switch {
	case hasFlusher && hasHijacker && hasReaderFrom:
		return writerFHR{sw, flusher{sw, fl}, hijacker{sw, hj}, readFrom{sw, rf}}, sw
	case hasFlusher && hasHijacker:
		return writerFH{sw, flusher{sw, fl}, hijacker{sw, hj}}, sw
	case hasFlusher && hasReaderFrom:
		return writerFR{sw, flusher{sw, fl}, readFrom{sw, rf}}, sw
	case hasHijacker && hasReaderFrom:
		return writerHR{sw, hijacker{sw, hj}, readFrom{sw, rf}}, sw
	case hasFlusher:
		return writerF{sw, flusher{sw, fl}}, sw
	case hasHijacker:
		return writerH{sw, hijacker{sw, hj}}, sw
	case hasReaderFrom:
		return writerR{sw, readFrom{sw, rf}}, sw
	default:
		return sw, sw
	}
}

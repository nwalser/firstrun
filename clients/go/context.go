package firstrun

import "context"

// Request-scoped identity.
//
// A server process is not a person: it handles many at once, so every recording
// method takes the identity per call and the Options identity is deliberately
// wrong to set in a multi-tenant service. That is correct and it is also
// tedious, because it means threading an id through every function that might
// want to record something, including the ones five layers down that otherwise
// have no reason to know who they are working for.
//
// Go already has the answer to that, and it is context.Context. A middleware
// puts the identity on the request context once; anything holding that context
// records against it without being handed anything else.
//
// Nothing here infers an identity. This file reads no cookie, no header, no
// session store and no remote address, and it joins nothing to anything: the
// customer's own code decides what these ids are and puts them here, exactly as
// it would put them on an Entry.

// Identity is who the entries recorded under one context are about.
//
// It is the identity half of Entry and nothing more, so everything true of
// those fields is true of these: every field is optional, none is inferred, and
// the user id is only ever the string the customer passed to their own call.
//
// This is what makes a scoped handle worth having: a multi-tenant server cannot
// set the identity in Options, because the process is not the subject.
type Identity struct {
	// UserID is the customer's own id for the person this scope is about, and
	// lands in the user.id attribute.
	UserID string
	// DeviceID names a machine, when this request names one. Lands in device.id.
	DeviceID string
	// SessionID lands in the session.id attribute.
	SessionID string

	// Attributes are stamped onto every entry recorded through this context:
	// the tenant, the request id, the route, whatever is true of this request
	// and of nothing else. They sit UNDER the entry's own attributes, so a
	// value stated at the call site always wins.
	//
	// Copied on the way in, so the caller may reuse the map.
	Attributes Attributes
}

// identityKey is the context key. An unexported struct type, so no other
// package can collide with it and none can reach the value except through
// FromContext.
type identityKey struct{}

// NewContext returns a copy of ctx carrying id.
//
// A nil ctx is treated as context.Background rather than panicking. This
// package is not allowed to take its host down over its own bookkeeping, and
// context.WithValue on a nil parent is exactly the panic a middleware writes
// once, in the error path, and finds in production.
//
// An empty Identity is stored like any other, deliberately: a handler that
// wants the work it is about to do attributed to nobody clears the ambient
// identity by putting an empty one on, and a NewContext that quietly did
// nothing in that case would leak the outer identity into it instead.
func NewContext(ctx context.Context, id Identity) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	// Copied and bounded here rather than once per entry. This map is read by
	// every goroutine that goes on to hold the context, so a caller who kept a
	// reference and mutated it would be racing all of them, and a concurrent
	// map write is the one failure Go does not let anybody recover from.
	id.Attributes = clampIdentityAttributes(id.Attributes)
	return context.WithValue(ctx, identityKey{}, id)
}

// FromContext returns the identity carried by ctx, and whether there was one.
//
// The attribute map it hands back is a copy, for the same reason NewContext
// took one: what is stored on the context is read concurrently, and a caller
// who mutated it would be racing every other holder.
func FromContext(ctx context.Context) (Identity, bool) {
	id, ok := identityFrom(ctx)
	if !ok {
		return Identity{}, false
	}
	id.Attributes = clampIdentityAttributes(id.Attributes)
	return id, true
}

// clampIdentityAttributes bounds an ambient attribute map without letting the
// host's own code take the host down.
//
// Clamping is not merely a copy. A value that is an error has its Error method
// called so the message can be stored, and that method is the host's code,
// running on the host's goroutine. The classic Go typed-nil (a *MyErr that is
// nil, held in an error interface) panics on its nil receiver, and the frames
// that panic would unwind through are the customer's own middleware, because a
// middleware is exactly where the docs tell them to call NewContext from. Log
// has a Client to hang a recover on and does; NewContext and FromContext are
// package functions and have to carry their own, which is what makes the
// promise in NewContext's doc comment true rather than aspirational.
//
// The whole map goes when one value blows up, because clampAttributes cannot be
// resumed halfway. That is a smaller loss than Log already takes for the same
// hazard, where the entry itself goes, and it leaves the ids, which are the
// half that decides whether anything can be recorded at all.
func clampIdentityAttributes(in Attributes) Attributes {
	// A recovered panic leaves the result at its zero value, which is the nil
	// this returns anyway for a map with nothing sendable in it.
	defer func() { _ = recover() }()
	return clampAttributes(in)
}

// identityFrom is the internal read, without the copy. Its callers (Ctx and the
// middleware) pass the map straight to mergeAttributes or to NewContext, and
// neither writes to it.
func identityFrom(ctx context.Context) (Identity, bool) {
	if ctx == nil {
		return Identity{}, false
	}
	id, ok := ctx.Value(identityKey{}).(Identity)
	return id, ok
}

// Scoped is a Client bound to one request's identity. Every method mirrors the
// Client method of the same name, takes the same arguments, and differs only in
// filling the identity fields the caller left blank.
//
// Precedence is one rule and it does not vary by helper, by field or by
// schedule: what the CALL SITE states wins, then what the CONTEXT carries, then
// what the CLIENT was configured with in Options. A handler with a better id
// for one entry sets it on the Entry and that one is used; everything else gets
// the request's.
//
// Flush and Close are not here. They are lifecycle, and a per-request handle is
// not where a process decides to stop. User is not here either, because it
// needs no shorter form: the entry it sends is
// s.Event(NameIdentify, nil, Entry{UserID: id}), with the rest of the identity coming
// from the context like every other entry's.
type Scoped struct {
	c  *Client
	id Identity
}

// Ctx returns a handle that fills identity in from ctx.
//
//	func withIdentity(next http.Handler) http.Handler {
//		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
//			// visitorID is the customer's own function. This package never
//			// works out who somebody is on its own initiative.
//			ctx := firstrun.NewContext(r.Context(), firstrun.Identity{
//				UserID: accountID(r),
//			})
//			next.ServeHTTP(w, r.WithContext(ctx))
//		})
//	}
//
//	func exportHandler(w http.ResponseWriter, r *http.Request) {
//		analytics.Ctx(r.Context()).Event("exported_csv", nil, firstrun.Entry{})
//	}
//
// The handle is a value derived from the client, not a second client: there is
// one queue, one sender goroutine and one set of counters however many of these
// exist, and making one per request costs an allocation and no I/O.
//
// A nil context, or one carrying no identity, gives a handle that behaves
// exactly like the client itself.
func (c *Client) Ctx(ctx context.Context) *Scoped {
	id, _ := identityFrom(ctx)
	return &Scoped{c: c, id: id}
}

// fill applies the ambient identity underneath whatever the caller stated.
//
// The client-level defaults are not consulted here: Log already falls back to
// Options for a blank identity, so leaving it blank at this layer is what puts
// the context in the middle of the two rather than in front of both.
func (s *Scoped) fill(e Entry) Entry {
	// One unit, one layer: an entry that states any identity of its own keeps
	// all of it and inherits none of this scope's. Filling the three fields
	// independently is how a background job recorded inside a request keeps the
	// requester's user.id while naming its own device.
	if e.UserID == "" && e.DeviceID == "" && e.SessionID == "" {
		e.UserID, e.DeviceID, e.SessionID = s.id.UserID, s.id.DeviceID, s.id.SessionID
	}
	// Guarded rather than merged unconditionally, because mergeAttributes
	// allocates a map sized for the full attribute bound and most requests
	// carry no ambient attributes at all. The merged map is bounded and clamped
	// downstream like any other entry's attributes.
	if len(s.id.Attributes) > 0 {
		e.Attributes = mergeAttributes(s.id.Attributes, e.Attributes)
	}
	return e
}

// Log records an entry, with the context's identity where the entry has none.
func (s *Scoped) Log(e Entry) { s.c.Log(s.fill(e)) }

// Event records a conventional product event at INFO.
func (s *Scoped) Event(name string, attrs Attributes, e Entry) {
	s.c.Event(name, attrs, s.fill(e))
}

// Error records a conventional exception entry at ERROR, unwrapped.
func (s *Scoped) Error(err error, attrs Attributes, e Entry) {
	s.c.Error(err, attrs, s.fill(e))
}

// Trace records a line at TRACE.
func (s *Scoped) Trace(body string, attrs Attributes, e Entry) {
	s.c.Trace(body, attrs, s.fill(e))
}

// Debug records a line at DEBUG.
func (s *Scoped) Debug(body string, attrs Attributes, e Entry) {
	s.c.Debug(body, attrs, s.fill(e))
}

// Info records a line at INFO.
func (s *Scoped) Info(body string, attrs Attributes, e Entry) {
	s.c.Info(body, attrs, s.fill(e))
}

// Warn records a line at WARN.
func (s *Scoped) Warn(body string, attrs Attributes, e Entry) {
	s.c.Warn(body, attrs, s.fill(e))
}

// ErrorLog records a line at ERROR with no error to unwrap.
func (s *Scoped) ErrorLog(body string, attrs Attributes, e Entry) {
	s.c.ErrorLog(body, attrs, s.fill(e))
}

// Fatal records a line at FATAL.
func (s *Scoped) Fatal(body string, attrs Attributes, e Entry) {
	s.c.Fatal(body, attrs, s.fill(e))
}

// Page records a server-rendered page view, with the path as url.path.
func (s *Scoped) Page(path string, e Entry) { s.c.Page(path, s.fill(e)) }

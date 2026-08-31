package firstrun

import (
	cryptorand "crypto/rand"
	"encoding/hex"
	"math"
	"regexp"
	"sync/atomic"
	"time"
)

// The parts of the wire contract this client has to know, copied by hand from
// packages/schema/src/log.ts, severity.ts, attributes.ts and conventions.ts.
//
// A published client outlives the server it was built against: pinning the
// shape here means an old binary keeps sending a body the edge still
// understands, rather than one that drifted with a version bump nobody
// redeployed. If the contract moves, this file moves with it.
//
// # One shape for everything
//
// There is no event type, no error type and no metric type. There is a LOG
// ENTRY, and that is all there is. An error is an entry with a high severity
// and exception.* attributes. A measurement is an entry carrying
// firstrun.metric and firstrun.value. A product event is an entry with a name
// and whatever attributes the caller thought were worth keeping. Meaning is
// assigned by CONVENTION when it is written and by QUERY when it is read, never
// by a closed set of types in the backend.

// sourceKeyRE matches fr_<16 hex>. The middle segment used to name the kind of
// source the key belonged to; there are no kinds of source.
var sourceKeyRE = regexp.MustCompile(`^fr_[0-9a-f]{16}$`)

// logNameRE is the only check any entry name gets. There is no allowlist:
// ':' and '>' are excluded because the server reserves them as key delimiters,
// so a name containing one could forge a key of a different shape.
var logNameRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)

const (
	// maxEntriesPerBatch is the server's hard limit. A larger body is rejected whole.
	maxEntriesPerBatch = 500
	// maxIDLen bounds the three identity attributes.
	maxIDLen = 512
	// ingestPath is the one ingestion route. Every body shape goes to it.
	ingestPath = "/v1/e"
	// maxBody is the longest body string this client sends. Truncated, never dropped.
	maxBody = 16384
)

// The bounds the edge enforces, mirrored here so one oversized attribute costs
// itself rather than costing the whole batch its existence. The edge rejects a
// body that breaks any of these, and a rejected body is a permanent failure that
// takes every entry travelling beside it down too.
const (
	maxAttributes      = 64
	maxAttributeDepth  = 4
	maxAttributeKey    = 128
	maxAttributeString = 4096
	maxAttributeItems  = 128
)

// The OpenTelemetry severity ladder: twenty-four numbers in six bands of four.
//
// The number is authoritative and is what the server stores; text is derived
// from it for display and never travels. Two entries that sorted differently
// because one said "warn" and the other said "WARNING" would be a bug nobody
// could see.
//
// The three spare steps inside each band exist so a program whose own logger has
// nine levels can map onto this without losing the ordering: SeverityWarn+1 is a
// slightly worse warning and still filters as a warning.
const (
	SeverityTrace = 1
	SeverityDebug = 5
	SeverityInfo  = 9
	SeverityWarn  = 13
	SeverityError = 17
	SeverityFatal = 21

	severityMin = 1
	severityMax = 24
)

// Conventional entry names. SUGGESTIONS, NOT LAW: any name matching logNameRE is
// stored, counted, grouped and filtered identically by the whole system.
const (
	NamePageView     = "page_view"
	NameSessionStart = "session_start"
	NameAppInstall   = "app_install"
	NameAppLaunch    = "app_launch"
	NameIdentify     = "identify"
	NameException    = "exception"
	NameHTTPRequest  = "http.request"
	NameMeasurement  = "measurement"
	// NameLog is what the level helpers name an entry. A free-form line still
	// needs a name, because name is the column a dashboard groups on.
	NameLog = "log"
)

// Conventional attribute keys, from packages/schema/src/conventions.ts. The
// exception, session, user, service, os, http and url keys are OpenTelemetry's,
// used verbatim; the firstrun.* keys are ours, namespaced so it is obvious at a
// glance which half of the vocabulary we can change.
const (
	// AttrBody is the human-readable line.
	//
	// OpenTelemetry's log model has body as a top-level field. This product
	// promotes five columns and no more, so it travels as an attribute under the
	// spec's own name. Same for AttrTraceID and AttrSpanID: they are part of the
	// spec's vocabulary, not part of ours, and promoting one later is a generated
	// column over attributes rather than a schema break.
	AttrBody    = "body"
	AttrTraceID = "trace_id"
	AttrSpanID  = "span_id"

	AttrExceptionType       = "exception.type"
	AttrExceptionMessage    = "exception.message"
	AttrExceptionStacktrace = "exception.stacktrace"
	AttrExceptionEscaped    = "exception.escaped"

	AttrSessionID = "session.id"
	AttrUserID    = "user.id"
	AttrDeviceID  = "device.id"

	AttrServiceName    = "service.name"
	AttrServiceVersion = "service.version"

	AttrOSType          = "os.type"
	AttrHostArch        = "host.arch"
	AttrBrowserLanguage = "browser.language"

	AttrURLPath = "url.path"
	AttrURLFull = "url.full"

	AttrHTTPRequestMethod      = "http.request.method"
	AttrHTTPResponseStatusCode = "http.response.status_code"
	AttrHTTPRoute              = "http.route"

	AttrChannel    = "firstrun.channel"
	// AttrTest marks test data. Written only as the JSON boolean true, and only
	// when true: the dashboard matches it with jsonb containment, where the
	// string "true" is a different value and would match neither world.
	AttrTest = "firstrun.test"
	AttrDurationMS = "firstrun.duration_ms"
	AttrValue      = "firstrun.value"
	AttrMetric     = "firstrun.metric"
	AttrUnit       = "firstrun.unit"
)

// Attributes is everything about an entry that is not one of the five promoted
// columns. The backend does not know what any key means, which is the point: a
// closed set of columns is a closed set of questions, and the one thing we
// cannot know in advance is which question a customer needs answered.
type Attributes = map[string]any

// logBatch is the LogBatch body, exactly. Field names are the contract; do not
// add any.
//
// The keys are one letter because this is the same body the browser tag posts
// from sendBeacon on a page being unloaded, where bytes are the constraint: one
// shape for every client rather than a compact browser dialect beside a verbose
// SDK one. A second body shape is a second thing to get wrong in a proxy config
// and a second normaliser to keep in step.
type logBatch struct {
	// SourceKey identifies a destination and authorises nothing.
	SourceKey string `json:"k"`
	// Resource is what is true of the whole PROCESS rather than of one entry:
	// the build, the operating system, the release channel. It sits once per
	// body because it does not change between two entries in the same request,
	// and repeating it 250 times is 250 copies of one string. The edge merges it
	// UNDER each entry's own attributes, so an entry that sets the same key wins.
	Resource Attributes  `json:"r,omitempty"`
	Entries  []wireEntry `json:"e"`
}

// wireEntry is one entry on the wire. Five fields, and there is no sixth.
//
// body, trace_id and span_id are not fields here: they are attributes, under the
// spec's own names, because this product promotes five columns and no more.
// observed_timestamp is not sent at all, because the edge stamps ingested_at
// itself and would overwrite anything a client claimed.
type wireEntry struct {
	// ID is client-generated, so a request that times out and is retried is
	// deduplicated by the server rather than counted twice.
	ID string `json:"i"`
	// Time is when it happened, ms since epoch. Client-stamped and
	// AUTHORITATIVE: an entry queued during an outage and delivered an hour
	// later is still counted at the moment it happened.
	Time int64  `json:"t"`
	Name string `json:"n"`
	// Severity is 1..24. Omitted rather than guessed when the caller said
	// nothing: an entry with no severity is honestly unclassified, and one
	// silently filed as INFO is a lie a filter will act on.
	Severity int `json:"s,omitempty"`
	// Attributes is everything else about this entry.
	Attributes Attributes `json:"a,omitempty"`
}

// item is one queued entry with the batch-level context it must travel with.
//
// The resource sits on the batch rather than on the entry, so two entries may
// only share a request if their resources match. group is that resource
// flattened into a comparable key. Identity lives in the resource, so grouping
// on it is also what keeps two people out of one body.
type item struct {
	group string
	// resource is carried alongside the key so the batch can be built without
	// parsing it back out.
	resource Attributes
	// urgent means this entry is at or above Options.FlushOnSeverity and goes
	// out at once whatever the schedule says.
	urgent bool
	entry  wireEntry
}

// isLogName reports whether the server will accept this as an entry name.
func isLogName(name string) bool { return logNameRE.MatchString(name) }

// clampSeverity keeps a caller's number on the ladder. Zero means "the caller
// said nothing", which is honest and is not an error.
func clampSeverity(n int) int {
	if n == 0 {
		return 0
	}
	if n < severityMin {
		return severityMin
	}
	if n > severityMax {
		return severityMax
	}
	return n
}

// clampBody bounds a body string. Truncated rather than dropped: half a line
// still says something.
func clampBody(s string) string {
	if len(s) <= maxBody {
		return s
	}
	return s[:maxBody]
}

// clampAttributes copies and bounds an attribute map, returning nil when nothing
// survived.
//
// Copying matters as much as clamping: a caller who reuses and mutates their map
// after the call must not be able to rewrite an entry already recorded.
func clampAttributes(in Attributes) Attributes {
	if len(in) == 0 {
		return nil
	}
	out := make(Attributes, len(in))
	for k, v := range in {
		if len(out) >= maxAttributes {
			break
		}
		if k == "" || len(k) > maxAttributeKey {
			continue
		}
		cleaned, ok := clampValue(v, maxAttributeDepth)
		if !ok {
			continue
		}
		out[k] = cleaned
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// clampValue returns a value the edge will accept, and false when there is
// nothing sendable.
//
// Non-finite floats go because NaN and Infinity are not JSON: encoding/json
// refuses them outright, which would cost the whole batch every entry in it.
// Anything past the depth limit is dropped rather than flattened, because a
// truncated object that still looks like an object is worse to debug than a key
// that is honestly absent.
func clampValue(v any, depth int) (any, bool) {
	switch value := v.(type) {
	case nil:
		return nil, true
	case string:
		if len(value) > maxAttributeString {
			return value[:maxAttributeString], true
		}
		return value, true
	case bool:
		return value, true
	case float32:
		return clampFloat(float64(value))
	case float64:
		return clampFloat(value)
	case int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64:
		return value, true
	case time.Time:
		return value.UTC().Format(time.RFC3339Nano), true
	case error:
		return clampValue(value.Error(), depth)
	}

	if depth <= 1 {
		return nil, false
	}

	switch value := v.(type) {
	case Attributes:
		out := make(Attributes, len(value))
		for k, item := range value {
			if len(out) >= maxAttributeItems {
				break
			}
			if k == "" || len(k) > maxAttributeKey {
				continue
			}
			cleaned, ok := clampValue(item, depth-1)
			if !ok {
				continue
			}
			out[k] = cleaned
		}
		return out, true
	case []any:
		out := make([]any, 0, len(value))
		for _, item := range value {
			if len(out) >= maxAttributeItems {
				break
			}
			cleaned, ok := clampValue(item, depth-1)
			if !ok {
				// A hole in an array shifts every later index. Null is the
				// honest stand-in for "this one did not survive".
				cleaned = nil
			}
			out = append(out, cleaned)
		}
		return out, true
	case []string:
		out := make([]any, 0, len(value))
		for _, s := range value {
			if len(out) >= maxAttributeItems {
				break
			}
			cleaned, _ := clampValue(s, depth-1)
			out = append(out, cleaned)
		}
		return out, true
	}

	// A type this client cannot vouch for. Dropped rather than handed to
	// encoding/json, which might refuse it and take the batch with it.
	return nil, false
}

func clampFloat(f float64) (any, bool) {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return nil, false
	}
	return f, true
}

// mergeAttributes merges bounded maps. Later maps win, and the count stays
// bounded. Returns nil when everything was empty.
func mergeAttributes(maps ...Attributes) Attributes {
	out := make(Attributes, maxAttributes)
	for _, m := range maps {
		for k, v := range m {
			if _, known := out[k]; !known && len(out) >= maxAttributes {
				continue
			}
			out[k] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

var uuidFallback atomic.Uint64

// newUUID returns a version 4 UUID.
//
// Entry ids are generated on this side so a request that times out and is
// retried is deduplicated by the server rather than counted twice. If the system
// source of randomness is unavailable we still return a distinct id: a duplicate
// entry id would be counted once, which is worse than an id that is merely
// unpredictable to nobody.
func newUUID() string {
	var b [16]byte
	if _, err := cryptorand.Read(b[:]); err != nil {
		n := uint64(time.Now().UnixNano()) ^ (uuidFallback.Add(1) << 32)
		for i := 0; i < 8; i++ {
			b[i] = byte(n >> (8 * i))
			b[i+8] = byte(n>>(8*i)) ^ 0x5a
		}
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80

	var out [36]byte
	hex.Encode(out[0:8], b[0:4])
	out[8] = '-'
	hex.Encode(out[9:13], b[4:6])
	out[13] = '-'
	hex.Encode(out[14:18], b[6:8])
	out[18] = '-'
	hex.Encode(out[19:23], b[8:10])
	out[23] = '-'
	hex.Encode(out[24:36], b[10:16])
	return string(out[:])
}

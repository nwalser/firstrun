package firstrun

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The delivery policy: WHEN this client sends what it has collected.
//
// See docs/delivery-policy.md. Two axes, and conflating them is the mistake:
// scheduling decides when a send is attempted, durability decides what is still
// there after a crash or a kill. "Send once at startup" is not a schedule on its
// own; it is a schedule that never fires during the run combined with a queue
// that survives to the next one, and a single enum cannot express that.
//
// The policy never overrides the reliability rules. Nothing here may block the
// caller, panic into the host, retry unboundedly, grow without limit, or write
// to the host's stdout or stderr.

// Schedule decides when a send is attempted.
type Schedule string

const (
	// ScheduleImmediate sends as soon as a batch can be formed.
	//
	// It means "do not wait for a timer", NOT "one request per entry". Entries
	// that arrive while a request is in flight, or in the same pass of the
	// sender loop, coalesce into one batch: a loop calling Event a thousand
	// times produces a handful of requests, not a thousand. Reading "live" as
	// synchronous would put this client in the caller's critical path, which is
	// the one thing it may never do.
	ScheduleImmediate Schedule = "immediate"

	// ScheduleInterval sends every Every, or as soon as MaxBatch entries are
	// waiting, whichever comes first. The default, and the right one for a
	// long-lived server process.
	ScheduleInterval Schedule = "interval"

	// ScheduleStartup drains whatever survived the last run and then never sends
	// again during this one: what this run produces is left for the next launch.
	// The quietest mode there is, one burst of requests per start.
	//
	// It is only meaningful with PersistenceDisk. With memory nothing survives
	// the run, so nothing would ever be sent, and that combination is coerced
	// rather than accepted.
	ScheduleStartup Schedule = "startup"

	// ScheduleManual sends only when Flush is called. For tests, and for a
	// caller who would rather decide.
	ScheduleManual Schedule = "manual"
)

// Persistence decides what is still there after a crash or a kill.
type Persistence string

const (
	// PersistenceMemory keeps the queue in the process and loses it with the
	// process. The default for a server; see the README for why.
	PersistenceMemory Persistence = "memory"

	// PersistenceDisk mirrors the pending queue to a file and drains it on the
	// next start. It is what makes a crash report survive the crash that
	// produced it, which is the whole point of collecting one.
	PersistenceDisk Persistence = "disk"
)

// Toggle is a three-state flag: unset means "whatever this schedule implies",
// which a plain bool cannot say and a *bool says clumsily.
type Toggle uint8

const (
	// ToggleDefault leaves the decision to the schedule.
	ToggleDefault Toggle = iota
	ToggleOn
	ToggleOff
)

// SeverityNever sits one step above the top of the ladder, so no entry can
// reach it. Set FlushOnSeverity to this to turn severity flushing off.
const SeverityNever = severityMax + 1

// defaultEvery and defaultMaxBatch are the server surface's defaults from
// docs/delivery-policy.md.
const (
	defaultEvery    = 15 * time.Second
	defaultMaxBatch = 250
	// defaultQueueBytes bounds the durable queue file. Disk is bounded for the
	// same reason memory is: a client that grows without limit has broken the
	// contract whichever medium it grows on.
	defaultQueueBytes    = 8 << 20
	defaultExitFlushTime = 2 * time.Second
)

// resolvePolicy fills in the delivery policy and returns whatever the caller has
// to be told about a combination that could not be honoured as written.
//
// Diagnostics rather than errors: a misconfigured client that still works is
// better for the host program than one that refuses to start, and every
// coercion here has an obvious correct reading. The one thing never done is
// accepting a combination that silently sends nothing.
func (o *Options) resolvePolicy() []Diagnostic {
	var out []Diagnostic

	switch o.Schedule {
	case ScheduleImmediate, ScheduleInterval, ScheduleStartup, ScheduleManual:
	case "":
		o.Schedule = ScheduleInterval
	default:
		out = append(out, Diagnostic{
			Code:    CodeConfig,
			Level:   LevelWarn,
			Message: "unknown Schedule " + string(o.Schedule) + "; using " + string(ScheduleInterval),
		})
		o.Schedule = ScheduleInterval
	}

	switch o.Persistence {
	case PersistenceMemory, PersistenceDisk:
	case "":
		o.Persistence = PersistenceMemory
	default:
		out = append(out, Diagnostic{
			Code:    CodeConfig,
			Level:   LevelWarn,
			Message: "unknown Persistence " + string(o.Persistence) + "; using " + string(PersistenceMemory),
		})
		o.Persistence = PersistenceMemory
	}

	// startup with memory is incoherent: nothing survives the run, so nothing is
	// ever sent. Coerced to disk and said out loud, because silently sending
	// nothing is the worst of the three outcomes and a caller who asked for
	// startup has already asked for durability without naming it.
	if o.Schedule == ScheduleStartup && o.Persistence == PersistenceMemory {
		o.Persistence = PersistenceDisk
		out = append(out, Diagnostic{
			Code:  CodeConfig,
			Level: LevelWarn,
			Message: "Schedule startup keeps nothing across runs with Persistence memory, " +
				"so nothing would ever be sent; using disk",
		})
	}

	if o.Persistence == PersistenceDisk && o.QueuePath == "" {
		o.QueuePath = defaultQueuePath(o.SourceKey)
	}
	if o.QueueMaxBytes <= 0 {
		o.QueueMaxBytes = defaultQueueBytes
	}

	// Zero means "you said nothing", so it takes the default rather than
	// meaning "flush everything", which is what a literal reading of 0 as a
	// severity floor would do and which nobody wants.
	if o.FlushOnSeverity == 0 {
		o.FlushOnSeverity = SeverityError
	}
	if o.FlushOnSeverity < 0 {
		o.FlushOnSeverity = SeverityNever
	}

	if o.Every <= 0 {
		o.Every = defaultEvery
	}
	// MaxBatch may not exceed what one request may carry, read from the wire
	// contract rather than guessed. Exceeding it means every request is
	// rejected, the queue never drains, and it presents as total silence.
	if o.MaxBatch <= 0 {
		o.MaxBatch = defaultMaxBatch
	}
	if o.MaxBatch > maxEntriesPerBatch {
		out = append(out, Diagnostic{
			Code:  CodeConfig,
			Level: LevelWarn,
			Message: fmt.Sprintf("MaxBatch %d is above the server's per-request cap of %d, "+
				"which would have every request rejected; using %d",
				o.MaxBatch, maxEntriesPerBatch, maxEntriesPerBatch),
		})
		o.MaxBatch = maxEntriesPerBatch
	}
	if o.ExitFlushTimeout <= 0 {
		o.ExitFlushTimeout = defaultExitFlushTime
	}
	return out
}

// flushesOnExit reports whether Close should try to send what is still buffered.
//
// True everywhere except startup, whose entire point is that this run's entries
// are left for the next launch. Set FlushOnExit explicitly to override either
// way.
func (o *Options) flushesOnExit() bool {
	switch o.FlushOnExit {
	case ToggleOn:
		return true
	case ToggleOff:
		return false
	default:
		return o.Schedule != ScheduleStartup
	}
}

// defaultQueuePath is where the durable queue lives when the caller did not say.
//
// os.UserCacheDir is %LOCALAPPDATA% on Windows and never %APPDATA%: a roaming
// profile syncs the roaming folder between machines, so a queue written there
// would replay one machine's backlog on another.
func defaultQueuePath(sourceKey string) string {
	dir, err := os.UserCacheDir()
	if err != nil || dir == "" {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "firstrun", queueFileName(sourceKey)+".ndjson")
}

// queueFileName reduces a source key to something safe to name a file with. The
// key is validated elsewhere and may be junk by the time this runs, so nothing
// here trusts its shape.
func queueFileName(sourceKey string) string {
	var b strings.Builder
	for _, r := range sourceKey {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "queue"
	}
	return b.String()
}

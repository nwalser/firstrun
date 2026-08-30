package firstrun

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"
)

// The delivery policy, and the one claim in it that is easy to get wrong:
// `immediate` means "do not wait for a timer", NOT "one request per entry".

// recorder is a stand-in edge. It counts requests and entries separately,
// because the whole question is the ratio between them.
type recorder struct {
	mu       sync.Mutex
	requests int
	entries  int
	batches  []int
	server   *httptest.Server
}

func newRecorder(t *testing.T) *recorder {
	t.Helper()
	r := &recorder{}
	r.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			Entries []json.RawMessage `json:"e"`
		}
		_ = json.NewDecoder(req.Body).Decode(&body)
		r.mu.Lock()
		r.requests++
		r.entries += len(body.Entries)
		r.batches = append(r.batches, len(body.Entries))
		r.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(r.server.Close)
	return r
}

func (r *recorder) counts() (requests, entries int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.requests, r.entries
}

func (r *recorder) largestBatch() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	max := 0
	for _, n := range r.batches {
		if n > max {
			max = n
		}
	}
	return max
}

// waitFor polls until cond holds or the budget runs out.
func waitFor(t *testing.T, why string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", why)
}

func testOptions(host string) Options {
	return Options{
		SourceKey:  "fr_server_0123456789abcdef",
		Host:       host,
		DistinctID: "install_1",
	}
}

func closeClient(t *testing.T, c *Client) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.Close(ctx); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

// TestImmediateCoalesces is the claim that matters. A thousand calls in a tight
// loop must produce a handful of requests, because anything else puts this
// client in the caller's critical path.
func TestImmediateCoalesces(t *testing.T) {
	rec := newRecorder(t)
	opts := testOptions(rec.server.URL)
	opts.Schedule = ScheduleImmediate
	c, err := New(opts)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	const n = 1000
	for i := 0; i < n; i++ {
		c.Event("loop_iteration", Attributes{"i": i}, Entry{})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.Flush(ctx); err != nil {
		t.Fatalf("Flush: %v", err)
	}
	closeClient(t, c)

	requests, entries := rec.counts()
	t.Logf("immediate: %d entries in %d requests, largest batch %d", entries, requests, rec.largestBatch())

	if entries != n {
		t.Errorf("got %d entries, want %d", entries, n)
	}
	// The floor is 4 (1000 entries at MaxBatch 250). The bar is set well above
	// it so a slow machine does not fail the build, and still an order of
	// magnitude below the one-request-per-entry failure this exists to catch.
	if requests > 100 {
		t.Errorf("%d requests for %d entries: immediate is not coalescing", requests, n)
	}
	if got := rec.largestBatch(); got > maxEntriesPerBatch {
		t.Errorf("a batch of %d exceeds the server cap of %d", got, maxEntriesPerBatch)
	}
}

// TestImmediateNeverBlocks: the loop above must cost the caller nothing that
// looks like I/O, even while requests are in flight.
func TestImmediateNeverBlocks(t *testing.T) {
	rec := newRecorder(t)
	opts := testOptions(rec.server.URL)
	opts.Schedule = ScheduleImmediate
	c, _ := New(opts)
	defer closeClient(t, c)

	started := time.Now()
	for i := 0; i < 10000; i++ {
		c.Event("loop_iteration", nil, Entry{})
	}
	elapsed := time.Since(started)
	t.Logf("10000 calls in %s (%s each)", elapsed, elapsed/10000)
	if elapsed > 2*time.Second {
		t.Errorf("10000 calls took %s: something in the record path is waiting", elapsed)
	}
}

// TestIntervalSendsOnMaxBatch: interval fires on `every` or `maxBatch`,
// whichever comes first. With an hour-long interval only the count can be
// responsible.
func TestIntervalSendsOnMaxBatch(t *testing.T) {
	rec := newRecorder(t)
	opts := testOptions(rec.server.URL)
	opts.Schedule = ScheduleInterval
	opts.Every = time.Hour
	opts.MaxBatch = 50
	c, _ := New(opts)
	defer closeClient(t, c)

	for i := 0; i < 200; i++ {
		c.Event("tick", nil, Entry{})
	}
	waitFor(t, "maxBatch to send without the ticker", func() bool {
		_, entries := rec.counts()
		return entries >= 150
	})
	if got := rec.largestBatch(); got > 50 {
		t.Errorf("batch of %d exceeds MaxBatch 50", got)
	}
}

// TestFlushOnSeverity: an ERROR leaves at once whatever the schedule says, and
// an INFO under the same schedule waits.
func TestFlushOnSeverity(t *testing.T) {
	rec := newRecorder(t)
	opts := testOptions(rec.server.URL)
	opts.Schedule = ScheduleInterval
	opts.Every = time.Hour
	opts.MaxBatch = 500
	c, _ := New(opts)
	defer closeClient(t, c)

	c.Info("ordinary line", nil, Entry{})
	time.Sleep(50 * time.Millisecond)
	if _, entries := rec.counts(); entries != 0 {
		t.Fatalf("an INFO sent %d entries with an hour-long interval", entries)
	}

	c.ErrorLog("something broke", nil, Entry{})
	waitFor(t, "an ERROR to flush immediately", func() bool {
		_, entries := rec.counts()
		return entries >= 2
	})
	// The INFO rides along with it, which is the point: the flush takes the
	// whole backlog, not just the entry that triggered it.
	if _, entries := rec.counts(); entries != 2 {
		t.Errorf("got %d entries, want the ERROR and the INFO beside it", entries)
	}
}

func TestFlushOnSeverityCanBeDisabled(t *testing.T) {
	rec := newRecorder(t)
	opts := testOptions(rec.server.URL)
	opts.Schedule = ScheduleInterval
	opts.Every = time.Hour
	opts.FlushOnSeverity = SeverityNever
	c, _ := New(opts)
	defer closeClient(t, c)

	c.Fatal("the worst thing", nil, Entry{})
	time.Sleep(50 * time.Millisecond)
	if _, entries := rec.counts(); entries != 0 {
		t.Errorf("SeverityNever still flushed %d entries", entries)
	}
}

// TestManualOnlySendsOnFlush: manual means Flush and nothing else.
func TestManualOnlySendsOnFlush(t *testing.T) {
	rec := newRecorder(t)
	opts := testOptions(rec.server.URL)
	opts.Schedule = ScheduleManual
	c, _ := New(opts)

	for i := 0; i < 10; i++ {
		c.Event("held", nil, Entry{})
	}
	time.Sleep(50 * time.Millisecond)
	if _, entries := rec.counts(); entries != 0 {
		t.Fatalf("manual sent %d entries unasked", entries)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.Flush(ctx); err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if _, entries := rec.counts(); entries != 10 {
		t.Errorf("got %d entries after Flush, want 10", entries)
	}
	closeClient(t, c)
}

// TestStartupWithMemoryIsCoerced: the combination that would silently send
// nothing is refused as written and said out loud.
func TestStartupWithMemoryIsCoerced(t *testing.T) {
	rec := newRecorder(t)
	var (
		mu    sync.Mutex
		diags []Diagnostic
	)
	opts := testOptions(rec.server.URL)
	opts.Schedule = ScheduleStartup
	opts.Persistence = PersistenceMemory
	opts.QueuePath = filepath.Join(t.TempDir(), "q.ndjson")
	opts.OnDiagnostic = func(d Diagnostic) {
		mu.Lock()
		diags = append(diags, d)
		mu.Unlock()
	}
	c, err := New(opts)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer closeClient(t, c)

	if c.opts.Persistence != PersistenceDisk {
		t.Errorf("persistence is %q, want it coerced to disk", c.opts.Persistence)
	}
	mu.Lock()
	defer mu.Unlock()
	for _, d := range diags {
		if d.Code == CodeConfig {
			t.Logf("diagnostic: %s", d.Message)
			return
		}
	}
	t.Error("coerced silently: no config diagnostic")
}

// TestMaxBatchCappedAtServerLimit: a MaxBatch above the wire format's cap would
// have every request rejected and present as total silence.
func TestMaxBatchCappedAtServerLimit(t *testing.T) {
	rec := newRecorder(t)
	opts := testOptions(rec.server.URL)
	opts.MaxBatch = 10000
	var got Diagnostic
	opts.OnDiagnostic = func(d Diagnostic) {
		if d.Code == CodeConfig {
			got = d
		}
	}
	c, _ := New(opts)
	defer closeClient(t, c)

	if c.opts.MaxBatch != maxEntriesPerBatch {
		t.Errorf("MaxBatch is %d, want %d", c.opts.MaxBatch, maxEntriesPerBatch)
	}
	if got.Code != CodeConfig {
		t.Error("capped silently: no config diagnostic")
	}
}

// TestStartupDrainsTheLastRun is the two axes working together: a schedule that
// never fires during the run plus a queue that survives it.
func TestStartupDrainsTheLastRun(t *testing.T) {
	rec := newRecorder(t)
	path := filepath.Join(t.TempDir(), "queue.ndjson")

	first := testOptions(rec.server.URL)
	first.Schedule = ScheduleStartup
	first.Persistence = PersistenceDisk
	first.QueuePath = path
	a, err := New(first)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	for i := 0; i < 3; i++ {
		a.Event("accumulated", nil, Entry{})
	}
	closeClient(t, a)

	if _, entries := rec.counts(); entries != 0 {
		t.Fatalf("startup sent %d entries during its own run", entries)
	}

	b, err := New(first)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	waitFor(t, "the next run to drain what survived", func() bool {
		_, entries := rec.counts()
		return entries == 3
	})
	closeClient(t, b)
}

// TestCloseIsIdempotentAndLeavesNothingRunning.
func TestCloseIsIdempotentAndLeavesNothingRunning(t *testing.T) {
	rec := newRecorder(t)
	before := runtime.NumGoroutine()

	c, _ := New(testOptions(rec.server.URL))
	c.Event("one", nil, Entry{})

	closeClient(t, c)
	closeClient(t, c)
	// A third, on a context that is already dead: still no panic, still nil or
	// a plain error.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_ = c.Close(ctx)

	// Recording after Close is refused rather than panicking.
	c.Event("after", nil, Entry{})
	if c.Stats().Rejected == 0 {
		t.Error("an event after Close was not rejected")
	}

	waitFor(t, "the sender goroutine to be gone", func() bool {
		return runtime.NumGoroutine() <= before+2
	})
}

// TestDiskQueueSurvivesWithoutAServer: nothing sends, and the backlog is on
// disk for the next run rather than gone with the process.
func TestDiskQueueSurvivesWithoutAServer(t *testing.T) {
	rec := newRecorder(t)
	path := filepath.Join(t.TempDir(), "queue.ndjson")

	dead := testOptions("http://127.0.0.1:1")
	dead.Schedule = ScheduleInterval
	dead.Every = 20 * time.Millisecond
	dead.Persistence = PersistenceDisk
	dead.QueuePath = path
	dead.MaxRetries = -1
	dead.ConnectTimeout = 20 * time.Millisecond
	dead.RequestTimeout = 50 * time.Millisecond
	dead.ExitFlushTimeout = 50 * time.Millisecond

	a, _ := New(dead)
	for i := 0; i < 5; i++ {
		a.Event("during_the_outage", nil, Entry{})
	}
	time.Sleep(150 * time.Millisecond)
	closeClient(t, a)

	alive := dead
	alive.Host = rec.server.URL
	b, _ := New(alive)
	waitFor(t, "the backlog to reach a server that is up", func() bool {
		_, entries := rec.counts()
		return entries >= 5
	})
	closeClient(t, b)
}

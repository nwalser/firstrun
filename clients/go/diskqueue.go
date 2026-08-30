package firstrun

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// The durable half of the delivery policy.
//
// This file is a MIRROR of what the sender is still holding, not a write-ahead
// log: entries are appended when they join the backlog and the file is rewritten
// when the backlog shrinks, so what a crash leaves behind is exactly what had
// not been sent. Entry ids are generated on this side, so replaying a file whose
// entries did in fact reach the server costs a duplicate the server deduplicates
// rather than a double count.
//
// Owned by the sender goroutine and touched by nothing else, which is why it
// needs no lock.

// diskRecord is one persisted entry: the batch context it has to travel with,
// plus the entry itself.
//
// The group key and the urgency flag are recomputed on load rather than stored.
// Both are derived from configuration, and a stored copy would be a stale
// opinion from a run configured differently.
type diskRecord struct {
	DistinctID string     `json:"d"`
	Resource   Attributes `json:"r,omitempty"`
	Entry      wireEntry  `json:"e"`
}

// maxRecordLine bounds one line on the way back in. An entry cannot legitimately
// be larger than the attribute bounds allow, and a line longer than this is
// corruption rather than data.
const maxRecordLine = 1 << 20

type diskQueue struct {
	path     string
	maxBytes int64
	size     int64
	file     *os.File
	// broken is set after the first write failure. A disk that will not take
	// writes is not a reason to stop working: the client carries on in memory,
	// having said so once.
	broken bool
	diag   func(Diagnostic)
}

func newDiskQueue(path string, maxBytes int64, diag func(Diagnostic)) *diskQueue {
	return &diskQueue{path: path, maxBytes: maxBytes, diag: diag}
}

// load reads what survived the last run, newest max entries kept, and leaves the
// file in place as the mirror of what it returns.
//
// Nothing is deleted here. The file is only rewritten once a delivery has
// actually changed what is pending, so a crash between load and the first send
// leaves the backlog exactly where it was.
func (q *diskQueue) load(max int, flushOnSeverity int) []item {
	f, err := os.Open(q.path)
	if err != nil {
		if !os.IsNotExist(err) {
			q.fail("cannot read the queue file", err)
		}
		q.openAppend()
		return nil
	}

	var (
		out     []item
		skipped int
	)
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64<<10), maxRecordLine)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var rec diskRecord
		if err := json.Unmarshal(line, &rec); err != nil || rec.DistinctID == "" || rec.Entry.Name == "" {
			// A half-written tail is the expected shape of a crash. One
			// unreadable line costs itself and nothing else.
			skipped++
			continue
		}
		out = append(out, item{
			group:      rec.DistinctID + "\x00" + resourceKey(rec.Resource),
			distinctID: rec.DistinctID,
			resource:   rec.Resource,
			urgent:     rec.Entry.Severity != 0 && rec.Entry.Severity >= flushOnSeverity,
			entry:      rec.Entry,
		})
	}
	if err := scanner.Err(); err != nil {
		q.diagnose(LevelWarn, CodeDropped, "stopped reading the queue file early: "+err.Error())
	}
	_ = f.Close()

	if skipped > 0 {
		q.diagnose(LevelWarn, CodeDropped, fmt.Sprintf("skipped %d unreadable lines in the queue file", skipped))
	}
	if max > 0 && len(out) > max {
		// The newest are the ones worth keeping: what is lost is the stale tail
		// of a backlog rather than what happened just before the process died.
		q.diagnose(LevelWarn, CodeDropped, fmt.Sprintf("queue file held %d entries, keeping the newest %d", len(out), max))
		out = out[len(out)-max:]
	}

	q.openAppend()
	if len(out) > 0 {
		q.diagnose(LevelDebug, CodeRestored, fmt.Sprintf("restored %d entries from the last run", len(out)))
	}
	return out
}

// append mirrors newly queued entries. One write per pass, not one per entry:
// the sender hands over everything it took in this round.
func (q *diskQueue) append(items []item) {
	if q.broken || len(items) == 0 {
		return
	}
	if q.file == nil {
		q.openAppend()
		if q.file == nil {
			return
		}
	}
	var buf bytes.Buffer
	for _, it := range items {
		if line := encodeRecord(it); line != nil {
			buf.Write(line)
		}
	}
	if buf.Len() == 0 {
		return
	}
	n, err := q.file.Write(buf.Bytes())
	q.size += int64(n)
	if err != nil {
		q.fail("cannot write to the queue file", err)
	}
}

// overCap reports whether the file has grown past its bound and the sender
// should rewrite it.
func (q *diskQueue) overCap() bool { return !q.broken && q.size > q.maxBytes }

// sync rewrites the file to hold exactly pending, dropping the oldest entries if
// that does not fit in maxBytes. It returns what was kept and how many were
// dropped, so the caller can count them the same way a full channel is counted.
//
// Written to a temporary file and renamed over, so a crash mid-rewrite leaves
// the previous mirror rather than half of the new one.
func (q *diskQueue) sync(pending []item) ([]item, int) {
	if q.broken {
		return pending, 0
	}

	// nil entries keep the index alignment with pending, so trimming the front
	// of one trims the front of the other.
	lines := make([][]byte, len(pending))
	var total int64
	for i, it := range pending {
		lines[i] = encodeRecord(it)
		total += int64(len(lines[i]))
	}
	dropped := 0
	for total > q.maxBytes && dropped < len(lines) {
		total -= int64(len(lines[dropped]))
		dropped++
	}

	tmp := q.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		q.fail("cannot rewrite the queue file", err)
		return pending, 0
	}
	w := bufio.NewWriter(f)
	for _, line := range lines[dropped:] {
		if line == nil {
			continue
		}
		if _, err := w.Write(line); err != nil {
			_ = f.Close()
			_ = os.Remove(tmp)
			q.fail("cannot rewrite the queue file", err)
			return pending, 0
		}
	}
	if err := w.Flush(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		q.fail("cannot rewrite the queue file", err)
		return pending, 0
	}
	// Durability is the entire reason this file exists, so the rewrite is put on
	// the platter before the rename makes it authoritative.
	_ = f.Sync()
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		q.fail("cannot rewrite the queue file", err)
		return pending, 0
	}

	// Windows will not rename over a file that is still open, so the append
	// handle goes first and is reopened against the new file.
	q.closeFile()
	if err := os.Rename(tmp, q.path); err != nil {
		_ = os.Remove(tmp)
		q.fail("cannot replace the queue file", err)
		return pending, 0
	}
	q.size = total
	q.openAppend()
	return pending[dropped:], dropped
}

func (q *diskQueue) close() { q.closeFile() }

func (q *diskQueue) closeFile() {
	if q.file != nil {
		_ = q.file.Close()
		q.file = nil
	}
}

func (q *diskQueue) openAppend() {
	if q.broken || q.file != nil {
		return
	}
	if dir := filepath.Dir(q.path); dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			q.fail("cannot create the queue directory", err)
			return
		}
	}
	f, err := os.OpenFile(q.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		q.fail("cannot open the queue file", err)
		return
	}
	q.file = f
	if info, err := f.Stat(); err == nil {
		q.size = info.Size()
	}
}

// fail gives up on the disk permanently and says so once. The client keeps
// working in memory: losing durability is a worse client, and taking the host
// program down over it would be a worse library.
func (q *diskQueue) fail(what string, err error) {
	q.closeFile()
	if q.broken {
		return
	}
	q.broken = true
	q.diagnose(LevelError, CodeConfig, what+" ("+err.Error()+"); continuing in memory only")
}

func (q *diskQueue) diagnose(level DiagnosticLevel, code, message string) {
	if q.diag == nil {
		return
	}
	q.diag(Diagnostic{Code: code, Level: level, Message: message})
}

// encodeRecord returns one newline-terminated line, or nil for the entry that
// cannot be encoded at all. Unreachable with the clamped types this package
// produces, and dropping one line is still better than losing the file.
func encodeRecord(it item) []byte {
	b, err := json.Marshal(diskRecord{
		DistinctID: it.distinctID,
		Resource:   it.resource,
		Entry:      it.entry,
	})
	if err != nil {
		return nil
	}
	return append(b, '\n')
}

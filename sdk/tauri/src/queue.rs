//! The pending-entry queue, in memory or on disk.
//!
//! Durability is an axis of the delivery policy rather than a property of this
//! type (`docs/delivery-policy.md`), so both backings sit behind one API and the
//! sender thread never asks which one it got.
//!
//! **Memory is the desktop default**: a run's telemetry goes out at exit and
//! nothing is left on the user's machine between runs. **Disk is what a crash
//! survives.** It is not a legacy path. It is the only backing the `startup`
//! schedule can mean anything with, and the only one that gets a report out of a
//! process that never exited cleanly.
//!
//! The disk backing is the part that has to be right. A desktop app is offline
//! for hours, gets killed by the OS mid-write, is force-quit during shutdown,
//! and is then launched again by someone who expects last week's usage to be in
//! the dashboard. Every one of those is the normal case, not an edge case.
//!
//! Design, and why:
//!
//! - **NDJSON, append-only.** One entry per line, opened with `append`. A crash
//!   can therefore only ever corrupt the final line, and a corrupt final line is
//!   discarded on read. Any format needing a header, a footer or an index can be
//!   left in a state where the whole file is unreadable.
//!
//! - **Entry ids are generated here, on the client.** A send that times out may
//!   or may not have arrived, so the queue always retries, and the server dedups
//!   on the id. Retrying is safe precisely because the id came from disk rather
//!   than from the request.
//!
//! - **`timestamp` is stamped when the thing happens**, never when it is sent.
//!   A launch that happened on Friday and uploaded on Monday is a Friday launch,
//!   and the server buckets on that field. `observed_timestamp` records when
//!   this crate saw it; it stays on disk and is never sent, because the edge
//!   stamps its own `ingested_at` and would overwrite anything we claimed. The
//!   gap between the two is how you read a replayed backlog out of the queue
//!   file when debugging.
//!
//! - **Bounded, dropping the oldest.** An app offline for a month must not fill
//!   the user's disk, and a session nobody ever closes must not grow the host's
//!   heap. When the queue passes either limit the oldest entries go, since what
//!   survives should be the most recent behaviour: that is what retention and
//!   version queries read. Both backings count the same bytes, so switching one
//!   for the other does not silently change how much is kept.
//!
//! - **Rewrites are temp-file-plus-rename.** Truncating in place and writing
//!   over it means a crash halfway leaves a queue that is neither the old one
//!   nor the new one.
//!
//! One `Queue` is owned by the sender thread and never shared, which is why its
//! mutating methods can take `&mut self` and keep a cached length: counting the
//! lines of the file on every call would put the whole queue's cost on the
//! caller's thread.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use crate::wire::{now_ms, Attributes};

/// One log entry as it sits on disk.
///
/// Close to the wire entry but not identical: `client::WireEntry` is the shape
/// the server is sent, and it is written out separately so that adding something
/// this crate needs on disk can never quietly add a field to the wire.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QueuedEntry {
    pub id: String,
    /// What KIND of thing this is. Any name the server accepts; nothing is
    /// special-cased, and there is no allowlist anywhere in the system.
    pub name: String,
    /// Milliseconds since epoch, stamped when the thing happened. Authoritative.
    pub timestamp: i64,
    /// Milliseconds since epoch, stamped when this crate saw it.
    ///
    /// On disk only: it is never put on the wire, because the edge stamps its own
    /// `ingested_at`. It is here so a queue file recovered from a user's machine
    /// still says when each entry was written.
    pub observed_timestamp: i64,
    /// 1..24 on the OpenTelemetry ladder. Absent means honestly unclassified.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub severity_number: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub body: Option<String>,
    /// Everything about this entry that is not one of the promoted columns.
    ///
    /// The session id and the `user_id` in force when it was queued live here,
    /// as `session.id` and `user.id`. `user.id` is stamped by the sender rather
    /// than at the call site, because `identify` can be called between an entry
    /// being queued and the batch going out, and an entry from before somebody
    /// signed in is not theirs.
    #[serde(skip_serializing_if = "Attributes::is_empty", default)]
    pub attributes: Attributes,
    /// Reserved by the log data model, unused by this product today.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub span_id: Option<String>,
}

impl QueuedEntry {
    /// A new entry stamped as happening now.
    pub fn now(name: &str, severity: Option<u8>, body: Option<String>, attributes: Attributes) -> Self {
        let at = now_ms();
        QueuedEntry {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            timestamp: at,
            observed_timestamp: at,
            severity_number: severity,
            body,
            attributes,
            trace_id: None,
            span_id: None,
        }
    }
}

/// Where the pending entries live between being recorded and being sent.
///
/// One type with two backings rather than two types, because which one is in use
/// is a policy setting the host chooses and not something the sender thread has
/// any business branching on.
enum Backing {
    /// Nothing reaches the user's disk. The desktop default.
    Memory {
        /// The serialised size travels beside each entry so the byte ceiling
        /// costs one serialisation per entry instead of a walk of the queue.
        entries: VecDeque<(u64, QueuedEntry)>,
        bytes: u64,
    },
    /// NDJSON beside the anonymous id, drained on the next start.
    Disk { path: PathBuf },
}

pub struct Queue {
    backing: Backing,
    max_entries: usize,
    max_bytes: u64,
    /// Cached count of the entries waiting. Kept so `append` can enforce the
    /// ceiling and report a queue depth without re-reading the file.
    len: usize,
}

impl Queue {
    /// Opens the disk queue, counting whatever a previous run left behind.
    ///
    /// Never fails. A file that cannot be read is treated as empty and will be
    /// rewritten by the first trim, because refusing to start analytics is a
    /// worse outcome than losing a queue we could not parse anyway.
    pub fn open(path: impl Into<PathBuf>) -> Queue {
        let mut queue = Queue {
            backing: Backing::Disk { path: path.into() },
            max_entries: 5_000,
            max_bytes: 2 * 1024 * 1024,
            len: 0,
        };
        queue.len = queue.read_all().map(|e| e.len()).unwrap_or(0);
        queue
    }

    /// A queue that leaves nothing behind. Empty at every start, by definition:
    /// there is nothing to replay, which is why `startup` cannot be served by
    /// this backing.
    pub fn memory() -> Queue {
        Queue {
            backing: Backing::Memory {
                entries: VecDeque::new(),
                bytes: 0,
            },
            max_entries: 5_000,
            max_bytes: 2 * 1024 * 1024,
            len: 0,
        }
    }

    pub fn with_limits(mut self, max_entries: usize, max_bytes: u64) -> Self {
        self.max_entries = max_entries.max(1);
        self.max_bytes = max_bytes;
        self
    }

    /// The queue file, or `None` when this queue is in memory.
    pub fn path(&self) -> Option<&Path> {
        match &self.backing {
            Backing::Disk { path } => Some(path),
            Backing::Memory { .. } => None,
        }
    }

    /// True when this queue survives the process that wrote it.
    pub fn is_durable(&self) -> bool {
        matches!(self.backing, Backing::Disk { .. })
    }

    /// Entries waiting. Cached, so this costs nothing to ask for.
    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Appends one entry and returns how many old ones had to be dropped to stay
    /// inside the limits.
    pub fn append(&mut self, entry: &QueuedEntry) -> std::io::Result<usize> {
        // Serialised for both backings: on disk it is the line, in memory it is
        // how the byte ceiling is measured. Counting the same bytes either way
        // is what keeps the two limits meaning one thing.
        let line = serde_json::to_string(entry)?;

        match &mut self.backing {
            Backing::Memory { entries, bytes } => {
                let size = line.len() as u64 + 1;
                entries.push_back((size, entry.clone()));
                *bytes += size;
            }
            Backing::Disk { path } => {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut file = OpenOptions::new().create(true).append(true).open(path)?;
                file.write_all(line.as_bytes())?;
                file.write_all(b"\n")?;
                // Flushed, not fsynced. Losing the last few entries to a power
                // cut is acceptable; blocking on the disk for every click is not.
                file.flush()?;
            }
        }

        self.len += 1;

        if self.len > self.max_entries || self.size()? > self.max_bytes {
            return self.trim();
        }
        Ok(0)
    }

    fn size(&self) -> std::io::Result<u64> {
        match &self.backing {
            Backing::Memory { bytes, .. } => Ok(*bytes),
            Backing::Disk { path } => match fs::metadata(path) {
                Ok(m) => Ok(m.len()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(0),
                Err(e) => Err(e),
            },
        }
    }

    /// Every entry still waiting, oldest first. On disk, a partial final line
    /// (the app was killed mid-write) is dropped rather than failing the whole
    /// read.
    pub fn read_all(&self) -> std::io::Result<Vec<QueuedEntry>> {
        match &self.backing {
            Backing::Memory { entries, .. } => {
                Ok(entries.iter().map(|(_, e)| e.clone()).collect())
            }
            Backing::Disk { .. } => Ok(self.read_lines()?.1),
        }
    }

    fn read_lines(&self) -> std::io::Result<(Vec<String>, Vec<QueuedEntry>)> {
        let Backing::Disk { path } = &self.backing else {
            return Ok((vec![], vec![]));
        };
        let file = match File::open(path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((vec![], vec![])),
            Err(e) => return Err(e),
        };

        let mut lines = Vec::new();
        let mut entries = Vec::new();
        for line in BufReader::new(file).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<QueuedEntry>(&line) {
                Ok(entry) => {
                    lines.push(line);
                    entries.push(entry);
                }
                // A half-written or corrupt line. Losing one entry beats losing
                // the queue.
                Err(_) => continue,
            }
        }
        Ok((lines, entries))
    }

    /// The oldest `n` entries, for a send attempt.
    pub fn peek(&self, n: usize) -> std::io::Result<Vec<QueuedEntry>> {
        match &self.backing {
            Backing::Memory { entries, .. } => {
                Ok(entries.iter().take(n).map(|(_, e)| e.clone()).collect())
            }
            Backing::Disk { .. } => {
                let mut entries = self.read_all()?;
                entries.truncate(n);
                Ok(entries)
            }
        }
    }

    /// Drops the oldest `n` entries. Called only once the server has them, or has
    /// refused them in a way that will not change.
    pub fn drop_front(&mut self, n: usize) -> std::io::Result<()> {
        if n == 0 {
            return Ok(());
        }
        if let Backing::Memory { entries, bytes } = &mut self.backing {
            for _ in 0..n.min(entries.len()) {
                if let Some((size, _)) = entries.pop_front() {
                    *bytes = bytes.saturating_sub(size);
                }
            }
            if entries.is_empty() {
                // Rounding cannot accumulate here, but a drained queue that
                // still claims bytes would trim the next entry on sight.
                *bytes = 0;
            }
            self.len = entries.len();
            return Ok(());
        }

        let (lines, _) = self.read_lines()?;
        if n >= lines.len() {
            if let Some(path) = self.path() {
                match fs::remove_file(path) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e),
                }
            }
            self.len = 0;
            return Ok(());
        }
        self.rewrite(&lines[n..])
    }

    /// Keeps the newest entries that fit inside both limits, and returns how many
    /// were thrown away.
    fn trim(&mut self) -> std::io::Result<usize> {
        if let Backing::Memory { entries, bytes } = &mut self.backing {
            let before = entries.len();
            while entries.len() > self.max_entries {
                if let Some((size, _)) = entries.pop_front() {
                    *bytes = bytes.saturating_sub(size);
                }
            }
            // Byte budget second, because it is the one that catches unusually
            // large attribute maps. One entry always survives: a single entry
            // over the whole budget would otherwise be dropped forever and never
            // reach anyone.
            while *bytes > self.max_bytes && entries.len() > 1 {
                if let Some((size, _)) = entries.pop_front() {
                    *bytes = bytes.saturating_sub(size);
                }
            }
            self.len = entries.len();
            return Ok(before - entries.len());
        }

        let (lines, _) = self.read_lines()?;
        let before = lines.len();

        let mut start = before.saturating_sub(self.max_entries);
        let mut bytes: u64 = lines[start..].iter().map(|l| l.len() as u64 + 1).sum();
        while bytes > self.max_bytes && start + 1 < before {
            bytes -= lines[start].len() as u64 + 1;
            start += 1;
        }

        self.rewrite(&lines[start..])?;
        Ok(before - self.len)
    }

    /// Temp file, then rename. A crash leaves either the old queue or the new
    /// one, never a half-written one.
    fn rewrite(&mut self, lines: &[String]) -> std::io::Result<()> {
        let Backing::Disk { path } = &self.backing else {
            return Ok(());
        };
        let tmp = path.with_extension("tmp");
        {
            let mut file = File::create(&tmp)?;
            for line in lines {
                file.write_all(line.as_bytes())?;
                file.write_all(b"\n")?;
            }
            file.flush()?;
        }
        fs::rename(&tmp, path)?;
        self.len = lines.len();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::SEVERITY_INFO;
    use serde_json::json;

    fn ev(name: &str) -> QueuedEntry {
        QueuedEntry::now(name, Some(SEVERITY_INFO), None, Attributes::new())
    }

    fn queue() -> (tempfile::TempDir, Queue) {
        let dir = tempfile::tempdir().unwrap();
        let q = Queue::open(dir.path().join("queue.ndjson"));
        (dir, q)
    }

    #[test]
    fn survives_a_restart() {
        let (dir, mut q) = queue();
        q.append(&ev("app_launch")).unwrap();
        q.append(&ev("app_launch")).unwrap();

        // A new process, same file.
        let reopened = Queue::open(dir.path().join("queue.ndjson"));
        assert_eq!(reopened.len(), 2);
    }

    #[test]
    fn an_empty_queue_is_not_an_error() {
        let (_dir, mut q) = queue();
        assert!(q.is_empty());
        assert_eq!(q.read_all().unwrap(), vec![]);
        q.drop_front(10).unwrap();
    }

    #[test]
    fn a_line_half_written_when_the_os_killed_us_is_discarded() {
        let (_dir, mut q) = queue();
        q.append(&ev("app_launch")).unwrap();

        let mut f = OpenOptions::new().append(true).open(q.path().unwrap()).unwrap();
        f.write_all(b"{\"id\":\"partial\",\"na").unwrap();
        drop(f);

        let entries = q.read_all().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "app_launch");
    }

    #[test]
    fn a_corrupt_line_in_the_middle_does_not_take_the_rest_with_it() {
        let (_dir, mut q) = queue();
        q.append(&ev("first")).unwrap();
        {
            let mut f = OpenOptions::new().append(true).open(q.path().unwrap()).unwrap();
            f.write_all(b"not json at all\n").unwrap();
        }
        q.append(&ev("third")).unwrap();

        let names: Vec<_> = q.read_all().unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["first", "third"]);
    }

    #[test]
    fn only_what_the_server_accepted_is_dropped() {
        let (_dir, mut q) = queue();
        for i in 0..5 {
            q.append(&ev(&format!("e{i}"))).unwrap();
        }

        let batch = q.peek(3).unwrap();
        assert_eq!(batch.len(), 3);
        q.drop_front(batch.len()).unwrap();

        let names: Vec<_> = q.read_all().unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["e3", "e4"]);
        assert_eq!(q.len(), 2);
    }

    #[test]
    fn a_failed_send_leaves_the_queue_alone() {
        let (_dir, mut q) = queue();
        for i in 0..3 {
            q.append(&ev(&format!("e{i}"))).unwrap();
        }
        // Peek without dropping is what a failed send does.
        let _ = q.peek(3).unwrap();
        assert_eq!(q.len(), 3);
    }

    #[test]
    fn is_bounded_and_keeps_the_newest() {
        let dir = tempfile::tempdir().unwrap();
        let mut q = Queue::open(dir.path().join("q.ndjson")).with_limits(10, 256);

        let mut dropped = 0;
        for i in 0..200 {
            dropped += q.append(&ev(&format!("e{i}"))).unwrap();
        }

        let entries = q.read_all().unwrap();
        assert!(entries.len() <= 10, "queue grew to {}", entries.len());
        assert_eq!(entries.last().unwrap().name, "e199");
        // Everything that went in either survived or was counted out.
        assert_eq!(dropped + entries.len(), 200);
    }

    #[test]
    fn entry_ids_are_unique_so_retries_dedup_server_side() {
        let (_dir, mut q) = queue();
        for _ in 0..50 {
            q.append(&ev("app_launch")).unwrap();
        }
        let ids: std::collections::HashSet<_> =
            q.read_all().unwrap().into_iter().map(|e| e.id).collect();
        assert_eq!(ids.len(), 50);
    }

    #[test]
    fn timestamp_is_stamped_when_it_happened() {
        let before = now_ms();
        let entry = ev("app_launch");
        let after = now_ms();
        assert!(entry.timestamp >= before && entry.timestamp <= after);
        assert!(entry.observed_timestamp >= before && entry.observed_timestamp <= after);
    }

    #[test]
    fn a_memory_queue_leaves_nothing_behind() {
        let dir = tempfile::tempdir().unwrap();
        let mut q = Queue::memory();
        assert!(q.path().is_none());
        assert!(!q.is_durable());

        q.append(&ev("app_launch")).unwrap();
        assert_eq!(q.len(), 1);
        // The whole point of the desktop default: nothing on the user's disk,
        // and nothing for the next run to find.
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_memory_queue_is_bounded_and_keeps_the_newest() {
        // Identical to the disk case, on purpose: the durability axis must not
        // quietly change how much is kept.
        let mut q = Queue::memory().with_limits(10, 256);

        let mut dropped = 0;
        for i in 0..200 {
            dropped += q.append(&ev(&format!("e{i}"))).unwrap();
        }

        let entries = q.read_all().unwrap();
        assert!(entries.len() <= 10, "queue grew to {}", entries.len());
        assert_eq!(entries.last().unwrap().name, "e199");
        assert_eq!(dropped + entries.len(), 200);
    }

    #[test]
    fn a_memory_queue_settles_only_what_the_server_accepted() {
        let mut q = Queue::memory();
        for i in 0..5 {
            q.append(&ev(&format!("e{i}"))).unwrap();
        }

        let batch = q.peek(3).unwrap();
        assert_eq!(batch.len(), 3);
        q.drop_front(batch.len()).unwrap();

        let names: Vec<_> = q.read_all().unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["e3", "e4"]);
        assert_eq!(q.len(), 2);

        // A drained queue must not still be claiming bytes: it would trim the
        // next entry on sight.
        q.drop_front(2).unwrap();
        assert!(q.is_empty());
        for i in 0..5 {
            assert_eq!(q.append(&ev(&format!("f{i}"))).unwrap(), 0);
        }
        assert_eq!(q.len(), 5);
    }

    #[test]
    fn attributes_survive_a_round_trip_through_disk() {
        let (_dir, mut q) = queue();
        let mut attrs = Attributes::new();
        attrs.insert("rows".into(), json!(1200));
        attrs.insert("nested".into(), json!({"a": [1, 2, 3]}));
        q.append(&QueuedEntry::now("exported", None, Some("done".into()), attrs))
            .unwrap();

        let back = q.read_all().unwrap();
        assert_eq!(back[0].attributes["rows"], json!(1200));
        assert_eq!(back[0].attributes["nested"], json!({"a": [1, 2, 3]}));
        assert_eq!(back[0].body.as_deref(), Some("done"));
        // Absent rather than guessed: an unclassified entry is honest.
        assert_eq!(back[0].severity_number, None);
    }
}

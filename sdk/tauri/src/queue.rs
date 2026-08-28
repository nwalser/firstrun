//! The disk-backed event queue.
//!
//! This is the part that has to be right. A desktop app is offline for hours,
//! gets killed by the OS mid-write, is force-quit during shutdown, and is then
//! launched again by someone who expects last week's usage to be in the
//! dashboard. Every one of those is the normal case, not an edge case.
//!
//! Design, and why:
//!
//! - **NDJSON, append-only.** One event per line, opened with `append`. A crash
//!   can therefore only ever corrupt the final line, and a corrupt final line is
//!   discarded on read. Any format needing a header, a footer or an index can be
//!   left in a state where the whole file is unreadable.
//!
//! - **Event ids are generated here, on the client.** A send that times out may
//!   or may not have arrived, so the queue always retries, and the server dedups
//!   on the id. Retrying is safe precisely because the id came from disk rather
//!   than from the request.
//!
//! - **`event_time` is stamped when the event happens**, never when it is sent.
//!   A launch that happened on Friday and uploaded on Monday is a Friday launch.
//!   See CLAUDE.md rule 2.
//!
//! - **Bounded, dropping the oldest.** An app offline for a month must not fill
//!   the user's disk. When the file passes its limit the oldest events go, since
//!   what survives should be the most recent behaviour -- that is what retention
//!   and version queries read. The first-run event is not at risk: it goes
//!   through `/v1/claim`, not through here.
//!
//! - **Rewrites are temp-file-plus-rename.** Truncating in place and writing
//!   over it means a crash halfway leaves a queue that is neither the old one
//!   nor the new one.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub type Props = BTreeMap<String, String>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QueuedEvent {
    pub event_id: String,
    pub event_name: String,
    /// Milliseconds since epoch, stamped when the event happened.
    pub event_time: i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty", default)]
    pub props: Props,
}

impl QueuedEvent {
    pub fn now(name: &str, props: Props) -> Self {
        QueuedEvent {
            event_id: uuid::Uuid::new_v4().to_string(),
            event_name: name.to_string(),
            event_time: now_ms(),
            session_id: None,
            props,
        }
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct Queue {
    path: PathBuf,
    max_events: usize,
    max_bytes: u64,
}

impl Queue {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Queue {
            path: path.into(),
            max_events: 5_000,
            max_bytes: 2 * 1024 * 1024,
        }
    }

    pub fn with_limits(mut self, max_events: usize, max_bytes: u64) -> Self {
        self.max_events = max_events;
        self.max_bytes = max_bytes;
        self
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn append(&self, event: &QueuedEvent) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let line = serde_json::to_string(event)?;

        let mut file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        file.write_all(line.as_bytes())?;
        file.write_all(b"\n")?;
        // Flushed, not fsynced. Losing the last few events to a power cut is
        // acceptable; blocking the UI thread on the disk for every click is not.
        file.flush()?;
        drop(file);

        if self.size()? > self.max_bytes {
            self.trim()?;
        }
        Ok(())
    }

    fn size(&self) -> std::io::Result<u64> {
        match fs::metadata(&self.path) {
            Ok(m) => Ok(m.len()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(0),
            Err(e) => Err(e),
        }
    }

    /// Every event still on disk, oldest first. A partial final line -- the app
    /// was killed mid-write -- is dropped rather than failing the whole read.
    pub fn read_all(&self) -> std::io::Result<Vec<QueuedEvent>> {
        Ok(self.read_lines()?.1)
    }

    fn read_lines(&self) -> std::io::Result<(Vec<String>, Vec<QueuedEvent>)> {
        let file = match File::open(&self.path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((vec![], vec![])),
            Err(e) => return Err(e),
        };

        let mut lines = Vec::new();
        let mut events = Vec::new();
        for line in BufReader::new(file).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<QueuedEvent>(&line) {
                Ok(event) => {
                    lines.push(line);
                    events.push(event);
                }
                // A half-written or corrupt line. Losing one event beats losing
                // the queue.
                Err(_) => continue,
            }
        }
        Ok((lines, events))
    }

    /// The oldest `n` events, for a send attempt.
    pub fn peek(&self, n: usize) -> std::io::Result<Vec<QueuedEvent>> {
        let mut events = self.read_all()?;
        events.truncate(n);
        Ok(events)
    }

    /// Drops the oldest `n` events. Called only after the server accepted them.
    pub fn drop_front(&self, n: usize) -> std::io::Result<()> {
        if n == 0 {
            return Ok(());
        }
        let (lines, _) = self.read_lines()?;
        if n >= lines.len() {
            let _ = fs::remove_file(&self.path);
            return Ok(());
        }
        self.rewrite(&lines[n..])
    }

    pub fn len(&self) -> std::io::Result<usize> {
        Ok(self.read_all()?.len())
    }

    pub fn is_empty(&self) -> std::io::Result<bool> {
        Ok(self.len()? == 0)
    }

    /// Keeps the newest `max_events` and throws the rest away.
    fn trim(&self) -> std::io::Result<()> {
        let (lines, _) = self.read_lines()?;
        if lines.len() <= self.max_events {
            // Over the byte budget but under the event budget: the events are
            // simply large. Rewriting drops any corrupt lines, which is the only
            // thing left to reclaim.
            return self.rewrite(&lines);
        }
        self.rewrite(&lines[lines.len() - self.max_events..])
    }

    /// Temp file, then rename. A crash leaves either the old queue or the new
    /// one, never a half-written one.
    fn rewrite(&self, lines: &[String]) -> std::io::Result<()> {
        let tmp = self.path.with_extension("tmp");
        {
            let mut file = File::create(&tmp)?;
            for line in lines {
                file.write_all(line.as_bytes())?;
                file.write_all(b"\n")?;
            }
            file.flush()?;
        }
        fs::rename(&tmp, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(name: &str) -> QueuedEvent {
        QueuedEvent::now(name, Props::new())
    }

    fn queue() -> (tempfile::TempDir, Queue) {
        let dir = tempfile::tempdir().unwrap();
        let q = Queue::new(dir.path().join("queue.ndjson"));
        (dir, q)
    }

    #[test]
    fn survives_a_restart() {
        let (dir, q) = queue();
        q.append(&ev("app_launch")).unwrap();
        q.append(&ev("app_launch")).unwrap();

        // A new process, same file.
        let reopened = Queue::new(dir.path().join("queue.ndjson"));
        assert_eq!(reopened.len().unwrap(), 2);
    }

    #[test]
    fn an_empty_queue_is_not_an_error() {
        let (_dir, q) = queue();
        assert!(q.is_empty().unwrap());
        assert_eq!(q.read_all().unwrap(), vec![]);
        q.drop_front(10).unwrap();
    }

    #[test]
    fn a_line_half_written_when_the_os_killed_us_is_discarded() {
        let (_dir, q) = queue();
        q.append(&ev("app_launch")).unwrap();

        let mut f = OpenOptions::new().append(true).open(q.path()).unwrap();
        f.write_all(b"{\"event_id\":\"partial\",\"event_na").unwrap();
        drop(f);

        let events = q.read_all().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_name, "app_launch");
    }

    #[test]
    fn a_corrupt_line_in_the_middle_does_not_take_the_rest_with_it() {
        let (_dir, q) = queue();
        q.append(&ev("first")).unwrap();
        {
            let mut f = OpenOptions::new().append(true).open(q.path()).unwrap();
            f.write_all(b"not json at all\n").unwrap();
        }
        q.append(&ev("third")).unwrap();

        let names: Vec<_> = q.read_all().unwrap().into_iter().map(|e| e.event_name).collect();
        assert_eq!(names, vec!["first", "third"]);
    }

    #[test]
    fn only_what_the_server_accepted_is_dropped() {
        let (_dir, q) = queue();
        for i in 0..5 {
            q.append(&ev(&format!("e{i}"))).unwrap();
        }

        let batch = q.peek(3).unwrap();
        assert_eq!(batch.len(), 3);
        q.drop_front(batch.len()).unwrap();

        let names: Vec<_> = q.read_all().unwrap().into_iter().map(|e| e.event_name).collect();
        assert_eq!(names, vec!["e3", "e4"]);
    }

    #[test]
    fn a_failed_send_leaves_the_queue_alone() {
        let (_dir, q) = queue();
        for i in 0..3 {
            q.append(&ev(&format!("e{i}"))).unwrap();
        }
        // Peek without dropping is what a failed send does.
        let _ = q.peek(3).unwrap();
        assert_eq!(q.len().unwrap(), 3);
    }

    #[test]
    fn is_bounded_and_keeps_the_newest() {
        let dir = tempfile::tempdir().unwrap();
        let q = Queue::new(dir.path().join("q.ndjson")).with_limits(10, 256);

        for i in 0..200 {
            q.append(&ev(&format!("e{i}"))).unwrap();
        }

        let events = q.read_all().unwrap();
        assert!(events.len() <= 10, "queue grew to {}", events.len());
        assert_eq!(events.last().unwrap().event_name, "e199");
    }

    #[test]
    fn event_ids_are_unique_so_retries_dedup_server_side() {
        let (_dir, q) = queue();
        for _ in 0..50 {
            q.append(&ev("app_launch")).unwrap();
        }
        let ids: std::collections::HashSet<_> =
            q.read_all().unwrap().into_iter().map(|e| e.event_id).collect();
        assert_eq!(ids.len(), 50);
    }

    #[test]
    fn event_time_is_stamped_when_it_happened() {
        let before = now_ms();
        let event = ev("app_launch");
        let after = now_ms();
        assert!(event.event_time >= before && event.event_time <= after);
    }
}

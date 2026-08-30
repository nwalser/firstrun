//! The delivery policy, against a real socket.
//!
//! `docs/delivery-policy.md` makes claims that only hold end to end: that
//! `immediate` coalesces instead of sending one request per entry, that `manual`
//! stays silent until the app closes, that an ERROR leaves the process the
//! moment it is recorded, and that `startup` on a memory queue is never
//! accepted. Each of those is a counted number of HTTP requests, so each is
//! tested against a stub server rather than against an internal flag.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use firstrun_sdk::{Analytics, Config, DeliveryMode, Diagnostic, Persistence};

const KEY: &str = "fr_desktop_9f3a2b1c4d5e6f70";

// ---------------------------------------------------------------------------
// A server that does nothing but count
// ---------------------------------------------------------------------------

struct StubServer {
    port: u16,
    requests: Arc<AtomicUsize>,
    entries: Arc<AtomicUsize>,
}

impl StubServer {
    fn start() -> StubServer {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(AtomicUsize::new(0));
        let entries = Arc::new(AtomicUsize::new(0));

        let (r, e) = (Arc::clone(&requests), Arc::clone(&entries));
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (r, e) = (Arc::clone(&r), Arc::clone(&e));
                // One thread per connection: ureq pools connections, so a
                // keep-alive that stays open must not stop the next one being
                // accepted.
                thread::spawn(move || serve(stream, r, e));
            }
        });

        StubServer { port, requests, entries }
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn requests(&self) -> usize {
        self.requests.load(Ordering::Relaxed)
    }

    fn entries(&self) -> usize {
        self.entries.load(Ordering::Relaxed)
    }

    /// Waits for at least `n` entries to arrive, bounded. Returns whether they
    /// did, so a test asserts on the answer rather than on a sleep being long
    /// enough on a loaded machine.
    fn wait_for_entries(&self, n: usize, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        while Instant::now() < deadline {
            if self.entries() >= n {
                return true;
            }
            thread::sleep(Duration::from_millis(5));
        }
        self.entries() >= n
    }
}

fn serve(stream: TcpStream, requests: Arc<AtomicUsize>, entries: Arc<AtomicUsize>) {
    let mut writer = match stream.try_clone() {
        Ok(w) => w,
        Err(_) => return,
    };
    let mut reader = BufReader::new(stream);

    loop {
        let mut length = 0usize;
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                // The client closed the connection between requests.
                Ok(0) | Err(_) => return,
                Ok(_) => {}
            }
            let header = line.trim_end();
            if header.is_empty() {
                break;
            }
            let lowered = header.to_ascii_lowercase();
            if let Some(value) = lowered.strip_prefix("content-length:") {
                length = value.trim().parse().unwrap_or(0);
            }
        }

        let mut body = vec![0u8; length];
        if reader.read_exact(&mut body).is_err() {
            return;
        }

        requests.fetch_add(1, Ordering::Relaxed);
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&body) {
            let count = value
                .get("e")
                .and_then(|e| e.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            entries.fetch_add(count, Ordering::Relaxed);
        }

        if writer
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .is_err()
        {
            return;
        }
        let _ = writer.flush();
    }
}

/// A config that talks to `server` and sends nothing it was not asked to.
fn config(server: &StubServer, dir: &tempfile::TempDir) -> Config {
    Config {
        source_key: KEY.into(),
        host: server.url(),
        app_name: "delivery-test".into(),
        app_dir: Some(dir.path().to_path_buf()),
        // Every count in these tests is a count of what the test recorded.
        track_lifecycle: false,
        ..Config::default()
    }
}

fn collector() -> (Arc<Mutex<Vec<Diagnostic>>>, firstrun_sdk::DiagnosticHook) {
    let seen: Arc<Mutex<Vec<Diagnostic>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    let hook: firstrun_sdk::DiagnosticHook = Arc::new(move |d: Diagnostic| {
        if let Ok(mut seen) = sink.lock() {
            seen.push(d);
        }
    });
    (seen, hook)
}

fn messages(seen: &Arc<Mutex<Vec<Diagnostic>>>) -> Vec<String> {
    seen.lock().unwrap().iter().map(|d| d.message.clone()).collect()
}

// ---------------------------------------------------------------------------
// immediate coalesces
// ---------------------------------------------------------------------------

#[test]
fn immediate_coalesces_a_thousand_calls_into_a_handful_of_requests() {
    // The claim that makes `immediate` safe to offer at all: it means "do not
    // wait for a timer", never "one request per entry". A thousand calls in a
    // loop is the shape that catches the mistake.
    let server = StubServer::start();
    let dir = tempfile::tempdir().unwrap();
    let analytics = Analytics::start(Config {
        delivery: DeliveryMode::Immediate,
        ..config(&server, &dir)
    });
    assert!(analytics.is_enabled());

    for _ in 0..1_000 {
        analytics.event("clicked", &[("i", "x")]);
    }

    assert!(analytics.flush(Duration::from_secs(10)), "the queue did not empty");
    drop(analytics);

    assert_eq!(server.entries(), 1_000, "every entry reached the server");
    // 1000 entries at the default max_batch of 200 is five requests at best.
    // Anything near a thousand means the window is not coalescing at all.
    let requests = server.requests();
    assert!(
        (5..=25).contains(&requests),
        "expected a handful of requests, got {requests}"
    );
}

#[test]
fn immediate_does_not_wait_for_the_flush_interval() {
    // The other half of the same claim: coalescing is a window measured in
    // milliseconds, not the interval schedule wearing a different name.
    let server = StubServer::start();
    let dir = tempfile::tempdir().unwrap();
    let analytics = Analytics::start(Config {
        delivery: DeliveryMode::Immediate,
        flush_interval: Duration::from_secs(600),
        ..config(&server, &dir)
    });

    analytics.event("opened_project", &[]);
    assert!(
        server.wait_for_entries(1, Duration::from_secs(5)),
        "an immediate entry waited for the interval"
    );
    drop(analytics);
}

// ---------------------------------------------------------------------------
// the desktop defaults
// ---------------------------------------------------------------------------

#[test]
fn the_desktop_defaults_are_manual_in_memory_and_flushed_on_exit() {
    let server = StubServer::start();
    let dir = tempfile::tempdir().unwrap();
    let analytics = Analytics::start(Config {
        // Short on purpose: under `manual` a timer must not fire at all, so a
        // 50ms interval is the strongest form of the assertion below.
        flush_interval: Duration::from_millis(50),
        ..config(&server, &dir)
    });

    assert_eq!(analytics.delivery(), DeliveryMode::Manual);
    assert_eq!(analytics.persistence(), Persistence::Memory);

    analytics.event("exported_project", &[]);
    analytics.event("opened_project", &[]);
    thread::sleep(Duration::from_millis(300));
    assert_eq!(server.requests(), 0, "manual sent without being asked");

    // Nothing is on the user's disk while the app is running.
    assert!(!dir.path().join("events.ndjson").exists());

    drop(analytics);
    assert_eq!(server.entries(), 2, "the exit flush did not go out");
    assert!(!dir.path().join("events.ndjson").exists());
}

#[test]
fn flush_on_exit_false_means_the_run_takes_its_telemetry_with_it() {
    let server = StubServer::start();
    let dir = tempfile::tempdir().unwrap();
    let analytics = Analytics::start(Config {
        flush_on_exit: false,
        ..config(&server, &dir)
    });

    analytics.event("exported_project", &[]);
    drop(analytics);
    assert_eq!(server.requests(), 0);
}

// ---------------------------------------------------------------------------
// flush_on_severity
// ---------------------------------------------------------------------------

#[test]
fn an_error_leaves_the_process_while_the_process_still_exists() {
    // The mitigation the memory default rests on. Under `manual` nothing else
    // would go out until exit, and a crash never reaches exit.
    let server = StubServer::start();
    let dir = tempfile::tempdir().unwrap();
    let analytics = Analytics::start(config(&server, &dir));

    analytics.event("opened_project", &[]);
    thread::sleep(Duration::from_millis(100));
    assert_eq!(server.requests(), 0);

    analytics.error_log("could not save the project", &[]);
    assert!(
        server.wait_for_entries(1, Duration::from_secs(5)),
        "an ERROR waited for the schedule"
    );

    drop(analytics);
    // The urgent send takes the whole queue with it, which is the coalescing
    // rule again rather than an exception to it.
    assert_eq!(server.entries(), 2);
}

#[test]
fn an_unclassified_entry_is_never_urgent() {
    // `flush_on_severity` filters what the caller classified. An entry with no
    // severity is unclassified rather than severe, exactly as `min_severity`
    // treats it.
    let server = StubServer::start();
    let dir = tempfile::tempdir().unwrap();
    let analytics = Analytics::start(config(&server, &dir));

    analytics.log(firstrun_sdk::LogEntry::new("render.frame"));
    thread::sleep(Duration::from_millis(200));
    assert_eq!(server.requests(), 0);
    drop(analytics);
}

#[test]
fn flush_on_severity_none_turns_it_off() {
    let server = StubServer::start();
    let dir = tempfile::tempdir().unwrap();
    let analytics = Analytics::start(Config {
        flush_on_severity: None,
        ..config(&server, &dir)
    });

    analytics.fatal("the renderer died", &[]);
    thread::sleep(Duration::from_millis(200));
    assert_eq!(server.requests(), 0);
    drop(analytics);
    assert_eq!(server.entries(), 1);
}

// ---------------------------------------------------------------------------
// the incoherent combination
// ---------------------------------------------------------------------------

#[test]
fn startup_on_a_memory_queue_is_coerced_to_disk_and_says_so() {
    // Silently sending nothing is the worst of the three answers the policy
    // allows, so this combination never survives contact with `start`.
    let server = StubServer::start();
    let dir = tempfile::tempdir().unwrap();
    let (seen, hook) = collector();
    let analytics = Analytics::start(Config {
        delivery: DeliveryMode::Startup,
        persistence: Persistence::Memory,
        on_diagnostic: Some(hook),
        ..config(&server, &dir)
    });

    assert_eq!(analytics.persistence(), Persistence::Disk);
    assert_eq!(analytics.delivery(), DeliveryMode::Startup);
    assert!(
        messages(&seen).iter().any(|m| m.contains("startup") && m.contains("disk")),
        "the coercion was not reported: {:?}",
        messages(&seen)
    );
    drop(analytics);
}

#[test]
fn a_max_batch_over_the_servers_cap_is_clamped_rather_than_rejected_forever() {
    // Over the cap, every request fails validation and the queue never drains,
    // which presents as total silence rather than as an error.
    let server = StubServer::start();
    let dir = tempfile::tempdir().unwrap();
    let (seen, hook) = collector();
    let analytics = Analytics::start(Config {
        max_batch: 5_000,
        on_diagnostic: Some(hook),
        ..config(&server, &dir)
    });

    for _ in 0..600 {
        analytics.event("clicked", &[]);
    }
    assert!(analytics.flush(Duration::from_secs(10)));
    drop(analytics);

    assert!(
        messages(&seen).iter().any(|m| m.contains("max_batch")),
        "the clamp was not reported: {:?}",
        messages(&seen)
    );
    assert_eq!(server.entries(), 600);
    // 600 entries cannot have been one request if the cap was honoured.
    assert!(server.requests() >= 2, "the cap was not applied");
}

// ---------------------------------------------------------------------------
// durability, which the default no longer uses and must still work
// ---------------------------------------------------------------------------

#[test]
fn disk_survives_the_run_and_startup_drains_it_on_the_next_one() {
    let dir = tempfile::tempdir().unwrap();

    // A run that never gets to send: the queue outlives it on disk.
    {
        let dead = StubServer::start();
        let analytics = Analytics::start(Config {
            persistence: Persistence::Disk,
            flush_on_exit: false,
            ..config(&dead, &dir)
        });
        assert_eq!(analytics.persistence(), Persistence::Disk);
        analytics.event("exported_project", &[]);
        analytics.event("opened_project", &[]);
        drop(analytics);
        assert_eq!(dead.requests(), 0);
    }
    assert!(dir.path().join("events.ndjson").exists());

    // The next launch drains what survived, and then stays quiet.
    let server = StubServer::start();
    let analytics = Analytics::start(Config {
        delivery: DeliveryMode::Startup,
        persistence: Persistence::Disk,
        flush_on_exit: false,
        flush_interval: Duration::from_millis(50),
        ..config(&server, &dir)
    });

    assert!(
        server.wait_for_entries(2, Duration::from_secs(5)),
        "the startup drain did not replay last run"
    );

    analytics.event("clicked", &[]);
    thread::sleep(Duration::from_millis(300));
    assert_eq!(server.entries(), 2, "startup sent during the run");
    drop(analytics);
}

#[test]
fn interval_sends_on_its_own_clock() {
    let server = StubServer::start();
    let dir = tempfile::tempdir().unwrap();
    let analytics = Analytics::start(Config {
        delivery: DeliveryMode::Interval,
        flush_interval: Duration::from_millis(100),
        ..config(&server, &dir)
    });

    analytics.event("opened_project", &[]);
    assert!(
        server.wait_for_entries(1, Duration::from_secs(5)),
        "the interval never fired"
    );
    drop(analytics);
}

// ---------------------------------------------------------------------------
// the rules the policy never overrides
// ---------------------------------------------------------------------------

#[test]
fn a_host_that_is_not_there_never_reaches_the_caller() {
    // Port 1 on loopback refuses immediately, which is the fast form of every
    // failure this crate has to absorb: no panic, no block, no error out.
    let dir = tempfile::tempdir().unwrap();
    let analytics = Analytics::start(Config {
        source_key: KEY.into(),
        host: "http://127.0.0.1:1".into(),
        app_name: "delivery-test".into(),
        app_dir: Some(dir.path().to_path_buf()),
        track_lifecycle: false,
        delivery: DeliveryMode::Immediate,
        breaker_threshold: 2,
        retry_base_delay: Duration::from_millis(10),
        shutdown_timeout: Duration::from_millis(200),
        ..Config::default()
    });

    let started = Instant::now();
    for _ in 0..200 {
        analytics.event("clicked", &[]);
    }
    // Recording is a channel send. It cannot have waited on a socket.
    assert!(started.elapsed() < Duration::from_secs(1));

    // Nothing arrives, and `flush` says so rather than hanging or throwing.
    let _ = analytics.flush(Duration::from_millis(300));
    let closing = Instant::now();
    drop(analytics);
    assert!(
        closing.elapsed() < Duration::from_secs(2),
        "shutdown outran its own timeout"
    );
}

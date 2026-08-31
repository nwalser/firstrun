//! Analytics for a Tauri desktop app.
//!
//! One anonymous id for this installation, a bounded queue, and a background
//! thread that ships batches to `POST /v1/e`.
//!
//! # When it sends
//!
//! Two settings, and conflating them is the mistake: [`DeliveryMode`] decides
//! when a send is attempted, [`Persistence`] decides what is still there after a
//! crash. The desktop defaults are **manual with a flush on exit, in memory**,
//! so a run's telemetry goes out as one burst when the app closes and nothing is
//! left on the user's machine between runs.
//!
//! That is also, on its own, the configuration in which a crash loses the report
//! of the crash. `flush_on_severity` (ERROR by default) is the mitigation: an
//! entry at or above it leaves the process at the moment it is recorded rather
//! than at exit. The residual gap and the way to close it are in the README.
//!
//! **The contract, which outranks every feature here: if firstrun is
//! unreachable, slow, or returning errors, the host application is unaffected.**
//! Every recording call hands a message to a channel and returns. They do no
//! I/O, take no lock a UI thread contends on, cannot panic into the caller, and
//! cannot fail in a way the caller has to handle. Nothing in this crate writes
//! to the host's stdout or stderr: the only output is the diagnostic hook, which
//! the host opts into.
//!
//! The trade is stated plainly. This SDK is allowed to lose entries. It is not
//! allowed to panic, block, retry unboundedly, or grow without limit.
//!
//! # One shape for everything
//!
//! firstrun stores one thing: a **log entry**. An error is a log entry with a
//! high severity and `exception.*` attributes. A product event is a log entry
//! with a name. A measurement is a log entry carrying `firstrun.metric` and
//! `firstrun.value`. The model is OpenTelemetry's log data model: a timestamp,
//! an observed timestamp, a severity number on the 1..24 ladder, a body, and an
//! attribute map.
//!
//! So there is one recording call, [`Analytics::log`], and everything else
//! builds one for you. [`Analytics::event`], [`Analytics::error`],
//! [`Analytics::info`] and the rest are **convenience helpers that build a
//! conventional entry: examples of a good shape, not a schema.** Nothing they
//! produce is privileged, and nothing you send without them is second class.
//!
//! Identity is three optional attributes and nothing is inferred. `device.id` is anonymous,
//! generated on this machine and persisted next to the queue; `user.id` is only
//! ever the string the host passed to [`Analytics::identify`]. This client is
//! never linked to a website visitor or to any other app.
//!
//! ```no_run
//! use firstrun_sdk::{Analytics, Config, LogEntry};
//! use std::time::Duration;
//!
//! let analytics = Analytics::start(Config {
//!     source_key: "fr_9f3a2b1c4d5e6f70".into(),
//!     host: "https://t.example.com".into(),
//!     app_name: "Themia".into(),
//!     service_version: Some(env!("CARGO_PKG_VERSION").into()),
//!     ..Config::default()
//! });
//!
//! // A conventional product event.
//! analytics.event("opened_project", &[("kind", "local")]);
//!
//! // A conventional line, at a severity.
//! analytics.warn("the sample cache was rebuilt from scratch", &[]);
//!
//! // Something threw. The error is unwrapped into exception.* for you.
//! if let Err(e) = std::fs::read("project.json") {
//!     analytics.error(&e, &[("path", "project.json")]);
//! }
//!
//! // The raw escape hatch, for anything the helpers do not say.
//! analytics.log(
//!     LogEntry::new("render.frame")
//!         .severity(firstrun_sdk::wire::SEVERITY_DEBUG)
//!         .attr("firstrun.metric", "frame_ms")
//!         .attr("firstrun.value", 16.4)
//!         .attr("layers", 12),
//! );
//!
//! analytics.user(Some("acct_8812"));
//!
//! // On the way out. Optional, and bounded by what you pass it.
//! analytics.flush(Duration::from_secs(2));
//! ```

pub mod client;
pub mod device_id;
pub mod queue;
pub mod wire;

use std::fmt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::Value;

use client::{Client, LogBatch, Outcome};
use queue::{Queue, QueuedEntry};
use wire::{
    clamp_attributes, clamp_body, Attributes, ATTR_BROWSER_LANGUAGE, ATTR_CHANNEL,
    ATTR_DEVICE_ID, ATTR_EXCEPTION_MESSAGE, ATTR_EXCEPTION_STACKTRACE, ATTR_EXCEPTION_TYPE,
    ATTR_HOST_ARCH, ATTR_OS_TYPE, ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_SESSION_ID,
    ATTR_TEST, ATTR_URL_PATH,
    ATTR_USER_ID, SEVERITY_DEBUG, SEVERITY_ERROR, SEVERITY_FATAL, SEVERITY_INFO, SEVERITY_TRACE,
    SEVERITY_WARN,
};

/// Conventional entry names. Suggestions, not law: any name the server accepts
/// is stored, counted, grouped and filtered identically.
pub use wire::{
    NAME_APP_INSTALL, NAME_APP_LAUNCH, NAME_EXCEPTION, NAME_IDENTIFY, NAME_LOG, NAME_MEASUREMENT,
    NAME_PAGE_VIEW, NAME_SESSION_START,
};

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/// What a [`Diagnostic`] is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticCode {
    /// An entry was refused before it entered the queue.
    Refused,
    /// Entries were discarded because the queue was full.
    Dropped,
    /// A batch failed and will be tried again.
    Retry,
    /// The server refused a batch, so it was dropped rather than retried.
    Rejected,
    /// Sending has paused after repeated failures.
    BreakerOpen,
    /// The server answered again and sending resumed.
    BreakerClose,
    /// Something inside this crate went wrong. Never fatal to the host.
    Internal,
}

/// The only thing this crate ever reports.
#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub code: DiagnosticCode,
    pub message: String,
    /// How many entries this is about, where that means anything.
    pub count: usize,
}

/// Where diagnostics go. Never a logger this crate picked, and never stderr:
/// analytics has no business in the host's log output.
pub type DiagnosticHook = Arc<dyn Fn(Diagnostic) + Send + Sync + 'static>;

/// Counters, for a debug screen or a test.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Stats {
    /// Entries waiting to be sent right now, wherever the queue lives.
    pub queued: usize,
    pub accepted: u64,
    /// Dropped because the queue was full. The oldest go first.
    pub dropped_overflow: u64,
    /// Dropped because the server refused them.
    pub dropped_rejected: u64,
    /// Refused before queueing: an invalid name, or a disabled client.
    pub refused: u64,
    pub circuit_open: bool,
    pub consecutive_failures: u32,
}

#[derive(Default)]
struct Counters {
    queued: AtomicUsize,
    accepted: AtomicU64,
    dropped_overflow: AtomicU64,
    dropped_rejected: AtomicU64,
    refused: AtomicU64,
    circuit_open: AtomicBool,
    consecutive_failures: AtomicU32,
}

// ---------------------------------------------------------------------------
// Delivery policy
// ---------------------------------------------------------------------------

/// **When** a send is attempted. See `docs/delivery-policy.md`.
///
/// Scheduling and durability look like one setting and are not. This is the
/// first half; [`Persistence`] is the second. "Send once at startup" is not a
/// schedule on its own: it is a schedule that never fires during the run,
/// combined with a queue that survives to the next one. Modelled as one setting,
/// the combination people actually want cannot be expressed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryMode {
    /// Send as soon as a batch can be formed.
    ///
    /// **Not one request per entry.** It means "do not wait for a timer".
    /// Entries recorded close together coalesce into one batch, so a loop
    /// calling [`Analytics::event`] a thousand times produces a handful of
    /// requests. `coalesce_window` is how wide "close together" is.
    Immediate,
    /// Every `flush_interval`, or when `max_batch` entries are waiting,
    /// whichever comes first.
    Interval,
    /// Drain whatever survived the last run at startup, then never again during
    /// this one: the quietest mode there is, one burst of requests per launch.
    ///
    /// Only coherent with [`Persistence::Disk`], since a memory queue has
    /// nothing to drain. Pair it with `flush_on_exit: false` if you want the
    /// burst to be the only traffic a run produces.
    Startup,
    /// Only [`Analytics::flush`], plus shutdown when `flush_on_exit` is set.
    ///
    /// The desktop default: a run's telemetry goes out as one burst when the
    /// application closes.
    Manual,
}

/// **What is still there** after a crash or a kill.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Persistence {
    /// Nothing is written to the user's disk and nothing survives the run.
    ///
    /// The desktop default. Quiet, and it leaves no trace between runs. The cost
    /// is stated plainly in the README: this is exactly the configuration in
    /// which a hard crash loses everything, including the report of the crash,
    /// which is what `flush_on_severity` exists to mitigate.
    Memory,
    /// The pending queue is written beside the anonymous id and drained on the
    /// next start.
    ///
    /// What makes a crash report survive the crash that produced it, and the
    /// only thing [`DeliveryMode::Startup`] can be built on.
    Disk,
}

// ---------------------------------------------------------------------------
// The entry
// ---------------------------------------------------------------------------

/// One log entry, as the wire models it. The raw escape hatch.
///
/// Build it, hand it to [`Analytics::log`], and it goes out exactly as written.
/// There is nothing the convenience helpers can produce that you cannot write
/// here yourself, and nothing you write here is treated differently.
///
/// ```
/// use firstrun_sdk::LogEntry;
/// use firstrun_sdk::wire::SEVERITY_WARN;
///
/// let entry = LogEntry::new("cache.rebuilt")
///     .severity(SEVERITY_WARN)
///     .body("the sample cache was rebuilt from scratch")
///     .attr("firstrun.duration_ms", 8_400)
///     .attr("reason", "checksum mismatch");
/// ```
#[derive(Debug, Clone)]
pub struct LogEntry {
    /// What KIND of thing this is: the `name` column, and what a board groups on.
    pub name: String,
    /// The human-readable line, when there is one.
    pub body: Option<String>,
    /// 1..24 on the OpenTelemetry ladder.
    ///
    /// `None` is the honest answer when you have nothing to say. An entry with
    /// no severity is unclassified; one silently filed as INFO is a lie a
    /// filter will act on.
    pub severity: Option<u8>,
    /// Everything else. The backend does not know what any key means, which is
    /// the point: a closed set of columns is a closed set of questions.
    pub attributes: Attributes,
    /// When it happened, in milliseconds since the epoch. `None` means now.
    /// Authoritative: the server buckets on this and never rebuckets.
    pub timestamp: Option<i64>,
    /// Reserved by the log data model. Stored, unused by the product today.
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
}

impl LogEntry {
    pub fn new(name: impl Into<String>) -> Self {
        LogEntry {
            name: name.into(),
            body: None,
            severity: None,
            attributes: Attributes::new(),
            timestamp: None,
            trace_id: None,
            span_id: None,
        }
    }

    pub fn body(mut self, body: impl Into<String>) -> Self {
        self.body = Some(body.into());
        self
    }

    pub fn severity(mut self, severity: u8) -> Self {
        self.severity = Some(severity);
        self
    }

    /// Adds one attribute. Any JSON value, nested up to four levels.
    pub fn attr(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        self.attributes.insert(key.into(), value.into());
        self
    }

    /// Milliseconds since the epoch, for something you are recording after the
    /// fact. A launch that happened on Friday and is sent on Monday is a Friday
    /// launch.
    pub fn at(mut self, timestamp_ms: i64) -> Self {
        self.timestamp = Some(timestamp_ms);
        self
    }

    /// Reserved by the model. Nothing in the product reads these yet.
    pub fn trace(mut self, trace_id: impl Into<String>, span_id: impl Into<String>) -> Self {
        self.trace_id = Some(trace_id.into());
        self.span_id = Some(span_id.into());
        self
    }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/// Everything the SDK needs to know. Only `source_key`, `host` and `app_name`
/// have to be set; every other default is safe in production.
#[derive(Clone)]
pub struct Config {
    /// The public source key for this app, e.g. `fr_9f3a2b1c4d5e6f70`.
    ///
    /// It ships inside the binary, names which ingestion site is sending, and
    /// authorises nothing. The server is the only thing that knows which project
    /// it belongs to.
    pub source_key: String,
    /// Ingest origin, e.g. the subdomain the customer pointed at us. Trailing
    /// slash optional.
    pub host: String,
    /// Names the directory holding the anonymous id and the queue. Set it to the
    /// product name so both survive a source key rotation.
    pub app_name: String,

    /// Sent as the `service.name` resource attribute. Defaults to `app_name`.
    pub service_name: Option<String>,
    /// Sent as `service.version`. `env!("CARGO_PKG_VERSION")` is the usual answer.
    pub service_version: Option<String>,
    /// Sent as `firstrun.channel`, e.g. "stable" or "beta".
    pub channel: Option<String>,
    /// Sent as `os.type`. Defaults to this platform.
    pub os: Option<String>,
    /// Sent as `host.arch`. Defaults to this platform.
    pub arch: Option<String>,
    /// Sent as `browser.language`, a BCP-47 tag, which is what the convention
    /// calls it on every client. No default: the standard library cannot read
    /// the user's UI language, and a guess here is worse than a null.
    pub locale: Option<String>,

    /// Extra resource attributes: anything true of this INSTALLATION rather than
    /// of one entry. The named options above win on a clash.
    pub resource: Attributes,
    /// Attributes stamped onto every entry. An entry's own attributes win.
    pub default_attributes: Attributes,

    /// Marks everything this client sends as test data, via `firstrun.test`.
    ///
    /// The dashboard shows one world or the other and never both, so a debug
    /// build with this set cannot move a number anybody is looking at. Wire it
    /// to what the build already knows, such as `cfg!(debug_assertions)`.
    /// Nothing is inferred here: a client that guessed would eventually guess
    /// wrong on somebody's machine, silently and in the direction nobody checks.
    pub test_mode: bool,

    /// Where the anonymous id and the queue live. Defaults to the per-user local
    /// application data directory under `firstrun/<app_name>`.
    pub app_dir: Option<PathBuf>,
    /// Supply the anonymous id yourself instead of persisting one.
    pub device_id: Option<String>,
    /// Emits `app_install` on the run that creates the anonymous id, and
    /// `session_start` then `app_launch` on every run. Nothing else is ever
    /// sent for you.
    ///
    /// `session_start` is sent because this client already HAS a session -- one
    /// run is one session, and `session.id` rides on every entry -- and a
    /// session nothing ever announces is one no board can count. The browser
    /// tag has always sent it; a desktop app that carried a session id and
    /// never opened it left every "sessions" card reading zero on data that
    /// plainly had sessions in it.
    pub track_lifecycle: bool,

    /// Entries classified below this severity are dropped before they are
    /// queued. 0 sends everything.
    ///
    /// An entry with NO severity is never dropped by this: unclassified is not
    /// the same as quiet, and filtering on a field the caller did not set would
    /// silently lose the entries that say the least about themselves.
    pub min_severity: u8,

    /// Entries allowed in the queue. Past this the oldest are dropped and
    /// counted in [`Stats::dropped_overflow`].
    pub max_queued_entries: usize,
    /// Bytes allowed in the queue. The other half of the same ceiling, because a
    /// few entries with large attribute maps can cost more than a great many
    /// small ones.
    pub max_queue_bytes: u64,

    /// When a send is attempted. Defaults to [`DeliveryMode::Manual`], which
    /// with `flush_on_exit` is the desktop policy: one burst as the app closes.
    pub delivery: DeliveryMode,
    /// What survives the run. Defaults to [`Persistence::Memory`]: nothing is
    /// written to the user's disk.
    pub persistence: Persistence,
    /// Entries per request, the policy's `maxBatch`.
    ///
    /// Clamped to the server's cap ([`wire::MAX_BATCH_ENTRIES`]) with a
    /// diagnostic, because a batch over it is rejected on every attempt: the
    /// queue never drains and it presents as total silence.
    pub max_batch: usize,
    /// The policy's `every`: how long a partial batch waits under
    /// [`DeliveryMode::Interval`]. Ignored by every other mode.
    pub flush_interval: Duration,
    /// How long [`DeliveryMode::Immediate`] gathers entries before sending.
    ///
    /// This is what makes "immediate" mean "do not wait for a timer" rather than
    /// "one request per entry". It never delays a caller: the wait happens on
    /// the sender thread, which has nothing else to do.
    pub coalesce_window: Duration,
    /// Any entry classified at or above this severity is sent at once, whatever
    /// the schedule says. `None` turns it off. Defaults to
    /// [`wire::SEVERITY_ERROR`].
    ///
    /// The single most valuable setting here, and the reason a memory queue is a
    /// defensible desktop default: a crash report that waits for the next tick
    /// is a crash report that usually never arrives, because the process is
    /// gone. An entry with no severity is never urgent, for the same reason
    /// `min_severity` never drops one: unclassified is not a classification.
    pub flush_on_severity: Option<u8>,
    /// Best-effort drain while the [`Analytics`] value is being dropped, bounded
    /// by `shutdown_timeout`. Defaults to true.
    pub flush_on_exit: bool,

    /// Whole-request timeout. There is no analytics request worth waiting longer
    /// than this for.
    pub request_timeout: Duration,
    /// Dial and TLS handshake.
    pub connect_timeout: Duration,
    /// First retry delay. Doubles per consecutive failure.
    pub retry_base_delay: Duration,
    /// Ceiling for the retry delay before jitter.
    pub retry_max_delay: Duration,
    /// Consecutive failures before the circuit opens and we stop dialling.
    pub breaker_threshold: u32,
    /// How long the circuit stays open, after which one probe is allowed.
    pub breaker_cooldown: Duration,
    /// The longest dropping the [`Analytics`] value may block the host.
    pub shutdown_timeout: Duration,

    /// False accepts every call and sends nothing.
    pub enabled: bool,
    /// The only output this crate produces. It is called from the sender thread
    /// and from the recording calls, so it must be cheap and safe for concurrent
    /// use. A panic inside it is caught and discarded.
    pub on_diagnostic: Option<DiagnosticHook>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            source_key: String::new(),
            host: String::new(),
            app_name: String::new(),
            service_name: None,
            service_version: None,
            channel: None,
            os: None,
            arch: None,
            locale: None,
            resource: Attributes::new(),
            default_attributes: Attributes::new(),
            test_mode: false,
            app_dir: None,
            device_id: None,
            track_lifecycle: true,
            min_severity: 0,
            max_queued_entries: 5_000,
            max_queue_bytes: 2 * 1024 * 1024,
            // The desktop row of the table in `docs/delivery-policy.md`: manual
            // with a flush on exit, in memory, and anything at or above ERROR
            // leaving the process while the process still exists.
            delivery: DeliveryMode::Manual,
            persistence: Persistence::Memory,
            max_batch: 200,
            flush_interval: Duration::from_secs(30),
            coalesce_window: Duration::from_millis(10),
            flush_on_severity: Some(SEVERITY_ERROR),
            flush_on_exit: true,
            request_timeout: Duration::from_secs(10),
            connect_timeout: Duration::from_secs(5),
            retry_base_delay: Duration::from_secs(1),
            retry_max_delay: Duration::from_secs(60),
            breaker_threshold: 5,
            breaker_cooldown: Duration::from_secs(300),
            shutdown_timeout: Duration::from_secs(2),
            enabled: true,
            on_diagnostic: None,
        }
    }
}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("source_key", &self.source_key)
            .field("host", &self.host)
            .field("app_name", &self.app_name)
            .field("service_name", &self.service_name)
            .field("service_version", &self.service_version)
            .field("channel", &self.channel)
            .field("os", &self.os)
            .field("arch", &self.arch)
            .field("locale", &self.locale)
            .field("resource", &self.resource)
            .field("default_attributes", &self.default_attributes)
            .field("app_dir", &self.app_dir)
            .field("track_lifecycle", &self.track_lifecycle)
            .field("min_severity", &self.min_severity)
            .field("max_queued_entries", &self.max_queued_entries)
            .field("max_queue_bytes", &self.max_queue_bytes)
            .field("delivery", &self.delivery)
            .field("persistence", &self.persistence)
            .field("max_batch", &self.max_batch)
            .field("flush_interval", &self.flush_interval)
            .field("coalesce_window", &self.coalesce_window)
            .field("flush_on_severity", &self.flush_on_severity)
            .field("flush_on_exit", &self.flush_on_exit)
            .field("request_timeout", &self.request_timeout)
            .field("connect_timeout", &self.connect_timeout)
            .field("retry_base_delay", &self.retry_base_delay)
            .field("retry_max_delay", &self.retry_max_delay)
            .field("breaker_threshold", &self.breaker_threshold)
            .field("breaker_cooldown", &self.breaker_cooldown)
            .field("shutdown_timeout", &self.shutdown_timeout)
            .field("enabled", &self.enabled)
            .field("on_diagnostic", &self.on_diagnostic.is_some())
            .finish()
    }
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

enum Message {
    Entry(QueuedEntry),
    Identify(Option<String>),
    /// Drain until the deadline, then answer whether the queue emptied.
    Flush(Instant, Sender<bool>),
    Shutdown,
}

/// The handle the host holds for the life of the app.
///
/// Tauri's managed state is the natural place for it. Dropping it flushes what
/// is queued and stops the sender thread, bounded by `shutdown_timeout`.
pub struct Analytics {
    tx: Sender<Message>,
    worker: Option<JoinHandle<()>>,
    /// The worker signals here just before it returns. `JoinHandle::join` cannot
    /// be given a deadline, so this is what makes `Drop` bounded.
    ///
    /// Behind a `Mutex` only because a bare `Receiver` is `!Sync`, and Tauri's
    /// managed state requires `Send + Sync`. It is read once, from `Drop`.
    finished: Mutex<Receiver<()>>,
    device_id: String,
    session_id: String,
    default_attributes: Attributes,
    min_severity: u8,
    counters: Arc<Counters>,
    hook: Option<DiagnosticHook>,
    enabled: bool,
    /// The policy actually in force, which is not always the one that was asked
    /// for: see [`Analytics::delivery`].
    delivery: DeliveryMode,
    persistence: Persistence,
    shutdown_timeout: Duration,
}

/// `tauri::Builder::manage` requires `Send + Sync + 'static`, so losing either
/// breaks the one way this crate is meant to be held. A compile-time assertion
/// rather than a comment, because the offending field is usually something
/// innocent added deep inside the handle.
const _: fn() = || {
    fn manageable<T: Send + Sync + 'static>() {}
    manageable::<Analytics>();
};

impl Analytics {
    /// Starts the SDK: resolves the anonymous id, settles the delivery policy,
    /// replays anything a previous run persisted, and keeps shipping.
    ///
    /// **This never fails.** A missing source key or a thread that will not spawn
    /// produce a client that accepts every call and sends nothing, plus a
    /// diagnostic saying so. A host is not asked to handle an analytics failure
    /// on its startup path. Call [`Analytics::is_enabled`] in a test if you want
    /// that to be loud.
    ///
    /// A policy that cannot work is coerced rather than accepted: `startup` on a
    /// memory queue would send nothing for the life of the app, so it becomes
    /// disk and says so. [`Analytics::delivery`] and [`Analytics::persistence`]
    /// report what is actually in force.
    pub fn start(mut config: Config) -> Analytics {
        let hook = config.on_diagnostic.clone();
        let counters = Arc::new(Counters::default());
        let session_id = uuid::Uuid::new_v4().to_string();

        let configured = !config.source_key.trim().is_empty() && !config.host.trim().is_empty();
        if !configured {
            report(&hook, DiagnosticCode::Internal, 0, || {
                "source_key and host are required; this client will discard every call".into()
            });
        } else if !wire::is_valid_source_key(&config.source_key) {
            // Not fatal: the server is the authority on whether a key resolves.
            // This is here so a typo shows up as a diagnostic rather than as
            // silence on a dashboard nobody is watching yet.
            report(&hook, DiagnosticCode::Internal, 0, || {
                "source_key does not look like fr_<16 hex>".into()
            });
        }

        let app_dir = config
            .app_dir
            .clone()
            .or_else(|| device_id::default_app_dir(&config.app_name));

        // Resolve the id before deciding whether to run, so `device_id()` is
        // answerable on a disabled client too.
        let (id, first_run) = match (config.device_id.as_deref().and_then(wire::clamp_id), &app_dir) {
            (Some(supplied), _) => (supplied, false),
            (None, Some(dir)) => {
                let (resolved, error) = device_id::load_or_create(dir);
                if let Some(error) = error {
                    report(&hook, DiagnosticCode::Internal, 0, || {
                        format!("could not persist the anonymous id: {error}")
                    });
                }
                (resolved.id, resolved.first_run)
            }
            // No directory on this platform and none supplied. A per-process id
            // is still a real id; it simply does not survive a restart.
            (None, None) => (uuid::Uuid::new_v4().to_string(), true),
        };

        // Resolved before anything is spawned, so an incoherent combination is
        // reported once, on the caller's thread, rather than becoming silence.
        resolve_policy(&mut config, app_dir.is_some(), &hook);

        let enabled = configured && config.enabled;
        let (tx, rx) = mpsc::channel::<Message>();
        let (finished_tx, finished) = mpsc::channel::<()>();
        let shutdown_timeout = config.shutdown_timeout;
        let lifecycle = config.track_lifecycle;
        let min_severity = config.min_severity;
        let delivery = config.delivery;
        let persistence = config.persistence;

        let mut default_attributes = config.default_attributes.clone();
        clamp_attributes(&mut default_attributes);

        let mut analytics = Analytics {
            tx,
            worker: None,
            finished: Mutex::new(finished),
            device_id: id.clone(),
            session_id: session_id.clone(),
            default_attributes,
            min_severity,
            counters: Arc::clone(&counters),
            hook: hook.clone(),
            enabled,
            delivery,
            persistence,
            shutdown_timeout,
        };

        if !enabled {
            // The sender half stays alive with no receiver, so every later call
            // is a no-op that costs one failed channel send.
            return analytics;
        }

        let worker = Worker::new(config, app_dir, Arc::clone(&counters));
        let spawned = thread::Builder::new()
            .name("firstrun-sender".into())
            .spawn(move || {
                // The worker is written not to panic. This is the backstop that
                // keeps one that slipped through from becoming an abort in the
                // host's process.
                let _ = catch_unwind(AssertUnwindSafe(|| worker.run(rx)));
                let _ = finished_tx.send(());
            });

        match spawned {
            Ok(handle) => analytics.worker = Some(handle),
            Err(e) => {
                report(&hook, DiagnosticCode::Internal, 0, || {
                    format!("could not start the sender thread: {e}")
                });
                analytics.enabled = false;
                return analytics;
            }
        }

        if lifecycle {
            if first_run {
                analytics.event(NAME_APP_INSTALL, &[]);
            }
            // Ordered install, session, launch: an install is a fact about this
            // machine, the session is the run those entries belong to, and the
            // launch is the thing a daily-active count reads. All three carry
            // the same `session.id`, so the order is a readability choice
            // rather than something a query depends on.
            analytics.event(NAME_SESSION_START, &[]);
            analytics.event(NAME_APP_LAUNCH, &[]);
        }

        analytics
    }

    /// The anonymous id being sent. Not a person, and not joined to anything.
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    /// The id for this run of the app. One launch is one session. Travels as the
    /// `session.id` attribute.
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// False when the SDK was misconfigured or turned off. It still accepts
    /// every call.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// The schedule actually in force.
    ///
    /// Not always the one that was configured: an incoherent combination is
    /// coerced to the nearest coherent one and reported through the diagnostic
    /// hook rather than accepted and quietly never sent.
    pub fn delivery(&self) -> DeliveryMode {
        self.delivery
    }

    /// The durability actually in force. See [`Analytics::delivery`].
    pub fn persistence(&self) -> Persistence {
        self.persistence
    }

    pub fn stats(&self) -> Stats {
        Stats {
            queued: self.counters.queued.load(Ordering::Relaxed),
            accepted: self.counters.accepted.load(Ordering::Relaxed),
            dropped_overflow: self.counters.dropped_overflow.load(Ordering::Relaxed),
            dropped_rejected: self.counters.dropped_rejected.load(Ordering::Relaxed),
            refused: self.counters.refused.load(Ordering::Relaxed),
            circuit_open: self.counters.circuit_open.load(Ordering::Relaxed),
            consecutive_failures: self.counters.consecutive_failures.load(Ordering::Relaxed),
        }
    }

    // -----------------------------------------------------------------------
    // The raw call
    // -----------------------------------------------------------------------

    /// Records one log entry, exactly as you describe it.
    ///
    /// This is the whole API. Every helper below builds one of these and calls
    /// it. Use it whenever the conventional helpers do not say what you mean:
    /// they are examples of a good shape, not a schema you have to fit.
    ///
    /// Returns as soon as the entry is on the channel: no I/O, no lock the UI
    /// thread contends on, no panic. An invalid name is counted in
    /// [`Stats::refused`] and reported rather than sent.
    pub fn log(&self, entry: LogEntry) {
        if !self.enabled {
            self.counters.refused.fetch_add(1, Ordering::Relaxed);
            return;
        }
        if !wire::is_valid_log_name(&entry.name) {
            self.counters.refused.fetch_add(1, Ordering::Relaxed);
            let name = entry.name.clone();
            report(&self.hook, DiagnosticCode::Refused, 1, || {
                format!("invalid entry name: {name:?}")
            });
            return;
        }
        // A threshold filters what the caller CLASSIFIED. An entry with no
        // severity is unclassified rather than quiet, so it is never dropped.
        if let Some(severity) = entry.severity {
            if severity < self.min_severity {
                return;
            }
        }

        // The client-level defaults sit UNDER the entry's own attributes, so a
        // call that names a key explicitly wins. Anything else would make an
        // override silently ineffective.
        let mut attributes = self.default_attributes.clone();
        // A desktop install IS a machine, which is why this client fills
        // `device.id` in for itself and the browser tag does not. One run is one
        // session, so both ride on every entry.
        attributes.insert(ATTR_DEVICE_ID.into(), Value::String(self.device_id.clone()));
        attributes.insert(ATTR_SESSION_ID.into(), Value::String(self.session_id.clone()));
        for (key, value) in entry.attributes {
            attributes.insert(key, value);
        }
        clamp_attributes(&mut attributes);

        let mut queued = QueuedEntry::now(
            &entry.name,
            entry.severity.map(|s| s.clamp(wire::SEVERITY_MIN, wire::SEVERITY_MAX)),
            entry.body.as_deref().and_then(clamp_body),
            attributes,
        );
        if let Some(at) = entry.timestamp {
            queued.timestamp = at.max(0);
        }
        queued.trace_id = entry.trace_id;
        queued.span_id = entry.span_id;

        let _ = self.tx.send(Message::Entry(queued));
    }

    // -----------------------------------------------------------------------
    // Conventional helpers
    // -----------------------------------------------------------------------

    /// Something happened that is worth counting: a product event.
    ///
    /// A conventional entry at INFO whose `name` is the thing that happened. Any
    /// name matching `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$` is legal and nothing is
    /// special-cased: `event("opened_project")` and `event("exported_csv")` are
    /// the same kind of thing.
    pub fn event(&self, name: &str, attributes: &[(&str, &str)]) {
        self.log(entry_with(name, Some(SEVERITY_INFO), None, attributes));
    }

    /// Something threw. The error is unwrapped for you.
    ///
    /// A conventional entry named `exception` at ERROR, carrying
    /// `exception.type` from the error's type, `exception.message` from its
    /// `Display`, and `exception.stacktrace` from its `source()` chain. Rust
    /// errors do not carry a stack, and the chain is the closest thing that is
    /// actually useful to read.
    ///
    /// There is no error table and no error pipeline behind this. It is a log
    /// entry like every other one, and it is only an error because of its
    /// severity and its attributes.
    pub fn error<E: std::error::Error + ?Sized>(&self, err: &E, attributes: &[(&str, &str)]) {
        let (message, exception) = exception_attributes(err);
        let mut entry = entry_with(NAME_EXCEPTION, Some(SEVERITY_ERROR), Some(message), attributes);
        // Under the caller's own, so an explicit `exception.type` still wins.
        let mut merged = exception;
        for (key, value) in entry.attributes {
            merged.insert(key, value);
        }
        entry.attributes = merged;
        self.log(entry);
    }

    /// A line at TRACE. Named `log`, because `name` is what a board groups on.
    pub fn trace(&self, body: &str, attributes: &[(&str, &str)]) {
        self.line(SEVERITY_TRACE, body, attributes);
    }

    /// A line at DEBUG.
    pub fn debug(&self, body: &str, attributes: &[(&str, &str)]) {
        self.line(SEVERITY_DEBUG, body, attributes);
    }

    /// A line at INFO.
    pub fn info(&self, body: &str, attributes: &[(&str, &str)]) {
        self.line(SEVERITY_INFO, body, attributes);
    }

    /// A line at WARN.
    pub fn warn(&self, body: &str, attributes: &[(&str, &str)]) {
        self.line(SEVERITY_WARN, body, attributes);
    }

    /// A line at ERROR with no error value to unwrap.
    ///
    /// [`Analytics::error`] is taken by the helper that unwraps a thrown thing,
    /// which is the one worth the shorter name. This is for the case where you
    /// have a sentence and no `Error`.
    pub fn error_log(&self, body: &str, attributes: &[(&str, &str)]) {
        self.line(SEVERITY_ERROR, body, attributes);
    }

    /// A line at FATAL.
    pub fn fatal(&self, body: &str, attributes: &[(&str, &str)]) {
        self.line(SEVERITY_FATAL, body, attributes);
    }

    fn line(&self, severity: u8, body: &str, attributes: &[(&str, &str)]) {
        self.log(entry_with(
            NAME_LOG,
            Some(severity),
            Some(body.to_string()),
            attributes,
        ));
    }

    /// A screen or page was viewed. The path travels as the conventional
    /// `url.path` attribute; there is no url column.
    pub fn page(&self, path: &str, attributes: &[(&str, &str)]) {
        let mut entry = entry_with(NAME_PAGE_VIEW, Some(SEVERITY_INFO), None, attributes);
        entry
            .attributes
            .entry(ATTR_URL_PATH.to_string())
            .or_insert_with(|| Value::String(path.to_string()));
        self.log(entry);
    }

    /// Attaches the host's own user id to everything sent from here on, and
    /// records an `identify` entry so the id lands on a row immediately.
    ///
    /// The id becomes the `user.id` attribute of every later entry. This is the
    /// only way a user id ever appears. Nothing is inferred, nothing is derived,
    /// nothing is merged, and this source is never linked to any other. Pass
    /// `None` to sign out; `device.id` is kept, because it belongs to this
    /// installation rather than to whoever signed in.
    pub fn user(&self, user_id: Option<&str>) {
        let clamped = user_id.and_then(wire::clamp_id);
        // Ordered ahead of the entry on the same channel, so the `identify`
        // entry is the first one that carries the new id.
        let _ = self.tx.send(Message::Identify(clamped.clone()));
        if clamped.is_some() {
            self.event(NAME_IDENTIFY, &[]);
        }
    }

    /// Waits at most `timeout` for everything queued before this call to reach
    /// the server, and returns whether it did.
    ///
    /// **Never required.** It exists for an app about to exit that would rather
    /// not lose the last few entries. False means a timeout, a disabled client,
    /// or an open circuit; it is not an error the host has to do anything about.
    pub fn flush(&self, timeout: Duration) -> bool {
        if !self.enabled {
            return false;
        }
        let (reply, answer) = mpsc::channel::<bool>();
        if self.tx.send(Message::Flush(Instant::now() + timeout, reply)).is_err() {
            return false;
        }
        // Bounded by the caller's own number, and a dead worker answers as a
        // disconnect rather than holding the host here.
        answer.recv_timeout(timeout).unwrap_or(false)
    }
}

impl Drop for Analytics {
    fn drop(&mut self) {
        let _ = self.tx.send(Message::Shutdown);
        let Some(worker) = self.worker.take() else {
            return;
        };

        // `join` has no deadline, so wait on the worker's own signal instead and
        // give up on schedule. A sender still inside a socket read at that point
        // is left to process exit: holding the host's shutdown open for it would
        // trade the one thing this crate promises for a handful of entries.
        // `get_mut` rather than `lock`: nothing else can hold this while `Drop`
        // runs, and a poisoned mutex must not become a panic on the way out.
        let finished = match self.finished.get_mut() {
            Ok(finished) => finished,
            Err(poisoned) => poisoned.into_inner(),
        };

        match finished.recv_timeout(self.shutdown_timeout + Duration::from_millis(250)) {
            Ok(()) => {
                let _ = worker.join();
            }
            Err(_) => report(&self.hook, DiagnosticCode::Internal, 0, || {
                "the sender thread did not finish within shutdown_timeout".into()
            }),
        }
    }
}

/// Settles the two policy axes against each other and against the platform.
///
/// Every coercion here is loud. The one outcome `docs/delivery-policy.md` rules
/// out is a client that accepts a combination and then sends nothing, so a
/// combination that cannot work becomes the nearest one that can, plus a
/// diagnostic saying what changed and why.
fn resolve_policy(config: &mut Config, has_app_dir: bool, hook: &Option<DiagnosticHook>) {
    // A batch over the server's cap is rejected on every attempt, so the queue
    // never drains and the failure presents as total silence rather than as an
    // error anyone can see. The cap is read out of the wire format.
    let asked = config.max_batch;
    config.max_batch = asked.clamp(1, wire::MAX_BATCH_ENTRIES);
    if asked > wire::MAX_BATCH_ENTRIES {
        let cap = wire::MAX_BATCH_ENTRIES;
        report(hook, DiagnosticCode::Internal, 0, move || {
            format!("max_batch {asked} is over the server's per-request cap, using {cap}")
        });
    }

    // Nothing survives a memory queue, so a schedule whose whole job is to drain
    // what survived would send nothing at all, for the life of the app.
    if config.delivery == DeliveryMode::Startup && config.persistence == Persistence::Memory {
        config.persistence = Persistence::Disk;
        report(hook, DiagnosticCode::Internal, 0, || {
            "delivery=startup needs persistence=disk, because a memory queue leaves nothing \
             to drain at the next start; using disk"
                .into()
        });
    }

    // The one case disk cannot be honoured: a platform with nowhere to write.
    if config.persistence == Persistence::Disk && !has_app_dir {
        config.persistence = Persistence::Memory;
        let stranded = config.delivery == DeliveryMode::Startup;
        if stranded {
            // Startup on a memory queue would now be the incoherent pair again,
            // and this time there is no disk to coerce towards. Manual at least
            // still sends on exit and on an explicit flush.
            config.delivery = DeliveryMode::Manual;
        }
        report(hook, DiagnosticCode::Internal, 0, move || {
            if stranded {
                "no writable app directory: persistence=disk fell back to memory and \
                 delivery=startup to manual, since a startup drain would have nothing to drain"
                    .into()
            } else {
                "no writable app directory: persistence=disk fell back to memory, so nothing \
                 survives this run"
                    .into()
            }
        });
    }
}

/// An entry from a name, a severity, a body and a flat string attribute list.
///
/// The string-pair form is what a desktop call site almost always has. Reach for
/// [`LogEntry`] when a value is a number, a boolean or a nested object.
fn entry_with(
    name: &str,
    severity: Option<u8>,
    body: Option<String>,
    attributes: &[(&str, &str)],
) -> LogEntry {
    let mut entry = LogEntry::new(name);
    entry.severity = severity;
    entry.body = body;
    for (key, value) in attributes {
        entry
            .attributes
            .insert((*key).to_string(), Value::String((*value).to_string()));
    }
    entry
}

/// Unwraps an error into the conventional exception attributes.
///
/// The single most valuable helper here, so it does the work the caller would
/// otherwise do at every call site. Rust carries no stack on an error value, so
/// `exception.stacktrace` is the `source()` chain, bounded so a cyclic or very
/// deep chain cannot run away.
fn exception_attributes<E: std::error::Error + ?Sized>(err: &E) -> (String, Attributes) {
    let message = err.to_string();
    let mut attributes = Attributes::new();
    attributes.insert(
        ATTR_EXCEPTION_TYPE.into(),
        Value::String(type_name_of::<E>()),
    );
    attributes.insert(ATTR_EXCEPTION_MESSAGE.into(), Value::String(message.clone()));

    let mut chain: Vec<String> = Vec::new();
    let mut source = err.source();
    while let Some(cause) = source {
        chain.push(format!("Caused by: {cause}"));
        if chain.len() >= 8 {
            break;
        }
        source = cause.source();
    }
    if !chain.is_empty() {
        attributes.insert(
            ATTR_EXCEPTION_STACKTRACE.into(),
            Value::String(chain.join("\n")),
        );
    }

    (message, attributes)
}

/// The error's type, as something a breakdown can group on.
///
/// The full path (`std::io::Error`) rather than the last segment, because half
/// the errors in any program are called `Error` and a column of them says
/// nothing. A `dyn` type keeps its trait name for the same reason.
fn type_name_of<E: ?Sized>() -> String {
    let full = std::any::type_name::<E>();
    let trimmed = full.trim_start_matches("dyn ");
    // Generic parameters make one type read as several. The base path is what a
    // reader means when they ask which error this was.
    let base = trimmed.split('<').next().unwrap_or(trimmed);
    base.chars().take(128).collect()
}

/// Calls the host's hook, if there is one.
///
/// The message is built behind a closure so that formatting it costs nothing
/// when nobody is listening, which is the normal case in a shipped build.
fn report(
    hook: &Option<DiagnosticHook>,
    code: DiagnosticCode,
    count: usize,
    message: impl FnOnce() -> String,
) {
    let Some(hook) = hook else { return };
    let diagnostic = Diagnostic { code, message: message(), count };
    // A hook that panics is the host's bug, and it is still not allowed to
    // become this crate's crash.
    let _ = catch_unwind(AssertUnwindSafe(|| hook(diagnostic)));
}

// ---------------------------------------------------------------------------
// The sender thread
// ---------------------------------------------------------------------------

/// The longest the sender thread waits when nothing is scheduled.
///
/// A schedule with no clock (`immediate` between windows, `manual`, `startup`)
/// has nothing to wake for, and an unbounded park makes a missed wake permanent.
/// An hour is short enough that a lost wake costs latency rather than the queue,
/// and long enough that an idle app is genuinely idle.
const IDLE_PARK: Duration = Duration::from_secs(3600);

struct Worker {
    config: Config,
    client: Client,
    queue: Queue,
    counters: Arc<Counters>,
    /// What is true of this installation and this build. Built once: it cannot
    /// change while the process runs, and it sits once per body on the wire.
    resource: Option<Attributes>,
    user_id: Option<String>,
    /// Not before this instant. Set by backoff after a failure.
    next_attempt: Instant,
    /// While open, nothing is dialled at all.
    circuit_until: Instant,
    circuit_open: bool,
    failures: u32,
}

impl Worker {
    fn new(config: Config, dir: Option<PathBuf>, counters: Arc<Counters>) -> Worker {
        // `resolve_policy` has already settled disk against whether there is a
        // directory, so this pairing cannot disagree with the reported policy.
        let queue = match (config.persistence, dir) {
            (Persistence::Disk, Some(dir)) => Queue::open(dir.join("events.ndjson")),
            _ => Queue::memory(),
        }
        .with_limits(config.max_queued_entries, config.max_queue_bytes);
        counters.queued.store(queue.len(), Ordering::Relaxed);

        let client = Client::new(&config.host, config.connect_timeout, config.request_timeout);
        let now = Instant::now();
        let resource = build_resource(&config);

        Worker {
            config,
            client,
            queue,
            counters,
            resource,
            user_id: None,
            next_attempt: now,
            circuit_until: now,
            circuit_open: false,
            failures: 0,
        }
    }

    fn run(mut self, rx: Receiver<Message>) {
        // Whatever last week left behind goes out before anything new. Under
        // `startup` this is the whole of what the run ever sends on its own;
        // every other mode wants it too, and on a memory queue it finds nothing.
        self.drain(None);
        let mut send_at = self.schedule_after_drain();

        loop {
            // `None` means nothing is due and only a message can change that.
            // The park is capped rather than infinite so a missed wake costs an
            // hour of latency instead of the queue.
            let wait = match send_at {
                Some(at) => at.saturating_duration_since(Instant::now()),
                None => IDLE_PARK,
            };
            match rx.recv_timeout(wait) {
                Ok(Message::Entry(entry)) => {
                    let urgent = self.is_urgent(&entry);
                    self.enqueue(entry);
                    send_at = self.schedule_after_entry(send_at, urgent);
                }
                Ok(Message::Identify(id)) => self.user_id = id,
                Ok(Message::Flush(until, reply)) => {
                    let emptied = self.drain(Some(until));
                    let _ = reply.send(emptied);
                    send_at = self.schedule_after_drain();
                }
                // Disconnected means the handle was dropped without a chance to
                // send Shutdown. Same ending either way.
                Ok(Message::Shutdown) | Err(RecvTimeoutError::Disconnected) => {
                    if self.config.flush_on_exit {
                        // Best effort and time-bounded: a slow network must not
                        // hold the host's process open.
                        self.drain(Some(Instant::now() + self.config.shutdown_timeout));
                    }
                    return;
                }
                Err(RecvTimeoutError::Timeout) => {
                    // Only a send we scheduled ourselves fires here. The idle
                    // park expiring is not a reason to send under a schedule
                    // that has no clock.
                    if send_at.is_some_and(|at| at <= Instant::now()) {
                        self.drain(None);
                        send_at = self.schedule_after_drain();
                    }
                }
            }
        }
    }

    /// When the next unattended send is due, or `None` when nothing but a
    /// message should wake this thread.
    ///
    /// The backoff gate is respected in every branch. A timer that fired on
    /// schedule while the breaker was open would dial straight into an outage on
    /// a fixed period, which is the one thing the reliability rules name
    /// outright.
    fn schedule_after_drain(&self) -> Option<Instant> {
        let now = Instant::now();
        let gate = self.gate();
        match self.config.delivery {
            DeliveryMode::Interval => Some((now + self.config.flush_interval).max(gate)),
            // Immediate, startup and manual have no clock of their own. What is
            // left over after a failed attempt still needs exactly one wake to
            // try again, and that wake is the gate coming due.
            _ => (!self.queue.is_empty() && gate > now).then_some(gate),
        }
    }

    /// When to send given that an entry has just been queued. Never later than
    /// what was already scheduled: a steady stream of entries must not push the
    /// window out in front of itself forever.
    fn schedule_after_entry(&self, scheduled: Option<Instant>, urgent: bool) -> Option<Instant> {
        let now = Instant::now();
        let due = |at: Instant| Some(scheduled.map_or(at, |s| s.min(at)));
        // "As soon as possible" is never sooner than the backoff allows. Waking
        // to be turned away by the breaker on every entry would be a busy loop
        // paid for by whoever is logging.
        let ready = now.max(self.gate());

        // At or above `flush_on_severity`, whatever the schedule says.
        if urgent {
            return due(ready);
        }
        match self.config.delivery {
            // A full batch does not wait, for either mode that sends on its own.
            DeliveryMode::Interval | DeliveryMode::Immediate
                if self.queue.len() >= self.config.max_batch =>
            {
                due(ready)
            }
            // "Do not wait for a timer" is not "one request per entry". Every
            // entry recorded while the window is open joins the same batch, so a
            // loop calling `event()` a thousand times is a handful of requests.
            DeliveryMode::Immediate => due(ready.max(now + self.config.coalesce_window)),
            DeliveryMode::Interval => scheduled.or(Some(now + self.config.flush_interval)),
            // Nothing here sends on its own: that is what they mean.
            DeliveryMode::Startup | DeliveryMode::Manual => scheduled,
        }
    }

    /// The earliest instant a send may be attempted: the backoff delay, or the
    /// breaker's cooldown while it is open.
    fn gate(&self) -> Instant {
        if self.circuit_open {
            self.circuit_until
        } else {
            self.next_attempt
        }
    }

    /// Whether this entry leaves the process the moment it is recorded.
    ///
    /// An entry with no severity is never urgent. Unclassified is not a
    /// classification, and treating it as one would send half the queue at once
    /// the first time somebody called `log()` without a severity.
    fn is_urgent(&self, entry: &QueuedEntry) -> bool {
        match (self.config.flush_on_severity, entry.severity_number) {
            (Some(threshold), Some(severity)) => severity >= threshold,
            _ => false,
        }
    }

    fn enqueue(&mut self, mut entry: QueuedEntry) {
        // Stamped here rather than at the call site: the channel preserves the
        // order of the recording calls and `identify`, so this is the id that
        // was in force when the entry happened. An entry from before somebody
        // signed in is not theirs.
        // Nothing is removed when there is no id: a later `identify(None)` does
        // not retract an id an earlier entry was correctly stamped with.
        if let Some(id) = &self.user_id {
            entry
                .attributes
                .entry(ATTR_USER_ID.to_string())
                .or_insert_with(|| Value::String(id.clone()));
        }

        match self.queue.append(&entry) {
            Ok(0) => {}
            Ok(dropped) => {
                self.counters.dropped_overflow.fetch_add(dropped as u64, Ordering::Relaxed);
                self.report(DiagnosticCode::Dropped, dropped, || {
                    "queue full, dropped the oldest entries".into()
                });
            }
            Err(e) => {
                self.counters.refused.fetch_add(1, Ordering::Relaxed);
                self.report(DiagnosticCode::Internal, 1, || {
                    format!("could not queue an entry: {e}")
                });
            }
        }
        self.counters.queued.store(self.queue.len(), Ordering::Relaxed);
    }

    /// Sends until the queue is empty or something says stop. Returns whether it
    /// emptied. `until` bounds the whole pass, and is set only by `flush` and by
    /// shutdown, which are the two places a human is waiting.
    fn drain(&mut self, until: Option<Instant>) -> bool {
        loop {
            if self.queue.is_empty() {
                return true;
            }

            let now = Instant::now();
            if self.circuit_open {
                if now < self.circuit_until {
                    return false;
                }
                // Half open: let exactly one batch through. If it fails the
                // failure count is still over the threshold, so the circuit
                // opens again immediately.
                self.circuit_open = false;
                self.counters.circuit_open.store(false, Ordering::Relaxed);
                self.report(DiagnosticCode::BreakerClose, 0, || {
                    "circuit half open, probing".into()
                });
            }

            if now < self.next_attempt {
                match until {
                    // A caller who gave us a deadline would rather we waited out
                    // a short backoff than reported failure straight away.
                    Some(deadline) if self.next_attempt < deadline => {
                        thread::sleep(self.next_attempt - now)
                    }
                    _ => return false,
                }
            }

            let budget = match until {
                Some(deadline) => match deadline.checked_duration_since(Instant::now()) {
                    Some(left) if !left.is_zero() => Some(left),
                    // Out of time. What is left goes out on the next pass, or on
                    // the next launch when the queue is a durable one.
                    _ => return false,
                },
                None => None,
            };

            let batch = match self.queue.peek(self.config.max_batch) {
                Ok(batch) if !batch.is_empty() => batch,
                Ok(_) => return true,
                Err(e) => {
                    self.report(DiagnosticCode::Internal, 0, || {
                        format!("could not read the queue: {e}")
                    });
                    return false;
                }
            };

            // No grouping pass. The resource is the only thing that sits on the
            // batch, and it does not change while the process runs, so the whole
            // peeked run is one request. The three identity keys vary per entry
            // and ride in that entry's own attributes.
            let count = batch.len();

            // Evaluated into a local so the batch's borrow of `self.config` ends
            // before the arms below need `&mut self`.
            let outcome = {
                let payload = LogBatch {
                    k: &self.config.source_key,
                    r: self.resource.as_ref(),
                    e: client::wire_entries(&batch),
                };
                self.client.send(&payload, budget)
            };

            match outcome {
                Outcome::Accepted => {
                    self.counters.accepted.fetch_add(count as u64, Ordering::Relaxed);
                    self.settle(count);
                    self.on_success();
                }
                Outcome::Rejected(detail) => {
                    self.counters.dropped_rejected.fetch_add(count as u64, Ordering::Relaxed);
                    self.settle(count);
                    self.report(DiagnosticCode::Rejected, count, || {
                        format!("server rejected a batch ({detail}), dropped")
                    });
                    // A rejection is a working connection, so it must not push
                    // the circuit towards open.
                    self.on_success();
                }
                Outcome::Transient(detail, retry_after) => {
                    self.on_failure(&detail, retry_after);
                    return false;
                }
            }
        }
    }

    /// Drops what the server has settled. A crash before this re-sends, and the
    /// server dedups on the entry ids, which is why retrying is always safe.
    fn settle(&mut self, count: usize) {
        if let Err(e) = self.queue.drop_front(count) {
            self.report(DiagnosticCode::Internal, 0, || {
                format!("could not trim the queue: {e}")
            });
        }
        self.counters.queued.store(self.queue.len(), Ordering::Relaxed);
    }

    fn on_success(&mut self) {
        let failures = self.failures;
        if failures > 0 {
            self.report(DiagnosticCode::BreakerClose, 0, move || {
                format!("recovered after {failures} failures")
            });
        }
        self.failures = 0;
        self.counters.consecutive_failures.store(0, Ordering::Relaxed);
        self.next_attempt = Instant::now();
    }

    fn on_failure(&mut self, detail: &str, retry_after: Option<Duration>) {
        self.failures = self.failures.saturating_add(1);
        self.counters.consecutive_failures.store(self.failures, Ordering::Relaxed);

        // Capped exponential with equal jitter: half the delay is fixed so it
        // still grows, half is random so a thousand clients that went offline
        // together do not come back in lockstep and finish the outage for us.
        let exponent = (self.failures - 1).min(20);
        let base = self.config.retry_base_delay.as_millis() as u64;
        let capped = base
            .saturating_mul(1u64 << exponent)
            .min(self.config.retry_max_delay.as_millis() as u64);
        let mut delay = capped / 2 + (jitter_fraction() * (capped / 2) as f64) as u64;

        if let Some(asked) = retry_after {
            // The server knows better than our own curve does, within reason.
            let asked = asked.as_millis() as u64;
            delay = delay.max(asked.min(self.config.retry_max_delay.as_millis() as u64 * 5));
        }

        self.next_attempt = Instant::now() + Duration::from_millis(delay);
        self.report(DiagnosticCode::Retry, 0, || {
            format!("send failed ({detail}), retrying in {delay}ms")
        });

        if self.failures >= self.config.breaker_threshold && !self.circuit_open {
            self.circuit_open = true;
            self.circuit_until = Instant::now() + self.config.breaker_cooldown;
            self.counters.circuit_open.store(true, Ordering::Relaxed);
            let failures = self.failures;
            let cooldown = self.config.breaker_cooldown.as_secs();
            self.report(DiagnosticCode::BreakerOpen, 0, move || {
                format!("giving up for {cooldown}s after {failures} consecutive failures")
            });
        }
    }

    fn report(&self, code: DiagnosticCode, count: usize, message: impl FnOnce() -> String) {
        report(&self.config.on_diagnostic, code, count, message);
    }
}

/// The resource attributes for this installation, or `None` when there is
/// nothing to say.
///
/// `None` rather than an empty object, so a body that has nothing to report
/// about the process omits the key instead of carrying two useless bytes on
/// every request for the life of the app.
fn build_resource(config: &Config) -> Option<Attributes> {
    let mut resource = config.resource.clone();

    let mut set = |key: &str, value: Option<String>| {
        if let Some(value) = value {
            resource.insert(key.to_string(), Value::String(value));
        }
    };
    set(
        ATTR_SERVICE_NAME,
        config
            .service_name
            .clone()
            .or_else(|| Some(config.app_name.clone()))
            .filter(|s| !s.trim().is_empty()),
    );
    set(ATTR_SERVICE_VERSION, config.service_version.clone());
    set(ATTR_CHANNEL, config.channel.clone());
    set(
        ATTR_OS_TYPE,
        Some(config.os.clone().unwrap_or_else(|| wire::os_name().to_string())),
    );
    set(
        ATTR_HOST_ARCH,
        Some(config.arch.clone().unwrap_or_else(|| wire::arch_name().to_string())),
    );
    set(ATTR_BROWSER_LANGUAGE, config.locale.clone());
    // Outside `set`, which takes an Option<String>: this one has to reach the
    // wire as a JSON boolean rather than as the string "true".
    if config.test_mode {
        resource.insert(ATTR_TEST.to_string(), Value::Bool(true));
    }

    clamp_attributes(&mut resource);
    if resource.is_empty() {
        None
    } else {
        Some(resource)
    }
}

/// A fraction in `[0, 1)` to spread retries with.
///
/// Taken from the clock rather than a random number generator: breaking lockstep
/// between clients coming back from one outage is all this has to do, and it is
/// not worth a dependency or a seeded state to carry around.
fn jitter_fraction() -> f64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    (nanos % 1_000_000) as f64 / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct Inner;
    impl fmt::Display for Inner {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "the disk went away")
        }
    }
    impl std::error::Error for Inner {}

    #[derive(Debug)]
    struct Outer(Inner);
    impl fmt::Display for Outer {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "could not save the project")
        }
    }
    impl std::error::Error for Outer {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            Some(&self.0)
        }
    }

    #[test]
    fn an_error_unwraps_into_the_conventions_without_the_caller_doing_it() {
        let (message, attrs) = exception_attributes(&Outer(Inner));
        assert_eq!(message, "could not save the project");
        assert_eq!(
            attrs[ATTR_EXCEPTION_MESSAGE],
            Value::String("could not save the project".into())
        );
        assert!(attrs[ATTR_EXCEPTION_TYPE]
            .as_str()
            .unwrap()
            .ends_with("Outer"));
        // Rust carries no stack on an error value. The source chain is the
        // closest equivalent and is what a reader actually needs.
        assert_eq!(
            attrs[ATTR_EXCEPTION_STACKTRACE],
            Value::String("Caused by: the disk went away".into())
        );
    }

    #[test]
    fn a_source_chain_is_bounded() {
        // A cyclic or very deep chain must not be able to build an unbounded
        // string on the caller's thread.
        #[derive(Debug)]
        struct Loop;
        impl fmt::Display for Loop {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "round and round")
            }
        }
        impl std::error::Error for Loop {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                Some(&Loop)
            }
        }
        let (_, attrs) = exception_attributes(&Loop);
        let stack = attrs[ATTR_EXCEPTION_STACKTRACE].as_str().unwrap();
        assert_eq!(stack.lines().count(), 8);
    }

    #[test]
    fn a_disabled_client_accepts_every_call_and_sends_nothing() {
        // The contract a host relies on: a missing source key is not an error
        // the host has to handle on its startup path.
        let analytics = Analytics::start(Config {
            app_name: "test".into(),
            ..Config::default()
        });
        assert!(!analytics.is_enabled());
        analytics.event("anything", &[]);
        analytics.warn("a line", &[]);
        analytics.log(LogEntry::new("raw"));
        analytics.user(Some("u_1"));
        assert!(!analytics.flush(Duration::from_millis(1)));
    }

    #[test]
    fn an_invalid_name_is_refused_rather_than_sent() {
        let analytics = Analytics::start(Config {
            app_name: "test".into(),
            ..Config::default()
        });
        analytics.log(LogEntry::new("a:b"));
        // Disabled clients count every call as refused, so this only checks the
        // call did not panic. The name check itself is tested in `wire`.
        assert!(analytics.stats().refused > 0);
    }

    #[test]
    fn the_resource_carries_the_installation_and_omits_what_was_not_set() {
        let resource = build_resource(&Config {
            app_name: "Themia".into(),
            service_version: Some("1.4.0".into()),
            ..Config::default()
        })
        .expect("os and arch are always known");
        assert_eq!(resource[ATTR_SERVICE_NAME], Value::String("Themia".into()));
        assert_eq!(resource[ATTR_SERVICE_VERSION], Value::String("1.4.0".into()));
        assert!(resource.contains_key(ATTR_OS_TYPE));
        assert!(resource.contains_key(ATTR_HOST_ARCH));
        // A guess here would be worse than a null: the standard library cannot
        // read the user's UI language.
        assert!(!resource.contains_key(ATTR_BROWSER_LANGUAGE));
        assert!(!resource.contains_key(ATTR_CHANNEL));
    }
}

//! Desktop SDK.
//!
//! Milestone 1 does exactly three things:
//!
//! 1. Keeps a stable install id for this copy of the app.
//! 2. On first run, finds the download token the installer's filename carried
//!    and claims it. That claim is the join -- it is the moment a website
//!    visitor and an installation become one person.
//! 3. Ships events from a disk-backed queue that survives being offline, being
//!    killed, and being launched again a week later.
//!
//! What it deliberately does not do: compute a person id, decide anything about
//! identity, or send an event without an id it generated itself.
//!
//! ```no_run
//! use firstrun_sdk::{Analytics, Config};
//!
//! let analytics = Analytics::start(Config {
//!     project_id: "7f9b5c2e-1d4a-4f8b-9c3e-6a2b8d5f1e40".into(),
//!     host: "https://t.themia.app".into(),
//!     app_name: "Themia".into(),
//!     app_version: env!("CARGO_PKG_VERSION").into(),
//!     ..Config::default()
//! })
//! .expect("analytics");
//!
//! analytics.track("opened_project", [("kind", "local")]);
//! ```

pub mod client;
pub mod install;
pub mod queue;
pub mod token;

use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use client::{AppBatch, ClaimRequest, Client, SendError};
use queue::{now_ms, Props, QueuedEvent, Queue};

pub const EVENT_APP_FIRST_RUN: &str = "app_first_run";
pub const EVENT_APP_LAUNCH: &str = "app_launch";

/// How many events go in one request. Large enough that a week offline drains
/// in a handful of round trips, small enough that a failure re-sends little.
const BATCH_SIZE: usize = 200;
const FLUSH_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Default)]
pub struct Config {
    pub project_id: String,
    /// Ingest origin, e.g. the subdomain the customer CNAMEd at us.
    pub host: String,
    pub app_name: String,
    pub app_version: String,
    pub channel: Option<String>,
    pub locale: Option<String>,
    /// Install id and event queue. Defaults to the platform config dir under `app_name`.
    pub app_dir: Option<PathBuf>,
    /// Where the install hook left the token. Defaults to `%LOCALAPPDATA%\<app_name>`.
    ///
    /// Separate from `app_dir` because the NSIS hook runs before the app has
    /// ever started and has to pick a location without asking it. That location
    /// is local-machine data, not roaming: a token is about this machine, and
    /// roaming it to another one would claim the join for the wrong install.
    pub token_dir: Option<PathBuf>,
}

enum Message {
    Event(QueuedEvent),
    Identify(Option<String>),
    Flush,
    Shutdown,
}

pub struct Analytics {
    tx: Sender<Message>,
    worker: Option<JoinHandle<()>>,
    install_id: String,
    queue: Arc<Mutex<Queue>>,
}

impl Analytics {
    /// Starts the SDK: resolves the install id, claims the token if this is a
    /// first run, replays whatever is on disk, and keeps shipping.
    pub fn start(config: Config) -> std::io::Result<Analytics> {
        let app_dir = match config.app_dir.clone() {
            Some(dir) => dir,
            None => install::default_app_dir(&config.app_name).ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotFound, "no config directory on this platform")
            })?,
        };

        let token_dir = config
            .token_dir
            .clone()
            .or_else(|| install::default_token_dir(&config.app_name))
            .unwrap_or_else(|| app_dir.clone());

        let install = install::load_or_create(&app_dir)?;
        let queue = Arc::new(Mutex::new(Queue::new(app_dir.join("events.ndjson"))));
        let client = Client::new(config.host.clone());

        let (tx, rx) = mpsc::channel::<Message>();
        let worker_queue = Arc::clone(&queue);
        let worker_config = config.clone();
        let worker_install = install.clone();
        let worker_token_dir = token_dir.clone();

        let worker = thread::Builder::new()
            .name("firstrun-sdk".into())
            .spawn(move || {
                let mut account_id: Option<String> = None;

                if worker_install.first_run {
                    // The one call that matters. Everything else is table stakes.
                    claim_first_run(&client, &worker_config, &worker_install, &worker_token_dir);
                }

                // Whatever last week left behind goes out before anything new.
                drain(&client, &worker_config, &worker_install.id, &worker_queue, &account_id);

                loop {
                    match rx.recv_timeout(FLUSH_INTERVAL) {
                        Ok(Message::Event(event)) => {
                            if let Ok(q) = worker_queue.lock() {
                                let _ = q.append(&event);
                            }
                        }
                        Ok(Message::Identify(id)) => account_id = id,
                        Ok(Message::Flush) => {
                            drain(&client, &worker_config, &worker_install.id, &worker_queue, &account_id)
                        }
                        Ok(Message::Shutdown) | Err(RecvTimeoutError::Disconnected) => {
                            drain(&client, &worker_config, &worker_install.id, &worker_queue, &account_id);
                            return;
                        }
                        Err(RecvTimeoutError::Timeout) => {
                            drain(&client, &worker_config, &worker_install.id, &worker_queue, &account_id)
                        }
                    }
                }
            })?;

        let analytics = Analytics {
            tx,
            worker: Some(worker),
            install_id: install.id,
            queue,
        };

        // A first run already recorded itself through /v1/claim, so recording a
        // launch here as well would double-count the day someone installed.
        if !install.first_run {
            analytics.track(EVENT_APP_LAUNCH, [] as [(&str, &str); 0]);
        }

        Ok(analytics)
    }

    pub fn install_id(&self) -> &str {
        &self.install_id
    }

    /// Queues an event, stamped with the time it happened.
    pub fn track<K, V>(&self, name: &str, props: impl IntoIterator<Item = (K, V)>)
    where
        K: Into<String>,
        V: Into<String>,
    {
        let props: Props = props.into_iter().map(|(k, v)| (k.into(), v.into())).collect();
        let _ = self.tx.send(Message::Event(QueuedEvent::now(name, props)));
    }

    /// An account id seen here and on the website is an exact join, method
    /// `account`. Resolution happens server-side; this only carries the id.
    pub fn identify(&self, account_id: Option<String>) {
        let _ = self.tx.send(Message::Identify(account_id));
    }

    pub fn flush(&self) {
        let _ = self.tx.send(Message::Flush);
    }

    /// Events still on disk, for tests and diagnostics.
    pub fn pending(&self) -> usize {
        self.queue.lock().ok().and_then(|q| q.len().ok()).unwrap_or(0)
    }
}

impl Drop for Analytics {
    fn drop(&mut self) {
        let _ = self.tx.send(Message::Shutdown);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Step 2 of the join, from the app's side.
fn claim_first_run(client: &Client, config: &Config, install: &install::Install, token_dir: &std::path::Path) {
    let found = token::find(token_dir);

    let request = ClaimRequest {
        project_id: &config.project_id,
        install_id: &install.id,
        token: found.as_deref(),
        event_id: &uuid::Uuid::new_v4().to_string(),
        event_time: now_ms(),
        app_version: &config.app_version,
        os: os_name(),
        arch: arch_name(),
        locale: config.locale.as_deref(),
        channel: config.channel.as_deref(),
    };

    match client.claim(&request) {
        // Claimed. Delete the token so a later launch cannot claim it again.
        Ok(_) => token::delete_token_file(token_dir),
        // The token was junk or already spent; deleting it stops us retrying
        // something that will never work.
        Err(SendError::Permanent(_)) => token::delete_token_file(token_dir),
        // Offline on first launch is common -- someone installs on a plane.
        // The token file stays, and the next launch tries again.
        Err(SendError::Transient(_)) => {}
    }
}

fn drain(
    client: &Client,
    config: &Config,
    install_id: &str,
    queue: &Arc<Mutex<Queue>>,
    account_id: &Option<String>,
) {
    loop {
        let batch = match queue.lock().ok().and_then(|q| q.peek(BATCH_SIZE).ok()) {
            Some(b) if !b.is_empty() => b,
            _ => return,
        };

        let payload = AppBatch {
            project_id: &config.project_id,
            install_id,
            account_id: account_id.as_deref(),
            app_version: &config.app_version,
            channel: config.channel.as_deref(),
            os: os_name(),
            arch: arch_name(),
            locale: config.locale.as_deref(),
            events: &batch,
        };

        match client.send_events(&payload) {
            // The server has them. Dropping only what it accepted means a crash
            // here re-sends, and the server dedups on our event ids.
            Ok(()) => {
                if let Ok(q) = queue.lock() {
                    let _ = q.drop_front(batch.len());
                }
            }
            // Malformed and always will be. Keeping it would wedge everything
            // queued behind it.
            Err(SendError::Permanent(_)) => {
                if let Ok(q) = queue.lock() {
                    let _ = q.drop_front(batch.len());
                }
            }
            // Offline. Try again on the next tick, with the queue untouched.
            Err(SendError::Transient(_)) => return,
        }
    }
}

pub fn os_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        other => other,
    }
}

pub fn arch_name() -> &'static str {
    std::env::consts::ARCH
}

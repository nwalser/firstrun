//! One `POST` to `/v1/e`, and the body it carries.
//!
//! Blocking, on the SDK's own thread. A desktop app makes one request every few
//! minutes at most, and an async runtime pulled in for that would be the largest
//! dependency in the crate by an order of magnitude.
//!
//! Nothing here returns an error to a caller. Every failure becomes an
//! [`Outcome`], because the only three things the sender can do about a request
//! are keep the batch, drop the batch, or wait.

use serde::Serialize;
use serde_json::Value;
use std::borrow::Cow;
use std::time::Duration;

use crate::queue::QueuedEntry;
use crate::wire::{self, Attributes};

/// One log entry as the server is sent it. Nothing else goes on the wire.
///
/// Five fields, and there is no sixth. The keys are one letter because this is
/// the same body the browser tag posts from `sendBeacon` on a page being
/// unloaded, where bytes are the constraint: one shape for every client rather
/// than a compact browser dialect beside a verbose SDK one.
///
/// `body`, `trace_id` and `span_id` are not fields here. They are attributes,
/// under the spec's own names, because this product promotes five columns and
/// no more. `observed_timestamp` is not sent at all: the edge stamps
/// `ingested_at` itself and would overwrite anything a client claimed.
///
/// Source of truth: `WireEntry` in `packages/schema/src/log.ts`.
#[derive(Debug, Serialize)]
pub struct WireEntry<'a> {
    /// entry id. Client-generated, so a request that times out and is retried dedups.
    i: &'a str,
    /// timestamp, ms since epoch. Client-stamped and authoritative: the server
    /// buckets on this and never rebuckets.
    t: i64,
    /// name
    n: &'a str,
    /// severity_number, 1..24. Omitted rather than guessed when nobody classified it.
    #[serde(skip_serializing_if = "Option::is_none")]
    s: Option<u8>,
    /// attributes
    #[serde(skip_serializing_if = "Option::is_none")]
    a: Option<Cow<'a, Attributes>>,
}

/// Borrows queued entries into the shape the server is sent.
///
/// The attribute map is borrowed whenever it can be. It is only cloned for an
/// entry that carries a body, a trace id or a span id, because those three are
/// stored beside the map on disk and have to be folded into it here.
pub fn wire_entries(queued: &[QueuedEntry]) -> Vec<WireEntry<'_>> {
    queued
        .iter()
        .map(|e| {
            let spec: [(&str, Option<&str>); 3] = [
                (wire::ATTR_BODY, e.body.as_deref()),
                (wire::ATTR_TRACE_ID, e.trace_id.as_deref()),
                (wire::ATTR_SPAN_ID, e.span_id.as_deref()),
            ];

            let mut attributes = if spec.iter().all(|(_, v)| v.is_none()) {
                if e.attributes.is_empty() {
                    None
                } else {
                    Some(Cow::Borrowed(&e.attributes))
                }
            } else {
                Some(Cow::Owned(e.attributes.clone()))
            };

            if let Some(Cow::Owned(map)) = attributes.as_mut() {
                for (key, value) in spec {
                    if let Some(value) = value {
                        // The dedicated field wins over a same-named attribute:
                        // naming it explicitly is the more specific statement.
                        map.insert(key.to_string(), Value::String(value.to_string()));
                    }
                }
            }

            WireEntry {
                i: &e.id,
                t: e.timestamp,
                n: &e.name,
                s: e.severity_number,
                a: attributes,
            }
        })
        .collect()
}

/// The body every non-browser SDK sends.
///
/// One identity and one resource per request. `d` and the `r` map sit here
/// rather than on each entry because neither changes between two entries in the
/// same body, and repeating them 250 times is 250 copies of the same strings.
/// Everything that varies per entry, including `user.id` and `session.id`,
/// lives in that entry's own attributes.
///
/// Source of truth: `LogBatch` in `packages/schema/src/log.ts`.
#[derive(Debug, Serialize)]
pub struct LogBatch<'a> {
    /// source key
    pub k: &'a str,
    /// distinct id
    pub d: &'a str,
    /// resource attributes: what is true of this INSTALLATION and this build,
    /// such as `service.version`, `os.type`, `host.arch` and `firstrun.channel`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r: Option<&'a Attributes>,
    /// entries
    pub e: Vec<WireEntry<'a>>,
}

/// What the sender should do next.
#[derive(Debug)]
pub enum Outcome {
    /// The server has them. Drop the batch.
    Accepted,
    /// The server understood and said no, and will say no again in an hour.
    /// Drop the batch: keeping it would wedge every later entry behind it.
    Rejected(String),
    /// Offline, timed out, rate limited, or the server is having a bad day.
    /// Keep the batch and back off. Carries what the server asked us to wait.
    Transient(String, Option<Duration>),
}

pub struct Client {
    url: String,
    agent: ureq::Agent,
}

impl Client {
    pub fn new(host: &str, connect_timeout: Duration, request_timeout: Duration) -> Client {
        Client {
            url: format!("{}/v1/e", host.trim_end_matches('/')),
            agent: ureq::AgentBuilder::new()
                .timeout_connect(connect_timeout)
                .timeout(request_timeout)
                .build(),
        }
    }

    /// Sends one batch. `budget` overrides the agent's timeout, which is how the
    /// shutdown pass keeps its whole attempt inside the time the host gave it.
    pub fn send(&self, batch: &LogBatch<'_>, budget: Option<Duration>) -> Outcome {
        // Serialised here rather than through ureq's `json` feature: the body is
        // already going through serde_json, and one fewer optional feature is
        // one fewer thing to get wrong in a consumer's dependency tree.
        let body = match serde_json::to_string(batch) {
            Ok(body) => body,
            // A batch that will not serialise now will not serialise later.
            Err(e) => return Outcome::Rejected(format!("could not serialise: {e}")),
        };

        let mut request = self
            .agent
            .post(&self.url)
            .set("Content-Type", "application/json")
            // No cookies, no auth header, nothing identifying. The source key in
            // the body is the whole of what the server is told about the caller.
            .set("User-Agent", concat!("firstrun-rust/", env!("CARGO_PKG_VERSION")));
        if let Some(budget) = budget {
            request = request.timeout(budget);
        }

        match request.send_string(&body) {
            // The response body says nothing the status code has not, and
            // reading it is work with no consumer.
            Ok(_) => Outcome::Accepted,
            // 408 and 429 are the two 4xx that mean "later", not "never".
            Err(ureq::Error::Status(code, response)) if code == 408 || code == 429 => {
                Outcome::Transient(format!("http {code}"), retry_after(&response))
            }
            // A malformed batch, or a source key that no longer resolves.
            Err(ureq::Error::Status(code, _)) if (400..500).contains(&code) => {
                Outcome::Rejected(format!("http {code}"))
            }
            Err(ureq::Error::Status(code, response)) => {
                Outcome::Transient(format!("http {code}"), retry_after(&response))
            }
            Err(e) => Outcome::Transient(e.to_string(), None),
        }
    }
}

/// `Retry-After` in seconds. A malformed header is ignored rather than allowed
/// to become an error on the send path.
fn retry_after(response: &ureq::Response) -> Option<Duration> {
    let raw = response.header("Retry-After")?;
    raw.trim().parse::<u64>().ok().map(Duration::from_secs)
}

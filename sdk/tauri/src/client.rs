//! HTTP to the ingest host.
//!
//! Blocking, on the SDK's own thread. A desktop app has one network call to
//! make every few minutes, and an async runtime pulled in for that would be the
//! largest dependency in the crate.

use serde::Serialize;
use std::time::Duration;

use crate::queue::QueuedEvent;

#[derive(Debug, Clone)]
pub struct Client {
    host: String,
    agent: ureq::Agent,
}

#[derive(Debug, Serialize)]
pub struct AppBatch<'a> {
    pub project_id: &'a str,
    pub install_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<&'a str>,
    pub app_version: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<&'a str>,
    pub os: &'a str,
    pub arch: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<&'a str>,
    pub events: &'a [QueuedEvent],
}

#[derive(Debug, Serialize)]
pub struct ClaimRequest<'a> {
    pub project_id: &'a str,
    pub install_id: &'a str,
    /// `None` when no token was found. The server then tries the estimated
    /// match, which is why first run has one code path rather than two.
    pub token: Option<&'a str>,
    pub event_id: &'a str,
    pub event_time: i64,
    pub app_version: &'a str,
    pub os: &'a str,
    pub arch: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<&'a str>,
}

#[derive(Debug)]
pub enum SendError {
    /// The server said no in a way that retrying will not fix. Drop the batch.
    Permanent(u16),
    /// Offline, timed out, or the server is having a bad day. Keep the batch.
    Transient(String),
}

impl Client {
    pub fn new(host: impl Into<String>) -> Self {
        Client {
            host: host.into().trim_end_matches('/').to_string(),
            agent: ureq::AgentBuilder::new()
                .timeout_connect(Duration::from_secs(5))
                .timeout(Duration::from_secs(20))
                .build(),
        }
    }

    pub fn send_events(&self, batch: &AppBatch<'_>) -> Result<(), SendError> {
        self.post(&format!("{}/v1/e", self.host), batch).map(|_| ())
    }

    pub fn claim(&self, req: &ClaimRequest<'_>) -> Result<String, SendError> {
        self.post(&format!("{}/v1/claim", self.host), req)
    }

    fn post(&self, url: &str, body: &impl Serialize) -> Result<String, SendError> {
        // Serialised here rather than via ureq's `json` feature: the body is
        // already going through serde_json, and one fewer optional feature is
        // one fewer thing to get wrong in a consumer's dependency tree.
        let body = serde_json::to_string(body).map_err(|e| SendError::Transient(e.to_string()))?;

        match self
            .agent
            .post(url)
            .set("Content-Type", "application/json")
            .send_string(&body)
        {
            Ok(res) => Ok(res.into_string().unwrap_or_default()),
            // A 4xx means this payload is wrong and will be wrong again in an
            // hour. Retrying it forever would block every event behind it.
            Err(ureq::Error::Status(code, _)) if (400..500).contains(&code) => {
                Err(SendError::Permanent(code))
            }
            Err(ureq::Error::Status(code, _)) => Err(SendError::Transient(format!("http {code}"))),
            Err(e) => Err(SendError::Transient(e.to_string())),
        }
    }
}

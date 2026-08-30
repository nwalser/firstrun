//! The shapes shared with the server: source keys, entry names, the severity
//! ladder, the attribute bounds, and the exact strings `os.type` and
//! `host.arch` are spelled with.
//!
//! Everything here is a hand-written check rather than a regex crate. These are
//! the only two patterns this crate will ever match, and they have to stay
//! byte-identical to their counterparts in `packages/schema/src/`.
//!
//! ## One shape for everything
//!
//! There is no event type, no error type and no metric type. There is a LOG
//! ENTRY. An error is an entry with a high severity and `exception.*`
//! attributes; a product event is an entry with a name; a measurement is an
//! entry carrying `firstrun.metric` and `firstrun.value`. Meaning is assigned by
//! convention when it is written and by query when it is read, never by a closed
//! set of types in the backend.

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

/// The longest entry name the server accepts.
pub const LOG_NAME_MAX: usize = 128;

/// The longest a `distinct_id` or an id-shaped attribute may be.
pub const ID_MAX: usize = 512;

/// The surfaces a source key may name. Closed list, mirroring `SURFACES`.
pub const SURFACES: [&str; 5] = ["web", "desktop", "mobile", "server", "other"];

/// How many entries one `POST /v1/e` may carry.
///
/// Read out of the wire format rather than guessed: this is `MAX_BATCH_ENTRIES`
/// in `packages/schema/src/log.ts`, where the edge enforces it as
/// `z.array(WireEntry).min(1).max(...)`. A `max_batch` above it makes every
/// request fail validation, so the queue never drains and the whole thing
/// presents as total silence rather than as an error anyone can see.
pub const MAX_BATCH_ENTRIES: usize = 500;

// ---------------------------------------------------------------------------
// Attribute bounds
// ---------------------------------------------------------------------------

/// How many top-level attribute keys one entry may carry.
pub const MAX_ATTRIBUTES: usize = 64;
/// How deep the attribute JSON may nest. The top-level map counts as level one.
pub const MAX_ATTRIBUTE_DEPTH: usize = 4;
pub const MAX_ATTRIBUTE_KEY: usize = 128;
pub const MAX_ATTRIBUTE_STRING: usize = 4096;
/// How many entries one array or nested object may hold.
pub const MAX_ATTRIBUTE_ITEMS: usize = 128;
/// The longest `body` this crate will send. Truncated, never dropped.
pub const MAX_BODY: usize = 16_384;

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

/// The OpenTelemetry severity ladder: twenty-four numbers in six bands of four.
///
/// The number is authoritative and is what the server stores; text is derived
/// from it for display and never travels. Two entries that sorted differently
/// because one said "warn" and the other said "WARNING" would be a bug nobody
/// could see.
///
/// The three spare steps inside each band exist so a host whose own logger has
/// nine levels can map onto this without losing the ordering: `SEVERITY_WARN + 1`
/// is a slightly worse warning and still filters as a warning.
pub const SEVERITY_TRACE: u8 = 1;
pub const SEVERITY_DEBUG: u8 = 5;
pub const SEVERITY_INFO: u8 = 9;
pub const SEVERITY_WARN: u8 = 13;
pub const SEVERITY_ERROR: u8 = 17;
pub const SEVERITY_FATAL: u8 = 21;

pub const SEVERITY_MIN: u8 = 1;
pub const SEVERITY_MAX: u8 = 24;

const BANDS: [(&str, u8); 6] = [
    ("TRACE", SEVERITY_TRACE),
    ("DEBUG", SEVERITY_DEBUG),
    ("INFO", SEVERITY_INFO),
    ("WARN", SEVERITY_WARN),
    ("ERROR", SEVERITY_ERROR),
    ("FATAL", SEVERITY_FATAL),
];

/// The spellings people already have in their loggers, mapped onto a band.
const ALIASES: [(&str, u8); 16] = [
    ("VERBOSE", SEVERITY_TRACE),
    ("FINER", SEVERITY_TRACE),
    ("FINEST", SEVERITY_TRACE),
    ("FINE", SEVERITY_DEBUG),
    ("NOTICE", SEVERITY_INFO),
    ("INFORMATION", SEVERITY_INFO),
    ("INFORMATIONAL", SEVERITY_INFO),
    ("WARNING", SEVERITY_WARN),
    ("ERR", SEVERITY_ERROR),
    ("SEVERE", SEVERITY_ERROR),
    ("CRIT", SEVERITY_FATAL),
    ("CRITICAL", SEVERITY_FATAL),
    ("ALERT", SEVERITY_FATAL),
    ("EMERG", SEVERITY_FATAL),
    ("EMERGENCY", SEVERITY_FATAL),
    ("PANIC", SEVERITY_FATAL),
];

/// A severity name back to its number, or `None` when it is not one of ours.
///
/// `None` rather than a default, because guessing a severity is worse than
/// having none: an entry with no severity is honestly unclassified, and one
/// silently filed as INFO is a lie a filter will act on.
pub fn severity_number(text: &str) -> Option<u8> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    // A trailing 1..4 selects a step inside the band: INFO2 is 10.
    let (word, step) = match text.as_bytes()[text.len() - 1] {
        b @ b'1'..=b'4' => (&text[..text.len() - 1], b - b'1'),
        _ => (text, 0),
    };
    if !word.chars().all(|c| c.is_ascii_alphabetic()) || word.is_empty() {
        return None;
    }
    let upper = word.to_ascii_uppercase();
    let base = BANDS
        .iter()
        .find(|(name, _)| *name == upper)
        .map(|(_, n)| *n)
        .or_else(|| {
            ALIASES
                .iter()
                .find(|(name, _)| *name == upper)
                .map(|(_, n)| *n)
        })?;
    Some(base + step)
}

/// `9` becomes `INFO`, `10` becomes `INFO2`. Display only; the number travels.
pub fn severity_text(n: u8) -> String {
    let v = n.clamp(SEVERITY_MIN, SEVERITY_MAX);
    let idx = ((v - 1) / 4) as usize;
    let (band, base) = BANDS[idx.min(BANDS.len() - 1)];
    let step = v - base;
    if step == 0 {
        band.to_string()
    } else {
        format!("{band}{}", step + 1)
    }
}

// ---------------------------------------------------------------------------
// Conventions
// ---------------------------------------------------------------------------

/// Conventional entry names. SUGGESTIONS, NOT LAW: any string matching
/// [`is_valid_log_name`] is stored, counted, grouped and filtered identically.
pub const NAME_APP_INSTALL: &str = "app_install";
pub const NAME_APP_LAUNCH: &str = "app_launch";
pub const NAME_IDENTIFY: &str = "identify";
pub const NAME_EXCEPTION: &str = "exception";
pub const NAME_PAGE_VIEW: &str = "page_view";
pub const NAME_MEASUREMENT: &str = "measurement";
/// What the level helpers name an entry. A free-form line still needs a name,
/// because `name` is the column a dashboard groups on.
pub const NAME_LOG: &str = "log";

/// Conventional attribute keys, from `packages/schema/src/conventions.ts`.
/// The exception, session, user, os and service keys are OpenTelemetry's, used
/// verbatim; `firstrun.*` is ours, namespaced so it is obvious which half of the
/// vocabulary we can change.
/// The human-readable line.
///
/// OpenTelemetry's log model has `body` as a top-level field. This product
/// promotes five columns and no more, so it travels as an attribute under the
/// spec's own name. Same for `trace_id` and `span_id`: they are part of the
/// spec's vocabulary, not part of ours, and promoting one later is a generated
/// column over `attributes` rather than a schema break.
pub const ATTR_BODY: &str = "body";
pub const ATTR_TRACE_ID: &str = "trace_id";
pub const ATTR_SPAN_ID: &str = "span_id";

pub const ATTR_EXCEPTION_TYPE: &str = "exception.type";
pub const ATTR_EXCEPTION_MESSAGE: &str = "exception.message";
pub const ATTR_EXCEPTION_STACKTRACE: &str = "exception.stacktrace";
pub const ATTR_SESSION_ID: &str = "session.id";
pub const ATTR_USER_ID: &str = "user.id";
pub const ATTR_SERVICE_NAME: &str = "service.name";
pub const ATTR_SERVICE_VERSION: &str = "service.version";
pub const ATTR_OS_TYPE: &str = "os.type";
pub const ATTR_OS_VERSION: &str = "os.version";
pub const ATTR_HOST_ARCH: &str = "host.arch";
pub const ATTR_BROWSER_LANGUAGE: &str = "browser.language";
pub const ATTR_URL_PATH: &str = "url.path";
pub const ATTR_CHANNEL: &str = "firstrun.channel";
/// Marks test data. Written only as the JSON boolean `true`, and only when it
/// is true: the dashboard matches it with jsonb containment, where the string
/// `"true"` is a different value and would match neither world. A production
/// entry omits the key rather than carrying `false` on every request.
pub const ATTR_TEST: &str = "firstrun.test";
pub const ATTR_DURATION_MS: &str = "firstrun.duration_ms";
pub const ATTR_VALUE: &str = "firstrun.value";
pub const ATTR_METRIC: &str = "firstrun.metric";
pub const ATTR_UNIT: &str = "firstrun.unit";

/// A string-keyed map of JSON. The one attribute type this crate uses.
pub type Attributes = Map<String, Value>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`.
///
/// `:` and `>` are excluded on the server on purpose: they delimit the parts of
/// a dashboard snapshot key, so a name containing one could forge the results of
/// a differently shaped key. Keep this in step with the server regex.
pub fn is_valid_log_name(name: &str) -> bool {
    if name.is_empty() || name.len() > LOG_NAME_MAX {
        return false;
    }
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphanumeric() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
}

/// The surface a source key claims, or `None` when the key is malformed.
///
/// Advisory only. The server records a surface on the source row and trusts
/// that, never the text of the key, so a client cannot claim to be something
/// else by editing the string it was given.
pub fn surface_from_source_key(key: &str) -> Option<&'static str> {
    let rest = key.strip_prefix("fr_")?;
    let (surface, suffix) = rest.split_once('_')?;
    if suffix.len() != 16 || !suffix.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
        return None;
    }
    SURFACES.iter().copied().find(|s| *s == surface)
}

/// `fr_<surface>_<16 lower-case alphanumerics>`.
pub fn is_valid_source_key(key: &str) -> bool {
    surface_from_source_key(key).is_some()
}

/// Milliseconds since the Unix epoch, which is what `timestamp` is.
///
/// A clock before 1970 gives 0 rather than a panic: a wrong timestamp is a bad
/// number on a dashboard, and this crate is not allowed to be worse than that.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The `os.type` string. `std::env::consts::OS` already spells these the way the
/// other clients do, which is what keeps a breakdown by os from splitting one
/// platform across two rows.
pub fn os_name() -> &'static str {
    std::env::consts::OS
}

/// The `host.arch` string: `x86_64`, `aarch64`, and so on.
pub fn arch_name() -> &'static str {
    std::env::consts::ARCH
}

/// An id the server will accept, or `None` when there is nothing to send.
///
/// The server counts characters, not bytes, so this truncates on a character
/// boundary. Cutting a UTF-8 sequence in half would produce a body that fails to
/// parse and a batch that is rejected forever.
pub fn clamp_id(id: &str) -> Option<String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(ID_MAX).collect())
}

/// A body the server will accept. Truncated rather than dropped: half a line
/// still says something.
pub fn clamp_body(body: &str) -> Option<String> {
    if body.is_empty() {
        return None;
    }
    Some(body.chars().take(MAX_BODY).collect())
}

// ---------------------------------------------------------------------------
// Attribute clamping
// ---------------------------------------------------------------------------

/// Bounds an attribute map to what the edge accepts, in place.
///
/// The edge rejects a body that breaks any of the bounds, and a rejected body is
/// a permanent failure that takes every entry in it down. Clamping on this side
/// is the difference between losing one oversized attribute and losing the whole
/// batch it travelled in.
pub fn clamp_attributes(attributes: &mut Attributes) {
    // Keys first, so a map that is over the count limit loses whole keys rather
    // than half of one deep value.
    let over: Vec<String> = attributes
        .keys()
        .filter(|k| k.is_empty() || k.chars().count() > MAX_ATTRIBUTE_KEY)
        .cloned()
        .collect();
    for key in over {
        attributes.remove(&key);
    }
    if attributes.len() > MAX_ATTRIBUTES {
        let excess: Vec<String> = attributes
            .keys()
            .skip(MAX_ATTRIBUTES)
            .cloned()
            .collect();
        for key in excess {
            attributes.remove(&key);
        }
    }
    let mut doomed: Vec<String> = Vec::new();
    for (key, value) in attributes.iter_mut() {
        if !clamp_value(value, MAX_ATTRIBUTE_DEPTH) {
            doomed.push(key.clone());
        }
    }
    for key in doomed {
        attributes.remove(&key);
    }
}

/// Bounds one value in place. Returns false when nothing sendable is left.
///
/// Non-finite numbers cannot occur here (serde_json has no NaN), so the two real
/// jobs are the string ceiling and the depth ceiling. Anything past the depth
/// limit is dropped rather than flattened: a truncated object that still looks
/// like an object is worse to debug than a key that is honestly absent.
fn clamp_value(value: &mut Value, depth: usize) -> bool {
    match value {
        Value::String(s) => {
            if s.chars().count() > MAX_ATTRIBUTE_STRING {
                *s = s.chars().take(MAX_ATTRIBUTE_STRING).collect();
            }
            true
        }
        Value::Array(items) => {
            if depth <= 1 {
                return false;
            }
            items.truncate(MAX_ATTRIBUTE_ITEMS);
            for item in items.iter_mut() {
                // A hole in an array shifts every later index, so a value that
                // did not survive becomes null rather than disappearing.
                if !clamp_value(item, depth - 1) {
                    *item = Value::Null;
                }
            }
            true
        }
        Value::Object(map) => {
            if depth <= 1 {
                return false;
            }
            let over: Vec<String> = map
                .keys()
                .enumerate()
                .filter(|(i, k)| {
                    *i >= MAX_ATTRIBUTE_ITEMS || k.is_empty() || k.chars().count() > MAX_ATTRIBUTE_KEY
                })
                .map(|(_, k)| k.clone())
                .collect();
            for key in over {
                map.remove(&key);
            }
            let mut doomed: Vec<String> = Vec::new();
            for (key, inner) in map.iter_mut() {
                if !clamp_value(inner, depth - 1) {
                    doomed.push(key.clone());
                }
            }
            for key in doomed {
                map.remove(&key);
            }
            true
        }
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn severity_text_round_trips_through_its_number() {
        for n in SEVERITY_MIN..=SEVERITY_MAX {
            assert_eq!(severity_number(&severity_text(n)), Some(n), "at {n}");
        }
    }

    #[test]
    fn the_spellings_people_already_have_land_on_a_band() {
        assert_eq!(severity_number("warn"), Some(SEVERITY_WARN));
        assert_eq!(severity_number("WARNING"), Some(SEVERITY_WARN));
        assert_eq!(severity_number("critical"), Some(SEVERITY_FATAL));
        assert_eq!(severity_number("info2"), Some(SEVERITY_INFO + 1));
    }

    #[test]
    fn an_unknown_severity_is_none_rather_than_a_guess() {
        // Guessing is worse than having none: an unclassified entry is honest,
        // one silently filed as INFO is a lie a filter will act on.
        assert_eq!(severity_number("loud"), None);
        assert_eq!(severity_number(""), None);
        assert_eq!(severity_number("9"), None);
    }

    #[test]
    fn attributes_are_bounded_rather_than_the_batch_being_rejected() {
        let mut attrs = Attributes::new();
        attrs.insert("long".into(), json!("x".repeat(MAX_ATTRIBUTE_STRING + 50)));
        attrs.insert("deep".into(), json!({"a": {"b": {"c": {"d": 1}}}}));
        attrs.insert("wide".into(), json!(vec![1; MAX_ATTRIBUTE_ITEMS + 20]));
        clamp_attributes(&mut attrs);

        assert_eq!(
            attrs["long"].as_str().unwrap().chars().count(),
            MAX_ATTRIBUTE_STRING
        );
        assert_eq!(attrs["wide"].as_array().unwrap().len(), MAX_ATTRIBUTE_ITEMS);
        // Level five is past the ceiling, so `c` loses its value and goes.
        assert_eq!(attrs["deep"], json!({"a": {"b": {}}}));
    }

    #[test]
    fn too_many_keys_lose_whole_keys() {
        let mut attrs = Attributes::new();
        for i in 0..MAX_ATTRIBUTES + 10 {
            attrs.insert(format!("k{i:03}"), json!(i));
        }
        clamp_attributes(&mut attrs);
        assert_eq!(attrs.len(), MAX_ATTRIBUTES);
    }

    #[test]
    fn entry_names_are_shape_checked_and_never_allowlisted() {
        assert!(is_valid_log_name("exported_csv"));
        assert!(is_valid_log_name("http.request"));
        assert!(is_valid_log_name("a-name-nobody-has-heard-of"));
        // Reserved as snapshot-key delimiters on the server.
        assert!(!is_valid_log_name("a:b"));
        assert!(!is_valid_log_name("a>b"));
        assert!(!is_valid_log_name("_leading"));
    }
}

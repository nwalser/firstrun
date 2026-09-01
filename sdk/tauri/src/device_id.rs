//! The anonymous id for this installation, and where it lives on disk.
//!
//! One id per (user account, machine, app). It is generated here, it is never
//! received from the server, and it is never linked to another source's id: the
//! same human on the website and in this app is two anonymous subjects, and that
//! is the correct answer rather than something to reconcile. A `user_id` appears
//! only when the host calls `identify`.
//!
//! **Local application data, never roaming.** On Windows that is
//! `%LOCALAPPDATA%`, not `%APPDATA%`. This id identifies one installation, so a
//! roaming profile carrying it to a second machine would report two installs as
//! one, and every per-install number would be quietly wrong.
//!
//! Whether this is a first run is decided by whether the file existed, not by a
//! flag written afterwards. A crash between reading the id and writing such a
//! flag would otherwise turn one install into two.

use std::fs;
use std::path::{Path, PathBuf};

/// The file inside the per-app directory.
pub const DEVICE_ID_FILE: &str = "device_id";

#[derive(Debug, Clone)]
pub struct DeviceId {
    pub id: String,
    /// True when this process created the id, i.e. nothing ran here before.
    pub first_run: bool,
}

/// Reads the id, creating it on first run.
///
/// A read-only or full disk gives a per-process id and an error to report, never
/// a failure the host has to handle: losing the continuity of one install is a
/// worse number, not a broken application.
pub fn load_or_create(app_dir: &Path) -> (DeviceId, Option<std::io::Error>) {
    let path = app_dir.join(DEVICE_ID_FILE);

    if let Ok(existing) = fs::read_to_string(&path) {
        if let Some(id) = crate::wire::clamp_id(&existing) {
            return (DeviceId { id, first_run: false }, None);
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    let error = write_atomic(app_dir, &path, &id).err();
    (DeviceId { id, first_run: true }, error)
}

/// Temp file then rename, so a crash leaves either no file or a complete one. A
/// half-written id read on the next launch would be a second install.
fn write_atomic(app_dir: &Path, path: &Path, contents: &str) -> std::io::Result<()> {
    fs::create_dir_all(app_dir)?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)
}

/// `%LOCALAPPDATA%\firstrun\<app>` on Windows, the platform equivalent
/// elsewhere. `None` on a platform with no such directory, which disables the
/// disk rather than guessing at a path.
pub fn default_app_dir(app_name: &str) -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("firstrun").join(slug(app_name)))
}

/// A directory name that is safe on every filesystem this crate targets.
fn slug(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for c in raw.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-' || c == '_' {
            out.push(c);
        } else if c.is_ascii_uppercase() {
            out.push(c.to_ascii_lowercase());
        } else {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches(|c| c == '-' || c == '.').to_string();
    if trimmed.is_empty() {
        "default".to_string()
    } else {
        trimmed.chars().take(64).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_id_is_stable_across_launches() {
        let dir = tempfile::tempdir().unwrap();
        let (first, _) = load_or_create(dir.path());
        let (second, _) = load_or_create(dir.path());

        assert_eq!(first.id, second.id);
        assert!(first.first_run);
        assert!(!second.first_run, "only the launch that created the id is a first run");
    }

    #[test]
    fn two_machines_are_two_installs() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        assert_ne!(load_or_create(a.path()).0.id, load_or_create(b.path()).0.id);
    }

    #[test]
    fn an_empty_file_is_treated_as_no_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(DEVICE_ID_FILE), "   \n").unwrap();
        let (distinct, error) = load_or_create(dir.path());
        assert!(distinct.first_run);
        assert!(!distinct.id.is_empty());
        assert!(error.is_none());
    }
}

//! The install id: this copy of the app, on this machine.
//!
//! Persisted next to the app's own data, generated once, never sent by anything
//! else. It is one of the three distincts the server resolves a person from --
//! the app never computes or receives a `person_id`. See CLAUDE.md rule 3.
//!
//! Whether this is the first run is decided by whether the file existed, not by
//! a flag the app sets afterwards. A crash between "claimed the token" and
//! "wrote a flag" would otherwise either lose the join or claim it twice.

use std::fs;
use std::path::{Path, PathBuf};

pub const INSTALL_ID_FILE: &str = "install_id";

#[derive(Debug, Clone)]
pub struct Install {
    pub id: String,
    /// True when this process created the id, i.e. nothing ran here before.
    pub first_run: bool,
}

pub fn load_or_create(app_dir: &Path) -> std::io::Result<Install> {
    fs::create_dir_all(app_dir)?;
    let path = app_dir.join(INSTALL_ID_FILE);

    if let Ok(existing) = fs::read_to_string(&path) {
        let id = existing.trim().to_string();
        if !id.is_empty() {
            return Ok(Install { id, first_run: false });
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    write_atomic(&path, &id)?;
    Ok(Install { id, first_run: true })
}

fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)
}

/// `%APPDATA%\<app>` on Windows, the platform equivalent elsewhere.
pub fn default_app_dir(app_name: &str) -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join(app_name))
}

/// `%LOCALAPPDATA%\<app>` -- where the NSIS install hook leaves the token.
///
/// Local rather than roaming on purpose: a download token says something about
/// this machine, and roaming it to another one would claim the join for an
/// install that never happened there.
pub fn default_token_dir(app_name: &str) -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join(app_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_id_is_stable_across_launches() {
        let dir = tempfile::tempdir().unwrap();
        let first = load_or_create(dir.path()).unwrap();
        let second = load_or_create(dir.path()).unwrap();

        assert_eq!(first.id, second.id);
        assert!(first.first_run);
        assert!(!second.first_run, "only the launch that created the id is a first run");
    }

    #[test]
    fn two_machines_are_two_installs() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        assert_ne!(load_or_create(a.path()).unwrap().id, load_or_create(b.path()).unwrap().id);
    }

    #[test]
    fn an_empty_file_is_treated_as_no_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(INSTALL_ID_FILE), "   \n").unwrap();
        let install = load_or_create(dir.path()).unwrap();
        assert!(install.first_run);
        assert!(!install.id.is_empty());
    }
}

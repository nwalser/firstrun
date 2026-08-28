//! Finding the download token on first run.
//!
//! Two paths, and the app needs both:
//!
//!  1. The NSIS install hook read the installer's own `$EXEPATH`, pulled the
//!     token out of the filename, and wrote it next to the app. Reliable, and
//!     the only one that works when the user installed from a folder we would
//!     never think to look in.
//!  2. Failing that, scan the Downloads folder for an installer whose name ends
//!     in a token. Newest match wins, because someone who downloaded twice ran
//!     the second one.
//!
//! The alphabet is Crockford base32: no I, L, O or U. Matched by hand rather
//! than with a regex crate, because this is the only pattern the SDK will ever
//! match and it has to stay byte-identical to `TOKEN_IN_FILENAME_RE` in
//! `packages/schema` and to the NSIS hook.

use std::fs;
use std::path::{Path, PathBuf};

pub const TOKEN_LENGTH: usize = 8;
pub const TOKEN_FILE: &str = "install_token";

fn is_token_char(c: char) -> bool {
    matches!(c, '0'..='9' | 'A'..='H' | 'J' | 'K' | 'M' | 'N' | 'P'..='T' | 'V'..='Z')
}

pub fn is_token(s: &str) -> bool {
    s.len() == TOKEN_LENGTH && s.chars().all(is_token_char)
}

/// `Themia-Setup-1.4.2-9GQ4T7BX.exe` -> `9GQ4T7BX`
pub fn token_from_filename(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE"))?;
    let candidate = stem.rsplit_once('-')?.1.to_ascii_uppercase();
    if is_token(&candidate) {
        Some(candidate)
    } else {
        None
    }
}

/// The token the install hook left for us.
pub fn read_token_file(app_dir: &Path) -> Option<String> {
    let raw = fs::read_to_string(app_dir.join(TOKEN_FILE)).ok()?;
    let token = raw.trim().to_ascii_uppercase();
    if is_token(&token) {
        Some(token)
    } else {
        None
    }
}

/// Claimed once, then gone. Leaving it would re-claim on every launch.
pub fn delete_token_file(app_dir: &Path) {
    let _ = fs::remove_file(app_dir.join(TOKEN_FILE));
}

/// Newest installer in `dir` whose filename carries a token.
pub fn scan_for_token(dir: &Path) -> Option<String> {
    let mut best: Option<(std::time::SystemTime, String)> = None;

    for entry in fs::read_dir(dir).ok()?.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(token) = token_from_filename(&name) else {
            continue;
        };
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        if best.as_ref().is_none_or(|(t, _)| modified > *t) {
            best = Some((modified, token));
        }
    }

    best.map(|(_, token)| token)
}

/// Where Windows puts downloads, with a best effort elsewhere.
pub fn downloads_dir() -> Option<PathBuf> {
    dirs::download_dir()
}

/// The token for this first run, if there is one.
pub fn find(app_dir: &Path) -> Option<String> {
    read_token_file(app_dir).or_else(|| downloads_dir().and_then(|d| scan_for_token(&d)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_well_formed_token() {
        assert!(is_token("9GQ4T7BX"));
        assert_eq!(token_from_filename("Themia-Setup-1.4.2-9GQ4T7BX.exe").as_deref(), Some("9GQ4T7BX"));
    }

    #[test]
    fn rejects_the_letters_crockford_leaves_out() {
        // I, L, O and U are excluded so nothing collides with 1 and 0 when a
        // human reads it off a filename.
        for bad in ["IIIIIIII", "LLLLLLLL", "OOOOOOOO", "UUUUUUUU"] {
            assert!(!is_token(bad), "{bad} should not be a token");
        }
    }

    #[test]
    fn rejects_near_misses() {
        assert!(!is_token("9GQ4T7B"));
        assert!(!is_token("9GQ4T7BXX"));
        assert_eq!(token_from_filename("Themia-Setup-1.4.2.exe"), None);
        assert_eq!(token_from_filename("9GQ4T7BX.exe"), None);
        assert_eq!(token_from_filename("Themia-Setup-1.4.2-9GQ4T7BX.msi"), None);
    }

    #[test]
    fn is_case_insensitive_because_windows_is() {
        assert_eq!(token_from_filename("themia-setup-1.4.2-9gq4t7bx.EXE").as_deref(), Some("9GQ4T7BX"));
    }

    #[test]
    fn newest_download_wins() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Themia-Setup-1.4.0-AAAAAAAA.exe"), b"old").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(dir.path().join("Themia-Setup-1.4.2-BBBBBBBB.exe"), b"new").unwrap();
        fs::write(dir.path().join("notes.txt"), b"ignored").unwrap();

        assert_eq!(scan_for_token(dir.path()).as_deref(), Some("BBBBBBBB"));
    }

    #[test]
    fn the_hook_beats_the_downloads_scan() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(TOKEN_FILE), "  cccccccc \n").unwrap();
        assert_eq!(find(dir.path()).as_deref(), Some("CCCCCCCC"));

        delete_token_file(dir.path());
        assert_eq!(read_token_file(dir.path()), None);
    }
}

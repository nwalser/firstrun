# firstrun-sdk

Desktop SDK. Claims the download token on first run, then ships events from a
disk-backed queue.

```rust
use firstrun_sdk::{Analytics, Config};

let analytics = Analytics::start(Config {
    project_id: "7f9b5c2e-1d4a-4f8b-9c3e-6a2b8d5f1e40".into(),
    host: "https://t.themia.app".into(),
    app_name: "Themia".into(),
    app_version: env!("CARGO_PKG_VERSION").into(),
    ..Config::default()
})?;

analytics.track("opened_project", [("kind", "local")]);
analytics.identify(Some(account_id));   // an account id seen on both surfaces is an exact join
```

Hold the `Analytics` value for the life of the app. Dropping it flushes and
joins the worker thread.

## The claim

On the launch that creates the install id — and only that one — the SDK looks
for the download token in two places:

1. `%LOCALAPPDATA%\<app>\install_token`, written by the NSIS hook from the
   installer's own `$EXEPATH`. Reliable.
2. Failing that, the newest `*-XXXXXXXX.exe` in the user's Downloads folder.

Then it `POST`s `/v1/claim` once and deletes the token file. `token` is `null`
when nothing was found — the app calls the endpoint either way, and the server
tries the estimated match, so first run has one code path.

Add the hook to `tauri.conf.json`:

```json
{
  "bundle": {
    "windows": {
      "nsis": { "installerHooks": "../../sdk/tauri/nsis/install-token-hook.nsh" }
    }
  }
}
```

## The queue

The part that has to be right. NDJSON, append-only, in the app config dir.

- A crash can only ever corrupt the last line, and a corrupt line is skipped on
  read. Nothing else in the file is at risk.
- Event ids are generated on this side, so a timed-out send is always retried
  and the server dedups.
- `event_time` is stamped when the event happens. A launch on Friday that
  uploads on Monday is a Friday launch.
- Bounded at 5,000 events / 2 MB, dropping the oldest. An app offline for a
  month must not fill someone's disk.
- Rewrites go through a temp file and a rename, so a crash leaves either the old
  queue or the new one.

`cargo test` covers all of the above, including a deliberately half-written
final line.

## What it will not do

Compute a `person_id`, decide anything about identity, or send an event without
an id it generated itself. Identity is resolved server-side by
`packages/identity` and nowhere else.

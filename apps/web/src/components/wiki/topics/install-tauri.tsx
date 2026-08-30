import AppWindow from "lucide-solid/icons/app-window";
import type { WikiTopic } from "../registry.js";
import { WikiProse } from "../shell.js";
import { Callout, Snippet } from "../snippet.js";

/**
 * Tauri: the Rust crate, held in Tauri's managed state.
 *
 * Transcribed from `sdk/tauri/README.md` and `src/lib.rs`. The disk queue is
 * the one thing here worth a callout: a desktop app is offline routinely, and
 * "the entries survive a kill" is what makes a desktop number trustworthy.
 */

export const topics: WikiTopic[] = [
  {
    slug: "install-tauri",
    title: "Tauri",
    summary: "The Rust crate, with a disk-backed queue that survives being offline or killed.",
    section: "Install guides",
    appliesTo: "desktop",
    order: 62,
    icon: AppWindow,
    render: (ctx) => (
      <WikiProse>
        <p>
          Every call hands an entry to a background worker and returns: nothing panics into your
          app, nothing blocks the UI thread, and if firstrun is unreachable your app is unaffected.
        </p>

        <h2>Add the crate</h2>
        <Snippet
          filename="src-tauri/Cargo.toml"
          lang="toml"
          code={`[dependencies]\nfirstrun-sdk = { path = "../../sdk/tauri" }`}
          note="Not published to crates.io yet, so it is a path or a git dependency."
        />

        <h2>Start the client</h2>
        <Snippet
          filename="src-tauri/src/main.rs"
          lang="rust"
          code={
            `use firstrun_sdk::{Analytics, Config};\n\n` +
            `let analytics = Analytics::start(Config {\n` +
            `    source_key: "${ctx.vars.key}".into(),\n` +
            `    host: "${ctx.vars.origin}".into(),\n` +
            `    service_name: "${ctx.vars.app}".into(),\n` +
            `    service_version: Some(env!("CARGO_PKG_VERSION").into()),\n` +
            `    ..Config::default()\n` +
            `});\n\n` +
            `tauri::Builder::default()\n` +
            `    .manage(analytics)\n` +
            `    .run(tauri::generate_context!())?;`
          }
          note={
            <>
              <code>start</code> returns an <code>Analytics</code> rather than a{" "}
              <code>Result</code>, so a bad key or an unwritable disk gives you a client that
              accepts every call and sends nothing instead of a failure on your startup path.{" "}
              <code>app_install</code> on the first run ever and <code>app_launch</code> on every
              run are queued for you. <code>service_name</code> names the directory holding the
              anonymous id and the queue, so set it and both survive a key rotation.
            </>
          }
        />

        <h2>Write entries</h2>
        <Snippet
          lang="rust"
          code={
            `analytics.event("exported_project", attrs! { "format" => "pdf", "pages" => 12 });\n\n` +
            `analytics.error(&e, attrs! {});\n\n` +
            `analytics.log(Entry {\n` +
            `    name: "render_stalled".into(),\n` +
            `    severity: Severity::Warn,\n` +
            `    attributes: attrs! { "frames_dropped" => 41 },\n` +
            `    ..Entry::now()\n` +
            `});\n\n` +
            `analytics.identify(Some("acct_8812"));   // your own id, when they sign in\n` +
            `analytics.flush(Duration::from_secs(2)); // on exit. Optional: dropping it flushes too`
          }
          note={
            <>
              <code>event</code> writes at INFO and <code>error</code> at ERROR, both filling in
              the conventional attributes; <code>log</code> takes any name, any severity and any
              attributes. Values go on the wire as JSON, so a number stays a number, and an entry
              is stamped with the time it happened rather than the time it is sent.
            </>
          }
        />

        <Callout title="The queue is on disk">
          Entries are appended to an NDJSON file beside the anonymous id before they go anywhere
          else, bounded at 5,000 entries and 2 MB, dropping the oldest and counting them in{" "}
          <code>stats()</code>. That is what makes a desktop number trustworthy: laptops are
          offline, processes get killed, and a launch on Friday that uploads on Monday is still a
          Friday launch. The anonymous id lives in per-user local application data (
          <code>%LOCALAPPDATA%</code> on Windows, not the roaming profile) because it names one
          installation.
        </Callout>
      </WikiProse>
    ),
  },
];

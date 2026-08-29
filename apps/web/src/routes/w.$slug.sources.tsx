import { Link, createFileRoute, notFound, redirect, useRouter } from "@tanstack/solid-router";
import { For, Show, createSignal } from "solid-js";
import { createSourceFn, deleteSourceFn, getSession, getWorkspace } from "../lib/api.js";

/**
 * Ingestion sources: the marketing site, the desktop app, whatever else.
 *
 * All of them share one identity namespace. That is the point, and the page
 * says so, because "one workspace per platform" is the mistake that quietly
 * makes the whole product stop working.
 */
export const Route = createFileRoute("/w/$slug/sources")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspace({ data: params.slug });
    if (!view) throw notFound();
    return view;
  },
  component: Sources,
});

function Sources() {
  const view = Route.useLoaderData();
  const router = useRouter();

  const [name, setName] = createSignal("");
  const [kind, setKind] = createSignal<"web" | "desktop">("web");
  const [assetName, setAssetName] = createSignal("Setup");
  const [busy, setBusy] = createSignal(false);

  async function add(e: Event) {
    e.preventDefault();
    if (!name().trim()) return;
    setBusy(true);
    await createSourceFn({
      data: {
        slug: view().workspace.slug,
        name: name(),
        kind: kind(),
        assetName: assetName(),
      },
    });
    setName("");
    await router.invalidate();
    setBusy(false);
  }

  async function remove(id: string) {
    setBusy(true);
    await deleteSourceFn({ data: { slug: view().workspace.slug, sourceId: id } });
    await router.invalidate();
    setBusy(false);
  }

  return (
    <main class="wrap">
      <div class="page-head">
        <div>
          <h1>Sources</h1>
          <p class="lede">
            Every source in this workspace shares one set of people. A visitor on the site and an
            install on someone's laptop resolve to the same person — that join is the product, and
            it only works inside a single workspace.
          </p>
        </div>
        <Link class="btn" to="/w/$slug" params={{ slug: view().workspace.slug }}>
          Back to dashboard
        </Link>
      </div>

      <div class="stack">
        <For each={view().sources}>
          {(source) => (
            <section class="card">
              <div class="card-head">
                <div class="row">
                  <strong>{source.name}</strong>
                  <span class="pill">{source.kind}</span>
                </div>
                <button class="btn sm" data-variant="danger" disabled={busy()} onClick={() => remove(source.id)}>
                  Remove
                </button>
              </div>

              <div class="row" style={{ "margin-bottom": "12px" }}>
                <span class="meta">Ingest key</span>
                <code class="key">{source.ingestKey}</code>
              </div>

              <Show
                when={source.kind === "web"}
                fallback={
                  <div class="code">
{`use firstrun_sdk::{Analytics, Config};

let analytics = Analytics::start(Config {
    source_key: "${source.ingestKey}".into(),
    host: "${view().publicOrigin}".into(),
    app_name: "${source.assetName ?? "App"}".into(),
    app_version: env!("CARGO_PKG_VERSION").into(),
    ..Config::default()
})?;`}
                  </div>
                }
              >
                <div class="code">
{`<script async
        src="${view().publicOrigin}/t.js"
        data-key="${source.ingestKey}"></script>

<a data-fr-download data-fr-asset="${view().sources.find((s) => s.kind === "desktop")?.assetName ?? "Setup"}">
  Download
</a>`}
                </div>
              </Show>

              <p class="meta" style={{ "margin-top": "10px" }}>
                <Show
                  when={source.kind === "web"}
                  fallback="Reads the token the installer's filename carried, on first run."
                >
                  The download link is rewritten to carry the visitor id, which is what makes the
                  install traceable back to this visit.
                </Show>
              </p>
            </section>
          )}
        </For>

        <form class="card" onSubmit={add}>
          <div class="card-head">
            <div class="card-title">Add a source</div>
          </div>
          <div class="row">
            <div class="field">
              <label>Name</label>
              <input type="text" placeholder="themia.app" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            </div>
            <div class="field">
              <label>Kind</label>
              <select value={kind()} onChange={(e) => setKind(e.currentTarget.value as "web" | "desktop")}>
                <option value="web">Website</option>
                <option value="desktop">Desktop app</option>
              </select>
            </div>
            <Show when={kind() === "desktop"}>
              <div class="field">
                <label>Installer basename</label>
                <input
                  type="text"
                  placeholder="Themia-Setup"
                  value={assetName()}
                  onInput={(e) => setAssetName(e.currentTarget.value)}
                />
              </div>
            </Show>
            <button class="btn" data-variant="primary" disabled={busy() || !name().trim()} style={{ "align-self": "flex-end" }}>
              Add
            </button>
          </div>
          <p class="meta" style={{ "margin-top": "10px" }}>
            The installer basename becomes the filename the browser saves, with the download token
            appended to it. That filename is the only thing that survives from the website into the
            installed app.
          </p>
        </form>
      </div>
    </main>
  );
}

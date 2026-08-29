import { createFileRoute, notFound, redirect, useRouter } from "@tanstack/solid-router";
import { For, Show, createSignal } from "solid-js";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/ui/index.js";
import { createSourceFn, deleteSourceFn, getProject, getSession } from "../lib/api.js";
import { PageHeader } from "./__root.js";

/**
 * Ingestion sources for one project.
 *
 * Every source here shares one namespace of people. That is the point, and the
 * page says so, because splitting a product across projects is the mistake that
 * quietly makes the whole thing stop working.
 */
export const Route = createFileRoute("/w/$wslug/$pslug/sources")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getProject({ data: { workspace: params.wslug, project: params.pslug } });
    if (!view) throw notFound();
    return view;
  },
  component: Sources,
});

function Sources() {
  const view = Route.useLoaderData();
  const router = useRouter();

  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal("");
  const [kind, setKind] = createSignal<"web" | "desktop">("web");
  const [assetName, setAssetName] = createSignal("Setup");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal<string | null>(null);

  const isAdmin = () => view().role === "admin";
  const desktopAsset = () => view().sources.find((s) => s.kind === "desktop")?.assetName ?? "Setup";

  async function add(e: Event) {
    e.preventDefault();
    if (!name().trim()) return;
    setBusy(true);
    setError(null);
    const result = await createSourceFn({
      data: {
        workspace: view().workspace.slug,
        project: view().project.slug,
        name: name(),
        kind: kind(),
        assetName: assetName(),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setOpen(false);
    await router.invalidate();
  }

  async function remove(sourceId: string) {
    setBusy(true);
    await deleteSourceFn({
      data: { workspace: view().workspace.slug, project: view().project.slug, sourceId },
    });
    setBusy(false);
    await router.invalidate();
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
    } catch {
      // Clipboard access can be refused; the key is visible either way.
    }
  }

  const snippet = (source: { kind: string; ingestKey: string }) =>
    source.kind === "web"
      ? `<script async\n        src="${view().publicOrigin}/t.js"\n        data-key="${source.ingestKey}"></script>\n\n<a data-fr-download data-fr-asset="${desktopAsset()}">\n  Download\n</a>`
      : `use firstrun_sdk::{Analytics, Config};\n\nlet analytics = Analytics::start(Config {\n    source_key: "${source.ingestKey}".into(),\n    host: "${view().publicOrigin}".into(),\n    app_name: "${view().project.name}".into(),\n    app_version: env!("CARGO_PKG_VERSION").into(),\n    ..Config::default()\n})?;`;

  return (
    <main class="mx-auto max-w-4xl px-6 pb-24">
      <PageHeader
        title="Sources"
        crumb={{
          label: `← ${view().project.name}`,
          href: `/w/${view().workspace.slug}/${view().project.slug}`,
        }}
        description="Every source in this project shares one set of people. A visitor on the site and an install on someone's laptop resolve to the same person — that join is the product, and it only works inside a single project."
        actions={
          <Show when={isAdmin()}>
            <Button size="sm" onClick={() => setOpen(true)}>
              Add source
            </Button>
          </Show>
        }
      />

      <Show when={error()}>
        {(message) => (
          <p class="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {message()}
          </p>
        )}
      </Show>

      <div class="flex flex-col gap-4">
        <For each={view().sources}>
          {(source) => (
            <Card>
              <CardHeader>
                <div class="flex min-w-0 items-center gap-2">
                  <CardTitle class="text-sm normal-case tracking-normal text-foreground">
                    {source.name}
                  </CardTitle>
                  <Badge variant="secondary">{source.kind}</Badge>
                </div>
                <Show when={isAdmin()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy()}
                    class="hover:text-destructive"
                    onClick={() => remove(source.id)}
                  >
                    Remove
                  </Button>
                </Show>
              </CardHeader>

              <CardContent>
                <div class="mb-3 flex flex-wrap items-center gap-2">
                  <span class="text-xs text-muted-foreground">Ingest key</span>
                  <code class="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs">
                    {source.ingestKey}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copy(source.ingestKey, source.id)}
                  >
                    {copied() === source.id ? "Copied" : "Copy"}
                  </Button>
                </div>

                <pre class="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
                  {snippet(source)}
                </pre>

                <p class="mt-2.5 text-xs text-muted-foreground">
                  <Show
                    when={source.kind === "web"}
                    fallback="Reads the token the installer's filename carried, on first run."
                  >
                    The download link is rewritten to carry the visitor id, which is what makes the
                    install traceable back to this visit.
                  </Show>
                </p>
              </CardContent>
            </Card>
          )}
        </For>

        <Show when={view().sources.length === 0}>
          <div class="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
            No sources yet.
          </div>
        </Show>
      </div>

      <Sheet open={open()} onOpenChange={setOpen}>
        <SheetContent>
          <form onSubmit={add} class="flex h-full flex-col">
            <SheetHeader>
              <SheetTitle>Add a source</SheetTitle>
              <SheetDescription>Something that sends events into this project.</SheetDescription>
            </SheetHeader>

            <SheetBody>
              <div class="flex flex-col gap-5">
                <div class="flex flex-col gap-2">
                  <Label for="source-name">Name</Label>
                  <Input
                    id="source-name"
                    placeholder="themia.app"
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                  />
                </div>

                <div class="flex flex-col gap-2">
                  <Label>Kind</Label>
                  <Select
                    value={kind()}
                    onChange={setKind}
                    options={[
                      { value: "web", label: "Website" },
                      { value: "desktop", label: "Desktop app" },
                    ]}
                  />
                </div>

                <Show when={kind() === "desktop"}>
                  <div class="flex flex-col gap-2">
                    <Label for="asset">Installer basename</Label>
                    <Input
                      id="asset"
                      placeholder="Themia-Setup"
                      value={assetName()}
                      onInput={(e) => setAssetName(e.currentTarget.value)}
                    />
                    <p class="text-xs text-muted-foreground">
                      Becomes the filename the browser saves, with the download token appended. That
                      filename is the only thing that survives from the website into the installed
                      app.
                    </p>
                  </div>
                </Show>
              </div>
            </SheetBody>

            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={busy() || !name().trim()}>{busy() ? "Adding…" : "Add source"}</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </main>
  );
}

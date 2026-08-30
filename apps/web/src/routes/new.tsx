import { createFileRoute, redirect, useNavigate } from "@tanstack/solid-router";
import Building2 from "lucide-solid/icons/building-2";
import { Show, createSignal } from "solid-js";
import {
  Alert,
  AlertDescription,
  Brandmark,
  Button,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
  Field,
  Input,
  buttonVariants,
} from "../components/ui/index.js";
import { createWorkspaceFn, getSession } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * Creating a workspace.
 *
 * A workspace holds people and projects. It is not the identity namespace --
 * that is the project, one level down -- so the copy here talks about access,
 * and the copy on the new-project screen talks about people.
 *
 * This is also the product's page-level empty state: `routes/index.tsx`
 * redirects here precisely when a signed-in account has zero workspaces. The
 * reference draws that as a tile rather than as a bare heading (popovers get a
 * line, pages get the tile), which is why the block above the form is
 * `EmptyMedia` / `EmptyTitle` / `EmptyDescription` rather than a `PageHeader`.
 *
 * There is no shell around this page, so it hangs on the page track itself and
 * the 24px margin is a grid column rather than padding on the form.
 */
export const Route = createFileRoute("/new")({
  loader: async () => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    return session;
  },
  component: NewWorkspace,
});

/** Mirrors db/repo.ts, so the preview is the slug and not an approximation. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "untitled"
  );
}

function NewWorkspace() {
  const i18n = useI18n();
  const session = Route.useLoaderData();
  const navigate = useNavigate();

  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const first = () => session().workspaces[0];

  async function submit(e: Event) {
    e.preventDefault();
    if (!name().trim()) return;
    setBusy(true);
    setError(null);
    const result = await createWorkspaceFn({ data: name().trim() });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate({ to: "/w/$wslug", params: { wslug: result.slug } });
  }

  return (
    /*
      Both auth screens scroll the page itself. Neither sits inside the shell,
      so there is no scroll container above them, and clipping instead would
      put the submit button out of reach on a short window.
    */
    <main class="page-track page-track-compact h-dvh overflow-y-auto">
      <div class="flex w-full flex-col gap-6 py-16">
        {/* The same mark the sign-in screen renders, so two consecutive
            first-run screens show one product rather than two. */}
        <div class="flex items-center gap-2 text-body font-semibold">
          <Brandmark class="h-3.5 w-auto" />
          firstrun
        </div>

        <div class="flex flex-col items-center gap-2 text-center">
          <EmptyMedia>
            <Building2 />
          </EmptyMedia>
          <EmptyTitle>{i18n.t("workspace.new")}</EmptyTitle>
          <EmptyDescription>{i18n.t("workspace.new_hint")}</EmptyDescription>
        </div>

        <form onSubmit={submit} class="flex flex-col gap-6">
          <Field
            label={i18n.t("common.name")}
            description={
              <>
                {i18n.t("workspace.address_prefix")}{" "}
                <span class="font-mono text-foreground">/w/{slugify(name() || "")}</span>.
              </>
            }
          >
            <Input
              placeholder="Acme"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </Field>

          <Show when={error()}>
            {(message) => (
              <Alert variant="destructive">
                <AlertDescription>{message()}</AlertDescription>
              </Alert>
            )}
          </Show>

          <div class="flex items-center justify-end gap-2 border-t pt-4">
            <Show when={first()}>
              {(workspace) => (
                <a href={`/w/${workspace().slug}`} class={buttonVariants({ variant: "ghost" })}>
                  {i18n.t("common.cancel")}
                </a>
              )}
            </Show>
            {/* Kobalte renders type="button" unless told otherwise. */}
            <Button type="submit" disabled={busy() || !name().trim()}>
              {busy() ? i18n.t("common.creating") : i18n.t("workspace.create")}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}

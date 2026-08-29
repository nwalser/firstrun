import { createFileRoute, redirect, useNavigate } from "@tanstack/solid-router";
import { Show, createSignal } from "solid-js";
import { Button, Input, Label } from "../components/ui/index.js";
import { createWorkspaceFn, getSession } from "../lib/api.js";

/**
 * Creating a workspace.
 *
 * A workspace holds people and projects. It is not the identity namespace --
 * that is the project, one level down -- so the copy here talks about access,
 * and the copy on the new-project screen talks about people.
 */
export const Route = createFileRoute("/new")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
  },
  component: NewWorkspace,
});

function NewWorkspace() {
  const navigate = useNavigate();
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    if (!name().trim()) return;
    setBusy(true);
    setError(null);
    const result = await createWorkspaceFn({ data: name() });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate({ to: "/w/$wslug", params: { wslug: result.slug } });
  }

  return (
    <main class="flex min-h-dvh items-center justify-center p-6">
      <form class="w-full max-w-sm rounded-xl border bg-card p-7" onSubmit={submit}>
        <h1 class="text-lg font-semibold tracking-tight">New workspace</h1>
        <p class="mt-1.5 text-sm text-muted-foreground">
          A workspace is who: the people who can see things, and the projects they can see. Each
          product inside it gets its own project.
        </p>

        <div class="mt-6 flex flex-col gap-2">
          <Label for="name">Name</Label>
          <Input
            id="name"
            placeholder="Acme"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </div>

        <Show when={error()}>
          {(message) => <p class="mt-3 text-sm text-destructive">{message()}</p>}
        </Show>

        <Button class="mt-5 w-full" disabled={busy() || !name().trim()}>
          {busy() ? "Creating…" : "Create workspace"}
        </Button>
      </form>
    </main>
  );
}

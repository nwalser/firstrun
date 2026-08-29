import { Link, createFileRoute, notFound, redirect, useRouter } from "@tanstack/solid-router";
import { For, Show, createSignal } from "solid-js";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/ui/index.js";
import { createProjectFn, getSession, getWorkspace } from "../lib/api.js";
import { PageHeader } from "./__root.js";

/**
 * The projects in a workspace.
 *
 * A project is one product AND one namespace of people. The copy says so where
 * someone is about to create one, because "a project per platform" is the
 * mistake that quietly breaks the entire product: a visitor on the site and an
 * install of the app have to land in the same project to become one person.
 */
export const Route = createFileRoute("/w/$wslug/")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspace({ data: params.wslug });
    if (!view) throw notFound();
    return view;
  },
  component: WorkspaceProjects,
});

function WorkspaceProjects() {
  const view = Route.useLoaderData();
  const router = useRouter();

  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const isAdmin = () => view().workspace.role === "admin";

  async function create(e: Event) {
    e.preventDefault();
    if (!name().trim()) return;
    setBusy(true);
    setError(null);
    const result = await createProjectFn({
      data: { workspace: view().workspace.slug, name: name() },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setName("");
    await router.invalidate();
  }

  return (
    <main class="mx-auto max-w-6xl px-6 pb-24">
      <PageHeader
        title={view().workspace.name}
        badge={view().workspace.role}
        description="Each project is one product, with its own people and its own dashboard."
        actions={
          <>
            <Button as={Link} to="/w/$wslug/members" params={{ wslug: view().workspace.slug }} variant="outline" size="sm">
              People
              <Badge variant="secondary">{view().members.length}</Badge>
            </Button>
            <Show when={isAdmin()}>
              <Button size="sm" onClick={() => setOpen(true)}>
                New project
              </Button>
            </Show>
          </>
        }
      />

      <Show
        when={view().projects.length > 0}
        fallback={
          <div class="rounded-xl border border-dashed p-12 text-center">
            <p class="text-sm text-muted-foreground">No projects in this workspace yet.</p>
            <Show when={isAdmin()}>
              <Button class="mt-4" size="sm" onClick={() => setOpen(true)}>
                Create the first one
              </Button>
            </Show>
          </div>
        }
      >
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <For each={view().projects}>
            {(project) => (
              <Link to="/w/$wslug/$pslug" params={{ wslug: view().workspace.slug, pslug: project.slug }}>
                <Card class="h-full transition-colors hover:border-ring">
                  <CardContent class="pt-5">
                    <div class="font-medium">{project.name}</div>
                    <div class="mt-1 font-mono text-xs text-muted-foreground">/{project.slug}</div>
                  </CardContent>
                </Card>
              </Link>
            )}
          </For>
        </div>
      </Show>

      <Sheet open={open()} onOpenChange={setOpen}>
        <SheetContent>
          <form onSubmit={create} class="flex h-full flex-col">
            <SheetHeader>
              <SheetTitle>New project</SheetTitle>
              <SheetDescription>One product, one set of people.</SheetDescription>
            </SheetHeader>

            <SheetBody>
              <div class="flex flex-col gap-2">
                <Label for="project-name">Name</Label>
                <Input
                  id="project-name"
                  placeholder="Themia"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                />
              </div>

              <p class="mt-4 text-xs text-muted-foreground">
                Add your marketing site and your app as two <strong>sources</strong> inside this one
                project. They share one namespace of people, which is what lets a visit be joined to
                an install. A separate project per platform breaks that join.
              </p>

              <Show when={error()}>
                {(message) => <p class="mt-3 text-sm text-destructive">{message()}</p>}
              </Show>
            </SheetBody>

            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={busy() || !name().trim()}>
                {busy() ? "Creating…" : "Create project"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </main>
  );
}

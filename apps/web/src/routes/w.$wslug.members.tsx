import { createFileRoute, notFound, redirect, useRouter } from "@tanstack/solid-router";
import { For, Show, createSignal } from "solid-js";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/index.js";
import {
  addMemberFn,
  getSession,
  getWorkspace,
  removeMemberFn,
  setMemberRoleFn,
  type MemberRole,
} from "../lib/api.js";
import { PageHeader } from "./__root.js";

/**
 * Who can see this workspace, and who can change it.
 *
 * Two roles, deliberately. `admin` can change things, `read` can look. Anything
 * finer is a guess about how teams will use this, and a permission model is far
 * easier to widen later than to narrow.
 *
 * The last admin cannot be demoted or removed -- the server refuses, because a
 * workspace nobody can administer is the one unrecoverable state this model
 * allows.
 */
export const Route = createFileRoute("/w/$wslug/members")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspace({ data: params.wslug });
    if (!view) throw notFound();
    return view;
  },
  component: Members,
});

const ROLE_OPTIONS: Array<{ value: MemberRole; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "read", label: "Read" },
];

function Members() {
  const view = Route.useLoaderData();
  const router = useRouter();

  const [login, setLogin] = createSignal("");
  const [role, setRole] = createSignal<MemberRole>("read");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const isAdmin = () => view().workspace.role === "admin";

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That did not work.");
      return;
    }
    await router.invalidate();
  }

  const invite = (e: Event) => {
    e.preventDefault();
    if (!login().trim()) return;
    return run(async () => {
      const result = await addMemberFn({
        data: { workspace: view().workspace.slug, login: login(), role: role() },
      });
      if (result.ok) setLogin("");
      return result;
    });
  };

  return (
    <main class="mx-auto max-w-4xl px-6 pb-24">
      <PageHeader
        title="People"
        crumb={{ label: `← ${view().workspace.name}`, href: `/w/${view().workspace.slug}` }}
        description="Access is per workspace. Everyone here can see every project in it."
      />

      <Show when={error()}>
        {(message) => (
          <p class="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {message()}
          </p>
        )}
      </Show>

      <Card>
        <CardContent class="pt-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <For each={view().members}>
                {(member) => {
                  const isSelf = () => member.userId === view().currentUserId;
                  return (
                    <TableRow>
                      <TableCell>
                        <div class="flex items-center gap-2.5">
                          <Show
                            when={member.avatarUrl}
                            fallback={<span class="size-6 rounded-full bg-muted" />}
                          >
                            {(src) => <img src={src()} alt="" class="size-6 rounded-full" />}
                          </Show>
                          <div class="min-w-0">
                            <div class="truncate text-sm">{member.login}</div>
                            <Show when={member.name}>
                              <div class="truncate text-xs text-muted-foreground">{member.name}</div>
                            </Show>
                          </div>
                          <Show when={isSelf()}>
                            <Badge variant="secondary">you</Badge>
                          </Show>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Show
                          when={isAdmin()}
                          fallback={<Badge variant="outline">{member.role}</Badge>}
                        >
                          <Select
                            class="ml-auto h-8 w-28 text-xs"
                            aria-label={`Role for ${member.login}`}
                            value={member.role}
                            disabled={busy()}
                            options={ROLE_OPTIONS}
                            onChange={(next) =>
                              run(() =>
                                setMemberRoleFn({
                                  data: {
                                    workspace: view().workspace.slug,
                                    userId: member.userId,
                                    role: next,
                                  },
                                })
                              )
                            }
                          />
                        </Show>
                      </TableCell>

                      <TableCell>
                        <Show when={isAdmin()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy()}
                            class="hover:text-destructive"
                            onClick={() =>
                              run(() =>
                                removeMemberFn({
                                  data: {
                                    workspace: view().workspace.slug,
                                    userId: member.userId,
                                  },
                                })
                              )
                            }
                          >
                            Remove
                          </Button>
                        </Show>
                      </TableCell>
                    </TableRow>
                  );
                }}
              </For>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Show when={isAdmin()}>
        <Card class="mt-4">
          <CardContent class="pt-5">
            <form class="flex flex-wrap items-end gap-3" onSubmit={invite}>
              <div class="flex min-w-48 flex-1 flex-col gap-2">
                <Label for="login">GitHub username</Label>
                <Input
                  id="login"
                  placeholder="octocat"
                  value={login()}
                  onInput={(e) => setLogin(e.currentTarget.value)}
                />
              </div>
              <div class="flex w-32 flex-col gap-2">
                <Label>Role</Label>
                <Select value={role()} onChange={setRole} options={ROLE_OPTIONS} />
              </div>
              <Button disabled={busy() || !login().trim()}>Add</Button>
            </form>
            <p class="mt-3 text-xs text-muted-foreground">
              They have to sign in here once before they can be added — there is no invite email,
              and adding a username nobody has claimed would silently do nothing.
            </p>
          </CardContent>
        </Card>
      </Show>
    </main>
  );
}

import { createFileRoute, notFound, redirect, useRouter } from "@tanstack/solid-router";
import { For, Show, createSignal } from "solid-js";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  ConfirmDelete,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  initials,
  toast,
} from "../components/ui/index.js";
import {
  SettingsPending,
  SettingsSection,
  SettingsShell,
} from "../components/settings-shell.js";
import { useI18n, type TranslationKey } from "../lib/i18n/index.js";
import {
  addMemberFn,
  getSession,
  getWorkspace,
  removeMemberFn,
  setMemberRoleFn,
  type MemberRole,
} from "../lib/api.js";

/**
 * Who can see this workspace, and who can change it.
 *
 * Two roles, deliberately. `admin` can change things, `read` can look. Anything
 * finer is a guess about how teams will use this, and a permission model is far
 * easier to widen later than to narrow.
 *
 * Two things this page used to only imply, and now states outright: access is
 * granted per workspace and covers every project in it, and the last admin
 * cannot be demoted or removed. The server enforces the second one -- a
 * workspace nobody can administer is the one unrecoverable state this model
 * allows -- but a control that is dead without saying why is its own bug.
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
  pendingComponent: SettingsPending,
});

/*
  A role picks a key, never a computed string.

  These three maps are literals so `t` keeps its closed union, and they live at
  module scope only because nothing in them is translated here: the lookup
  happens inside the component, where `t` is read and where switching language
  re-renders. The options array itself is a function for exactly that reason.
  As a module constant its labels would be frozen in whichever locale the module
  was first evaluated in.
*/
const ROLE_LABEL = {
  admin: "members.role_admin",
  read: "members.role_read",
} as const satisfies Record<MemberRole, TranslationKey>;

const ROLE_HINT = {
  admin: "members.role_admin_hint",
  read: "members.role_read_hint",
} as const satisfies Record<MemberRole, TranslationKey>;

const ROLE_CHANGED = {
  admin: "members.now_admin",
  read: "members.now_reader",
} as const satisfies Record<MemberRole, TranslationKey>;

function Members() {
  const view = Route.useLoaderData();
  const router = useRouter();
  const i18n = useI18n();

  const roleOptions = (): Array<{ value: MemberRole; label: string }> => [
    { value: "admin", label: i18n.t("members.role_admin") },
    { value: "read", label: i18n.t("members.role_read") },
  ];

  const [login, setLogin] = createSignal("");
  const [role, setRole] = createSignal<MemberRole>("read");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const isAdmin = () => view().workspace.role === "admin";
  const admins = () => view().members.filter((m) => m.role === "admin").length;
  /** The one the server will refuse to touch, so the UI can explain instead. */
  const isLastAdmin = (member: { role: MemberRole }) => member.role === "admin" && admins() === 1;

  /**
   * Run one mutation, and put its failure where the reader can act on it.
   *
   * `inline` is what makes the two halves of this page behave differently, and
   * they have to. The invite form has a field, so its failures belong under
   * that field. A role change and a removal happen in a table row that has
   * nowhere to put a sentence -- a message in a cell wraps and takes the row's
   * height with it -- so those get the toast and nothing else.
   *
   * They used to share one `error` signal, which meant a role change that the
   * server refused printed its reason at the BOTTOM of the page, under the
   * username input of a form the reader was not filling in, about a control
   * they were not touching. The toast said it too, so the visible effect was a
   * stale sentence left behind under an unrelated field.
   */
  async function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
    inline = false
  ) {
    setBusy(true);
    if (inline) setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      const message = result.error ?? i18n.t("members.failed");
      if (inline) setError(message);
      else toast.error(message);
      return;
    }
    toast.success(done);
    await router.invalidate();
  }

  const invite = (event: Event) => {
    event.preventDefault();
    const handle = login().trim();
    if (!handle) return;
    return run(
      async () => {
        const result = await addMemberFn({
          data: { workspace: view().workspace.slug, login: handle, role: role() },
        });
        if (result.ok) setLogin("");
        return result;
      },
      i18n.t("members.added", { name: handle }),
      true
    );
  };

  return (
    <SettingsShell
      // The same key the sidebar pane names this route with, so the heading and
      // the row that leads here cannot say two different words.
      title={i18n.t("shell.people")}
      description={i18n.t("members.description")}
    >
      <SettingsSection
        id="members"
        title={i18n.t("members.title")}
        description={i18n.t("members.hint")}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{i18n.t("members.person")}</TableHead>
              <TableHead>{i18n.t("members.role")}</TableHead>
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
                      {/* One line, not a stack: the row is a fixed 48px, and a
                          cell that is sometimes one line and sometimes two is
                          what makes a list of them look ragged. The full name
                          follows the handle in the muted colour instead. */}
                      <div class="flex items-center gap-2.5">
                        {/* GitHub is not obliged to have an avatar for anyone,
                            so the initials fallback is what keeps the column
                            from having holes in it. */}
                        <Avatar class="size-6 shrink-0">
                          <AvatarImage src={member.avatarUrl ?? undefined} alt="" />
                          <AvatarFallback>{initials(member.name ?? member.login)}</AvatarFallback>
                        </Avatar>
                        <span class="truncate">{member.login}</span>
                        <Show when={member.name}>
                          {(name) => <span class="truncate text-muted-foreground">{name()}</span>}
                        </Show>
                        <Show when={isSelf()}>
                          <Badge variant="secondary">{i18n.t("members.you")}</Badge>
                        </Show>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Show
                        when={isAdmin() && !isLastAdmin(member)}
                        fallback={
                          <Badge variant="outline">{i18n.t(ROLE_LABEL[member.role])}</Badge>
                        }
                      >
                        <Select
                          // The small form height, and the control keeps the
                          // 14px application chrome size it sets itself.
                          class="h-control-sm w-28"
                          aria-label={i18n.t("members.role_for", { name: member.login })}
                          value={member.role}
                          disabled={busy()}
                          options={roleOptions()}
                          onChange={(next) =>
                            run(
                              () =>
                                setMemberRoleFn({
                                  data: {
                                    workspace: view().workspace.slug,
                                    userId: member.userId,
                                    role: next,
                                  },
                                }),
                              i18n.t(ROLE_CHANGED[next], { name: member.login })
                            )
                          }
                        />
                      </Show>
                    </TableCell>

                    {/* The row's actions, at its right edge. Not a redundant
                        override: the columns are left-set now, and only this
                        one is deliberately not. */}
                    <TableCell class="text-right">
                      <Show when={isAdmin()}>
                        <Show when={!isLastAdmin(member)}>
                          <ConfirmDelete
                            trigger={
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy()}
                                class="hover:text-destructive"
                              >
                                {i18n.t("common.remove")}
                              </Button>
                            }
                            title={i18n.t("members.remove_confirm", { name: member.login })}
                            description={
                              isSelf()
                                ? i18n.t("members.remove_self_hint")
                                : i18n.t("members.remove_other_hint")
                            }
                            actionLabel={i18n.t("common.remove")}
                            onConfirm={() =>
                              run(
                                () =>
                                  removeMemberFn({
                                    data: {
                                      workspace: view().workspace.slug,
                                      userId: member.userId,
                                    },
                                  }),
                                i18n.t("members.removed", { name: member.login })
                              )
                            }
                          />
                        </Show>
                      </Show>
                    </TableCell>
                  </TableRow>
                );
              }}
            </For>
          </TableBody>
        </Table>

        {/*
          Said once, under the list, rather than inside the row of whoever
          happens to be the last admin. A sentence in a cell wraps to two or
          three lines and takes the whole row's height with it, and a control
          that is dead without saying why is its own bug: this says why, in the
          one place it is true, and the server enforces it either way.
        */}
        <Show when={isAdmin() && admins() === 1}>
          <p class="mt-3 text-copy-13 text-muted-foreground">{i18n.t("members.last_admin")}</p>
        </Show>
      </SettingsSection>

      <Show when={isAdmin()}>
        <SettingsSection
          id="add"
          title={i18n.t("members.add")}
          description={i18n.t("members.add_hint")}
          footer={
            /* Spinner and the changed word, the treatment `ConfirmDelete`
                already uses: a disabled button reading "Adding" is
                indistinguishable from a disabled button that has stopped. */
            <Button type="submit" form="add-member" disabled={busy() || !login().trim()}>
              <Show when={busy()}>
                <Spinner />
              </Show>
              {busy() ? i18n.t("common.adding") : i18n.t("common.add")}
            </Button>
          }
        >
          <form id="add-member" class="flex flex-wrap items-start gap-3" onSubmit={invite}>
            <Field class="min-w-48 flex-1">
              <FieldLabel for="login">{i18n.t("members.username_label")}</FieldLabel>
              <Input
                id="login"
                placeholder="octocat"
                value={login()}
                onInput={(e) => setLogin(e.currentTarget.value)}
              />
              <FieldDescription>{i18n.t("members.username_hint")}</FieldDescription>
              <Show when={error()}>{(message) => <FieldError>{message()}</FieldError>}</Show>
            </Field>

            {/* Not a <Field>: Kobalte's Select renders its list through a
                portal, so a label with a `for` would point at nothing. The
                aria-label on the trigger is what a screen reader reads. */}
            <div class="flex w-32 flex-col gap-2">
              <FieldLabel>{i18n.t("members.role")}</FieldLabel>
              <Select
                aria-label={i18n.t("members.role")}
                value={role()}
                onChange={setRole}
                options={roleOptions()}
              />
              <FieldDescription>{i18n.t(ROLE_HINT[role()])}</FieldDescription>
            </div>
          </form>
        </SettingsSection>
      </Show>
    </SettingsShell>
  );
}

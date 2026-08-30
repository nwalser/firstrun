import { Link, createFileRoute, notFound, redirect, useNavigate, useRouter } from "@tanstack/solid-router";
import { For, Show, createSignal } from "solid-js";
import LayoutDashboard from "lucide-solid/icons/layout-dashboard";
import Lock from "lucide-solid/icons/lock";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  buttonVariants,
  ConfirmDelete,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  initials,
  toast,
} from "../components/ui/index.js";
import { DangerZone, SettingsSection, SettingsShell } from "../components/settings-shell.js";
import { LogoField } from "../components/logo-field.js";
import { useI18n } from "../lib/i18n/index.js";
import {
  clearWorkspaceLogoFn,
  deleteWorkspaceFn,
  getSession,
  getWorkspace,
  renameWorkspaceFn,
  setWorkspaceLogoFn,
} from "../lib/api.js";

/**
 * Workspace settings.
 *
 * Admin only, and a reader who follows a link here is told so plainly rather
 * than shown a 404 or a form that fails on submit. That gate is a courtesy: the
 * server re-checks the role on every mutation, because hiding a control is not
 * a permission check.
 */
export const Route = createFileRoute("/w/$wslug/settings")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspace({ data: params.wslug });
    if (!view) throw notFound();
    return view;
  },
  component: WorkspaceSettings,
});

function WorkspaceSettings() {
  const view = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const i18n = useI18n();

  // The pane draws these under its own translated header, so a label that is
  // still English shows up as a hole in the list. Every one that has a key uses
  // it, and the section title on the card below reads from the same call so the
  // two can never drift apart.
  const sections = () => [
    { id: "general", label: i18n.t("shell.general") },
    { id: "projects", label: i18n.t("shell.projects") },
    { id: "people", label: i18n.t("shell.people") },
    { id: "danger", label: i18n.t("settings.danger_zone") },
  ];

  const [name, setName] = createSignal(view().workspace.name);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const workspace = () => view().workspace;
  const isAdmin = () => workspace().role === "admin";
  const renamed = () => name().trim() !== workspace().name && name().trim().length > 0;

  async function rename(event: Event) {
    event.preventDefault();
    if (!renamed()) return;
    setBusy(true);
    setError(null);
    const result = await renameWorkspaceFn({
      data: { workspace: workspace().slug, name: name().trim() },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success(i18n.t("settings.renamed_to", { name: name().trim() }));
    // The slug is derived from the name, so the URL this page is on may no
    // longer exist. Navigate before invalidating or the loader refetches a
    // workspace under its old slug and 404s.
    await navigate({ to: "/w/$wslug/settings", params: { wslug: result.slug } });
    await router.invalidate();
  }

  async function uploadLogo(dataUrl: string) {
    const result = await setWorkspaceLogoFn({ data: { workspace: workspace().slug, dataUrl } });
    // Thrown rather than returned: LogoField puts its preview back on a
    // rejection, so a failed save never leaves a picture claiming success.
    if (!result.ok) throw new Error(result.error);
    toast.success(i18n.t("settings.logo_updated"));
    // /api/logo/<slug> is cache-keyed by logoUpdatedAt, which only changes in
    // the loader data. Without this the old image stays on screen everywhere
    // else in the app.
    await router.invalidate();
  }

  async function clearLogo() {
    const result = await clearWorkspaceLogoFn({ data: workspace().slug });
    if (!result.ok) throw new Error(result.error);
    toast.success(i18n.t("settings.logo_removed"));
    await router.invalidate();
  }

  async function destroy() {
    const result = await deleteWorkspaceFn({
      data: { workspace: workspace().slug, confirm: workspace().name },
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(i18n.t("settings.deleted", { name: workspace().name }));
    await navigate({ to: "/" });
  }

  return (
    <Show when={isAdmin()} fallback={<NeedsAdmin slug={workspace().slug} />}>
      <SettingsShell
        title={i18n.t("settings.workspace_title")}
        description={i18n.t("settings.workspace_description")}
        sections={sections()}
      >
        <SettingsSection
          id="general"
          title={i18n.t("shell.general")}
          description={i18n.t("settings.name_hint")}
          footer={
            <Button type="submit" form="workspace-general" disabled={busy() || !renamed()}>
              {busy() ? i18n.t("common.saving") : i18n.t("common.save")}
            </Button>
          }
        >
          <FieldGroup>
            {/* The logo sits outside this form on purpose: it saves the moment
                a file is chosen, and a control inside a form with a Save button
                claims otherwise. */}
            <form id="workspace-general" onSubmit={rename}>
              <Field>
                <FieldLabel for="workspace-name">{i18n.t("common.name")}</FieldLabel>
                <Input
                  id="workspace-name"
                  value={name()}
                  disabled={busy()}
                  onInput={(e) => setName(e.currentTarget.value)}
                />
                {/* Two keys, not one. The slug is drawn in the mono face in
                    the middle of the sentence and a placeholder cannot carry a
                    class. Both languages put the path in the same position, so
                    the split holds: verb, colon, path, consequence. */}
                <FieldDescription>
                  {i18n.t("settings.workspace_rename_lead")}{" "}
                  <span class="font-mono">/w/{workspace().slug}</span>{" "}
                  {i18n.t("settings.workspace_rename_tail")}
                </FieldDescription>
                <Show when={error()}>{(message) => <FieldError>{message()}</FieldError>}</Show>
              </Field>
            </form>

            {/* Not a <Field> either: the control here is a drop zone, an avatar
                and two buttons, so there is nothing for a label to point at. */}
            <div class="flex flex-col gap-2">
              <FieldLabel>{i18n.t("settings.logo")}</FieldLabel>
              <LogoField
                name={workspace().name}
                logoUpdatedAt={workspace().logoUpdatedAt}
                src={`/api/logo/${workspace().slug}`}
                onUpload={uploadLogo}
                onClear={clearLogo}
                disabled={busy()}
              />
              <FieldDescription>{i18n.t("settings.logo_saved_hint")}</FieldDescription>
            </div>
          </FieldGroup>
        </SettingsSection>

        <SettingsSection
          id="projects"
          title={i18n.t("shell.projects")}
          description={i18n.t("settings.projects_description")}
        >
          <Show
            when={view().projects.length > 0}
            fallback={
              <Empty>
                <EmptyMedia>
                  <LayoutDashboard />
                </EmptyMedia>
                <EmptyTitle>{i18n.t("settings.no_projects")}</EmptyTitle>
                <EmptyDescription>{i18n.t("settings.no_projects_hint")}</EmptyDescription>
                <EmptyContent>
                  {/* A styled Link rather than `Button as={Link}`: the
                      polymorphic `as` drops the route's param types on the
                      way through, and typed params are the point of Link. */}
                  <Link
                    to="/w/$wslug"
                    params={{ wslug: workspace().slug }}
                    class={buttonVariants({ size: "sm" })}
                  >
                    {i18n.t("settings.create_project")}
                  </Link>
                </EmptyContent>
              </Empty>
            }
          >
            {/* One container, not one card per row: the reference's card-style
                list is a single raised surface with a hairline between rows.
                The 1px edge is the shadow, so nothing here carries a border. */}
            <ul class="flex flex-col divide-y rounded-md bg-card shadow-sm">
              <For each={view().projects}>
                {(project) => (
                  <li class="flex items-center justify-between gap-3 p-4">
                    <div class="min-w-0">
                      <div class="truncate text-body">{project.name}</div>
                      <div class="truncate font-mono text-copy-13 text-muted-foreground">
                        /{project.slug}
                      </div>
                    </div>
                    <Link
                      to="/w/$wslug/$pslug/settings"
                      params={{ wslug: workspace().slug, pslug: project.slug }}
                      class={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      {i18n.t("shell.settings")}
                    </Link>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </SettingsSection>

        <SettingsSection
          id="people"
          title={i18n.t("shell.people")}
          description={i18n.t("settings.people_description")}
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="flex -space-x-2">
                <For each={view().members.slice(0, 6)}>
                  {(member) => (
                    <Avatar class="size-7 ring-2 ring-card">
                      <AvatarImage src={member.avatarUrl ?? undefined} alt="" />
                      <AvatarFallback>{initials(member.name ?? member.login)}</AvatarFallback>
                    </Avatar>
                  )}
                </For>
              </div>
              <div class="text-sm text-muted-foreground">
                {i18n.t("settings.people", { count: view().members.length })}
                <Show when={view().members.length > 6}>
                  {" "}
                  <Badge variant="secondary">+{i18n.num(view().members.length - 6)}</Badge>
                </Show>
              </div>
            </div>
            {/* The member list lives on its own page rather than being copied
                here: two places to change a role is one place to get it wrong. */}
            <Link
              to="/w/$wslug/members"
              params={{ wslug: workspace().slug }}
              class={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {i18n.t("settings.manage_people")}
            </Link>
          </div>
        </SettingsSection>

        <DangerZone id="danger">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0 max-w-lg">
              <div class="text-sm font-medium">{i18n.t("settings.delete_workspace_heading")}</div>
              <p class="mt-0.5 text-sm text-muted-foreground">
                {i18n.t("settings.delete_workspace_hint")}
              </p>
            </div>
            <ConfirmDelete
              trigger={
                <Button variant="destructive">{i18n.t("settings.delete_workspace")}</Button>
              }
              title={i18n.t("settings.delete_workspace_title", { name: workspace().name })}
              description={i18n.t("settings.delete_workspace_confirm", {
                count: view().projects.length,
              })}
              confirmWord={workspace().name}
              actionLabel={i18n.t("settings.delete_workspace")}
              onConfirm={destroy}
            />
          </div>
        </DangerZone>
      </SettingsShell>
    </Show>
  );
}

/**
 * What a reader sees here.
 *
 * Not a 404 -- the page exists and they are in the workspace -- and not a form
 * that only fails once submitted.
 */
function NeedsAdmin(props: { slug: string }) {
  const i18n = useI18n();

  return (
    <main class="px-6 py-6">
      <Empty>
        <EmptyMedia>
          <Lock />
        </EmptyMedia>
        <EmptyTitle>{i18n.t("settings.needs_admin")}</EmptyTitle>
        <EmptyDescription>{i18n.t("settings.workspace_needs_admin")}</EmptyDescription>
        <EmptyContent>
          <Link
            to="/w/$wslug"
            params={{ wslug: props.slug }}
            class={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {i18n.t("settings.back_to_projects")}
          </Link>
        </EmptyContent>
      </Empty>
    </main>
  );
}

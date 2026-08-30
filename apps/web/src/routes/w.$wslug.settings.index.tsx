import { Link, createFileRoute, notFound, redirect, useNavigate, useRouter } from "@tanstack/solid-router";
import { Show, createSignal } from "solid-js";
import Lock from "lucide-solid/icons/lock";
import {
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
  Spinner,
  toast,
} from "../components/ui/index.js";
import {
  DangerZone,
  SettingsPending,
  SettingsSection,
  SettingsShell,
} from "../components/settings-shell.js";
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
 * Workspace general settings: what it is called, what it looks like, and how to
 * delete it.
 *
 * Admin only, and a reader who follows a link here is told so plainly rather
 * than shown a 404 or a form that fails on submit. That gate is a courtesy: the
 * server re-checks the role on every mutation, because hiding a control is not
 * a permission check.
 *
 * The danger zone stays at the foot of THIS page rather than becoming a row of
 * its own in the settings pane. Deleting a workspace is an action, not a
 * setting, and a nav row leading to a page whose only content is one red button
 * advertises the irreversible thing instead of keeping it where somebody
 * already editing the workspace will find it.
 */
export const Route = createFileRoute("/w/$wslug/settings/")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspace({ data: params.wslug });
    if (!view) throw notFound();
    return view;
  },
  component: WorkspaceGeneral,
  pendingComponent: SettingsPending,
});

function WorkspaceGeneral() {
  const view = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const i18n = useI18n();

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
      // Inline only. The message has a place on screen -- under the field it is
      // about, where the reader's eye already is -- and a toast repeating it in
      // the corner is the same sentence twice, one copy of which then times
      // out. A toast is for a failure with nowhere to land: a delete, a role
      // change, a logo upload. See the note on `run` in `w.$wslug.members.tsx`.
      setError(result.error);
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
      >
        <SettingsSection
          id="general"
          title={i18n.t("shell.general")}
          description={i18n.t("settings.name_hint")}
          footer={
            /*
              A spinner AND the changed word, which is the treatment
              `ConfirmDelete` already uses for the one action in the design
              system that can take a moment. The word alone was the whole
              progress report on every form in the product: a disabled button
              reading "Saving" is indistinguishable from a disabled button that
              has stopped.
            */
            <Button type="submit" form="workspace-general" disabled={busy() || !renamed()}>
              <Show when={busy()}>
                <Spinner />
              </Show>
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

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
  clearProjectLogoFn,
  deleteProjectFn,
  getProject,
  getSession,
  renameProjectFn,
  setProjectLogoFn,
} from "../lib/api.js";

/**
 * Project settings.
 *
 * A project is one product, and it owns its events outright. Both danger-zone
 * sentences on this page exist because of that: a client's durable queue can
 * resend what it has not flushed yet, and nothing anywhere can resend what it
 * has. Deleting a project is the one action here with no way back.
 */
export const Route = createFileRoute("/w/$wslug/$pslug/settings")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getProject({ data: { workspace: params.wslug, project: params.pslug } });
    if (!view) throw notFound();
    return view;
  },
  component: ProjectSettings,
  pendingComponent: SettingsPending,
});

function ProjectSettings() {
  const view = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const i18n = useI18n();

  const [name, setName] = createSignal(view().project.name);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const workspace = () => view().workspace;
  const project = () => view().project;
  const isAdmin = () => view().role === "admin";
  const renamed = () => name().trim() !== project().name && name().trim().length > 0;

  async function rename(event: Event) {
    event.preventDefault();
    if (!renamed()) return;
    setBusy(true);
    setError(null);
    const result = await renameProjectFn({
      data: { workspace: workspace().slug, project: project().slug, name: name().trim() },
    });
    setBusy(false);
    if (!result.ok) {
      // Inline only. The message has a place on screen -- under the field it is
      // about -- and a toast repeating it in the corner is the same sentence
      // twice, one copy of which then times out. A toast is for a failure with
      // nowhere to land: the two deletes below are exactly that.
      setError(result.error);
      return;
    }
    toast.success(i18n.t("settings.renamed_to", { name: name().trim() }));
    // The slug follows the name, so this URL is stale the moment the rename
    // lands. Move to the new one before anything refetches the old slug.
    await navigate({
      to: "/w/$wslug/$pslug/settings",
      params: { wslug: workspace().slug, pslug: result.slug },
    });
    await router.invalidate();
  }

  async function uploadLogo(dataUrl: string) {
    const result = await setProjectLogoFn({
      data: { workspace: workspace().slug, project: project().slug, dataUrl },
    });
    // Thrown rather than returned: LogoField puts its preview back on a
    // rejection, so a failed save never leaves a picture claiming success.
    if (!result.ok) throw new Error(result.error);
    toast.success(i18n.t("settings.logo_updated"));
    // The image URL is cache-keyed by logoUpdatedAt, which only changes in the
    // loader data. Without this the old picture stays on screen everywhere else.
    await router.invalidate();
  }

  async function clearLogo() {
    const result = await clearProjectLogoFn({
      data: { workspace: workspace().slug, project: project().slug },
    });
    if (!result.ok) throw new Error(result.error);
    toast.success(i18n.t("settings.logo_removed"));
    await router.invalidate();
  }

  async function destroy() {
    const result = await deleteProjectFn({
      data: { workspace: workspace().slug, project: project().slug, confirm: project().name },
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(i18n.t("settings.deleted", { name: project().name }));
    await navigate({ to: "/w/$wslug", params: { wslug: workspace().slug } });
  }

  return (
    <Show when={isAdmin()} fallback={<NeedsAdmin wslug={workspace().slug} pslug={project().slug} />}>
      <SettingsShell
        title={i18n.t("settings.project_title")}
        description={i18n.t("settings.project_description", {
          project: project().name,
          workspace: workspace().name,
        })}
      >
        <SettingsSection
          id="general"
          title={i18n.t("shell.general")}
          description={i18n.t("settings.name_hint")}
          footer={
            /* Spinner and the changed word, the treatment `ConfirmDelete`
                already uses: a disabled button reading "Saving" is
                indistinguishable from a disabled button that has stopped. */
            <Button type="submit" form="project-general" disabled={busy() || !renamed()}>
              <Show when={busy()}>
                <Spinner />
              </Show>
              {busy() ? i18n.t("common.saving") : i18n.t("common.save")}
            </Button>
          }
        >
          <form id="project-general" onSubmit={rename}>
            <FieldGroup>
              <Field>
                <FieldLabel for="project-name">{i18n.t("common.name")}</FieldLabel>
                <Input
                  id="project-name"
                  value={name()}
                  disabled={busy()}
                  onInput={(e) => setName(e.currentTarget.value)}
                />
                {/* Two keys, not one. The path is drawn in the mono face in
                    the middle of the sentence and a placeholder cannot carry a
                    class. Both languages put it in the same position. */}
                <FieldDescription>
                  {i18n.t("settings.project_rename_lead")}{" "}
                  <span class="font-mono">
                    /w/{workspace().slug}/{project().slug}
                  </span>{" "}
                  {i18n.t("settings.project_rename_tail")}
                </FieldDescription>
                <Show when={error()}>{(message) => <FieldError>{message()}</FieldError>}</Show>
              </Field>
            </FieldGroup>
          </form>

          {/* Outside the form on purpose: it saves the moment a file is chosen,
              and a control inside a form with a Save button claims otherwise.
              Not a <Field> either -- the control is a drop zone, an image and
              two buttons, so there is nothing for a label to point at. */}
          <div class="mt-4 flex flex-col gap-2">
            <FieldLabel>{i18n.t("settings.project_logo")}</FieldLabel>
            <LogoField
              name={project().name}
              logoUpdatedAt={project().logoUpdatedAt}
              src={`/api/logo/${workspace().slug}/${project().slug}`}
              onUpload={uploadLogo}
              onClear={clearLogo}
              disabled={busy()}
            />
            <FieldDescription>{i18n.t("settings.project_logo_saved_hint")}</FieldDescription>
          </div>
        </SettingsSection>

        <DangerZone id="danger">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0 max-w-lg">
              <div class="text-sm font-medium">{i18n.t("settings.delete_project_heading")}</div>
              <p class="mt-0.5 text-sm text-muted-foreground">
                {i18n.t("settings.delete_project_hint", { count: view().sources.length })}
              </p>
            </div>
            <ConfirmDelete
              trigger={<Button variant="destructive">{i18n.t("settings.delete_project")}</Button>}
              title={i18n.t("settings.delete_project_title", { name: project().name })}
              description={i18n.t("settings.delete_project_confirm", {
                count: view().sources.length,
              })}
              confirmWord={project().name}
              actionLabel={i18n.t("settings.delete_project")}
              onConfirm={destroy}
            />
          </div>
        </DangerZone>
      </SettingsShell>
    </Show>
  );
}

function NeedsAdmin(props: { wslug: string; pslug: string }) {
  const i18n = useI18n();

  return (
    <main class="px-6 py-6">
      <Empty>
        <EmptyMedia>
          <Lock />
        </EmptyMedia>
        <EmptyTitle>{i18n.t("settings.needs_admin")}</EmptyTitle>
        <EmptyDescription>{i18n.t("settings.project_needs_admin")}</EmptyDescription>
        <EmptyContent>
          <Link
            to="/w/$wslug/$pslug"
            params={{ wslug: props.wslug, pslug: props.pslug }}
            class={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {i18n.t("settings.back_to_dashboard")}
          </Link>
        </EmptyContent>
      </Empty>
    </main>
  );
}

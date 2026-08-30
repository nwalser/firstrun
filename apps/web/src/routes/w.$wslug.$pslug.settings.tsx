import { Link, createFileRoute, notFound, redirect, useNavigate, useRouter } from "@tanstack/solid-router";
import { For, Show, createSignal } from "solid-js";
import Antenna from "lucide-solid/icons/antenna";
import Lock from "lucide-solid/icons/lock";
import {
  Badge,
  Button,
  buttonVariants,
  CodeBlock,
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
  toast,
} from "../components/ui/index.js";
import { DangerZone, SettingsSection, SettingsShell } from "../components/settings-shell.js";
import { useI18n } from "../lib/i18n/index.js";
import {
  deleteProjectFn,
  deleteSourceFn,
  getProject,
  getSession,
  renameProjectFn,
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
});

function ProjectSettings() {
  const view = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const i18n = useI18n();

  // Drawn in the sidebar pane, under a header that is already translated, so a
  // label that has a key uses it. The card title below reads the same call, and
  // the two cannot drift apart.
  const sections = () => [
    { id: "general", label: i18n.t("shell.general") },
    { id: "sources", label: i18n.t("shell.sources") },
    { id: "danger", label: i18n.t("settings.danger_zone") },
  ];

  const [name, setName] = createSignal(view().project.name);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const workspace = () => view().workspace;
  const project = () => view().project;
  const isAdmin = () => view().role === "admin";
  const renamed = () => name().trim() !== project().name && name().trim().length > 0;

  /*
    When a source last sent something, in words.

    Inside the component because it reads `t`: at module scope it would be
    evaluated once, in whichever locale happened to be active when the module
    was first loaded, and switching language would leave it in English. The day
    count goes through the plural family rather than an `n === 1` check, so a
    language with a `few` gets it right without every call site being revisited.
  */
  const lastSeen = (at: string | null): string => {
    if (!at) return i18n.t("settings.last_event_never");
    const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
    if (days <= 0) return i18n.t("settings.last_event_today");
    if (days === 1) return i18n.t("settings.last_event_yesterday");
    if (days < 30) return i18n.t("settings.last_event_days", { count: days });
    return i18n.t("settings.last_event_on", { date: i18n.shortDate(at) });
  };

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
      setError(result.error);
      toast.error(result.error);
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

  async function removeSource(sourceId: string, sourceName: string) {
    const result = await deleteSourceFn({
      data: { workspace: workspace().slug, project: project().slug, sourceId },
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(i18n.t("settings.source_removed", { name: sourceName }));
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
        sections={sections()}
      >
        <SettingsSection
          id="general"
          title={i18n.t("shell.general")}
          description={i18n.t("settings.name_hint")}
          footer={
            <Button type="submit" form="project-general" disabled={busy() || !renamed()}>
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
        </SettingsSection>

        <SettingsSection
          id="sources"
          title={i18n.t("shell.sources")}
          description={i18n.t("settings.sources_description")}
          footer={
            /* A styled Link rather than `Button as={Link}`: the polymorphic
               `as` drops the route's param types on the way through, and typed
               params are the point of Link. */
            <Link
              to="/w/$wslug/$pslug/sources"
              params={{ wslug: workspace().slug, pslug: project().slug }}
              class={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {i18n.t("settings.add_source")}
            </Link>
          }
        >
          <Show
            when={view().sources.length > 0}
            fallback={
              <Empty>
                <EmptyMedia>
                  <Antenna />
                </EmptyMedia>
                <EmptyTitle>{i18n.t("settings.no_sources")}</EmptyTitle>
                <EmptyDescription>{i18n.t("settings.no_sources_hint")}</EmptyDescription>
              </Empty>
            }
          >
            {/* One container with a hairline between rows, not a card per
                source: a stack of separately ringed boxes reads as a list of
                unrelated things. The 1px edge is the shadow, so no borders. */}
            <ul class="flex flex-col divide-y rounded-md bg-card shadow-sm">
              <For each={view().sources}>
                {(source) => (
                  <li class="p-4">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="truncate text-body font-medium">{source.name}</span>
                        <Badge variant="secondary">{source.kind}</Badge>
                      </div>
                      <ConfirmDelete
                        trigger={
                          <Button variant="ghost" size="sm" class="hover:text-destructive">
                            {i18n.t("common.remove")}
                          </Button>
                        }
                        title={i18n.t("settings.remove_source_title", { name: source.name })}
                        description={i18n.t("settings.remove_source_hint")}
                        actionLabel={i18n.t("settings.remove_source")}
                        onConfirm={() => removeSource(source.id, source.name)}
                      />
                    </div>

                    <div class="mt-2.5">
                      {/* The key is public by design -- it ships inside a
                          website's script tag -- so it is shown rather than
                          masked, with the copy button that puts it in a config. */}
                      <div class="mb-1.5 text-copy-13 text-muted-foreground">
                        {i18n.t("settings.ingest_key")}
                      </div>
                      <CodeBlock code={source.ingestKey} />
                    </div>

                    <div class="mt-2 text-copy-13 text-muted-foreground">
                      {lastSeen(source.lastSeenAt)}
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
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

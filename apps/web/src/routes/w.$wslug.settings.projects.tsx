import { Link, createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import LayoutDashboard from "lucide-solid/icons/layout-dashboard";
import Lock from "lucide-solid/icons/lock";
import {
  buttonVariants,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/index.js";
import {
  SettingsPending,
  SettingsSection,
  SettingsShell,
} from "../components/settings-shell.js";
import { useI18n } from "../lib/i18n/index.js";
import { getSession, getWorkspace } from "../lib/api.js";

/**
 * Every project in the workspace, and the way into each one's settings.
 *
 * Its own page rather than a card under General. A workspace with a dozen
 * products had this list sitting between the rename field and the delete
 * button, so the two things a reader came to General for were separated by the
 * one that grows without bound.
 *
 * It does not CREATE projects: that is `/w/$wslug/projects/new`, reached from
 * the workspace overview where somebody who has just run out of projects
 * actually is. This page is the index of what exists.
 *
 * Same loader as General, which is the whole workspace view. The call is
 * already the one every page in this area makes, and asking for a narrower
 * shape would be a second query returning a subset of a cached one.
 */
export const Route = createFileRoute("/w/$wslug/settings/projects")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspace({ data: params.wslug });
    if (!view) throw notFound();
    return view;
  },
  component: WorkspaceProjects,
  pendingComponent: SettingsPending,
});

function WorkspaceProjects() {
  const view = Route.useLoaderData();
  const i18n = useI18n();

  const workspace = () => view().workspace;
  const isAdmin = () => workspace().role === "admin";

  return (
    <Show when={isAdmin()} fallback={<NeedsAdmin slug={workspace().slug} />}>
      <SettingsShell
        title={i18n.t("shell.projects")}
        description={i18n.t("settings.projects_description")}
      >
        <SettingsSection id="projects" title={i18n.t("shell.projects")}>
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
      </SettingsShell>
    </Show>
  );
}

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

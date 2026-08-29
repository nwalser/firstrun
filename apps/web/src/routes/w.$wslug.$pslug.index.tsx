import { Link, createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { Dashboard } from "../components/dashboard.js";
import { shortDate } from "../components/format.js";
import { Button } from "../components/ui/index.js";
import { getProject, getSession } from "../lib/api.js";
import { PageHeader } from "./__root.js";

/**
 * The dashboard.
 *
 * One request loads the project, its sources, its layout and one snapshot
 * covering every widget on it -- the layout is known before any SQL runs, so
 * the queries are deduplicated up front rather than one per card.
 */
export const Route = createFileRoute("/w/$wslug/$pslug/")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getProject({ data: { workspace: params.wslug, project: params.pslug } });
    if (!view) throw notFound();
    return view;
  },
  component: ProjectDashboard,
});

function ProjectDashboard() {
  const view = Route.useLoaderData();

  const window = () =>
    `${shortDate(view().snapshot.from)} — ${shortDate(new Date(view().snapshot.to.valueOf() - 864e5))}`;

  return (
    <main class="mx-auto max-w-6xl px-6 pb-24">
      <PageHeader
        title={view().project.name}
        crumb={{ label: `← ${view().workspace.name}`, href: `/w/${view().workspace.slug}` }}
        description={window()}
        actions={
          <Button
            as={Link}
            to="/w/$wslug/$pslug/sources"
            params={{ wslug: view().workspace.slug, pslug: view().project.slug }}
            variant="outline"
            size="sm"
          >
            {view().sources.length} {view().sources.length === 1 ? "source" : "sources"}
          </Button>
        }
      />

      <Show
        when={view().sources.length > 0}
        fallback={
          <div class="rounded-xl border border-dashed p-12 text-center">
            <p class="text-sm text-muted-foreground">Nothing is sending events yet.</p>
            <Button
              as={Link}
              to="/w/$wslug/$pslug/sources"
              params={{ wslug: view().workspace.slug, pslug: view().project.slug }}
              class="mt-4"
              size="sm"
            >
              Add a source
            </Button>
          </div>
        }
      >
        <Dashboard
          workspaceSlug={view().workspace.slug}
          projectSlug={view().project.slug}
          layout={view().layout}
          snapshot={view().snapshot}
          sources={view().sources}
          canEdit={view().role === "admin"}
        />
      </Show>
    </main>
  );
}

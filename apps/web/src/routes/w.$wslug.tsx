import { Outlet, createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import { AppShell } from "../components/app-shell.js";
import { getSession, getWorkspace } from "../lib/api.js";

/**
 * The layout every workspace page sits inside.
 *
 * The shell is here rather than in each route so the sidebar keeps its state
 * across navigation instead of remounting -- a sidebar that re-collapses every
 * time you click a project is worse than no sidebar. It is also why the shell
 * cannot see which project is open: that is a route below this one, and it
 * publishes itself upwards. See `useProjectNav`.
 */
export const Route = createFileRoute("/w/$wslug")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspace({ data: params.wslug });
    if (!view) throw notFound();
    return { session, view };
  },
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  const data = Route.useLoaderData();
  return (
    <AppShell
      session={data().session}
      workspace={data().view.workspace}
      projects={data().view.projects}
      billing={data().view.billing}
    >
      <Outlet />
    </AppShell>
  );
}

import { Outlet, createFileRoute, notFound, redirect, useRouterState } from "@tanstack/solid-router";
import { createEffect, onCleanup } from "solid-js";
import { useProjectNav } from "../components/app-shell.js";
import { getProjectNav, getSession } from "../lib/api.js";

/**
 * Everything that stays put while you move around inside one project.
 *
 * There is nothing on screen here any more. The project's own chrome -- its
 * name, its boards, its sources -- is contextual navigation, and contextual
 * navigation lives in the sidebar: this route's whole job is to load that and
 * publish it upwards, so the shell can draw the project scope of the nav while
 * the child route draws the page.
 *
 * The tab strip that used to sit here is gone with it. It was a shape the
 * reference does not have, and the four things it owned -- rename, duplicate,
 * delete and reorder, including Alt+Arrow, which was the only way to reorder a
 * board from a keyboard -- moved onto the sidebar rows rather than being
 * dropped. See `BoardRows` in the app shell.
 *
 * A board has its own address -- `/w/<ws>/<project>/dashboards/<board>` -- so
 * this route does not know which one is open: that is a child's route param,
 * and a parent loader cannot see it. It loads only the chrome, which is also
 * the right amount of work. The board itself, with its snapshot, is loaded by
 * the route that actually shows one.
 *
 * Boards live under `dashboards/` rather than directly under the project
 * because `settings`, `sources` and `dashboards` are already static children
 * here. A flat `/w/<ws>/<project>/<board>` would collide with all three today,
 * and worse, any static child added later would silently shadow somebody's
 * existing board. Under this segment the only reserved slug is `new`.
 */
export const Route = createFileRoute("/w/$wslug/$pslug")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const nav = await getProjectNav({
      data: { workspace: params.wslug, project: params.pslug },
    });
    if (!nav) throw notFound();
    return nav;
  },
  component: ProjectLayout,
});

/**
 * Which board the URL names, or null.
 *
 * Read from the path rather than from loader data because the board is a child
 * route's parameter. `new` is the create page, not a board -- it is the one
 * slug this segment reserves.
 */
export function activeBoardSlug(pathname: string): string | null {
  const match = pathname.replace(/\/+$/, "").match(/\/dashboards\/([^/]+)$/);
  const slug = match?.[1];
  return slug && slug !== "new" ? slug : null;
}

function ProjectLayout() {
  const nav = Route.useLoaderData();
  const { setNav } = useProjectNav();
  const layoutRouterState = useRouterState();

  // A non-null value here is what puts the sidebar into project scope, so this
  // is also the switch between the two navigation shapes. Cleared on the way
  // out, or the sidebar keeps showing a project nobody is looking at.
  createEffect(() =>
    setNav({
      projectSlug: nav().project.slug,
      projectName: nav().project.name,
      role: nav().role,
      dashboards: nav().dashboards,
      activeSlug: activeBoardSlug(layoutRouterState().location.pathname),
    })
  );
  onCleanup(() => setNav(null));

  return <Outlet />;
}

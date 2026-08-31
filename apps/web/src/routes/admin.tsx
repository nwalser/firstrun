import { Outlet, createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import { AdminShell } from "../components/admin-shell.js";
import { getAdminContext, getSession } from "../lib/api.js";

/**
 * The operator's area, and the layout every page in it sits inside.
 *
 * ## It has the app's shell now
 *
 * It used to have none, on the argument that the app's shell is scoped to one
 * workspace while this is scoped to all of them. What that actually ruled out
 * was the workspace SWITCHER, and dropping the sidebar, the topbar, the account
 * menu and the breadcrumb along with it left the one page in the product you
 * could not navigate away from. `AdminShell` is the same chrome with a
 * different scope in it, exactly as `DocsShell` is.
 *
 * The layout is here rather than in each page so the sidebar keeps its state
 * across navigation instead of remounting, which is the same reason
 * `w.$wslug.tsx` mounts the app's.
 *
 * ## Who gets here
 *
 * `FIRSTRUN_ADMINS`, a list of GitHub logins, and nothing else. Being an admin
 * of every workspace on the box does not reach this area: administering a
 * workspace and operating the deployment are different questions with different
 * mechanisms (`docs` on `lib/admin.server.ts`).
 *
 * The loader gets `null` for anybody else and renders a not-found, so the area
 * does not confirm its own existence to somebody guessing at the URL. This
 * guard is what makes the pages unreachable; it is not what makes them safe.
 * Every loader below re-checks `requireInstanceAdmin` on the server, and every
 * write on the workspaces page checks it again.
 */
export const Route = createFileRoute("/admin")({
  loader: async () => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const context = await getAdminContext();
    if (!context) throw notFound();
    return { session, context };
  },
  component: AdminLayout,
});

function AdminLayout() {
  const data = Route.useLoaderData();
  return (
    <AdminShell session={data().session} context={data().context}>
      <Outlet />
    </AdminShell>
  );
}

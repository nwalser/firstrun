import { Link, createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { Dashboard } from "../components/dashboard.js";
import { shortDate } from "../components/format.js";
import { getSession, getWorkspace } from "../lib/api.js";

/**
 * The dashboard.
 *
 * One request loads the workspace, its sources, its layout and one snapshot
 * covering every widget on it -- the layout is known before any SQL runs, so
 * the queries are deduplicated up front rather than one per card.
 */
export const Route = createFileRoute("/w/$slug/")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspace({ data: params.slug });
    if (!view) throw notFound();
    return view;
  },
  component: WorkspaceDashboard,
});

function WorkspaceDashboard() {
  const view = Route.useLoaderData();

  return (
    <main class="wrap">
      <div class="page-head">
        <div>
          <h1>{view().workspace.name}</h1>
          <p class="meta">
            {shortDate(view().snapshot.from)} — {shortDate(new Date(view().snapshot.to.valueOf() - 864e5))}
            {" · "}
            <Link to="/w/$slug/sources" params={{ slug: view().workspace.slug }}>
              {view().sources.length} {view().sources.length === 1 ? "source" : "sources"}
            </Link>
          </p>
        </div>
      </div>

      <Show
        when={view().sources.length > 0}
        fallback={
          <div class="empty">
            <p>Nothing is sending events yet.</p>
            <Link
              class="btn"
              data-variant="primary"
              to="/w/$slug/sources"
              params={{ slug: view().workspace.slug }}
            >
              Add a source
            </Link>
          </div>
        }
      >
        <Dashboard
          slug={view().workspace.slug}
          layout={view().layout}
          snapshot={view().snapshot}
          sources={view().sources}
          canEdit={true}
        />
      </Show>
    </main>
  );
}

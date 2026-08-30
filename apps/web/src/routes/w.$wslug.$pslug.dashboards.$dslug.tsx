import { Link, createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import Plug from "lucide-solid/icons/plug";
import { Show } from "solid-js";
import { Dashboard } from "../components/dashboard.js";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
  buttonVariants,
} from "../components/ui/index.js";
import { getProject, getSession } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * One board, at its own address.
 *
 * The board is a path segment rather than a query parameter because it is a
 * place, not a setting: it is what somebody bookmarks, what they paste into a
 * chat, and what the back button should return them to. `?d=` said the opposite
 * (that a board is a modifier on the project page), and query strings get
 * dropped by every link shortener and share sheet that decides it knows better.
 *
 * The whole board arrives in one call: the project, its layout, and a single
 * snapshot covering every card on it. The layout is known before any SQL runs,
 * so the queries are deduplicated up front rather than one per widget.
 */
export const Route = createFileRoute("/w/$wslug/$pslug/dashboards/$dslug")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });

    const view = await getProject({
      data: { workspace: params.wslug, project: params.pslug, dashboard: params.dslug },
    });
    if (!view) throw notFound();

    // The server falls back to the default board when the slug names nothing,
    // which is right for `getProject` and wrong for a URL: silently showing a
    // different board than the address asks for is how somebody sends a link to
    // the wrong numbers. Send them to the board's real address instead.
    if (view.dashboard.slug !== params.dslug) {
      throw redirect({
        to: "/w/$wslug/$pslug/dashboards/$dslug",
        params: { wslug: params.wslug, pslug: params.pslug, dslug: view.dashboard.slug },
        replace: true,
      });
    }

    return view;
  },
  component: BoardView,
});

function BoardView() {
  const i18n = useI18n();
  const view = Route.useLoaderData();

  return (
    // Vertical padding only. The shell's grid already supplies the 24px page
    // margin as a column, so padding here would double it -- and the canvas
    // bleeds by one gutter on top of that, which is what put the board ten
    // pixels left of every other page's content.
    <main class="py-6">
      <Show
        when={view().sources.length > 0}
        fallback={
          <Empty>
            <EmptyMedia>
              <Plug />
            </EmptyMedia>
            <EmptyTitle>{i18n.t("boards.no_sources")}</EmptyTitle>
            <EmptyDescription>{i18n.t("boards.no_sources_hint")}</EmptyDescription>
            <EmptyContent>
              <Link
                to="/w/$wslug/$pslug/sources/new"
                params={{ wslug: view().workspace.slug, pslug: view().project.slug }}
                class={buttonVariants({ size: "sm" })}
              >
                {i18n.t("boards.add_source")}
              </Link>
            </EmptyContent>
          </Empty>
        }
      >
        <Dashboard
          workspaceSlug={view().workspace.slug}
          projectSlug={view().project.slug}
          dashboardId={view().dashboard.id}
          layout={view().layout}
          snapshot={view().snapshot}
          sources={view().sources}
          discovery={view().discovery}
          canEdit={view().role === "admin"}
        />
      </Show>
    </main>
  );
}

import { Outlet, createFileRoute } from "@tanstack/solid-router";

/**
 * The sources area: the list, and the page that adds one.
 *
 * A pass-through with nothing of its own, because adding a source is a page
 * rather than a drawer over the list -- it is four decisions and a snippet to
 * paste, and none of that fits beside the thing it is about to change. The
 * project route above has already loaded everything either child needs.
 */
export const Route = createFileRoute("/w/$wslug/$pslug/sources")({
  component: () => <Outlet />,
});

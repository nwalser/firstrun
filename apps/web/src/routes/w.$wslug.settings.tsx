import { Outlet, createFileRoute } from "@tanstack/solid-router";

/**
 * The workspace settings area.
 *
 * A pass-through with nothing of its own, the same shape as the sources area.
 *
 * Settings used to be ONE page carrying four cards, with the sidebar pane
 * listing anchors into it. An anchor is not navigation: the pane's rows
 * scrolled the page rather than changing it, so the back button did not step
 * between them, a shared link landed on the whole page rather than the part it
 * was about, and the pane had no active row to mark because every section was
 * always on screen. Each card that is a page now has a page.
 *
 * Only what needs its own address gets one. General is `settings.index`;
 * Projects is beside it. People is NOT here -- membership is per workspace and
 * `/w/$wslug/members` is already that page, so the pane points there rather
 * than at a second copy that could disagree with it.
 */
export const Route = createFileRoute("/w/$wslug/settings")({
  component: () => <Outlet />,
});

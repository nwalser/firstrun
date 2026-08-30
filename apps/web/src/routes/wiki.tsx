import { Outlet, createFileRoute } from "@tanstack/solid-router";
import { WikiShell } from "../components/wiki/shell.js";
import { getSession, getWikiContext } from "../lib/api.js";

/**
 * The wiki, and the one thing every page in it shares.
 *
 * Public. There is no guard here and there must not be one: the install guide
 * is the page somebody reads while deciding whether to sign up, and a redirect
 * to /login is a redirect out of the documentation. The session is read for
 * chrome only -- an avatar and a link back into the app when there is one, a
 * sign-in button when there is not.
 *
 * `getWikiContext()` never denies either: signed out it answers with no sources
 * and a real public origin, so the snippets fall back to placeholders instead
 * of the page falling over.
 *
 * The shell is mounted here rather than per page so the chosen source survives
 * navigation inside the wiki without a remount -- the localStorage read happens
 * once, on mount, not on every page.
 */
export const Route = createFileRoute("/wiki")({
  /**
   * `?source=<id>` on any wiki URL preselects that source.
   *
   * Declared on the layout rather than on `/wiki/$topic` so a link from inside
   * the app can point at the overview or at a page, and so the reading side is
   * one place instead of one per page. Children inherit it, which is what keeps
   * `<Link to="/wiki/$topic" search={{ source }}>` typed.
   *
   * Anything that is not a string is dropped rather than rejected: a stray
   * query parameter must not be able to 404 the documentation.
   *
   * The return type is annotated with `source` **optional**, not
   * `string | undefined`. A required key -- even one that may be undefined --
   * makes the router demand `search` on every `<Link to="/wiki">` in the app,
   * which is twenty type errors and a parameter nobody wanted to pass.
   */
  validateSearch: (search: Record<string, unknown>): { source?: string } =>
    typeof search.source === "string" && search.source ? { source: search.source } : {},
  loader: async () => {
    const [session, context] = await Promise.all([getSession(), getWikiContext()]);
    return { session, context };
  },
  component: WikiLayout,
});

function WikiLayout() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  return (
    <WikiShell
      session={data().session}
      context={data().context}
      requestedSourceId={search().source ?? null}
    >
      <Outlet />
    </WikiShell>
  );
}

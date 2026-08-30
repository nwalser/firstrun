/**
 * Where the scope switchers land.
 *
 * Switching scope keeps you on the same PAGE. Picking a project while looking
 * at the workspace's sources takes you to that project's sources, not to its
 * overview; going back up takes you to the workspace's sources again. That is
 * the reference's behaviour (`docs/vercel-structure.md` section 20, where every
 * account-level page has a project-level twin) and it is the difference between
 * a scope switcher and a link home: a switcher that always lands on the
 * overview makes you re-navigate after every switch, which is most of the
 * reason people stop using one.
 *
 * Three shapes of page, and the section table below says which is which:
 *
 *  - **Twinned.** Sources and Settings exist at both scopes as two routes.
 *    Switching scope changes the route.
 *  - **Filtered.** Events and Usage are ONE workspace-wide page that narrows to
 *    a project through a search param. Switching scope changes the filter, not
 *    the address: the log is workspace-wide by nature, and a link somebody
 *    shares keeps meaning what it said.
 *  - **Unpaired.** Members is workspace-only and a board is project-only.
 *    Switching to the scope that has no counterpart falls back to that scope's
 *    overview, which is the honest answer rather than a dead row.
 *
 * This is pure: it reads a path and returns a destination, so it can be used by
 * the topbar switcher, the sidebar's back arrow and anything else that moves
 * between scopes without any of them re-deriving the rules.
 */

/** The sections that mean something at more than one scope. */
export type ScopeSection = "overview" | "sources" | "events" | "usage" | "members" | "settings";

/**
 * A destination, as a typed navigation rather than a string.
 *
 * The router's `to` is a literal union, so a hand-built path would have to be
 * cast to be navigable. A union of the shapes it can actually be keeps the
 * params checked against the route that uses them.
 */
export type ScopeTarget =
  | { to: "/w/$wslug"; params: { wslug: string } }
  | { to: "/w/$wslug/sources"; params: { wslug: string } }
  | { to: "/w/$wslug/members"; params: { wslug: string } }
  | { to: "/w/$wslug/settings"; params: { wslug: string } }
  | { to: "/w/$wslug/events"; params: { wslug: string }; search: { project?: string } }
  | { to: "/w/$wslug/usage"; params: { wslug: string }; search: { project?: string } }
  | { to: "/w/$wslug/$pslug"; params: { wslug: string; pslug: string } }
  | { to: "/w/$wslug/$pslug/sources"; params: { wslug: string; pslug: string } }
  | { to: "/w/$wslug/$pslug/settings"; params: { wslug: string; pslug: string } };

/**
 * Which section a path is in, at whichever scope it is in.
 *
 * The project slugs are needed rather than optional: `/w/acme/members` and
 * `/w/acme/themia` have the same shape, and only the workspace's own list can
 * tell a static section from a project. Same rule the shell uses to decide
 * whether it is at project scope at all.
 *
 * Anything unrecognised -- a board, a create flow, a page added later -- is
 * `overview`, so a switch from it lands somewhere real instead of 404ing.
 */
export function sectionOf(path: string, projectSlugs: readonly string[]): ScopeSection {
  const seg = path.split("/").filter(Boolean);
  if (seg[0] !== "w" || seg.length < 2) return "overview";

  // At project scope the section is one segment further along.
  const at = seg[2] !== undefined && projectSlugs.includes(seg[2]) ? seg[3] : seg[2];

  switch (at) {
    case "sources":
      return "sources";
    case "events":
      return "events";
    case "usage":
      return "usage";
    case "members":
      return "members";
    case "settings":
      return "settings";
    default:
      return "overview";
  }
}

/**
 * The same section, at the given scope.
 *
 * `project` null means workspace scope. A section with no counterpart at the
 * requested scope falls back to that scope's overview rather than to a route
 * that does not exist.
 */
export function scopeTarget(
  section: ScopeSection,
  workspace: string,
  project: string | null
): ScopeTarget {
  if (project === null) {
    switch (section) {
      case "sources":
        return { to: "/w/$wslug/sources", params: { wslug: workspace } };
      case "events":
        return { to: "/w/$wslug/events", params: { wslug: workspace }, search: {} };
      case "usage":
        return { to: "/w/$wslug/usage", params: { wslug: workspace }, search: {} };
      case "members":
        return { to: "/w/$wslug/members", params: { wslug: workspace } };
      case "settings":
        return { to: "/w/$wslug/settings", params: { wslug: workspace } };
      default:
        return { to: "/w/$wslug", params: { wslug: workspace } };
    }
  }

  switch (section) {
    case "sources":
      return { to: "/w/$wslug/$pslug/sources", params: { wslug: workspace, pslug: project } };
    case "settings":
      return { to: "/w/$wslug/$pslug/settings", params: { wslug: workspace, pslug: project } };
    case "events":
      return { to: "/w/$wslug/events", params: { wslug: workspace }, search: { project } };
    case "usage":
      return { to: "/w/$wslug/usage", params: { wslug: workspace }, search: { project } };
    // Membership is per workspace and covers every project in it, so there is
    // nothing narrower to show. The project's overview is where somebody
    // switching INTO a project wanted to be anyway.
    case "members":
    default:
      return { to: "/w/$wslug/$pslug", params: { wslug: workspace, pslug: project } };
  }
}

/**
 * A target as the href an anchor needs.
 *
 * The switchers render real links -- a scope row has to be middle-clickable and
 * copyable -- and only intercept the click to navigate on the client. So every
 * target has to be spellable as a path, which is this.
 */
export function scopeHref(target: ScopeTarget): string {
  const path = target.to
    .replace("$wslug", target.params.wslug)
    .replace("$pslug", "pslug" in target.params ? target.params.pslug : "");

  const project = "search" in target ? target.search.project : undefined;
  return project ? `${path}?project=${encodeURIComponent(project)}` : path;
}

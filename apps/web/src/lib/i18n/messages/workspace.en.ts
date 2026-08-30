import type { Namespaced } from "./namespace.js";

/**
 * The workspace overview and the workspace create flow.
 *
 * `routes/new.tsx` and `routes/w.$wslug.index.tsx`. The sidebar's own workspace
 * switcher is `shell`, which is why "Workspaces" is not here.
 */
export const workspace = {
  // Creating one. This is also the product's page-level empty state: an account
  // with no workspace is redirected here.
  "workspace.new": "New workspace",
  "workspace.new_hint":
    "A workspace is who: the people who can see things, and the projects they can see. Each " +
    "product inside it gets its own project.",
  "workspace.create": "Create workspace",
  "workspace.name_label": "Workspace name",
  // The sentence ends at the address, which is a mono-set path rather than a
  // word, so the value is markup and cannot live in the key. Terminal in both
  // languages: German puts the address last as well.
  "workspace.address_prefix": "Its address will be",

  // The overview.
  "workspace.overview": "Overview",
  "workspace.projects": "Projects",
  "workspace.projects_hint": "One project per product. Every surface it ships on reports into it.",
  "workspace.search_placeholder": "Search projects…",
  "workspace.search_label": "Search projects",
  "workspace.count_of": "{shown} of {total}",

  // The filter row. One value per facet, so a chip names its facet as well as
  // its value.
  "workspace.add_filter": "Add filter",
  "workspace.remove_filter": "Remove the {facet} filter",
  "workspace.facet_activity": "Activity",
  "workspace.facet_sources": "Sources",
  "workspace.facet_receiving": "Receiving",
  "workspace.facet_quiet": "Quiet",
  "workspace.facet_silent": "Nothing yet",
  "workspace.facet_connected": "Connected",

  // The toolbar. `sort_by` takes the field as a variable rather than being
  // built from two pieces: lower-casing a German noun to fit it into a sentence
  // is wrong, and that is what the English version used to do.
  "workspace.sort_by": "Sort by {field}",
  "workspace.sort_activity": "Last activity",
  "workspace.sort_name": "Name",
  "workspace.view_list": "List view",
  "workspace.view_grid": "Grid view",
  "workspace.add_new": "Add New",

  // The list, and what it says when there is nothing in it.
  "workspace.no_matches": "No project here matches what you are filtering by.",
  "workspace.no_projects": "No projects yet",
  "workspace.no_projects_hint":
    "One project per product. Your site and your app both go inside it, as sources.",
  "workspace.create_first": "Create the first one",

  // What a project row says. Lower case where it is a fragment in a caption
  // rather than a label.
  "workspace.sources_one": "{count} source",
  "workspace.sources_other": "{count} sources",
  "workspace.nothing_yet": "nothing yet",
  "workspace.projects_one": "{count} project",
  "workspace.projects_other": "{count} projects",

  /*
    The unit under the headline rate, and only the unit.

    The number is drawn separately, at its own size, so this carries no
    placeholder. Not a plural family either: a rate is a ratio, and "1
    event/hour" would be selected by the count of a number that is almost never
    a whole one.
  */
  "workspace.per_hour_unit": "events/hour",

  // The thirty-day histogram. The chart itself carries no axis and no labels,
  // so this is the whole of what a screen reader gets from it: the total, and
  // the window it covers.
  "workspace.ingest_30d_one": "{count} event in the last 30 days",
  "workspace.ingest_30d_other": "{count} events in the last 30 days",

  // The rail.
  "workspace.activity": "Activity",
  "workspace.people": "People",
  "workspace.manage": "Manage",
  "workspace.role_admin": "Admin",
  "workspace.role_read": "Read",
} satisfies Namespaced<"workspace">;

export type WorkspaceMessages = typeof workspace;

import type { Namespaced } from "./namespace.js";

/**
 * The board routes: opening one, and creating one.
 *
 * What a board *contains* is the `dashboard` namespace. The split follows the
 * files: these are the strings the route puts on the page around the canvas.
 *
 * The create page says "dashboard" where the sidebar says "board". That is the
 * English copy as it stands, and a translation sweep is the wrong moment to
 * unify it, so both words are here and the German follows each one.
 */
export const boards = {
  "boards.title": "Boards",
  "boards.new": "New board",
  "boards.create": "Create board",
  "boards.name_label": "Board name",
  "boards.rename": "Rename board",
  "boards.delete": "Delete board",
  "boards.delete_confirm": "Delete “{name}”? The widgets on it go with it.",
  "boards.empty": "This board is empty",
  "boards.empty_hint": "Add a widget to start measuring.",
  "boards.widgets_one": "{count} widget",
  "boards.widgets_other": "{count} widgets",

  // Creating one.
  "boards.new_dashboard": "New dashboard",
  "boards.create_dashboard": "Create dashboard",
  "boards.admin_only": "Only an admin of this workspace can add a dashboard.",
  "boards.new_hint":
    "Another arrangement of {name}'s events, with its own range, its own comparison, and its " +
    "own permanent filters. Nothing here is shared with the boards you already have.",
  "boards.address_prefix": "Its address will be",
  "boards.name_placeholder": "Marketing site",
  "boards.start_from": "Start from",
  "boards.start_from_hint":
    "Every card is one you could have placed by hand, and every one of them moves. The sketch " +
    "is the arrangement you will get.",

  // A board with nothing reporting into its project.
  "boards.no_sources": "Nothing is sending events yet",
  "boards.no_sources_hint":
    "A source is one thing that reports in: your site, your app, or your backend. They all " +
    "belong in this project, so their numbers sit side by side on one board.",
  "boards.add_source": "Add a source",
} satisfies Namespaced<"boards">;

export type BoardsMessages = typeof boards;

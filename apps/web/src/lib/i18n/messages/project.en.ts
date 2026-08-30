import type { Namespaced } from "./namespace.js";

/** The project shell, the project overview and the project create flow. */
export const project = {
  // Creating one.
  "project.new": "New project",
  "project.new_hint": "One project per product, in {workspace}.",
  "project.create": "Create project",
  "project.name_label": "Project name",
  "project.admin_only": "Only an admin of this workspace can create a project.",
  "project.address_prefix": "Its address will be",
  "project.start_from": "Start from",
  "project.start_from_hint":
    "The first board. Every project gets more later, and none of this is permanent.",

  // The callout that must not be skimmed. One key per paragraph: the English
  // emphasised three words in the middle of each, and a sentence split around
  // markup cannot be reordered into German.
  "project.callout_title": "One product, not one platform",
  "project.callout_body":
    "A project is one product. Every surface of it reports in here as its own source, so your " +
    "marketing site, your desktop app and your backend belong in this one project. That is what " +
    "puts their numbers next to each other on one board instead of on three you have to compare " +
    "by hand.",
  "project.callout_second":
    "A second project is for a second product. Splitting one product across two of them does " +
    "not lose anything, but no board can ever show both halves at once, and every comparison " +
    "between them becomes a thing somebody does by hand.",
  "project.chip_website": "Website",
  "project.chip_desktop": "Desktop app",
  "project.chip_backend": "Backend",
  "project.chip_one_board": "one board",

  // The overview's toolbar. The baseline is stated on screen because a delta
  // whose baseline is unstated is a number nobody can check.
  "project.against": "against {range}",
  "project.sources": "Sources",
  "project.open_board": "Open {name}",

  // Nothing reporting yet.
  "project.no_sources": "Nothing is sending events yet",
  "project.no_sources_hint":
    "A source is one thing that reports in: your site, your app, or your backend. They all " +
    "belong in this project, so their numbers sit side by side.",
  "project.add_source": "Add a source",

  // The seven cards.
  "project.card_events": "Events",
  "project.card_status": "Status",
  "project.card_uniques": "Uniques",
  "project.card_uniques_hint": "One id space per surface. Never summed across them.",
  "project.card_errors": "Errors",
  "project.card_errors_hint": "Events at severity 17 and above.",
  "project.card_names": "What is being sent",
  "project.card_names_hint": "By event name, most first.",
  "project.card_sources": "Sources",
  "project.card_sources_hint": "Each one is its own anonymous id space.",
  "project.card_boards": "Boards",
  "project.card_boards_hint": "Where the questions you arranged live.",
  "project.new_board": "New",
  "project.never_seen": "never seen",
  "project.no_boards":
    "No boards yet. One is made the first time somebody opens this project's dashboards.",

  // The status card. "Is this thing alive", in four facts.
  "project.fact_reporting": "Reporting",
  "project.fact_last_event": "Last event",
  "project.fact_sources": "Sources",
  "project.fact_boards": "Boards",
  "project.status_silent": "Nothing received",
  "project.status_quiet": "Quiet",
  "project.status_receiving": "Receiving",

  "project.open": "Open project",
  "project.no_events": "No events yet",
  "project.no_events_hint": "Add a source and send your first event.",
  "project.events_one": "{count} event",
  "project.events_other": "{count} events",
} satisfies Namespaced<"project">;

export type ProjectMessages = typeof project;

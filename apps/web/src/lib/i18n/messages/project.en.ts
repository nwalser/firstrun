import type { Namespaced } from "./namespace.js";

/** The project shell, the project overview and the project create flow. */
export const project = {
  // Creating one.
  "project.new": "New project",
  "project.new_hint": "One project per product, in {workspace}.",
  "project.create": "Create project",
  "project.name_label": "Project name",
  "project.name_hint":
    "One product. Your website, your desktop app and your backend all report in here, which " +
    "is what puts their numbers on one board. Nothing else is created with it.",
  "project.admin_only": "Only an admin of this workspace can create a project.",

  // The quickstart. Every step is checked against what exists, so the list is
  // never wrong about what is left and never has to be dismissed.
  "project.quickstart": "Finish setting this up",
  "project.quickstart_hint":
    "Nothing was created for you. These are the steps, each on the page that does it properly.",
  "project.quickstart_progress": "{done} of {total}",
  "project.step_done": "Done",
  "project.step_source": "Add a source",
  "project.step_source_hint":
    "One thing that reports in: your site, your app, or your backend. You get its key here.",
  "project.step_install": "Install it and send an event",
  "project.step_install_hint":
    "Paste the snippet into your own software. This ticks when the first event arrives.",
  "project.step_install_action": "Open sources",
  "project.step_board": "Make a board",
  "project.step_board_hint":
    "An arrangement of saved questions, with its own range and, if you like, one source it is " +
    "about.",
  "project.step_board_action": "New board",

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
  "project.card_uniques_hint": "One id space per source. Never summed across them.",
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
  "project.no_boards": "No boards yet. Make one when you know what you want to watch.",

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

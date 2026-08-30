import type { Namespaced } from "./namespace.js";

/** The source list, the source create flow, and the install handover beside it. */
export const sources = {
  "sources.title": "Sources",
  "sources.new": "New source",
  "sources.create": "Create source",
  "sources.name_label": "Source name",
  // What the filter row narrows by. It used to be the surface; sources have no
  // type, and activity is the question a source list is opened to ask.
  // The unit under the headline rate, matching the project rows exactly: the
  // two lists are read against each other, so they cannot word it differently.
  "sources.per_hour_unit": "events/hour",
  "sources.facet_activity": "Activity",
  "sources.facet_receiving": "Receiving",
  "sources.facet_quiet": "Quiet",
  "sources.facet_never": "Never seen",
  // "Ingest key" rather than "Source key": it is what every screen in this area
  // actually says, and one product should not have two names for one value on
  // one page.
  "sources.key_label": "Ingest key",
  "sources.key_hint": "Public by necessity. It names a destination and authorises nothing.",
  "sources.copy_key": "Copy ingest key",
  "sources.created_on": "Created {date}",
  "sources.last_seen": "Last seen {when}",
  "sources.seen": "seen {when}",
  "sources.never_seen": "never seen",
  "sources.sources_one": "{count} source",
  "sources.sources_other": "{count} sources",

  // The list page.
  "sources.list_hint":
    "Everything reporting into this project. Each source is its own anonymous id space: the " +
    "same human on your site and in your app counts as two, which is the honest answer rather " +
    "than a bug.",
  "sources.add_filter": "Add filter",
  "sources.remove_filter": "Remove the {facet} filter",
  "sources.sort_by": "Sort by {field}",
  "sources.sort_activity": "Last seen",
  "sources.sort_name": "Name",
  "sources.search_placeholder": "Search sources…",
  "sources.search_label": "Search sources",
  "sources.add": "Add source",
  "sources.count_of": "{shown} of {total}",
  "sources.no_matches": "No source here matches that search.",
  "sources.none_yet": "No sources yet",
  "sources.none_yet_hint":
    "Add your site and your app here, in this one project. They are two sources, not two " +
    "projects, and their numbers sit side by side on one board.",

  /*
   * The workspace-wide list.
   *
   * The same page one scope up: every source in every project, so "what is
   * reporting into this workspace at all" is one page rather than one page per
   * project. It says which project each source belongs to, because at this
   * scope that is the first thing a reader needs.
   */
  "sources.workspace_hint":
    "Everything reporting into this workspace, across every project. Each source is its own " +
    "anonymous id space, and two sources are never joined to each other: the same human on " +
    "your site and in your app counts as two.",
  "sources.project_label": "Project",
  "sources.all_projects": "All projects",
  "sources.sort_volume": "Volume",
  "sources.ingest_30d_one": "{count} event in the last 30 days",
  "sources.ingest_30d_other": "{count} events in the last 30 days",
  "sources.open_project": "Open {name}",
  "sources.none_in_workspace": "No sources in this workspace",
  "sources.none_in_workspace_hint":
    "A source is one thing that writes events: a site, an app, a server. Open a project to " +
    "add one, and it starts reporting the moment it is installed.",
  "sources.open_projects": "Open projects",

  // The empty state's options: one card per kind the create flow can make.
  "sources.option_web_title": "Website",
  "sources.option_web_body":
    "Pages, sessions, referrers, campaigns and Core Web Vitals, measured for you by the tag. " +
    "Anything else is a track() call you write.",
  "sources.option_web_action": "Add a website",
  "sources.option_desktop_title": "Desktop app",
  "sources.option_desktop_body":
    "Versions, retention and what people do once it is running. The queue is on disk, so " +
    "events written offline arrive at the next launch.",
  "sources.option_desktop_action": "Add a desktop app",

  // A row's actions. Every one of these is an accessible name, a tooltip, or
  // both, which is why they read as sentences rather than as labels.
  "sources.how_to_install": "How to install {name}",
  "sources.guide_hint": "Opens with this source selected, so every snippet carries its key",
  "sources.remove_source": "Remove {name}",
  "sources.remove_source_title": "Remove this source",
  "sources.remove_confirm_title": "Remove {name}?",
  "sources.remove_confirm_hint":
    "Its key stops being accepted immediately, so anything still running against it goes " +
    "quiet. The events it already sent stay: they belong to the project.",
  "sources.remove_action": "Remove source",
  "sources.clipboard_failed": "Could not reach the clipboard. Select the key and copy it.",

  // The create flow: four steps, the last one after creation.
  "sources.admin_only": "Only an admin of this workspace can add a source.",
  "sources.step_details": "Details",
  "sources.step_dashboard": "Dashboard",
  "sources.step_install": "Install",
  "sources.step_details_title": "Name it",
  "sources.step_details_hint": "Only ever shown to you and the people in this workspace.",
  "sources.asset_label": "Application name",
  "sources.asset_hint":
    "Optional. Used in the install guide snippets so they arrive naming your app. Nothing " +
    "sent by a client refers to it.",
  "sources.step_board_title": "Start it with a board",
  "sources.step_board_hint":
    "An arrangement of cards, added alongside the ones this project already has. You can " +
    "rearrange or delete it later.",
  "sources.want_board": "Create a dashboard for this source",
  "sources.want_board_hint":
    "Off if you would rather arrange one yourself, or already have the board you want.",
  "sources.template_label": "Template",
  "sources.template_hint": "Only the boards worth building out of what this kind of source sends.",
  "sources.continue": "Continue",
  "sources.ready": "{name} is ready",
  "sources.ready_hint":
    "Nothing arrives until something sends it. Next: install it, which is five steps in the " +
    "documentation with this key already substituted into every snippet.",

  // The handover into the documentation. One summary, because a source has no
  // type left to write a different sentence for.
  "sources.install_guide": "Installation guide",
  /*
   * One source, on its own page.
   *
   * A list answers "when was it last seen". This answers "is it sending what I
   * think it is", which needs the shape of its month, its own vocabulary, and
   * the last few entries in full.
   */
  "sources.detail_hint":
    "What this source has been sending, over the last thirty days. Everything here is measured " +
    "the same way a card on a board is, filtered to this one source.",
  "sources.back_to_list": "Back to sources",
  "sources.open_source": "Open {name}",
  "sources.activity": "Activity",
  "sources.what_it_sends": "What it sends",
  "sources.severity_mix": "Severity",
  "sources.open_log": "See them all",
  "sources.nothing_sent": "Nothing in this window.",

  // A heading and two buttons. The paragraph that used to sit between them
  // explained what the buttons say, on a page about a source.
  "sources.install_title": "Install it",
  "sources.open_guide": "Guides",
  "sources.open_api": "HTTP API",
} satisfies Namespaced<"sources">;

export type SourcesMessages = typeof sources;

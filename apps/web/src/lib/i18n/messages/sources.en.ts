import type { Namespaced } from "./namespace.js";

/** The source list, the source create flow, and the install handover beside it. */
export const sources = {
  "sources.title": "Sources",
  "sources.new": "New source",
  "sources.create": "Create source",
  "sources.name_label": "Source name",
  "sources.surface_label": "Surface",
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
  "sources.remove_filter": "Remove the {surface} filter",
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
  "sources.ingest_30d_one": "{count} entry in the last 30 days",
  "sources.ingest_30d_other": "{count} entries in the last 30 days",
  "sources.thirty_days": "30 days",
  "sources.open_project": "Open {name}",
  "sources.none_in_workspace": "No sources in this workspace",
  "sources.none_in_workspace_hint":
    "A source is one thing that writes entries: a site, an app, a server. Open a project to " +
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
    "entries written offline arrive at the next launch.",
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
    "quiet. The entries it already sent stay: they belong to the project.",
  "sources.remove_action": "Remove source",
  "sources.clipboard_failed": "Could not reach the clipboard. Select the key and copy it.",

  // The create flow: four steps, the last one after creation.
  "sources.admin_only": "Only an admin of this workspace can add a source.",
  "sources.step_type": "Type",
  "sources.step_details": "Details",
  "sources.step_dashboard": "Dashboard",
  "sources.step_install": "Install",
  "sources.step_type_title": "What is sending events?",
  "sources.step_type_hint":
    "Every surface of one product belongs in this one project, so its numbers sit on one " +
    "board. Add the site now and the app after, or the other way round.",
  "sources.kind_web": "Website",
  "sources.kind_web_hint":
    "Pages, sessions, referrers, campaigns and Core Web Vitals, measured for you. Anything " +
    "else is a track() call you write.",
  "sources.kind_desktop": "Desktop app",
  "sources.kind_desktop_hint":
    "Versions, retention and what people do once it is running. The queue is on disk, so " +
    "events written offline arrive at the next launch.",
  "sources.step_details_title": "Name it",
  "sources.step_details_hint": "Only ever shown to you and the people in this workspace.",
  "sources.name_placeholder_desktop": "Themia for Windows",
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
    "wiki with this key already substituted into every snippet.",

  // The handover into the wiki, one summary per surface.
  //
  // The `other` surface's key is `summary_generic`, not `summary_other`. A key
  // ending in an `Intl.PluralRules` category is read as a member of a plural
  // family, so `sources.summary_other` would leave the type as the `other` form
  // of a `sources.summary` plural and stop being callable on its own. Nothing
  // catches that at the call site; it fails as a missing key on the type.
  "sources.install_guide": "Installation guide",
  "sources.install_title": "How to install it",
  "sources.open_guide": "Open the step-by-step guide",
  "sources.guide_note": "Opens with this source selected, so every snippet already carries its key.",
  "sources.summary_web":
    "Add the tag, gate it behind your consent banner, and call track() for anything you want " +
    "counted. Page views, sessions, outbound clicks and Core Web Vitals are measured for you.",
  "sources.summary_desktop":
    "Add the crate, start it once at launch, then track() and identify(). The queue is on " +
    "disk, so events written while the machine is offline arrive at the next launch.",
  "sources.summary_server":
    "Add the package, construct the client from an environment variable, and pass your own " +
    "distinct id on every call. Nothing is awaited and nothing throws into your request path.",
  "sources.summary_mobile":
    "No first-party mobile client yet. Send batches to POST /v1/e yourself, or point an " +
    "existing client at this host: the wire format is the same for every surface.",
  "sources.summary_generic":
    "Anything that can make an HTTPS request can report. Send batches to POST /v1/e with your " +
    "source key and a distinct id you generate once per install.",
} satisfies Namespaced<"sources">;

export type SourcesMessages = typeof sources;

import type { Namespaced } from "./namespace.js";

/** Workspace settings, project settings, and the settings shell around both. */
export const settings = {
  "settings.title": "Settings",
  "settings.sections": "Sections",
  "settings.general": "General",
  "settings.saved": "Saved.",
  "settings.name_hint": "The name is also the URL.",
  "settings.renamed_to": "Renamed to {name}.",
  "settings.deleted": "Deleted {name}.",
  "settings.needs_admin": "You need admin access",

  "settings.danger_zone": "Danger zone",
  "settings.danger_zone_hint": "Nothing here can be undone.",
  "settings.delete_warning": "This cannot be undone.",

  // The workspace page.
  "settings.workspace_title": "Workspace settings",
  "settings.workspace_description":
    "A workspace holds people and projects. Who can see them, and what they are called.",
  // Two halves of one sentence, with the slug rendered in the mono face between
  // them. The split is a last resort and it is safe here only because both
  // languages put the path in the same place: verb, colon, path, consequence.
  "settings.workspace_rename_lead": "Renaming re-slugs the workspace:",
  "settings.workspace_rename_tail":
    "changes with it, and any link or bookmark to the old one stops working. You will land on " +
    "the new URL.",
  "settings.workspace_needs_admin":
    "Settings change what everyone in the workspace sees, so they are limited to admins. Ask one " +
    "of them to change what you need, or to make you an admin.",
  "settings.back_to_projects": "Back to projects",

  "settings.projects_description":
    "One product each. Everything that product ships on reports in as its own source, onto the same " +
    "boards.",
  "settings.no_projects": "No projects yet",
  "settings.no_projects_hint": "A project owns events, identity and a dashboard.",
  "settings.create_project": "Create one",

  "settings.people_description":
    "Membership is per workspace: everyone here can see every project in it.",
  "settings.manage_people": "Manage people",
  "settings.people_one": "{count} person",
  "settings.people_other": "{count} people",

  "settings.delete_workspace": "Delete workspace",
  "settings.delete_workspace_heading": "Delete this workspace",
  "settings.delete_workspace_hint":
    "Every project in it, and with each project every event, every person and every dashboard. " +
    "Permanently: the rows are deleted, not hidden.",
  "settings.delete_workspace_title": "Delete {name}?",
  // The count is the number of projects. The people figure that used to sit in
  // this sentence is gone: a second count in one string cannot be pluralised by
  // the family this key belongs to, and "all 1 people" was already wrong.
  "settings.delete_workspace_confirm_one":
    "This deletes {count} project and everything inside it: every event, every source, every " +
    "dashboard, and access for everyone in the workspace. There is no undo and no export.",
  "settings.delete_workspace_confirm_other":
    "This deletes {count} projects and everything inside them: every event, every source, every " +
    "dashboard, and access for everyone in the workspace. There is no undo and no export.",

  // The project page.
  "settings.project_title": "Project settings",
  "settings.project_description": "{project} in {workspace}. One product, one set of people.",
  "settings.project_rename_lead": "Renaming re-slugs the project:",
  "settings.project_rename_tail":
    "changes with it, and existing links stop resolving. Source keys are unaffected. Nothing " +
    "your app or website sends refers to the slug.",
  "settings.project_needs_admin":
    "Renaming a project changes its URL for everyone, and its ingest keys let anything post " +
    "events into it. Both are limited to admins. Ask one of them, or ask to be made one.",
  "settings.back_to_dashboard": "Back to the dashboard",

  "settings.sources_description":
    "Everything sending events into this project. Each one is its own anonymous id space, " +
    "reported side by side on the same boards.",
  "settings.add_source": "Add a source",
  "settings.no_sources": "Nothing is sending events yet",
  "settings.no_sources_hint": "Add your website and your app as two sources in this one project.",
  "settings.ingest_key": "Ingest key",
  "settings.remove_source": "Remove source",
  "settings.remove_source_title": "Remove {name}?",
  "settings.remove_source_hint":
    "Its ingest key stops working immediately, so anything still using it is rejected. Events it " +
    "has already sent stay: they belong to the project, not to the source.",
  "settings.source_removed": "Removed {name}.",

  "settings.last_event_never": "No events received yet.",
  "settings.last_event_today": "Last event today.",
  "settings.last_event_yesterday": "Last event yesterday.",
  "settings.last_event_days_one": "Last event {count} day ago.",
  "settings.last_event_days_other": "Last event {count} days ago.",
  "settings.last_event_on": "Last event {date}.",

  "settings.delete_project": "Delete project",
  "settings.delete_project_heading": "Delete this project",
  "settings.delete_project_hint_one":
    "This deletes everything the project owns: every event, every dashboard, and its {count} " +
    "source. Permanently.",
  "settings.delete_project_hint_other":
    "This deletes everything the project owns: every event, every dashboard, and all {count} " +
    "sources. Permanently.",
  "settings.delete_project_title": "Delete {name}?",
  "settings.delete_project_confirm_one":
    "Everything keyed to this project goes with it: its events, its dashboards, and its {count} " +
    "source. A source added later starts empty. None of it can be rebuilt from anything we keep.",
  "settings.delete_project_confirm_other":
    "Everything keyed to this project goes with it: its events, its dashboards, and its {count} " +
    "sources. A source added later starts empty. None of it can be rebuilt from anything we keep.",

  // The logo field. Shared by the workspace page and the project page, but its
  // strings belong to settings rather than to a namespace of its own. Only the
  // "where does this show up" sentence differs between the two.
  "settings.logo": "Logo",
  "settings.logo_hint": "PNG, JPEG or WebP. Resized to {size}px before it is uploaded.",
  "settings.logo_saved_hint":
    "Saved as soon as you choose one. Save below is for the name. Shown in the sidebar and the " +
    "workspace switcher, and stored in the database rather than on disk: deploys replace the " +
    "filesystem, and a logo that vanishes on the next release is worse than no logo.",
  "settings.project_logo": "Project image",
  "settings.project_logo_saved_hint":
    "Saved as soon as you choose one. Save above is for the name. Shown wherever this project " +
    "is listed, and stored in the database rather than on disk, for the same reason a workspace " +
    "logo is: deploys replace the filesystem.",
  "settings.logo_alt": "{name} logo",
  "settings.logo_drop": "Drop an image, or click to choose",
  "settings.logo_drop_replacement": "Drop a replacement, or click to choose",
  "settings.logo_updated": "Logo updated.",
  "settings.logo_removed": "Logo removed.",
  "settings.logo_too_large": "Still {size} after downscaling. The limit is {limit}.",
  "settings.logo_svg_rejected":
    "SVG is not accepted. We serve the logo from our own origin, and an SVG can carry script. " +
    "Use a PNG, JPEG or WebP.",
  // Two keys rather than one with a "That file" fallback interpolated into it:
  // a noun phrase substituted into a sentence is a fragment, and German would
  // need it in a case the English never states.
  "settings.logo_type_rejected": "{type} is not an image we can use. Use a PNG, JPEG or WebP.",
  "settings.logo_file_rejected":
    "That file is not an image we can use. Use a PNG, JPEG or WebP.",
  "settings.logo_save_failed": "That did not save.",
} satisfies Namespaced<"settings">;

export type SettingsMessages = typeof settings;

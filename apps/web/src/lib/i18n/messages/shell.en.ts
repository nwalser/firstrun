import type { Namespaced } from "./namespace.js";

/**
 * The sidebar, the topbar, the two switchers and the user menu.
 *
 * Complete: every string the app shell puts on the screen is here. It is the
 * worked example the other namespaces are filled in against.
 */
export const shell = {
  "shell.switch_workspace": "Switch workspace",
  "shell.switch_project": "Switch project",
  "shell.workspaces": "Workspaces",
  "shell.no_workspaces": "No workspaces, yet!",
  "shell.new_workspace": "New workspace",
  "shell.new_workspace_hint": "Collaborate with others on their own projects",
  "shell.find_workspace": "Find workspace…",
  "shell.find_project": "Find project…",
  "shell.find": "Find",
  "shell.find_placeholder": "Find…",
  "shell.no_results": "No results",
  "shell.all_projects": "All projects",
  "shell.back_to_workspace": "Back to workspace view",
  "shell.breadcrumb": "Breadcrumb",
  "shell.sources": "Sources",
  "shell.boards": "Boards",
  "shell.new_board": "New board",
  "shell.reorder_hint": "Alt+Up / Alt+Down to reorder",

  /*
   * The board row's own menu, and the delete it guards.
   *
   * These say "board" and belong to the sidebar rather than to the `boards`
   * namespace, which another area owns. A shared string that is not in the
   * frozen `common` namespace goes in the namespace of whoever renders it: two
   * catalogue entries reading "Board löschen" cost nothing.
   */
  "shell.duplicate": "Duplicate",
  "shell.board_options": "{name} options",
  "shell.delete_board": "Delete board",
  "shell.delete_board_named": "Delete {name}",
  "shell.delete_board_title": "Delete {name}?",
  "shell.delete_board_description":
    "The board and its arrangement go with it. The events do not: they belong to the project, and every other board still counts them.",
  "shell.general": "General",
  "shell.members_one": "{count} member",
  "shell.members_other": "{count} members",
  "shell.projects": "Projects",
  "shell.no_project_selected": "No project selected",
  "shell.no_projects_yet": "No projects yet",
  "shell.new_project": "New project",
  "shell.workspace": "Workspace",
  "shell.overview": "Overview",
  "shell.people": "People",
  "shell.settings": "Settings",
  "shell.help": "Help",
  "shell.documentation": "Documentation",
  "shell.sign_out": "Sign out",
} satisfies Namespaced<"shell">;

export type ShellMessages = typeof shell;

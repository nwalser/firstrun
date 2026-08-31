import type { ShellMessages } from "./shell.en.js";

/**
 * "Workspace" and "firstrun" stay as they are. The first is the word this
 * product uses in its own URLs and in every other tool a customer has open, and
 * "Arbeitsbereich" would be a translation of a proper noun. The second is a
 * brand.
 */
export const shell: ShellMessages = {
  "shell.switch_workspace": "Workspace wechseln",
  "shell.switch_project": "Projekt wechseln",
  "shell.workspaces": "Workspaces",
  "shell.no_workspaces": "Noch keine Workspaces",
  "shell.new_workspace": "Neuer Workspace",
  "shell.new_workspace_hint": "Gemeinsam an eigenen Projekten arbeiten",
  "shell.find_workspace": "Workspace suchen…",
  "shell.find_project": "Projekt suchen…",
  "shell.find": "Suchen",
  "shell.find_placeholder": "Suchen…",
  "shell.no_results": "Keine Ergebnisse",
  "shell.all_projects": "Alle Projekte",
  "shell.back_to_workspace": "Zurück zur Workspace-Ansicht",
  "shell.breadcrumb": "Navigationspfad",
  "shell.sources": "Quellen",
  "shell.events": "Events",
  "shell.usage": "Usage",
  "shell.boards": "Boards",
  "shell.new_board": "Neues Board",
  "shell.reorder_hint": "Alt+Auf / Alt+Ab zum Umsortieren",

  "shell.duplicate": "Duplizieren",
  "shell.board_options": "Optionen für {name}",
  "shell.delete_board": "Board löschen",
  "shell.delete_board_named": "{name} löschen",
  "shell.delete_board_title": "{name} löschen?",
  "shell.delete_board_description":
    "Das Board und seine Anordnung gehen mit. Die Events nicht: sie gehören zum Projekt, und jedes andere Board zählt sie weiterhin.",
  "shell.general": "Allgemein",
  "shell.members_one": "{count} Mitglied",
  "shell.members_other": "{count} Mitglieder",
  "shell.projects": "Projekte",
  "shell.no_project_selected": "Kein Projekt ausgewählt",
  "shell.no_projects_yet": "Noch keine Projekte",
  "shell.new_project": "Neues Projekt",
  "shell.workspace": "Workspace",
  "shell.overview": "Übersicht",
  "shell.people": "Personen",
  "shell.settings": "Einstellungen",
  "shell.notifications": "Benachrichtigungen",
  "shell.no_notifications": "Noch nichts zu melden",
  "shell.help": "Hilfe",
  "shell.documentation": "Dokumentation",
  "shell.sign_out": "Abmelden",
  "shell.project": "Projekt",
  "shell.account": "Konto",
};

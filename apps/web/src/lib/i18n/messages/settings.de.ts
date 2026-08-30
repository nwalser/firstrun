import type { SettingsMessages } from "./settings.en.js";

/**
 * "Workspace", "Board", "Dashboard", "Event", "Source Key" and "Ingest-Key"
 * stay English: they are the product's own names for things, and a customer
 * who has read the docs or talked to support is looking for that exact word.
 * "Surface" especially, because "Oberflaeche" means the visual surface of a UI
 * and the column holds the opposite of that.
 *
 * The two delete confirmations are plural families on the number of projects
 * and the number of sources, because German needs a different verb form as
 * well as a different noun: "wird ... geloescht" against "werden ... geloescht".
 */
export const settings: SettingsMessages = {
  "settings.title": "Einstellungen",
  "settings.sections": "Abschnitte",
  "settings.general": "Allgemein",
  "settings.saved": "Gespeichert.",
  "settings.name_hint": "Der Name ist zugleich die URL.",
  "settings.renamed_to": "Umbenannt in {name}.",
  "settings.deleted": "{name} gelöscht.",
  "settings.needs_admin": "Sie benötigen Admin-Rechte",

  "settings.danger_zone": "Gefahrenbereich",
  "settings.danger_zone_hint": "Nichts davon lässt sich rückgängig machen.",
  "settings.delete_warning": "Das lässt sich nicht rückgängig machen.",

  "settings.workspace_title": "Workspace-Einstellungen",
  "settings.workspace_description":
    "Ein Workspace enthält Personen und Projekte. Wer sie sehen darf und wie sie heißen.",
  "settings.workspace_rename_lead": "Beim Umbenennen erhält der Workspace einen neuen Slug:",
  "settings.workspace_rename_tail":
    "ändert sich mit, und jeder Link und jedes Lesezeichen auf die alte Adresse funktioniert " +
    "nicht mehr. Sie landen auf der neuen URL.",
  "settings.workspace_needs_admin":
    "Einstellungen ändern, was alle im Workspace sehen, deshalb sind sie Admins vorbehalten. " +
    "Bitten Sie einen Admin um die Änderung oder darum, Sie zum Admin zu machen.",
  "settings.back_to_projects": "Zurück zu den Projekten",

  "settings.projects_description":
    "Je ein Produkt. Jede Surface dieses Produkts meldet sich als eigene Quelle, auf denselben " +
    "Boards.",
  "settings.no_projects": "Noch keine Projekte",
  "settings.no_projects_hint": "Ein Projekt besitzt Events, Identität und ein Dashboard.",
  "settings.create_project": "Eines erstellen",

  "settings.people_description":
    "Mitgliedschaft gilt pro Workspace: Alle hier sehen jedes Projekt darin.",
  "settings.manage_people": "Personen verwalten",
  "settings.people_one": "{count} Person",
  "settings.people_other": "{count} Personen",

  "settings.delete_workspace": "Workspace löschen",
  "settings.delete_workspace_heading": "Diesen Workspace löschen",
  "settings.delete_workspace_hint":
    "Jedes Projekt darin und mit jedem Projekt jedes Event, jede Person und jedes Dashboard. " +
    "Endgültig: Die Zeilen werden gelöscht, nicht ausgeblendet.",
  "settings.delete_workspace_title": "{name} löschen?",
  "settings.delete_workspace_confirm_one":
    "Damit wird {count} Projekt gelöscht und alles darin: jedes Event, jede Quelle, jedes " +
    "Dashboard und der Zugriff für alle im Workspace. Es gibt kein Zurück und keinen Export.",
  "settings.delete_workspace_confirm_other":
    "Damit werden {count} Projekte gelöscht und alles darin: jedes Event, jede Quelle, jedes " +
    "Dashboard und der Zugriff für alle im Workspace. Es gibt kein Zurück und keinen Export.",

  "settings.project_title": "Projekteinstellungen",
  "settings.project_description": "{project} in {workspace}. Ein Produkt, ein Kreis von Personen.",
  "settings.project_rename_lead": "Beim Umbenennen erhält das Projekt einen neuen Slug:",
  "settings.project_rename_tail":
    "ändert sich mit, und bestehende Links laufen ins Leere. Source Keys bleiben davon " +
    "unberührt. Nichts, was Ihre App oder Ihre Website sendet, bezieht sich auf den Slug.",
  "settings.project_needs_admin":
    "Ein Projekt umzubenennen ändert seine URL für alle, und mit seinen Ingest-Keys kann alles " +
    "Events hineinschreiben. Beides ist Admins vorbehalten. Bitten Sie einen Admin darum oder " +
    "darum, Sie zum Admin zu machen.",
  "settings.back_to_dashboard": "Zurück zum Dashboard",

  "settings.sources_description":
    "Alles, was Events in dieses Projekt sendet. Jede Quelle ist ein eigener anonymer ID-Raum " +
    "und wird auf denselben Boards nebeneinander gezeigt.",
  "settings.add_source": "Quelle hinzufügen",
  "settings.no_sources": "Noch sendet nichts Events",
  "settings.no_sources_hint":
    "Fügen Sie Ihre Website und Ihre App als zwei Quellen in dieses eine Projekt ein.",
  "settings.ingest_key": "Ingest-Key",
  "settings.remove_source": "Quelle entfernen",
  "settings.remove_source_title": "{name} entfernen?",
  "settings.remove_source_hint":
    "Ihr Ingest-Key funktioniert sofort nicht mehr, alles, was ihn noch verwendet, wird " +
    "abgewiesen. Bereits gesendete Events bleiben: Sie gehören dem Projekt, nicht der Quelle.",
  "settings.source_removed": "{name} entfernt.",

  "settings.last_event_never": "Noch keine Events empfangen.",
  "settings.last_event_today": "Letztes Event heute.",
  "settings.last_event_yesterday": "Letztes Event gestern.",
  "settings.last_event_days_one": "Letztes Event vor {count} Tag.",
  "settings.last_event_days_other": "Letztes Event vor {count} Tagen.",
  "settings.last_event_on": "Letztes Event am {date}.",

  "settings.delete_project": "Projekt löschen",
  "settings.delete_project_heading": "Dieses Projekt löschen",
  "settings.delete_project_hint_one":
    "Damit wird alles gelöscht, was das Projekt besitzt: jedes Event, jedes Dashboard und seine " +
    "{count} Quelle. Endgültig.",
  "settings.delete_project_hint_other":
    "Damit wird alles gelöscht, was das Projekt besitzt: jedes Event, jedes Dashboard und alle " +
    "{count} Quellen. Endgültig.",
  "settings.delete_project_title": "{name} löschen?",
  "settings.delete_project_confirm_one":
    "Alles, was an diesem Projekt hängt, geht mit: seine Events, seine Dashboards und seine " +
    "{count} Quelle. Eine später hinzugefügte Quelle beginnt leer. Nichts davon lässt sich aus " +
    "dem wiederherstellen, was wir aufbewahren.",
  "settings.delete_project_confirm_other":
    "Alles, was an diesem Projekt hängt, geht mit: seine Events, seine Dashboards und seine " +
    "{count} Quellen. Eine später hinzugefügte Quelle beginnt leer. Nichts davon lässt sich aus " +
    "dem wiederherstellen, was wir aufbewahren.",

  "settings.logo": "Logo",
  "settings.logo_hint": "PNG, JPEG oder WebP. Wird vor dem Hochladen auf {size} px verkleinert.",
  "settings.logo_saved_hint":
    "Wird gespeichert, sobald Sie eines auswählen. Speichern unten gilt dem Namen. Erscheint in " +
    "der Seitenleiste und im Workspace-Umschalter und liegt in der Datenbank statt auf der " +
    "Festplatte: Deploys ersetzen das Dateisystem, und ein Logo, das beim nächsten Release " +
    "verschwindet, ist schlechter als gar kein Logo.",
  "settings.logo_alt": "Logo von {name}",
  "settings.logo_drop": "Bild hierher ziehen oder klicken, um eines zu wählen",
  "settings.logo_drop_replacement": "Ersatz hierher ziehen oder klicken, um einen zu wählen",
  "settings.logo_updated": "Logo aktualisiert.",
  "settings.logo_removed": "Logo entfernt.",
  "settings.logo_too_large": "Nach dem Verkleinern immer noch {size}. Das Limit liegt bei {limit}.",
  "settings.logo_svg_rejected":
    "SVG wird nicht angenommen. Wir liefern das Logo von unserer eigenen Origin aus, und ein SVG " +
    "kann Skript enthalten. Verwenden Sie PNG, JPEG oder WebP.",
  "settings.logo_type_rejected":
    "{type} ist kein Bildformat, das wir verwenden können. Verwenden Sie PNG, JPEG oder WebP.",
  "settings.logo_file_rejected":
    "Diese Datei ist kein Bildformat, das wir verwenden können. Verwenden Sie PNG, JPEG oder " +
    "WebP.",
  "settings.logo_save_failed": "Das wurde nicht gespeichert.",
};

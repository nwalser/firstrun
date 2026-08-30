import type { WorkspaceMessages } from "./workspace.en.js";

/**
 * "Workspace" stays English: it is the product's own word for the thing, it is
 * what the sidebar's switcher is called, and "Arbeitsbereich" is the word
 * nobody would search for. It is a noun in a German sentence, so it keeps its
 * capital and takes a hyphen in a compound.
 */
export const workspace: WorkspaceMessages = {
  "workspace.new": "Neuer Workspace",
  "workspace.new_hint":
    "Ein Workspace ist das Wer: die Personen, die etwas sehen können, und die Projekte, die " +
    "sie sehen. Jedes Produkt darin bekommt sein eigenes Projekt.",
  "workspace.create": "Workspace erstellen",
  "workspace.name_label": "Name des Workspace",
  "workspace.address_prefix": "Die Adresse lautet",

  "workspace.overview": "Übersicht",
  "workspace.projects": "Projekte",
  "workspace.projects_hint":
    "Ein Projekt pro Produkt. Jede Surface, auf der es ausgeliefert wird, meldet hierher.",
  "workspace.search_placeholder": "Projekte durchsuchen…",
  "workspace.search_label": "Projekte durchsuchen",
  "workspace.count_of": "{shown} von {total}",

  "workspace.add_filter": "Filter hinzufügen",
  "workspace.remove_filter": "Filter {facet} entfernen",
  "workspace.facet_activity": "Aktivität",
  "workspace.facet_sources": "Quellen",
  "workspace.facet_receiving": "Empfängt",
  "workspace.facet_quiet": "Ruhig",
  "workspace.facet_silent": "Noch nichts",
  "workspace.facet_connected": "Verbunden",

  "workspace.sort_by": "Sortieren nach {field}",
  "workspace.sort_activity": "Letzte Aktivität",
  "workspace.sort_name": "Name",
  "workspace.view_list": "Listenansicht",
  "workspace.view_grid": "Rasteransicht",
  "workspace.add_new": "Hinzufügen",

  "workspace.no_matches": "Kein Projekt hier entspricht Ihren Filtern.",
  "workspace.no_projects": "Noch keine Projekte",
  "workspace.no_projects_hint":
    "Ein Projekt pro Produkt. Ihre Website und Ihre App gehören beide hinein, als Quellen.",
  "workspace.create_first": "Das erste erstellen",

  "workspace.sources_one": "{count} Quelle",
  "workspace.sources_other": "{count} Quellen",
  "workspace.nothing_yet": "noch nichts",
  // Both forms are "{count} Projekt"/"{count} Projekte" by coincidence of the
  // noun, not by copy-paste: `Intl.PluralRules` asks for the category it chose.
  "workspace.projects_one": "{count} Projekt",
  "workspace.projects_other": "{count} Projekte",

  // "Std." rather than "Stunde": this sits under a name in a row and the
  // abbreviation is what a German reader expects in a caption that tight.
  "workspace.per_hour": "{rate} Einträge/Std.",

  "workspace.ingest_30d_one": "{count} Eintrag in den letzten 30 Tagen",
  "workspace.ingest_30d_other": "{count} Einträge in den letzten 30 Tagen",

  "workspace.activity": "Aktivität",
  "workspace.people": "Personen",
  "workspace.manage": "Verwalten",
  // "Admin" is the role's name in the product and in the schema. "Read" is a
  // label rather than a name, so it is translated.
  "workspace.role_admin": "Admin",
  "workspace.role_read": "Lesen",
};

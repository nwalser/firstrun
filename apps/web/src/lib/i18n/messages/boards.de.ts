import type { BoardsMessages } from "./boards.en.js";

/**
 * "Board", "Dashboard", "Widget" and "Event" stay English. All four are what
 * this product calls the things on its own screens, and "Tafel" or
 * "Steuerelement" would be a translation nobody would recognise in the sidebar
 * next to them.
 *
 * The quotation marks around a name are the German ones. „…“ is not decoration:
 * "…" in the middle of a German sentence reads as a typo.
 */
export const boards: BoardsMessages = {
  "boards.title": "Boards",
  "boards.new": "Neues Board",
  "boards.create": "Board erstellen",
  "boards.name_label": "Name des Boards",
  "boards.rename": "Board umbenennen",
  "boards.delete": "Board löschen",
  "boards.delete_confirm": "„{name}“ löschen? Die Widgets darauf werden mitgelöscht.",
  "boards.empty": "Dieses Board ist leer",
  "boards.empty_hint": "Fügen Sie ein Widget hinzu, um zu messen.",
  "boards.widgets_one": "{count} Widget",
  "boards.widgets_other": "{count} Widgets",

  "boards.new_dashboard": "Neues Dashboard",
  "boards.create_dashboard": "Dashboard erstellen",
  "boards.admin_only": "Nur ein Admin dieses Workspace kann ein Dashboard hinzufügen.",
  "boards.new_hint":
    "Eine weitere Anordnung der Events von {name}, mit eigenem Zeitraum, eigenem Vergleich und " +
    "eigenen dauerhaften Filtern. Nichts davon wird mit den Boards geteilt, die Sie bereits " +
    "haben.",
  "boards.address_prefix": "Die Adresse lautet",
  "boards.name_placeholder": "Marketing-Website",
  "boards.start_from": "Startpunkt",
  "boards.start_from_hint":
    "Jede Karte ist eine, die Sie auch von Hand hätten platzieren können, und jede lässt sich " +
    "verschieben. Die Skizze zeigt die Anordnung, die Sie bekommen.",

  "boards.no_sources": "Noch sendet nichts Events",
  "boards.no_sources_hint":
    "Eine Quelle ist eine Sache, die meldet: Ihre Website, Ihre App oder Ihr Backend. Sie alle " +
    "gehören in dieses Projekt, damit ihre Zahlen auf einem Board nebeneinanderstehen.",
  "boards.add_source": "Quelle hinzufügen",
};

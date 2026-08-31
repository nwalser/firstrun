import type { ProjectMessages } from "./project.en.js";

/**
 * "Uniques", "Board", "Event" and "Backend" stay English. They are
 * the words the schema, the clients' documentation and every other screen use,
 * and a reader who has one of those open is looking for that exact word.
 */
export const project: ProjectMessages = {
  "project.new": "Neues Projekt",
  "project.new_hint": "Ein Projekt pro Produkt, in {workspace}.",
  "project.create": "Projekt erstellen",
  "project.name_label": "Name des Projekts",
  "project.name_hint":
    "Ein Produkt. Ihre Website, Ihre Desktop-App und Ihr Backend melden sich alle hier, und " +
    "genau das stellt ihre Zahlen auf ein Board. Sonst wird nichts mit angelegt.",
  "project.admin_only": "Nur ein Admin dieses Workspace kann ein Projekt erstellen.",

  "project.quickstart": "Einrichtung abschließen",
  "project.quickstart_hint":
    "Es wurde nichts für Sie angelegt. Das sind die Schritte, jeder auf der Seite, die ihn " +
    "vollständig erledigt.",
  "project.quickstart_progress": "{done} von {total}",
  "project.step_done": "Erledigt",
  "project.step_source": "Quelle hinzufügen",
  "project.step_source_hint":
    "Eine Sache, die meldet: Ihre Website, Ihre App oder Ihr Backend. Den Key bekommen Sie dort.",
  "project.step_install": "Installieren und ein Event senden",
  "project.step_install_hint":
    "Snippet in Ihre eigene Software einsetzen. Hakt ab, sobald das erste Event ankommt.",
  "project.step_install_action": "Quellen öffnen",
  "project.step_board": "Board anlegen",
  "project.step_board_hint":
    "Eine Anordnung gespeicherter Fragen, mit eigenem Zeitraum und, wenn Sie mögen, genau " +
    "einer Quelle, um die es geht.",
  "project.step_board_action": "Neues Board",

  "project.against": "gegenüber {range}",
  "project.sources": "Quellen",
  "project.open_board": "{name} öffnen",

  "project.no_sources": "Noch sendet nichts Events",
  "project.no_sources_hint":
    "Eine Quelle ist eine Sache, die meldet: Ihre Website, Ihre App oder Ihr Backend. Sie alle " +
    "gehören in dieses Projekt, damit ihre Zahlen nebeneinanderstehen.",
  "project.add_source": "Quelle hinzufügen",

  "project.card_events": "Events",
  "project.card_status": "Status",
  "project.card_uniques": "Uniques",
  "project.card_uniques_hint":
    "Ein ID-Raum pro Quelle. Wird nie über Quellen hinweg summiert.",
  "project.card_errors": "Fehler",
  "project.card_errors_hint": "Events mit Severity 17 und höher.",
  "project.card_names": "Was gesendet wird",
  "project.card_names_hint": "Nach Name des Events, häufigste zuerst.",
  "project.card_sources": "Quellen",
  "project.card_sources_hint": "Jede ist ihr eigener anonymer ID-Raum.",
  "project.card_boards": "Boards",
  "project.card_boards_hint": "Wo die Fragen leben, die Sie angeordnet haben.",
  "project.new_board": "Neu",
  "project.never_seen": "nie gesehen",
  "project.no_boards":
    "Noch keine Boards. Legen Sie eines an, wenn Sie wissen, was Sie beobachten wollen.",

  "project.fact_reporting": "Meldet",
  "project.fact_last_event": "Letztes Event",
  "project.fact_sources": "Quellen",
  "project.fact_boards": "Boards",
  "project.status_silent": "Nichts empfangen",
  "project.status_quiet": "Ruhig",
  "project.status_receiving": "Empfängt",

  "project.open": "Projekt öffnen",
  "project.no_events": "Noch keine Events",
  "project.no_events_hint": "Fügen Sie eine Quelle hinzu und senden Sie Ihr erstes Event.",
  "project.events_one": "{count} Event",
  "project.events_other": "{count} Events",
};

import type { ProjectMessages } from "./project.en.js";

/**
 * "Surface", "Uniques", "Board", "Event" and "Backend" stay English. They are
 * the words the schema, the clients' documentation and every other screen use,
 * and a reader who has one of those open is looking for that exact word.
 */
export const project: ProjectMessages = {
  "project.new": "Neues Projekt",
  "project.new_hint": "Ein Projekt pro Produkt, in {workspace}.",
  "project.create": "Projekt erstellen",
  "project.name_label": "Name des Projekts",
  "project.admin_only": "Nur ein Admin dieses Workspace kann ein Projekt erstellen.",
  "project.address_prefix": "Die Adresse lautet",
  "project.start_from": "Startpunkt",
  "project.start_from_hint":
    "Das erste Board. Jedes Projekt bekommt später weitere, und nichts davon ist endgültig.",

  "project.callout_title": "Ein Produkt, nicht eine Plattform",
  "project.callout_body":
    "Ein Projekt ist ein Produkt. Jede Surface davon meldet sich hier als eigene Quelle, " +
    "deshalb gehören Ihre Marketing-Website, Ihre Desktop-App und Ihr Backend in dieses eine " +
    "Projekt. Genau das stellt ihre Zahlen auf einem Board nebeneinander statt auf drei, die " +
    "Sie von Hand vergleichen müssen.",
  "project.callout_second":
    "Ein zweites Projekt ist für ein zweites Produkt. Ein Produkt auf zwei Projekte " +
    "aufzuteilen verliert nichts, aber kein Board kann jemals beide Hälften zugleich zeigen, " +
    "und jeder Vergleich zwischen ihnen wird zu Handarbeit.",
  "project.chip_website": "Website",
  "project.chip_desktop": "Desktop-App",
  "project.chip_backend": "Backend",
  "project.chip_one_board": "ein Board",

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
    "Ein ID-Raum pro Surface. Wird nie über Surfaces hinweg summiert.",
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
    "Noch keine Boards. Eines entsteht, sobald jemand die Dashboards dieses Projekts zum " +
    "ersten Mal öffnet.",

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

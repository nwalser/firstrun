import type { UsageMessages } from "./usage.en.js";

/**
 * "Usage" bleibt englisch: es ist der Name der Seite in der Referenz und in
 * jedem Werkzeug dieser Art. "Event" ebenso, und zwar als Neutrum: das Event,
 * die Events. Es ist dasselbe Wort wie im Events-Namespace, weil es dieselbe
 * Zeile in derselben Tabelle bezeichnet.
 */
export const usage: UsageMessages = {
  "usage.title": "Usage",
  "usage.hint":
    "Alles, was dieser Workspace aufgenommen hat. Ein Event ist eine Zeile: ein Fehler, ein " +
    "Seitenaufruf und eine Messung zählen je einmal, weil sie dieselbe Zeilenform in derselben " +
    "Tabelle haben.",

  "usage.window_days": "Letzte {days} Tage",
  "usage.window_label": "Zeitraum",
  "usage.group_label": "Aufschlüsseln",
  "usage.by_project": "Nach Projekt",
  "usage.by_source": "Nach Quelle",
  "usage.by_severity": "Nach Severity",
  "usage.project_label": "Projekt",
  "usage.all_projects": "Alle Projekte",
  "usage.remove_filter": "Filter {filter} entfernen",

  "usage.events": "Events",
  "usage.against": "gegenüber {range}",
  "usage.per_day": "Pro Tag",
  "usage.busiest_day": "Stärkster Tag",
  "usage.no_delta": "Keine Vergleichsbasis vorhanden",

  "usage.breakdown": "Verbrauch im Detail",
  "usage.daily": "Täglich",
  "usage.chart_label": "Events pro Tag, {count} insgesamt",
  "usage.col_name": "Name",
  "usage.col_events": "Events",
  "usage.col_share": "Anteil",
  "usage.col_change": "Änderung",
  "usage.other": "Alles Übrige",
  "usage.none": "In diesem Zeitraum nichts empfangen",
  "usage.none_hint":
    "Gezählt wird nach dem Zeitstempel des Events. Ein Client, der offline war, meldet also " +
    "auf die Tage, an denen er tatsächlich benutzt wurde. Wähle einen längeren Zeitraum.",
  "usage.open_project": "{name} öffnen",

  "usage.late_note":
    "Gezählt nach dem Zeitstempel des Events, nicht nach dem Eingang bei uns. Ein Client, der " +
    "einen Tag offline war, zählt auf den Tag seiner Nutzung: die letzten Tage füllen sich also " +
    "noch auf.",
};

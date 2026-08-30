import type { EventsMessages } from "./events.en.js";

/**
 * "Event" stays English, and keeps its capital: it is the word this product's
 * clients, its wire format and its documentation all use, and an English proper
 * term inside a German sentence is a noun. "Eintrag" is used for the ROW -- an
 * entry in the table -- which is the same distinction the English side draws
 * between what a client sends and what is stored.
 *
 * "Severity", "Client", "Source" and "Live" stay for the same reason: each one
 * names something the schema names.
 */
export const events: EventsMessages = {
  "events.title": "Events",
  "events.hint":
    "Jeder Eintrag, den dieser Workspace empfangen hat, neueste zuerst. Ein Fehler, ein " +
    "Seitenaufruf und eine Messung haben hier dieselbe Zeilenform, weil sie in der Tabelle " +
    "dieselbe Zeilenform haben.",

  "events.search_placeholder": "Name, Client-Id oder Nachricht suchen…",
  "events.search_label": "Einträge durchsuchen",
  "events.window_hours": "Letzte 24 Stunden",
  "events.window_days": "Letzte {days} Tage",
  "events.window_label": "Zeitraum",
  "events.project_label": "Projekt",
  "events.all_projects": "Alle Projekte",
  "events.severity_label": "Severity",
  "events.severity_any": "Jede Severity",
  "events.severity_min": "{band} und schlimmer",
  "events.remove_filter": "Filter {filter} entfernen",

  "events.live": "Live",
  "events.live_hint": "Alle paar Sekunden auf neue Einträge prüfen",
  "events.live_on": "Live. Neue Einträge erscheinen, sobald sie ankommen.",

  "events.col_time": "Zeit",
  "events.col_severity": "Severity",
  "events.col_project": "Projekt",
  "events.col_name": "Name",
  "events.col_client": "Client",
  "events.unclassified": "Nicht klassifiziert",
  "events.entries_one": "{count} Eintrag",
  "events.entries_other": "{count} Einträge",
  "events.load_older": "Ältere laden",
  "events.loading": "Wird geladen…",
  "events.none": "Noch nichts empfangen",
  "events.none_hint":
    "Einträge erscheinen hier, sobald irgendetwas einen sendet. Quelle anlegen, installieren, " +
    "und auf dieser Seite prüfen, ob es funktioniert hat.",
  "events.no_matches": "Kein Eintrag in diesem Zeitraum passt zu diesen Filtern.",
  "events.widen": "Längeren Zeitraum wählen oder einen Filter entfernen.",

  "events.show_detail": "Diesen Eintrag vollständig anzeigen",
  "events.hide_detail": "Diesen Eintrag ausblenden",
  "events.attributes": "Attribute",
  "events.no_attributes": "Dieser Eintrag trägt keine Attribute.",
  "events.entry_id": "Eintrags-Id",
  "events.client_id": "Client-Id",
  "events.source_label": "Quelle",

  "events.happened": "Passiert",
  "events.received": "Empfangen",
  "events.late_by": "{delay} verspätet angekommen",
  "events.late_hint":
    "Den Zeitstempel setzt der Client, der den Eintrag geschrieben hat. Eine Queue, die nach " +
    "dem Wiederhochfahren nachgeliefert wird, landet also an dem Tag, an dem es passiert ist, " +
    "und nicht heute.",
};

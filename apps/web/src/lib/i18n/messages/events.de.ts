import type { EventsMessages } from "./events.en.js";

/**
 * "Event" stays English, and keeps its capital: it is the word this product's
 * clients, its wire format and its documentation all use, and an English proper
 * term inside a German sentence is a noun. It is neuter -- DAS Event -- which is
 * what every article, pronoun and adjective ending in this file agrees with.
 *
 * There used to be a second word here. The German said "Eintrag" for the stored
 * row and "Event" for what a client sends, mirroring a distinction the English
 * side drew. The product now calls the row an event in both languages, so the
 * distinction is gone rather than translated: one thing with two names in the
 * same interface is a thing a reader has to work out is one thing.
 *
 * "Severity", "Client", "Source" and "Live" stay for the same reason as Event:
 * each one names something the schema names.
 */
export const events: EventsMessages = {
  "events.title": "Events",
  "events.hint":
    "Jedes Event, das dieser Workspace empfangen hat, neueste zuerst. Ein Fehler, ein " +
    "Seitenaufruf und eine Messung haben hier dieselbe Zeilenform, weil sie in der Tabelle " +
    "dieselbe Zeilenform haben.",

  "events.search_placeholder": "Name, Client-Id oder Nachricht suchen…",
  "events.search_label": "Events durchsuchen",
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
  "events.live_hint": "Alle paar Sekunden auf neue Events prüfen",
  "events.live_on": "Live. Neue Events erscheinen, sobald sie ankommen.",

  "events.col_time": "Zeit",
  "events.col_severity": "Severity",
  "events.col_project": "Projekt",
  "events.col_name": "Name",
  "events.col_client": "Client",
  "events.unclassified": "Nicht klassifiziert",
  "events.events_one": "{count} Event",
  "events.events_other": "{count} Events",
  "events.load_older": "Ältere laden",
  "events.loading": "Wird geladen…",
  "events.none": "Noch nichts empfangen",
  "events.none_hint":
    "Events erscheinen hier, sobald irgendetwas eines sendet. Quelle anlegen, installieren, " +
    "und auf dieser Seite prüfen, ob es funktioniert hat.",
  "events.no_matches": "Kein Event in diesem Zeitraum passt zu diesen Filtern.",
  "events.widen": "Längeren Zeitraum wählen oder einen Filter entfernen.",

  "events.show_detail": "Dieses Event vollständig anzeigen",
  "events.hide_detail": "Dieses Event ausblenden",
  "events.attributes": "Attribute",
  "events.no_attributes": "Dieses Event trägt keine Attribute.",
  "events.event_id": "Event-Id",
  "events.client_id": "Client-Id",
  "events.source_label": "Quelle",

  "events.open_event": "{name} öffnen",
  "events.detail_hint":
    "Ein Event, genau so, wie es geschrieben wurde. Den Zeitstempel setzt der Client: ein Event " +
    "von einem Rechner, der offline war, gehört zu dem Moment, in dem es passiert ist, nicht zu " +
    "dem, in dem wir davon erfahren haben.",
  "events.detail_facts": "Was es ist",
  "events.back_to_log": "Zurück zum Log",
  "events.related": "Alles Weitere",
  "events.same_name": "Weitere {name}-Events",
  "events.same_client": "Alles von diesem Client",
  "events.open_source": "Quelle öffnen",
  "events.one_source": "Diese Quelle",

  "events.happened": "Passiert",
  "events.received": "Empfangen",
  "events.late_by": "{delay} verspätet angekommen",
  "events.late_hint":
    "Den Zeitstempel setzt der Client, der das Event geschrieben hat. Eine Queue, die nach " +
    "dem Wiederhochfahren nachgeliefert wird, landet also an dem Tag, an dem es passiert ist, " +
    "und nicht heute.",
};

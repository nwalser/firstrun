import type { ExploreMessages } from "./explore.en.js";

/**
 * "Explore" stays as it is. It is the name of a place in this product, the way
 * "Dashboard" is, and a person who has read the documentation or talked to
 * support is looking for that word in the sidebar. "Erkunden" would be a verb
 * where the screen needs a name.
 *
 * "Severity" and "Uniques" stay for the same reason: both are the product's own
 * word for a thing with a definition written down (the 1..24 ladder, and the one
 * definition of a unique in CLAUDE.md). "Schweregrad" would read as a different
 * quantity to anybody who has seen the API.
 */
export const explore: ExploreMessages = {
  "explore.title": "Explore",
  "explore.run": "Ausführen",
  "explore.running": "Wird ausgeführt…",

  "explore.filter": "Filter",
  "explore.add_filter": "Filter hinzufügen",
  "explore.group_by": "Gruppieren nach",
  "explore.aggregate": "Aggregat",
  "explore.time_bucket": "Zeitraster",
  "explore.limit": "Limit",
  "explore.attribute_placeholder": "Attribut oder Spalte…",

  "explore.no_results": "Keine Events entsprechen dieser Abfrage",
  "explore.results_one": "{count} Gruppe",
  "explore.results_other": "{count} Gruppen",
  "explore.save_as_widget": "Als Widget speichern",

  "explore.column_time": "Zeit",
  "explore.column_name": "Name",
  "explore.column_severity": "Severity",
  "explore.column_distinct_id": "Client-ID",
  "explore.column_event_id": "Event-ID",
  "explore.column_ingested_at": "Empfangen am",

  "explore.field_unique": "Unique",
  "explore.field_unique_option": "Unique (User-ID, sonst Client-ID)",
  "explore.field_label": "Feld",
  "explore.field_placeholder": "Feld auswählen",
  "explore.field_custom": "Anderes Attribut…",

  "explore.agg_events": "Events",
  "explore.agg_uniques": "Uniques",
  "explore.agg_distinct_of": "Verschiedene {field}",
  "explore.agg_percentile_of": "p{p} {field}",
  "explore.agg_sum_of": "Summe von {field}",
  "explore.agg_avg_of": "Durchschnitt von {field}",
  "explore.agg_min_of": "Minimum von {field}",
  "explore.agg_max_of": "Maximum von {field}",

  "explore.fn_count": "Anzahl Events",
  "explore.fn_count_distinct": "Anzahl verschiedener",
  "explore.fn_sum": "Summe",
  "explore.fn_avg": "Durchschnitt",
  "explore.fn_min": "Minimum",
  "explore.fn_max": "Maximum",
  "explore.fn_percentile": "Perzentil",

  "explore.query_by": "{measure} nach {groups}",
  "explore.query_over_time": "{measure} im Zeitverlauf",

  "explore.op_eq": "ist",
  "explore.op_ne": "ist nicht",
  "explore.op_in": "ist eines von",
  "explore.op_not_in": "ist keines von",
  "explore.op_lt": "ist vor/kleiner als",
  "explore.op_lte": "ist höchstens",
  "explore.op_gt": "ist nach/größer als",
  "explore.op_gte": "ist mindestens",
  "explore.op_contains": "enthält",
  "explore.op_starts_with": "beginnt mit",
  "explore.op_ends_with": "endet mit",
  "explore.op_exists": "ist gesetzt",
  "explore.op_not_exists": "ist nicht gesetzt",

  "explore.bucket_none": "Kein Raster",
  "explore.bucket_minute": "Pro Minute",
  "explore.bucket_hour": "Pro Stunde",
  "explore.bucket_day": "Pro Tag",
  "explore.bucket_week": "Pro Woche",
  "explore.bucket_month": "Pro Monat",

  "explore.viz_number": "Einzelne Zahl",
  "explore.viz_line": "Linie",
  "explore.viz_bar": "Balken",
  "explore.viz_area": "Fläche",
  "explore.viz_table": "Tabelle",
  "explore.viz_list": "Rangliste",
  "explore.viz_label": "Visualisierung",

  "explore.viz_problem_number_series":
    "Eine einzelne Zahl kann keine Reihe zeigen. Entfernen Sie das Zeitraster.",
  "explore.viz_problem_number_groups":
    "Eine einzelne Zahl kann keine Gruppen zeigen. Entfernen Sie die Gruppierung.",
  "explore.viz_problem_chart_axis":
    "Ein Diagramm braucht ein Zeitraster oder eine Gruppierung, um eine Achse zu haben.",

  "explore.value_placeholder": "Wert",
  "explore.values_placeholder": "Ein Wert pro Zeile",
  "explore.operator_label": "Operator",

  "explore.all_of": "Alle davon",
  "explore.any_of": "Eines davon",
  "explore.no_constraint": "keine Einschränkung",
  "explore.matches_nothing": "trifft auf nichts zu",
  "explore.conditions_one": "{count} Bedingung",
  "explore.conditions_other": "{count} Bedingungen",
  "explore.remove_group": "Gruppe entfernen",
  "explore.remove_condition": "Bedingung entfernen",
  "explore.remove_measure": "Messgröße entfernen",
  "explore.add_condition": "Bedingung",
  "explore.add_group": "Gruppe",
  "explore.add_measure": "Messgröße",

  "explore.section_viz": "Darstellen als",
  "explore.section_measure": "Messgröße",
  "explore.section_measure_hint":
    "Anzahl Events, Anzahl verschiedener Uniques oder eine Zahl aus einem Attribut.",
  "explore.section_filter_hint": "Leer bedeutet keine Einschränkung, niemals nichts.",
  "explore.section_group_hint":
    "Eine Spalte oder ein Attributpfad. Jeder teilt die Antwort weiter auf.",
  "explore.section_bucket_hint":
    "Immer auf dem Zeitpunkt des Events, nie auf dem Zeitpunkt des Eingangs.",
  "explore.section_limit_hint":
    "Wie viele Gruppen zurückkommen. Die Rangfolge entscheidet, welche.",

  "explore.aggregation_label": "Aggregation",
  "explore.percentile": "Perzentil",
  "explore.bucket_timezone":
    "Dargestellt in {zone}. Ein Tag ist ein Tag dort, wo die Leser des Boards sind, nicht in UTC.",
  "explore.fill_label": "Leere Raster anzeigen",
  "explore.fill_hint":
    "Eine Linie, die ihre eigenen Lücken schließt, macht aus einem zweitägigen Ausfall eine " +
    "sanfte Steigung.",

  "explore.rows_one": "{count} Zeile",
  "explore.rows_other": "{count} Zeilen",

  "explore.nothing_title": "Es ist noch nichts angekommen",
  "explore.nothing_body":
    "In diesem Zeitraum gibt es keine Events, also gibt es nichts zu entdecken und nichts " +
    "zu filtern. Jeder Client hat dieselben fünf Aufrufe, und einer davon genügt: ein Event " +
    "ist ein Name, eine Severity und eine Attributkarte, und es ist abfragbar, sobald es " +
    "ankommt.",
  "explore.nothing_cta": "So senden Sie ein erstes Event",
  "explore.nothing_widen":
    "Erweitern Sie auch den Zeitraum: Events werden vom Client gestempelt, und eine App, " +
    "die offline war, meldet Tage nach, die sie bereits durchlebt hat.",
};

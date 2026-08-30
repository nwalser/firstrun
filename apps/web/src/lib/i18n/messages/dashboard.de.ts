import type { DashboardMessages } from "./dashboard.en.js";

/**
 * `dashboard.filters_one` and `dashboard.filters_other` are the same word.
 * That is not a copy-paste slip and it must not be collapsed into one key: the
 * plural form is chosen by `Intl.PluralRules`, which asks the catalogue for the
 * category it selected, and a family missing `one` would fall through to
 * `other` by accident rather than by design. German has plenty of nouns whose
 * plural is identical to the singular, and every one of them looks like a
 * mistake to somebody tidying up later.
 *
 * `dashboard.more_one` and `dashboard.more_other` are the same for the same
 * reason: "weitere" is the form after a bare number in both.
 *
 * `Board`, `Dashboard`, `Widget` and `Uniques` stay in English. They are the
 * product's own names for things, and a person who has read the documentation
 * or opened the API is looking for exactly those words.
 */
export const dashboard: DashboardMessages = {
  "dashboard.add_widget": "Widget hinzufügen",
  "dashboard.edit_widget": "Widget bearbeiten",
  "dashboard.duplicate_widget": "Widget duplizieren",
  "dashboard.remove_widget": "Widget entfernen",
  "dashboard.no_data": "Keine Daten in diesem Zeitraum",

  "dashboard.range": "Zeitraum",
  "dashboard.range_custom": "Benutzerdefiniert",
  "dashboard.compare": "Vergleich",
  "dashboard.compare_none": "Keiner",
  "dashboard.compare_previous": "Vorheriger Zeitraum",
  "dashboard.compare_year": "Vorjahreszeitraum",
  "dashboard.compare_custom": "Benutzerdefiniert",
  "dashboard.baseline": "ggü. {range}",

  "dashboard.filters": "Filter",
  "dashboard.filters_one": "{count} Filter",
  "dashboard.filters_other": "{count} Filter",

  "dashboard.entries": "Einträge",
  "dashboard.uniques": "Uniques",

  "dashboard.range_last_24h": "Letzte 24 Stunden",
  "dashboard.range_last_12m": "Letzte 12 Monate",
  "dashboard.range_last_days_one": "Letzter {count} Tag",
  "dashboard.range_last_days_other": "Letzte {count} Tage",
  "dashboard.range_hint": "Oder wählen Sie zwei Daten für ein festes Fenster.",
  "dashboard.window_span": "{from} bis {to}",

  // Dative, because "gegenüber" governs it: "ggü. vorherigem Zeitraum".
  "dashboard.baseline_previous": "vorherigem Zeitraum",
  "dashboard.baseline_year": "Vorjahreszeitraum",

  "dashboard.compared_with": "Verglichen mit",
  "dashboard.showing": "Angezeigt",
  "dashboard.baseline_nothing": "Nichts",

  "dashboard.filter_none": "Filter",
  "dashboard.window_and_baseline": "{range} · verglichen mit {baseline}",
  "dashboard.saved": "Gespeichert",
  "dashboard.add_card": "Karte hinzufügen",
  "dashboard.mode_group": "Board-Modus",
  "dashboard.mode_look": "Board ansehen",
  "dashboard.mode_arrange": "Board anordnen",

  "dashboard.palette_title": "Karte hinzufügen",
  "dashboard.palette_close": "Palette schließen",
  "dashboard.palette_hint":
    "Startpunkte, kein Katalog. Jeder davon ist eine gespeicherte Abfrage, die Sie danach " +
    "bearbeiten, und keiner kann etwas fragen, was der Builder nicht kann. Ziehen Sie eine " +
    "Karte an einer beliebigen Stelle, ziehen Sie an einer Kante, um die Größe zu ändern, " +
    "Pfeiltasten zum Verschieben (Shift für fünf Schritte, Alt für die Größe). Es wird " +
    "laufend gespeichert.",

  "dashboard.empty_title": "Noch nichts auf diesem Board",
  "dashboard.empty_body":
    "Eine Karte ist eine gespeicherte Abfrage und eine Art, ihre Antwort zu zeichnen. " +
    "Beginnen Sie mit einem der Startpunkte und ändern Sie, was er zählt, oder setzen Sie " +
    "eine leere Karte und bauen Sie die Frage selbst.",

  "dashboard.board_filter_title": "Board-Filter",
  "dashboard.board_filter_body":
    "Gilt für jede Karte auf diesem Board. Er gehört zum Board, überlebt also ein Neuladen " +
    "und reist mit einem Link mit, den jemand verschickt.",
  "dashboard.clear": "Zurücksetzen",

  "dashboard.card_settings": "Einstellungen",
  "dashboard.duplicate": "Duplizieren",
  "dashboard.bring_to_front": "In den Vordergrund",
  "dashboard.note_badge": "Notiz",
  "dashboard.setting_title": "Titel",
  "dashboard.setting_title_hint": "Leer lassen, um zu verwenden, was die Abfrage sagt.",
  "dashboard.setting_text": "Text",
  "dashboard.setting_text_hint": "Markdown wird nicht gerendert. Zeilenumbrüche bleiben erhalten.",
  "dashboard.show_change": "Veränderung anzeigen",
  "dashboard.show_change_hint":
    "Gegenüber dem Vergleichszeitraum des Boards, den die Zeitraumauswahl festlegt.",
  "dashboard.show_shape": "Tagesverlauf anzeigen",
  "dashboard.show_shape_hint":
    "Dieselbe Frage mit einem Zeitraster, ein Diagramm davon kostet also nichts extra.",

  "dashboard.not_set": "(nicht gesetzt)",
  "dashboard.nothing_measured": "In diesem Zeitraum wurde nichts gemessen.",
  "dashboard.no_entries": "Keine Einträge in diesem Zeitraum.",
  "dashboard.empty_note": "Eine leere Notiz. Ihr Text steht in den Einstellungen der Karte.",
  "dashboard.note_title": "Notiz",
  "dashboard.peak": "Spitze",
  "dashboard.all_entries": "Alle Einträge",
  "dashboard.more_one": "+{count} weitere",
  "dashboard.more_other": "+{count} weitere",

  "dashboard.preset_uniques": "Einzelne Zahl",
  "dashboard.preset_uniques_hint":
    "Wie viele verschiedene Personen oder Installationen etwas gesendet haben, mit der " +
    "Veränderung seit dem letzten Zeitraum.",
  "dashboard.preset_over_time": "Im Zeitverlauf",
  "dashboard.preset_over_time_hint":
    "Einträge pro Tag, gerastert danach, wann sie passiert sind, nicht wann sie ankamen.",
  "dashboard.preset_names": "Was gesendet wird",
  "dashboard.preset_names_hint":
    "Jeder Eintragsname im Zeitraum, nach Rang. Das Erste, was man in einem neuen Projekt " +
    "ansieht.",
  "dashboard.preset_errors": "Fehler im Zeitverlauf",
  "dashboard.preset_errors_hint":
    "Einträge ab ERROR oder schlimmer, pro Tag. Severity ist eine Zahl, also ist das ein " +
    "einziger Filter.",
  "dashboard.preset_exceptions": "Häufigste Exceptions",
  "dashboard.preset_exceptions_hint":
    "Welcher Exception-Typ am häufigsten geworfen wird und wie viele Personen er erreicht hat.",
  "dashboard.preset_pages": "Häufigste Seiten",
  "dashboard.preset_pages_hint":
    "Seitenaufrufe nach Pfad gruppiert, sortiert danach, wie viele Personen sie gesehen haben.",
  "dashboard.preset_referrers": "Woher die Leute kamen",
  "dashboard.preset_referrers_hint": "Der verweisende Host bei einem Seitenaufruf, nach Rang.",
  "dashboard.preset_vitals": "Web Vitals",
  "dashboard.preset_vitals_hint":
    "Jedes Core Web Vital am 75. Perzentil, mit der Zahl der Messwerte, auf denen es beruht.",
  "dashboard.preset_versions": "App-Versionen",
  "dashboard.preset_versions_hint":
    "Installationen pro Version Ihrer Software, sortiert danach, wie viele noch darauf sind.",
  "dashboard.preset_slow_routes": "Langsamste Routen",
  "dashboard.preset_slow_routes_hint":
    "Die Dauer am 95. Perzentil pro Route, damit sich eine langsame Anfrage nicht hinter " +
    "einem Mittelwert verstecken kann.",
  "dashboard.preset_note": "Notiz",
  "dashboard.preset_note_hint":
    "Eine Überschrift oder ein Vorbehalt. Die einzige Karte ohne Abfrage dahinter.",
};

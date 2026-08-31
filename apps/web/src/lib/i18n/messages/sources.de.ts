import type { SourcesMessages } from "./sources.en.js";

/**
 * "Ingest Key", "Source Key", "Snippet", "Queue", "Event" and "Core Web Vitals"
 * stay as well, and keep their capitals: an English proper term inside a German
 * sentence is a noun, and German nouns are capitalised. A compound with one
 * English half takes a hyphen: "Desktop-App", "track()-Aufruf".
 *
 * "Quelle" is the counter-case. It is a label rather than a name, so it is
 * translated, which is what the sidebar does too.
 */
export const sources: SourcesMessages = {
  "sources.title": "Quellen",
  "sources.new": "Neue Quelle",
  "sources.create": "Quelle erstellen",
  "sources.name_label": "Name der Quelle",
  "sources.per_hour_unit": "Events/Std.",
  "sources.facet_activity": "Aktivität",
  "sources.facet_receiving": "Empfängt",
  "sources.facet_quiet": "Ruhig",
  "sources.facet_never": "Nie gesehen",
  "sources.key_label": "Ingest Key",
  "sources.key_hint": "Notwendigerweise öffentlich. Er benennt ein Ziel und berechtigt zu nichts.",
  "sources.copy_key": "Ingest Key kopieren",
  "sources.created_on": "Erstellt am {date}",
  "sources.last_seen": "Zuletzt gesehen {when}",
  // The placeholder moves to the front: German puts the time before the
  // participle, which is exactly what a key with the whole sentence in it can
  // do and two glued fragments cannot.
  "sources.seen": "{when} gesehen",
  "sources.never_seen": "nie gesehen",
  "sources.sources_one": "{count} Quelle",
  "sources.sources_other": "{count} Quellen",

  "sources.list_hint":
    "Alles, was in dieses Projekt meldet. Jede Quelle ist ihr eigener anonymer ID-Raum: " +
    "derselbe Mensch auf Ihrer Website und in Ihrer App zählt zweimal, was die ehrliche " +
    "Antwort ist und kein Fehler.",
  "sources.add_filter": "Filter hinzufügen",
  "sources.remove_filter": "Filter {facet} entfernen",
  "sources.sort_by": "Sortieren nach {field}",
  "sources.sort_activity": "Zuletzt gesehen",
  "sources.sort_name": "Name",
  "sources.search_placeholder": "Quellen durchsuchen…",
  "sources.search_label": "Quellen durchsuchen",
  "sources.add": "Quelle hinzufügen",
  "sources.count_of": "{shown} von {total}",
  "sources.no_matches": "Keine Quelle hier entspricht dieser Suche.",
  "sources.none_yet": "Noch keine Quellen",
  "sources.none_yet_hint":
    "Fügen Sie Ihre Website und Ihre App hier hinzu, in diesem einen Projekt. Sie sind zwei " +
    "Quellen, nicht zwei Projekte, und ihre Zahlen stehen auf einem Board nebeneinander.",

  "sources.workspace_hint":
    "Alles, was in diesen Workspace meldet, über alle Projekte hinweg. Jede Quelle ist ihr " +
    "eigener anonymer Id-Raum, und zwei Quellen werden nie miteinander verknüpft: derselbe " +
    "Mensch auf der Website und in der App zählt zweimal.",
  "sources.project_label": "Projekt",
  "sources.all_projects": "Alle Projekte",
  "sources.sort_volume": "Volumen",
  "sources.ingest_30d_one": "{count} Event in den letzten 30 Tagen",
  "sources.ingest_30d_other": "{count} Events in den letzten 30 Tagen",
  "sources.open_project": "{name} öffnen",
  "sources.none_in_workspace": "Keine Quellen in diesem Workspace",
  "sources.none_in_workspace_hint":
    "Eine Quelle ist eine Sache, die Events schreibt: eine Website, eine App, ein Server. " +
    "Öffne ein Projekt, um eine anzulegen; sie meldet, sobald sie installiert ist.",
  "sources.open_projects": "Projekte öffnen",

  "sources.option_web_title": "Website",
  "sources.option_web_body":
    "Seiten, Sitzungen, Referrer, Kampagnen und Core Web Vitals, vom Tag für Sie gemessen. " +
    "Alles andere ist ein track()-Aufruf, den Sie schreiben.",
  "sources.option_web_action": "Website hinzufügen",
  "sources.option_desktop_title": "Desktop-App",
  "sources.option_desktop_body":
    "Versionen, Retention und was Menschen tun, sobald sie läuft. Die Queue liegt auf der " +
    "Festplatte, deshalb kommen offline geschriebene Events beim nächsten Start an.",
  "sources.option_desktop_action": "Desktop-App hinzufügen",

  "sources.how_to_install": "{name} installieren",
  "sources.guide_hint": "Öffnet mit dieser Quelle ausgewählt, sodass jedes Snippet ihren Key trägt",
  "sources.remove_source": "{name} entfernen",
  "sources.remove_source_title": "Diese Quelle entfernen",
  "sources.remove_confirm_title": "{name} entfernen?",
  "sources.remove_confirm_hint":
    "Ihr Key wird sofort nicht mehr akzeptiert, alles, was noch damit läuft, verstummt also. " +
    "Die bereits gesendeten Events bleiben: Sie gehören zum Projekt.",
  "sources.remove_action": "Quelle entfernen",
  "sources.clipboard_failed":
    "Zwischenablage nicht erreichbar. Markieren Sie den Key und kopieren Sie ihn.",

  "sources.admin_only": "Nur ein Admin dieses Workspace kann eine Quelle hinzufügen.",
  "sources.step_details": "Details",
  "sources.step_install": "Installation",
  "sources.step_details_title": "Benennen Sie sie",
  "sources.step_details_hint": "Wird nur Ihnen und den Personen in diesem Workspace angezeigt.",
  "sources.asset_label": "Name der Anwendung",
  "sources.asset_hint":
    "Optional. Wird in den Snippets der Installationsanleitung verwendet, damit sie mit dem " +
    "Namen Ihrer Anwendung ankommen. Nichts, was ein Client sendet, bezieht sich darauf.",
  "sources.make_board": "Board dafür anlegen",
  "sources.ready": "{name} ist bereit",
  "sources.ready_hint":
    "Es kommt nichts an, bevor etwas sendet. Als Nächstes: installieren, in fünf Schritten im " +
    "Documentation, mit diesem Key bereits in jedem Snippet eingesetzt.",

  "sources.install_guide": "Installationsanleitung",
  "sources.detail_hint":
    "Was diese Quelle in den letzten dreißig Tagen gesendet hat. Alles hier wird genauso " +
    "gemessen wie eine Karte auf einem Board, gefiltert auf diese eine Quelle.",
  "sources.back_to_list": "Zurück zu den Quellen",
  "sources.open_source": "{name} öffnen",
  "sources.activity": "Aktivität",
  "sources.what_it_sends": "Was sie sendet",
  "sources.severity_mix": "Severity",
  "sources.open_log": "Alle ansehen",
  "sources.nothing_sent": "Nichts in diesem Zeitraum.",

  "sources.install_title": "Installieren",
  "sources.open_guide": "Anleitungen",
  "sources.open_api": "HTTP API",
};

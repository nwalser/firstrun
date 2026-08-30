import type { SourcesMessages } from "./sources.en.js";

/**
 * "Surface" stays English. It is one of this product's five named values
 * (`web`, `desktop`, `mobile`, `server`, `other`), it is the word in the schema
 * and in every client's documentation, and "Oberfläche" means the visual
 * surface of a UI, which is the opposite of what this column holds.
 *
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
  "sources.surface_label": "Surface",
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
  "sources.remove_filter": "Filter {surface} entfernen",
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

  "sources.option_web_title": "Website",
  "sources.option_web_body":
    "Seiten, Sitzungen, Referrer, Kampagnen und Core Web Vitals, vom Tag für Sie gemessen. " +
    "Alles andere ist ein track()-Aufruf, den Sie schreiben.",
  "sources.option_web_action": "Website hinzufügen",
  "sources.option_desktop_title": "Desktop-App",
  "sources.option_desktop_body":
    "Versionen, Retention und was Menschen tun, sobald sie läuft. Die Queue liegt auf der " +
    "Festplatte, deshalb kommen offline geschriebene Einträge beim nächsten Start an.",
  "sources.option_desktop_action": "Desktop-App hinzufügen",

  "sources.how_to_install": "{name} installieren",
  "sources.guide_hint": "Öffnet mit dieser Quelle ausgewählt, sodass jedes Snippet ihren Key trägt",
  "sources.remove_source": "{name} entfernen",
  "sources.remove_source_title": "Diese Quelle entfernen",
  "sources.remove_confirm_title": "{name} entfernen?",
  "sources.remove_confirm_hint":
    "Ihr Key wird sofort nicht mehr akzeptiert, alles, was noch damit läuft, verstummt also. " +
    "Die bereits gesendeten Einträge bleiben: Sie gehören zum Projekt.",
  "sources.remove_action": "Quelle entfernen",
  "sources.clipboard_failed":
    "Zwischenablage nicht erreichbar. Markieren Sie den Key und kopieren Sie ihn.",

  "sources.admin_only": "Nur ein Admin dieses Workspace kann eine Quelle hinzufügen.",
  "sources.step_type": "Typ",
  "sources.step_details": "Details",
  "sources.step_dashboard": "Dashboard",
  "sources.step_install": "Installation",
  "sources.step_type_title": "Was sendet Events?",
  "sources.step_type_hint":
    "Jede Surface eines Produkts gehört in dieses eine Projekt, damit seine Zahlen auf einem " +
    "Board stehen. Fügen Sie jetzt die Website hinzu und die App danach, oder andersherum.",
  "sources.kind_web": "Website",
  "sources.kind_web_hint":
    "Seiten, Sitzungen, Referrer, Kampagnen und Core Web Vitals, für Sie gemessen. Alles " +
    "andere ist ein track()-Aufruf, den Sie schreiben.",
  "sources.kind_desktop": "Desktop-App",
  "sources.kind_desktop_hint":
    "Versionen, Retention und was Menschen tun, sobald sie läuft. Die Queue liegt auf der " +
    "Festplatte, deshalb kommen offline geschriebene Events beim nächsten Start an.",
  "sources.step_details_title": "Benennen Sie sie",
  "sources.step_details_hint": "Wird nur Ihnen und den Personen in diesem Workspace angezeigt.",
  "sources.name_placeholder_desktop": "Themia für Windows",
  "sources.asset_label": "Name der Anwendung",
  "sources.asset_hint":
    "Optional. Wird in den Snippets der Installationsanleitung verwendet, damit sie mit dem " +
    "Namen Ihrer Anwendung ankommen. Nichts, was ein Client sendet, bezieht sich darauf.",
  "sources.step_board_title": "Mit einem Board starten",
  "sources.step_board_hint":
    "Eine Anordnung von Karten, die neben denen entsteht, die dieses Projekt bereits hat. Sie " +
    "können sie später umstellen oder löschen.",
  "sources.want_board": "Ein Dashboard für diese Quelle erstellen",
  "sources.want_board_hint":
    "Aus, wenn Sie lieber selbst eines anordnen oder das gewünschte Board bereits haben.",
  "sources.template_label": "Vorlage",
  "sources.template_hint":
    "Nur die Boards, die sich aus dem lohnen, was diese Art von Quelle sendet.",
  "sources.continue": "Weiter",
  "sources.ready": "{name} ist bereit",
  "sources.ready_hint":
    "Es kommt nichts an, bevor etwas sendet. Als Nächstes: installieren, in fünf Schritten im " +
    "Wiki, mit diesem Key bereits in jedem Snippet eingesetzt.",

  "sources.install_guide": "Installationsanleitung",
  "sources.install_title": "So installieren Sie es",
  "sources.open_guide": "Schritt-für-Schritt-Anleitung öffnen",
  "sources.guide_note":
    "Öffnet mit dieser Quelle ausgewählt, sodass jedes Snippet bereits ihren Key trägt.",
  "sources.summary_web":
    "Fügen Sie das Tag ein, schalten Sie es hinter Ihrem Consent-Banner frei und rufen Sie " +
    "track() für alles auf, was gezählt werden soll. Seitenaufrufe, Sitzungen, ausgehende " +
    "Klicks und Core Web Vitals werden für Sie gemessen.",
  "sources.summary_desktop":
    "Fügen Sie die Crate hinzu, starten Sie sie einmal beim Programmstart, dann track() und " +
    "identify(). Die Queue liegt auf der Festplatte, deshalb kommen Events, die offline " +
    "geschrieben wurden, beim nächsten Start an.",
  "sources.summary_server":
    "Fügen Sie das Paket hinzu, erzeugen Sie den Client aus einer Umgebungsvariable und " +
    "übergeben Sie bei jedem Aufruf Ihre eigene Distinct ID. Nichts wird abgewartet und nichts " +
    "wirft eine Ausnahme in Ihren Request-Pfad.",
  "sources.summary_mobile":
    "Noch kein eigener Mobile-Client. Senden Sie Batches selbst an POST /v1/e, oder richten " +
    "Sie einen vorhandenen Client auf diesen Host: Das Wire-Format ist für jede Surface " +
    "dasselbe.",
  "sources.summary_generic":
    "Alles, was eine HTTPS-Anfrage stellen kann, kann melden. Senden Sie Batches an POST /v1/e " +
    "mit Ihrem Source Key und einer Distinct ID, die Sie einmal pro Installation erzeugen.",
};

import type { DocsMessages } from "./docs.en.js";

/**
 * "Snippet", "Key", "Board", "Card", "Event" and "Origin" stay English: they
 * are what the code blocks and the columns on those pages are called in every
 * other tool the reader has open, and "Ausschnitt" or "Tafel" would send
 * somebody looking for a different thing.
 *
 * The page titles are translated where the title is a label ("Querying" ->
 * "Abfragen") and left alone where it is a name (".NET", "Astro", "SvelteKit").
 * The bodies of those pages are English prose and are not part of this sweep,
 * so a German reader gets a German contents rail over an English page.
 */
export const docs: DocsMessages = {
  "docs.title": "Dokumentation",
  "docs.topics": "Themen",
  "docs.contents": "Inhalt",
  "docs.overview": "Übersicht",
  "docs.not_found": "Nicht gefunden",
  "docs.breadcrumb": "Navigationspfad",
  "docs.on_this_page": "Auf dieser Seite",
  "docs.search": "Dokumentation durchsuchen",
  "docs.previous": "Zurück",
  "docs.next": "Weiter",
  "docs.back_to_app": "Zurück zur App",
  "docs.back_to_overview": "Zurück zur Übersicht",
  "docs.sign_in": "Anmelden",
  "docs.open_app": "App öffnen",
  "docs.optional": "optional",

  "docs.pick_source": "Quelle wählen",
  "docs.pick_source_hint": "Die Snippets unten werden mit dem Key der gewählten Quelle gefüllt.",
  "docs.picker_label": "Quelle, für die diese Anleitung geschrieben ist",
  "docs.copy_snippet": "Snippet kopieren",
  "docs.placeholder_badge": "Snippets zeigen Platzhalter-Keys",
  "docs.placeholder_line": "Snippets zeigen Platzhalter-Keys.",
  "docs.sign_in_to_fill": "Anmelden, um sie einzusetzen",
  "docs.add_source_to_fill": "Quelle hinzufügen, um sie einzusetzen",
  "docs.search_placeholder": "Workspaces, Projekte, Quellen durchsuchen",
  "docs.search_sources": "Quellen durchsuchen",
  "docs.your_sources": "Ihre Quellen",
  "docs.no_matches": "Nichts passt zu „{query}“.",
  "docs.clear_selection": "Zurücksetzen: wieder Platzhalter zeigen",

  "docs.callout_note": "Hinweis",
  "docs.callout_warning": "Achtung",
  "docs.callout_caution": "Schlägt still fehl",

  "docs.step": "Schritt {n}",
  "docs.steps_one": "{count} Schritt",
  "docs.steps_other": "{count} Schritte",

  "docs.section_getting_started": "Erste Schritte",
  "docs.section_install_guides": "Installationsanleitungen",
  "docs.section_how_it_works": "So funktioniert firstrun",
  "docs.section_reference": "Referenz",
  "docs.section_premade_events": "Vorgefertigte Events",

  "docs.index_lede_before": "firstrun ist",
  "docs.index_lede_strong":
    "ein selbst gehostetes Analyse-Backend für alles, was Sie ausliefern.",
  "docs.index_lede_after":
    "Ihre Marketing-Website, Ihre Desktop-App, Ihre mobile App und Ihr Backend melden alle in ein Projekt, auf Ihrem eigenen Postgres, und Sie lesen sie auf einem Board.",
  "docs.index_events_before":
    "Jedes Event ist eines, das Sie benannt haben. Es gibt keinen festen Funnel und kein bevorzugtes Event: ein Download-Button ist",
  "docs.index_events_after":
    "und wird genauso behandelt wie alles andere, was Sie senden. Gewöhnliche Web-Analyse (Seitenaufrufe, Sitzungen, Referrer, Core Web Vitals) wird darunter für Sie gemessen, sodass niemand ein zweites Tag daneben betreiben muss.",
  "docs.index_pick_source":
    "Wählen Sie oben eine Quelle, und jedes Snippet hier wird für sie neu geschrieben: mit ihrem echten Source Key und dem Origin, an das sie meldet. Die Wahl bleibt erhalten, solange Sie lesen.",
  "docs.index_sign_in_hint":
    "Diese Anleitungen sind mit Platzhalter-Keys geschrieben. Melden Sie sich an und wählen Sie oben eine Ihrer Quellen, dann wird jedes Snippet unten mit ihrem echten Source Key und dem Origin geschrieben, an das sie melden soll, sodass nichts mehr von Hand zu ersetzen bleibt.",
  "docs.no_pages": "Noch keine Seiten",
  "docs.no_pages_hint": "Im Documentation sind keine Themen registriert. Seiten liegen in",

  "docs.kind_sources": "{kind}-Quellen",
  "docs.no_page_called": "Keine Seite mit dem Namen „{slug}“",
  "docs.not_found_hint":
    "Sie wurde vielleicht umbenannt. Alles, was das Documentation hat, steht im Inhalt und auf der Übersicht.",

  "docs.topic_what_is_firstrun_title": "Was firstrun ist",
  "docs.topic_what_is_firstrun_summary":
    "Ein strukturiertes Log für alles, was Sie ausliefern, auf Ihrem eigenen Postgres.",
  "docs.topic_workspaces_title": "Workspaces, Projekte und Quellen",
  "docs.topic_workspaces_summary":
    "Die drei Ebenen, die zwei Rollen, und wer was ändern darf.",
  // "HTTP API" stays English: it is the name of the thing, and every reader
  // who wants this page arrived knowing that name.
  "docs.topic_http_api_title": "HTTP API",
  "docs.topic_http_api_summary":
    "Events selbst senden. Ein Endpunkt, ein Body-Format, kein SDK.",
  "docs.topic_identity_title": "Identität",
  "docs.topic_identity_summary":
    "Zwei Felder, nichts abgeleitet, und warum Uniques immer nur innerhalb einer Quelle gezählt werden.",
  "docs.topic_querying_title": "Abfragen",
  "docs.topic_querying_summary":
    "Filtern, gruppieren, aggregieren, bucketen, begrenzen: das ganze Vokabular, aus dem eine Card gebaut wird.",
  "docs.topic_dashboards_title": "Boards und Cards",
  "docs.topic_dashboards_summary":
    "Cards auf einer Fläche platziert, jede eine gespeicherte Abfrage, mit Filtern, die zum Board gehören.",
  "docs.topic_install_script_title": "Script-Tag",
  "docs.topic_install_script_summary": "Zwei Zeilen im Head. Kein Build-Schritt und kein Paket.",
  "docs.topic_install_react_title": "React",
  "docs.topic_install_react_summary": "React, Vite und Remix. Eine Komponente, einmal eingebunden.",
  "docs.topic_install_nextjs_title": "Next.js",
  "docs.topic_install_nextjs_summary":
    "App Router und Pages Router, die unterschiedliche Imports brauchen.",
  "docs.topic_install_sveltekit_title": "SvelteKit",
  "docs.topic_install_sveltekit_summary": "Ein Aufruf im Root-Layout, innerhalb von onMount.",
  "docs.topic_install_astro_title": "Astro",
  "docs.topic_install_astro_summary":
    "Eine Komponente im Head, die das Skript ausgibt, keine Island.",
  "docs.topic_install_dotnet_title": ".NET",
  "docs.topic_install_dotnet_summary":
    "Ein Paket für WPF, WinForms, Avalonia, MAUI, Konsolenwerkzeuge und ASP.NET.",
  "docs.topic_install_tauri_title": "Tauri",
  "docs.topic_install_tauri_summary":
    "Der Rust-Crate, mit einer Queue auf der Festplatte, die Offline-Zeiten und einen Prozessabbruch übersteht.",
  "docs.topic_install_node_title": "Node.js",
  "docs.topic_install_node_summary":
    "Serverseitiges JavaScript und TypeScript für Node ab 18, ESM und CommonJS.",
  "docs.topic_install_python_title": "Python",
  "docs.topic_install_python_summary":
    "Python ab 3.9, nur Standardbibliothek, sicher über einen Fork hinweg.",
  "docs.topic_install_go_title": "Go",
  "docs.topic_install_go_summary":
    "Serverseitiges Go ab 1.21, nur Standardbibliothek, eine Sender-Goroutine.",
  "docs.topic_troubleshooting_title": "Fehlerbehebung",
  "docs.topic_troubleshooting_summary":
    "Nichts kommt an, Events kommen verspätet, und Uniques, die falsch aussehen.",
  "docs.topic_log_events_title": "Referenz der Log-Events",
  "docs.topic_log_events_summary":
    "Eine Zeilenform für Fehler, Events und Messwerte, und die Konventionen, die wir vorschlagen.",
  "docs.topic_premade_events_title": "Alle Events",
  "docs.topic_premade_events_summary":
    "Die Namen, die unsere Clients für Sie schreiben, und was jeder davon mitführt.",
  // Die Titel der Event-Seiten sind der wörtliche Wert der Spalte `name` und
  // bleiben deshalb in jeder Sprache gleich, wie ".NET" und "Astro" weiter oben.
  "docs.topic_event_page_view_title": "page_view",
  "docs.topic_event_page_view_summary":
    "Eine Seite oder ein Screen wurde angesehen. Das Tag schreibt eines pro Navigation.",
  "docs.topic_event_session_start_title": "session_start",
  "docs.topic_event_session_start_summary":
    "Der erste Eintrag eines Besuchs oder eines Laufs. Das, was eine Besuchszahl zählt.",
  "docs.topic_event_page_leave_title": "page_leave",
  "docs.topic_event_page_leave_summary":
    "Eine Seite wurde verlassen. Enthält sichtbare Zeit und wie weit gescrollt wurde.",
  "docs.topic_event_outbound_click_title": "outbound_click",
  "docs.topic_event_outbound_click_summary":
    "Einem Link auf eine andere Website wurde gefolgt. Gezählt, nie abgefangen.",
  "docs.topic_event_file_download_title": "file_download",
  "docs.topic_event_file_download_summary":
    "Einem Link auf eine Datei wurde gefolgt. Eine Zählung, kein Proxy.",
  "docs.topic_event_form_submit_title": "form_submit",
  "docs.topic_event_form_submit_summary":
    "Ein Formular wurde abgeschickt. Die Identität des Formulars, nichts von seinem Inhalt.",
  "docs.topic_event_web_vital_title": "web_vital",
  "docs.topic_event_web_vital_summary":
    "Ein Core-Web-Vital-Messwert. Fünf Metriken, je ein Eintrag, einmal pro Dokument.",
  "docs.topic_event_app_install_title": "app_install",
  "docs.topic_event_app_install_summary":
    "Diese Installation lief zum ersten Mal. Einmal pro Installation, für immer.",
  "docs.topic_event_app_launch_title": "app_launch",
  "docs.topic_event_app_launch_summary":
    "Jeder Start einer installierten App, den ersten eingeschlossen.",
  "docs.topic_event_identify_title": "identify",
  "docs.topic_event_identify_summary":
    "Ein Client hat erfahren, zu welchem Benutzer er gehört. Wird nur geschrieben, wenn Sie es sagen.",
  "docs.topic_event_exception_title": "exception",
  "docs.topic_event_exception_summary":
    "Etwas hat geworfen. Ein Name für jede Exception, die Details in den Attributen.",
  "docs.topic_event_log_title": "log",
  "docs.topic_event_log_summary":
    "Eine freie Zeile. So benennen die Level-Helfer einen Eintrag.",
  "docs.topic_event_http_request_title": "http.request",
  "docs.topic_event_http_request_summary":
    "Ein ausgelieferter Request. Ein Name, den wir vorschlagen und den Sie schreiben.",
  "docs.topic_event_measurement_title": "measurement",
  "docs.topic_event_measurement_summary":
    "Ein einfacher numerischer Messwert. Die Form, die jede Zahl hier annimmt.",
  "docs.topic_privacy_title": "Datenschutz und Einwilligung",
  "docs.topic_privacy_summary":
    "Was erfasst wird, was vor der Einwilligung geschieht, und wo die Daten liegen.",
};

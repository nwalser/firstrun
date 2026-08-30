import type { WikiMessages } from "./wiki.en.js";

/**
 * "Snippet", "Key", "Board", "Card", "Event", "Surface" and "Origin" stay
 * English: they are what the code blocks and the columns on those pages are
 * called in every other tool the reader has open, and "Ausschnitt", "Tafel" or
 * "Oberfläche" would send somebody looking for a different thing. "Surface" in
 * particular is one of the five closed values in the schema, and "Oberfläche"
 * means the visual surface of a UI, which is the opposite of what it holds.
 *
 * The page titles are translated where the title is a label ("Querying" ->
 * "Abfragen") and left alone where it is a name (".NET", "Astro", "SvelteKit").
 * The bodies of those pages are English prose and are not part of this sweep,
 * so a German reader gets a German contents rail over an English page.
 */
export const wiki: WikiMessages = {
  "wiki.title": "Dokumentation",
  "wiki.topics": "Themen",
  "wiki.contents": "Inhalt",
  "wiki.overview": "Übersicht",
  "wiki.not_found": "Nicht gefunden",
  "wiki.breadcrumb": "Navigationspfad",
  "wiki.on_this_page": "Auf dieser Seite",
  "wiki.search": "Dokumentation durchsuchen",
  "wiki.previous": "Zurück",
  "wiki.next": "Weiter",
  "wiki.back_to_app": "Zurück zur App",
  "wiki.back_to_overview": "Zurück zur Übersicht",
  "wiki.sign_in": "Anmelden",
  "wiki.open_app": "App öffnen",
  "wiki.optional": "optional",

  "wiki.pick_source": "Quelle wählen",
  "wiki.pick_source_hint": "Die Snippets unten werden mit dem Key der gewählten Quelle gefüllt.",
  "wiki.picker_label": "Quelle, für die diese Anleitung geschrieben ist",
  "wiki.copy_snippet": "Snippet kopieren",
  "wiki.placeholder_badge": "Snippets zeigen Platzhalter-Keys",
  "wiki.placeholder_line": "Snippets zeigen Platzhalter-Keys.",
  "wiki.sign_in_to_fill": "Anmelden, um sie einzusetzen",
  "wiki.add_source_to_fill": "Quelle hinzufügen, um sie einzusetzen",
  "wiki.search_placeholder": "Workspaces, Projekte, Quellen durchsuchen",
  "wiki.search_sources": "Quellen durchsuchen",
  "wiki.your_sources": "Ihre Quellen",
  "wiki.no_matches": "Nichts passt zu „{query}“.",
  "wiki.clear_selection": "Zurücksetzen: wieder Platzhalter zeigen",

  "wiki.callout_note": "Hinweis",
  "wiki.callout_warning": "Achtung",
  "wiki.callout_caution": "Schlägt still fehl",

  "wiki.step": "Schritt {n}",
  "wiki.steps_one": "{count} Schritt",
  "wiki.steps_other": "{count} Schritte",

  "wiki.section_getting_started": "Erste Schritte",
  "wiki.section_install_guides": "Installationsanleitungen",
  "wiki.section_how_it_works": "So funktioniert firstrun",
  "wiki.section_reference": "Referenz",

  "wiki.index_lede_before": "firstrun ist",
  "wiki.index_lede_strong":
    "ein selbst gehostetes Analyse-Backend für alles, was Sie ausliefern.",
  "wiki.index_lede_after":
    "Ihre Marketing-Website, Ihre Desktop-App, Ihre mobile App und Ihr Backend melden alle in ein Projekt, auf Ihrem eigenen Postgres, und Sie lesen sie auf einem Board.",
  "wiki.index_events_before":
    "Jedes Event ist eines, das Sie benannt haben. Es gibt keinen festen Funnel und kein bevorzugtes Event: ein Download-Button ist",
  "wiki.index_events_after":
    "und wird genauso behandelt wie alles andere, was Sie senden. Gewöhnliche Web-Analyse (Seitenaufrufe, Sitzungen, Referrer, Core Web Vitals) wird darunter für Sie gemessen, sodass niemand ein zweites Tag daneben betreiben muss.",
  "wiki.index_pick_source":
    "Wählen Sie oben eine Quelle, und jedes Snippet hier wird für sie neu geschrieben: mit ihrem echten Source Key und dem Origin, an das sie meldet. Die Wahl bleibt erhalten, solange Sie lesen.",
  "wiki.index_sign_in_hint":
    "Diese Anleitungen sind mit Platzhalter-Keys geschrieben. Melden Sie sich an und wählen Sie oben eine Ihrer Quellen, dann wird jedes Snippet unten mit ihrem echten Source Key und dem Origin geschrieben, an das sie melden soll, sodass nichts mehr von Hand zu ersetzen bleibt.",
  "wiki.no_pages": "Noch keine Seiten",
  "wiki.no_pages_hint": "Im Wiki sind keine Themen registriert. Seiten liegen in",

  "wiki.kind_sources": "{kind}-Quellen",
  "wiki.kind_mismatch":
    "Diese Seite ist für {page}-Quellen, und {name} ist eine {kind}-Quelle. Die Snippets unten zeigen weiterhin ihren Key, und das ist nicht der, den diese Integration braucht.",
  "wiki.no_page_called": "Keine Seite mit dem Namen „{slug}“",
  "wiki.not_found_hint":
    "Sie wurde vielleicht umbenannt. Alles, was das Wiki hat, steht im Inhalt und auf der Übersicht.",

  "wiki.topic_what_is_firstrun_title": "Was firstrun ist",
  "wiki.topic_what_is_firstrun_summary":
    "Ein strukturiertes Log für jede Surface, die Sie ausliefern, auf Ihrem eigenen Postgres.",
  "wiki.topic_workspaces_title": "Workspaces, Projekte und Quellen",
  "wiki.topic_workspaces_summary":
    "Die drei Ebenen, die zwei Rollen, und wer was ändern darf.",
  "wiki.topic_identity_title": "Identität",
  "wiki.topic_identity_summary":
    "Zwei Felder, nichts abgeleitet, und warum Uniques immer nur innerhalb einer Surface gezählt werden.",
  "wiki.topic_querying_title": "Abfragen",
  "wiki.topic_querying_summary":
    "Filtern, gruppieren, aggregieren, bucketen, begrenzen: das ganze Vokabular, aus dem eine Card gebaut wird.",
  "wiki.topic_dashboards_title": "Boards und Cards",
  "wiki.topic_dashboards_summary":
    "Cards auf einer Fläche platziert, jede eine gespeicherte Abfrage, mit Filtern, die zum Board gehören.",
  "wiki.topic_install_script_title": "Script-Tag",
  "wiki.topic_install_script_summary": "Zwei Zeilen im Head. Kein Build-Schritt und kein Paket.",
  "wiki.topic_install_react_title": "React",
  "wiki.topic_install_react_summary": "React, Vite und Remix. Eine Komponente, einmal eingebunden.",
  "wiki.topic_install_nextjs_title": "Next.js",
  "wiki.topic_install_nextjs_summary":
    "App Router und Pages Router, die unterschiedliche Imports brauchen.",
  "wiki.topic_install_sveltekit_title": "SvelteKit",
  "wiki.topic_install_sveltekit_summary": "Ein Aufruf im Root-Layout, innerhalb von onMount.",
  "wiki.topic_install_astro_title": "Astro",
  "wiki.topic_install_astro_summary":
    "Eine Komponente im Head, die das Skript ausgibt, keine Island.",
  "wiki.topic_install_dotnet_title": ".NET",
  "wiki.topic_install_dotnet_summary":
    "Ein Paket für WPF, WinForms, Avalonia, MAUI, Konsolenwerkzeuge und ASP.NET.",
  "wiki.topic_install_tauri_title": "Tauri",
  "wiki.topic_install_tauri_summary":
    "Der Rust-Crate, mit einer Queue auf der Festplatte, die Offline-Zeiten und einen Prozessabbruch übersteht.",
  "wiki.topic_install_node_title": "Node.js",
  "wiki.topic_install_node_summary":
    "Serverseitiges JavaScript und TypeScript für Node ab 18, ESM und CommonJS.",
  "wiki.topic_install_python_title": "Python",
  "wiki.topic_install_python_summary":
    "Python ab 3.9, nur Standardbibliothek, sicher über einen Fork hinweg.",
  "wiki.topic_install_go_title": "Go",
  "wiki.topic_install_go_summary":
    "Serverseitiges Go ab 1.21, nur Standardbibliothek, eine Sender-Goroutine.",
  "wiki.topic_troubleshooting_title": "Fehlerbehebung",
  "wiki.topic_troubleshooting_summary":
    "Nichts kommt an, Einträge kommen verspätet, und Uniques, die falsch aussehen.",
  "wiki.topic_log_entries_title": "Referenz der Log-Einträge",
  "wiki.topic_log_entries_summary":
    "Eine Zeilenform für Fehler, Events und Messwerte, und die Konventionen, die wir vorschlagen.",
  "wiki.topic_privacy_title": "Datenschutz und Einwilligung",
  "wiki.topic_privacy_summary":
    "Was erfasst wird, was vor der Einwilligung geschieht, und wo die Daten liegen.",
};

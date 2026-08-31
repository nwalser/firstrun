import type { Namespaced } from "./namespace.js";

/**
 * The documentation CHROME, and only the chrome: the shell around a topic, the
 * contents rail, the source picker, the step numbering, the prev/next pair, and
 * the front page that introduces the whole thing.
 *
 * The prose of a topic is content, not a catalogue string. A page of
 * documentation translated one sentence at a time through a key map is a page
 * nobody can edit afterwards, and the topics are not in this sweep.
 *
 * The topic TITLES and SUMMARIES are here even so, because they are navigation:
 * they are what the contents rail, the breadcrumb and the index cards are made
 * of, and a reader deciding which page to open is reading those rather than the
 * page. They are keyed by slug and `registry.ts` maps a topic to its pair; a
 * topic with no event falls back to the English its own module declares, so
 * adding a page never breaks the build.
 */
export const docs = {
  "docs.title": "Documentation",
  "docs.topics": "Topics",
  "docs.contents": "Contents",
  "docs.overview": "Overview",
  "docs.not_found": "Not found",
  "docs.breadcrumb": "Breadcrumb",
  "docs.on_this_page": "On this page",
  "docs.search": "Search the documentation",
  "docs.previous": "Previous",
  "docs.next": "Next",
  "docs.back_to_app": "Back to the app",
  "docs.back_to_overview": "Back to the overview",
  "docs.sign_in": "Sign in",
  "docs.open_app": "Open app",
  "docs.optional": "optional",

  // The source picker in the header, and the one placeholder notice beside it.
  "docs.pick_source": "Pick a source",
  "docs.pick_source_hint": "The snippets below fill in with the key of the source you pick.",
  "docs.picker_label": "Source these instructions are written for",
  "docs.copy_snippet": "Copy snippet",
  "docs.placeholder_badge": "Snippets show placeholder keys",
  "docs.placeholder_line": "Snippets show placeholder keys.",
  "docs.sign_in_to_fill": "Sign in to fill them in",
  "docs.add_source_to_fill": "Add a source to fill them in",
  "docs.search_placeholder": "Search workspaces, projects, sources",
  "docs.search_sources": "Search sources",
  "docs.your_sources": "Your sources",
  "docs.no_matches": "Nothing matches “{query}”.",
  "docs.clear_selection": "Clear: go back to placeholders",

  // The default title of a callout, one per weight. A callout always shows a
  // title, so the ladder survives greyscale and a printed page.
  "docs.callout_note": "Note",
  "docs.callout_warning": "Heads up",
  "docs.callout_caution": "Fails silently",

  "docs.step": "Step {n}",
  "docs.steps_one": "{count} step",
  "docs.steps_other": "{count} steps",

  // The sections of the contents, in the order it shows them. The literal
  // in `DOCS_SECTIONS` stays the identity; these are only what it is called.
  "docs.section_getting_started": "Getting started",
  "docs.section_install_guides": "Install guides",
  "docs.section_how_it_works": "How firstrun works",
  "docs.section_reference": "Reference",
  "docs.section_premade_events": "Premade events",

  /*
   * The front page.
   *
   * Two of these sentences are split around a piece of markup that is part of
   * the sentence: an emphasised phrase, and a call written in code. A
   * placeholder cannot carry either, so the alternative was one key per
   * paragraph with the emphasis and the code sample dropped out of it. Both
   * halves of every split are whole clauses in both languages, which is what
   * keeps German word order intact across the seam.
   */
  "docs.index_lede_before": "firstrun is",
  "docs.index_lede_strong": "one self-hosted analytics backend for everything you ship.",
  "docs.index_lede_after":
    "Your marketing site, your desktop app, your mobile app and your backend all report into one project, on your own Postgres, and you read them on one board.",
  "docs.index_events_before":
    "Every event is one you named. There is no fixed funnel and no privileged event: a download button is",
  "docs.index_events_after":
    "and is treated exactly like anything else you send. Ordinary web analytics (page views, sessions, referrers, Core Web Vitals) is measured for you underneath that, so nobody has to run a second tag alongside this one.",
  "docs.index_pick_source":
    "Pick a source in the header and every snippet in here is rewritten for it: its real source key, and the origin it reports to. The choice is remembered while you read.",
  "docs.index_sign_in_hint":
    "These guides are written with placeholder keys. Sign in and pick one of your sources in the header, and every snippet below is rewritten with its real source key and the origin it should report to, so there is nothing left to substitute by hand.",
  "docs.no_pages": "No pages yet",
  "docs.no_pages_hint": "The documentation has no topics registered. Pages live in",

  // One topic page.
  "docs.kind_sources": "{kind} sources",
  "docs.no_page_called": "No page called “{slug}”",
  "docs.not_found_hint":
    "It may have been renamed. Everything the documentation has is in the contents, and on the overview.",

  // The pages, by slug. Navigation, not prose: see the note at the top.
  "docs.topic_what_is_firstrun_title": "What firstrun is",
  "docs.topic_what_is_firstrun_summary":
    "One structured log for everything you ship, on your own Postgres.",
  "docs.topic_workspaces_title": "Workspaces, projects and sources",
  "docs.topic_workspaces_summary": "The three levels, the two roles, and who can change what.",
  "docs.topic_http_api_title": "HTTP API",
  "docs.topic_http_api_summary": "Post events yourself. One endpoint, one body shape, no SDK.",
  "docs.topic_identity_title": "Identity",
  "docs.topic_identity_summary":
    "Two fields, nothing inferred, and why a unique is only ever counted inside one source.",
  "docs.topic_querying_title": "Querying",
  "docs.topic_querying_summary":
    "Filter, group, aggregate, bucket, limit: the whole vocabulary a card is built from.",
  "docs.topic_dashboards_title": "Boards and cards",
  "docs.topic_dashboards_summary":
    "Cards placed on a canvas, each a saved query, with filters that belong to the board.",
  "docs.topic_install_script_title": "Script tag",
  "docs.topic_install_script_summary": "Two lines in the head. No build step and no package.",
  "docs.topic_install_react_title": "React",
  "docs.topic_install_react_summary": "React, Vite and Remix. One component, mounted once.",
  "docs.topic_install_nextjs_title": "Next.js",
  "docs.topic_install_nextjs_summary":
    "App Router and Pages Router, which take different imports.",
  "docs.topic_install_sveltekit_title": "SvelteKit",
  "docs.topic_install_sveltekit_summary": "One call in the root layout, inside onMount.",
  "docs.topic_install_astro_title": "Astro",
  "docs.topic_install_astro_summary":
    "A component in the head that emits the script, not an island.",
  "docs.topic_install_dotnet_title": ".NET",
  "docs.topic_install_dotnet_summary":
    "One package for WPF, WinForms, Avalonia, MAUI, console tools and ASP.NET.",
  "docs.topic_install_tauri_title": "Tauri",
  "docs.topic_install_tauri_summary":
    "The Rust crate, with a disk-backed queue that survives being offline or killed.",
  "docs.topic_install_node_title": "Node.js",
  "docs.topic_install_node_summary":
    "Server-side JavaScript and TypeScript for Node 18+, ESM and CommonJS.",
  "docs.topic_install_python_title": "Python",
  "docs.topic_install_python_summary": "Python 3.9+, standard library only, safe across a fork.",
  "docs.topic_install_go_title": "Go",
  "docs.topic_install_go_summary":
    "Server-side Go 1.21+, standard library only, one sender goroutine.",
  "docs.topic_troubleshooting_title": "Troubleshooting",
  "docs.topic_troubleshooting_summary":
    "Nothing arriving, events arriving late, and uniques that look wrong.",
  "docs.topic_log_events_title": "Log event reference",
  "docs.topic_log_events_summary":
    "One row shape for errors, events and measurements, and the conventions we suggest.",
  "docs.topic_premade_events_title": "All events",
  "docs.topic_premade_events_summary":
    "The names our clients write for you, and what every one of them carries.",
  // The titles of the event pages are the literal value in the `name` column,
  // so they are the same in every language, like ".NET" and "Astro" above.
  "docs.topic_event_page_view_title": "page_view",
  "docs.topic_event_page_view_summary":
    "A page or screen was viewed. The tag writes one per navigation.",
  "docs.topic_event_session_start_title": "session_start",
  "docs.topic_event_session_start_summary":
    "The first entry of a visit or a run. What a visits number counts.",
  "docs.topic_event_page_leave_title": "page_leave",
  "docs.topic_event_page_leave_summary":
    "A page was left. Carries visible time and how far down the reader got.",
  "docs.topic_event_outbound_click_title": "outbound_click",
  "docs.topic_event_outbound_click_summary":
    "A link to another site was followed. Counted, never intercepted.",
  "docs.topic_event_file_download_title": "file_download",
  "docs.topic_event_file_download_summary": "A link to a file was followed. A count, and not a proxy.",
  "docs.topic_event_form_submit_title": "form_submit",
  "docs.topic_event_form_submit_summary":
    "A form was submitted. The identity of the form, and nothing that was in it.",
  "docs.topic_event_web_vital_title": "web_vital",
  "docs.topic_event_web_vital_summary":
    "One Core Web Vital sample. Five metrics, one entry each, once per document.",
  "docs.topic_event_app_install_title": "app_install",
  "docs.topic_event_app_install_summary":
    "This installation ran for the first time. One per install, ever.",
  "docs.topic_event_app_launch_title": "app_launch",
  "docs.topic_event_app_launch_summary": "Any launch of an installed app, including the first one.",
  "docs.topic_event_identify_title": "identify",
  "docs.topic_event_identify_summary":
    "A client learned which user it belongs to. Written only when you say so.",
  "docs.topic_event_exception_title": "exception",
  "docs.topic_event_exception_summary":
    "Something threw. One name for every exception, with the detail in attributes.",
  "docs.topic_event_log_title": "log",
  "docs.topic_event_log_summary": "A free-form line. What the level helpers name an entry.",
  "docs.topic_event_http_request_title": "http.request",
  "docs.topic_event_http_request_summary": "One request served. A name we suggest, written by you.",
  "docs.topic_event_measurement_title": "measurement",
  "docs.topic_event_measurement_summary":
    "A plain numeric sample. The shape every number here takes.",
  "docs.topic_privacy_title": "Privacy and consent",
  "docs.topic_privacy_summary":
    "What is collected, what happens before consent, and where the data lives.",
} satisfies Namespaced<"docs">;

export type DocsMessages = typeof docs;

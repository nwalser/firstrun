import type { Namespaced } from "./namespace.js";

/** The canvas, the widgets on it, and the range and comparison pickers above. */
export const dashboard = {
  "dashboard.add_widget": "Add widget",
  "dashboard.edit_widget": "Edit widget",
  "dashboard.duplicate_widget": "Duplicate widget",
  "dashboard.remove_widget": "Remove widget",
  "dashboard.no_data": "No data in this range",

  "dashboard.range": "Range",
  "dashboard.range_custom": "Custom",
  "dashboard.compare": "Compare",
  "dashboard.compare_none": "None",
  "dashboard.compare_previous": "Previous period",
  "dashboard.compare_year": "Previous year",
  "dashboard.compare_custom": "Custom",
  "dashboard.baseline": "vs {range}",
  // The comparison window, as a legend entry and a tooltip row. Not "vs
  // {range}": that key is a sentence about one number, and this names a line.
  "dashboard.baseline_series": "Baseline",

  "dashboard.filters": "Filters",
  "dashboard.filters_one": "{count} filter",
  "dashboard.filters_other": "{count} filters",

  "dashboard.events": "Events",
  "dashboard.uniques": "Uniques",

  // The range picker. `describeRange` and `RANGE_PRESETS` in
  // `packages/schema/src/range.ts` write these in English; the picker derives
  // them from the range's own shape instead so they can be translated here.
  "dashboard.range_last_24h": "Last 24 hours",
  "dashboard.range_last_12m": "Last 12 months",
  "dashboard.range_last_days_one": "Last {count} day",
  "dashboard.range_last_days_other": "Last {count} days",
  "dashboard.range_hint": "Or pick two dates for a fixed window.",
  "dashboard.window_span": "{from} to {to}",

  // The lower-case half of "vs previous period". A separate key rather than
  // `toLowerCase()` on the picker's own label: German capitalises nouns
  // wherever they stand, so lower-casing one is a spelling mistake.
  "dashboard.baseline_previous": "previous period",
  "dashboard.baseline_year": "previous year",

  "dashboard.compared_with": "Compared with",
  "dashboard.showing": "Showing",
  "dashboard.baseline_nothing": "Nothing",

  // The toolbar above the board.
  "dashboard.filter_none": "Filter",
  "dashboard.test_mode": "Test data",
  "dashboard.test_mode_off": "Showing production data. Switch to events your development builds sent.",
  "dashboard.test_mode_on": "Showing test data only. Production events are hidden.",
  "dashboard.test_banner": "Test data",
  "dashboard.window_and_baseline": "{range} · compared with {baseline}",
  "dashboard.saved": "Saved",
  "dashboard.add_card": "Add card",
  "dashboard.mode_group": "Board mode",
  "dashboard.mode_look": "Look at the board",
  "dashboard.mode_arrange": "Arrange the board",

  "dashboard.palette_title": "Add a card",
  "dashboard.palette_close": "Close the palette",
  "dashboard.palette_hint":
    "Starting points, not a catalogue. Each one is a saved query you then edit, and none of " +
    "them can ask anything the builder cannot. Drag a card from anywhere on it, pull an edge " +
    "to resize, arrow keys to nudge (hold shift for five steps, alt to resize). It saves as " +
    "you go.",

  "dashboard.empty_title": "Nothing on this board yet",
  "dashboard.empty_body":
    "A card is a saved query and a way of drawing its answer. Start from one of the presets " +
    "and edit what it counts, or place a blank one and build the question yourself.",

  "dashboard.board_filter_title": "Board filter",
  "dashboard.board_filter_body":
    "Applied to every card on this board. It belongs to the board, so it survives a reload " +
    "and travels with a link somebody sends.",
  "dashboard.clear": "Clear",

  // One card's controls and its settings drawer.
  "dashboard.card_settings": "Settings",
  "dashboard.duplicate": "Duplicate",
  "dashboard.bring_to_front": "Bring to front",
  "dashboard.note_badge": "note",
  "dashboard.setting_title": "Title",
  "dashboard.setting_title_hint": "Leave empty to use what the query says.",
  "dashboard.setting_text": "Text",
  "dashboard.setting_text_hint": "Markdown is not rendered. Line breaks are kept.",
  "dashboard.show_change": "Show the change",
  "dashboard.show_change_hint":
    "Against the board's comparison window, which the range picker sets.",
  "dashboard.show_shape": "Show the daily shape",
  "dashboard.show_shape_hint":
    "The same question with a bucket on it, so a chart of it costs nothing extra.",

  // What a card says when it has an answer, and when it has none.
  "dashboard.not_set": "(not set)",
  "dashboard.nothing_measured": "Nothing measured in this window.",
  "dashboard.no_events": "No events in this window.",
  "dashboard.empty_note": "An empty note. Its text lives in the card's settings.",
  "dashboard.note_title": "Note",
  "dashboard.peak": "peak",
  "dashboard.all_events": "All events",
  "dashboard.more_one": "+{count} more",
  "dashboard.more_other": "+{count} more",

  // That the board is measuring itself. There is no refresh button: a board is
  // a window onto something still happening, so it re-reads itself while open.
  "dashboard.live": "Live",
  "dashboard.live_title": "This board re-reads itself while it is open. Updated {when}.",
  "dashboard.live_paused": "Paused while the board is being arranged. It resumes when you stop.",

  // The starting points in the palette. The title is what the row reads; the
  // description is its `title` attribute, because a 36px row has no second line.
  "dashboard.preset_event_count": "Count one event",
  "dashboard.preset_event_count_hint":
    "How many times one named event happened, with the change since last. Lands on the " +
    "name this project sends most; change it in the builder.",
  "dashboard.preset_event_uniques": "One event, by person",
  "dashboard.preset_event_uniques_hint":
    "How many distinct people or installs sent one named event, counted once each however " +
    "often they sent it.",
  "dashboard.preset_uniques": "Single number",
  "dashboard.preset_uniques_hint":
    "How many distinct people or installs sent anything, with the change since last.",
  "dashboard.preset_over_time": "Over time",
  "dashboard.preset_over_time_hint":
    "Events per day, bucketed on when they happened rather than when they arrived.",
  "dashboard.preset_names": "What is being sent",
  "dashboard.preset_names_hint":
    "Every event name in the window, ranked. The first thing to look at on a new project.",
  "dashboard.preset_errors": "Errors over time",
  "dashboard.preset_errors_hint":
    "Events at ERROR or worse, per day. Severity is a number, so this is one filter.",
  "dashboard.preset_exceptions": "Top exceptions",
  "dashboard.preset_exceptions_hint":
    "Which exception type is thrown most, and how many people it reached.",
  "dashboard.preset_exception_messages": "Top exception messages",
  "dashboard.preset_exception_messages_hint":
    "Exceptions grouped by their message, so the same failure lands on one row. The closest " +
    "thing here to a list of issues.",
  "dashboard.preset_pages": "Top pages",
  "dashboard.preset_pages_hint":
    "Page views grouped by path, ranked by how many people saw each one.",
  "dashboard.preset_referrers": "Where people came from",
  "dashboard.preset_referrers_hint": "The referring host on a page view, ranked.",
  "dashboard.preset_vitals": "Web vitals",
  "dashboard.preset_vitals_hint":
    "Each Core Web Vital at the 75th percentile, with how many samples it rests on.",
  "dashboard.preset_versions": "App versions",
  "dashboard.preset_versions_hint":
    "Installs per version of your software, ranked by how many are still on it.",
  "dashboard.preset_slow_routes": "Slowest routes",
  "dashboard.preset_slow_routes_hint":
    "The 95th percentile duration per route, so one slow request cannot hide behind a mean.",
  "dashboard.preset_note": "Note",
  "dashboard.preset_note_hint": "A heading or a caveat. The one card with no query behind it.",
} satisfies Namespaced<"dashboard">;

export type DashboardMessages = typeof dashboard;

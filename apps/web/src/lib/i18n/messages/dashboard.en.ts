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

  "dashboard.filters": "Filters",
  "dashboard.filters_one": "{count} filter",
  "dashboard.filters_other": "{count} filters",

  "dashboard.entries": "Entries",
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
  "dashboard.no_entries": "No entries in this window.",
  "dashboard.empty_note": "An empty note. Its text lives in the card's settings.",
  "dashboard.note_title": "Note",
  "dashboard.peak": "peak",
  "dashboard.all_entries": "All entries",
  "dashboard.more_one": "+{count} more",
  "dashboard.more_other": "+{count} more",

  // The starting points in the palette. The title is what the row reads; the
  // description is its `title` attribute, because a 36px row has no second line.
  "dashboard.preset_uniques": "Single number",
  "dashboard.preset_uniques_hint":
    "How many distinct people or installs sent anything, with the change since last.",
  "dashboard.preset_over_time": "Over time",
  "dashboard.preset_over_time_hint":
    "Entries per day, bucketed on when they happened rather than when they arrived.",
  "dashboard.preset_names": "What is being sent",
  "dashboard.preset_names_hint":
    "Every entry name in the window, ranked. The first thing to look at on a new project.",
  "dashboard.preset_errors": "Errors over time",
  "dashboard.preset_errors_hint":
    "Entries at ERROR or worse, per day. Severity is a number, so this is one filter.",
  "dashboard.preset_exceptions": "Top exceptions",
  "dashboard.preset_exceptions_hint":
    "Which exception type is thrown most, and how many people it reached.",
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

import type { Namespaced } from "./namespace.js";

/**
 * The event log: every event the workspace has received, newest first.
 *
 * The vocabulary here is deliberately the data model's own. An event has a
 * `time`, a severity on the 1..24 ladder, a name and an attribute map, and this
 * page says exactly that rather than inventing softer words for them: somebody
 * reading a log is about to write a filter against the same four things.
 */
export const events = {
  "events.title": "Events",
  "events.hint":
    "Every event this workspace has received, newest first. An error, a page view and a " +
    "measurement are the same row shape here, because they are the same row shape in the table.",

  // The toolbar.
  "events.search_placeholder": "Search name, client id or message…",
  "events.search_label": "Search events",
  "events.window_hours": "Last 24 hours",
  "events.window_days": "Last {days} days",
  "events.window_label": "Window",
  "events.project_label": "Project",
  "events.all_projects": "All projects",
  "events.severity_label": "Severity",
  "events.severity_any": "Any severity",
  "events.severity_min": "{band} and worse",
  "events.remove_filter": "Remove the {filter} filter",

  /*
   * The live tail.
   *
   * Off by default. A list that reorders itself under a cursor is a list you
   * cannot read, and the moment somebody is looking at one event is exactly the
   * moment they do not want thirty more above it.
   */
  "events.live": "Live",
  "events.live_hint": "Check for new events every few seconds",
  "events.live_on": "Live. New events appear as they arrive.",

  // The list.
  "events.col_time": "Time",
  "events.col_severity": "Severity",
  "events.col_project": "Project",
  "events.col_name": "Name",
  "events.col_client": "Client",
  "events.unclassified": "Unclassified",
  "events.events_one": "{count} event",
  "events.events_other": "{count} events",
  "events.load_older": "Load older",
  "events.loading": "Loading…",
  "events.none": "Nothing received yet",
  "events.none_hint":
    "Events appear here the moment anything sends one. Add a source and install it, and this " +
    "page is where you check that it worked.",
  "events.no_matches": "No event in this window matches those filters.",
  "events.widen": "Try a longer window, or clear a filter.",

  // One event, opened.
  "events.show_detail": "Show this event in full",
  "events.hide_detail": "Hide this event",
  "events.attributes": "Attributes",
  "events.no_attributes": "This event carries no attributes.",
  "events.event_id": "Event id",
  "events.client_id": "Client id",
  "events.source_label": "Source",

  /*
   * The two timestamps, stated as two.
   *
   * `time` is the client's and is what everything here sorts and windows on;
   * `ingested_at` is when we heard about it. They differ by days whenever an app
   * was offline, and a log view that showed one number would be quietly lying
   * about the other.
   */
  /*
   * One event, on its own page.
   *
   * An event is addressable because an event is something people SEND each
   * other. The row still expands in place -- that is how a log is read -- and
   * the page is how one is cited.
   */
  "events.open_event": "Open {name}",
  "events.detail_hint":
    "One event, exactly as it was written. The timestamp is the client's own, so an event from " +
    "a machine that was offline belongs to the moment it happened rather than the moment we " +
    "heard about it.",
  "events.detail_facts": "What it is",
  "events.back_to_log": "Back to the log",
  "events.related": "Everything else",
  "events.same_name": "Other {name} events",
  "events.same_client": "Everything from this client",
  "events.open_source": "Open the source",
  "events.one_source": "This source",

  "events.happened": "Happened",
  "events.received": "Received",
  "events.late_by": "Arrived {delay} late",
  "events.late_hint":
    "The event is stamped by the client that wrote it, so a queue replayed after a machine came " +
    "back online lands on the day it happened rather than today.",
} satisfies Namespaced<"events">;

export type EventsMessages = typeof events;

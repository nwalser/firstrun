import type { Namespaced } from "./namespace.js";

/**
 * The usage page: how many events a workspace has taken in, and from where.
 *
 * The unit is deliberately named on screen: "usage" means events, and an
 * exception, a page view and a measurement each count once, because they are
 * the same row in the same table. That holds whether or not there is a plan
 * above it, which is why the plan's own strings live in `billing` and not here.
 */
export const usage = {
  "usage.title": "Usage",
  "usage.hint":
    "Everything this workspace has taken in. One event is one row: an error, a page view and a " +
    "measurement all count once, because they are the same row shape in the same table.",

  // The toolbar.
  "usage.window_days": "Last {days} days",
  "usage.window_label": "Window",
  "usage.group_label": "Break down",
  "usage.by_project": "By project",
  "usage.by_source": "By source",
  "usage.by_severity": "By severity",
  "usage.project_label": "Project",
  "usage.all_projects": "All projects",
  "usage.remove_filter": "Remove the {filter} filter",

  // The headline.
  "usage.events": "Events",
  "usage.against": "against {range}",
  "usage.per_day": "Per day",
  "usage.busiest_day": "Busiest day",
  "usage.no_delta": "No baseline to compare against",

  // The breakdown.
  "usage.breakdown": "Consumption breakdown",
  "usage.daily": "Daily",
  "usage.chart_label": "Events per day, {count} in total",
  "usage.col_name": "Name",
  "usage.col_events": "Events",
  "usage.col_share": "Share",
  "usage.col_change": "Change",
  "usage.other": "Everything else",
  "usage.none": "Nothing received in this window",
  "usage.none_hint":
    "Usage is counted on the event's own timestamp, so a client that was offline reports on the " +
    "days it was actually used. Try a longer window.",
  "usage.open_project": "Open {name}",

  /*
   * The one thing this page has to say that a bill would not.
   *
   * Events are counted on `time`, which the client stamps, so today's number
   * keeps moving as queued events arrive from machines that were offline. That
   * is not a bug and it is the first question anybody asks about these numbers.
   */
  "usage.late_note":
    "Counted on the event's own timestamp, not on when it reached us. A client that was offline " +
    "for a day adds to the day it was used, so recent days keep filling in.",
} satisfies Namespaced<"usage">;

export type UsageMessages = typeof usage;

import type { Namespaced } from "./namespace.js";

/**
 * The starting-point picker, which the board, source and project create flows
 * all mount. One namespace rather than three copies, because it is one
 * component and its strings belong to it rather than to whichever flow opened
 * it.
 *
 * The catalogue itself (`packages/schema/src/templates.ts`) carries an English
 * `name` and `description` per template. The picker looks those up here by the
 * template's key instead, through a record of literals, so the schema stays
 * free of display copy.
 */
export const templates = {
  "templates.pick": "Pick a starting point",
  "templates.pick_hint":
    "A starting point is a set of good defaults. Everything on it can be edited afterwards.",

  "templates.overview": "Overview",
  "templates.overview_hint":
    "Every source side by side: traffic, installs, and where people came from.",
  "templates.website": "Website",
  "templates.website_hint": "Traffic, pages, referrers, campaigns and vitals.",
  "templates.app_health": "App health",
  "templates.app_health_hint":
    "Installs, versions in use, how many open it each day, and what is failing.",
  "templates.blank": "Blank",
  "templates.blank_hint": "An empty canvas.",
} satisfies Namespaced<"templates">;

export type TemplatesMessages = typeof templates;

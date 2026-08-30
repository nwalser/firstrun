import { ATTR, NAME } from "./conventions.js";
import { SEVERITY } from "./severity.js";
import type { Surface } from "./surface.js";
import { BOARD_VERSION, type Board, type BoardWidget } from "./board.js";
import {
  emptyFilter,
  uniquesAggregation,
  type Field,
  type Filter,
  type LogQuery,
  type Scalar,
  type Visualisation,
} from "./query.js";

/**
 * A board somebody can use before they have arranged anything.
 *
 * Offered when a project or a source is created, because an empty canvas asks a
 * question that a person who has just installed the SDK cannot yet answer.
 *
 * Every card here is a SAVED QUERY, built out of the same filter, group by,
 * aggregation, bucket and limit the builder offers. Nothing in this file can
 * express a board a customer could not have arranged themselves, and every
 * entry name and attribute key in it is a CONVENTION that a project spelling
 * its own differently is expected to edit. A template that needed a special
 * case in the query layer would be a template that lied about what the product
 * can do.
 *
 * Templates live next to the board contract rather than in the contract
 * package because they PRODUCE a board: a template that built the old closed
 * layout would have its cards silently dropped by the migration on the very
 * first read, which is exactly what used to happen to the funnel and retention
 * cards below.
 */

/**
 * The timezone a template's buckets are drawn in.
 *
 * UTC, fixed, and not the creator's own zone. A template is built on the server
 * and then shared: a board stamped with whichever zone the creating machine
 * happened to be in would give two colleagues two different daily charts of the
 * same data. A card the reader builds afterwards stores the zone they chose,
 * which they can see.
 */
const TEMPLATE_TZ = "UTC";

const attr = (key: string, as?: "number"): Field => ({
  kind: "attribute",
  path: [key],
  ...(as ? { as } : {}),
});

const nameIs = (name: string): Filter => ({
  op: "eq",
  field: { kind: "column", column: "name" },
  value: name,
});

const nameIn = (names: readonly string[]): Filter => ({
  op: "in",
  field: { kind: "column", column: "name" },
  values: [...names] as Scalar[],
});

const daily = { unit: "day" as const, timezone: TEMPLATE_TZ };
const rankByFirst = [{ key: { aggregate: 0 }, direction: "desc" } as const];

interface Placement {
  id: string;
  title?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const card = (
  at: Placement,
  viz: Visualisation,
  query: LogQuery,
  extra: { compare?: boolean; sparkline?: boolean } = {}
): BoardWidget => ({
  ...at,
  kind: "query",
  viz,
  query,
  compare: extra.compare ?? false,
  sparkline: extra.sparkline ?? false,
});

/** A single number counting one conventional name, with its own daily sparkline. */
const counter = (at: Placement, name: string, of: "entries" | "uniques"): BoardWidget =>
  card(
    at,
    "number",
    {
      filter: nameIs(name),
      aggregations: [of === "entries" ? { fn: "count" } : uniquesAggregation()],
    },
    { compare: true, sparkline: true }
  );

/** A ranked list of one attribute, over one name. */
const ranking = (at: Placement, name: string | null, key: string, limit: number): BoardWidget =>
  card(at, "list", {
    ...(name ? { filter: nameIs(name) } : {}),
    groupBy: [attr(key)],
    aggregations: [uniquesAggregation()],
    orderBy: rankByFirst,
    limit,
    withTotal: true,
  });

const board = (widgets: BoardWidget[]): Board => ({
  version: BOARD_VERSION,
  range: { kind: "last", days: 30 },
  comparison: { kind: "previous" },
  filter: emptyFilter(),
  widgets,
});

function overviewBoard(): Board {
  return board([
    counter({ id: "views", title: "Page views", x: 0, y: 0, w: 300, h: 160 }, NAME.PAGE_VIEW, "entries"),
    counter({ id: "visitors", title: "Visitors", x: 320, y: 0, w: 300, h: 160 }, NAME.PAGE_VIEW, "uniques"),
    counter({ id: "installs", title: "Installs", x: 640, y: 0, w: 300, h: 160 }, NAME.APP_INSTALL, "uniques"),
    counter({ id: "launches", title: "Launches", x: 960, y: 0, w: 300, h: 160 }, NAME.APP_LAUNCH, "uniques"),

    card(
      { id: "series", title: "Visitors per day", x: 0, y: 180, w: 620, h: 300 },
      "bar",
      { filter: nameIs(NAME.PAGE_VIEW), aggregations: [uniquesAggregation()], bucket: daily, fill: true },
      { compare: true }
    ),

    // What used to be a three-step funnel. A funnel needs a self-join on one
    // person's entries in order, which this query layer does not answer, so the
    // card is the honest version of the same question: the three names side by
    // side over time, each counted on its own.
    card({ id: "journey", title: "Visits, installs and launches", x: 640, y: 180, w: 640, h: 300 }, "line", {
      filter: nameIn([NAME.PAGE_VIEW, NAME.APP_INSTALL, NAME.APP_LAUNCH]),
      groupBy: [{ kind: "column", column: "name" }],
      aggregations: [uniquesAggregation()],
      bucket: daily,
      limit: 200,
    }),

    ranking({ id: "pages", title: "Top pages", x: 0, y: 500, w: 620, h: 300 }, NAME.PAGE_VIEW, ATTR.URL_PATH, 10),
    ranking({ id: "refs", title: "Where people came from", x: 640, y: 500, w: 640, h: 300 }, NAME.PAGE_VIEW, ATTR.REFERRER_HOST, 10),
  ]);
}

function webBoard(): Board {
  return board([
    counter({ id: "views", title: "Page views", x: 0, y: 0, w: 300, h: 160 }, NAME.PAGE_VIEW, "entries"),
    counter({ id: "visitors", title: "Visitors", x: 320, y: 0, w: 300, h: 160 }, NAME.PAGE_VIEW, "uniques"),
    counter({ id: "sessions", title: "Sessions", x: 640, y: 0, w: 300, h: 160 }, NAME.SESSION_START, "entries"),
    counter({ id: "forms", title: "Form submits", x: 960, y: 0, w: 300, h: 160 }, NAME.FORM_SUBMIT, "uniques"),

    card(
      { id: "series", title: "Page views per day", x: 0, y: 180, w: 1280, h: 280 },
      "area",
      { filter: nameIs(NAME.PAGE_VIEW), aggregations: [{ fn: "count" }], bucket: daily, fill: true },
      { compare: true }
    ),

    ranking({ id: "pages", title: "Top pages", x: 0, y: 480, w: 400, h: 320 }, NAME.PAGE_VIEW, ATTR.URL_PATH, 10),
    ranking({ id: "refs", title: "Referrers", x: 440, y: 480, w: 400, h: 320 }, NAME.PAGE_VIEW, ATTR.REFERRER_HOST, 10),
    ranking({ id: "camps", title: "Campaigns", x: 880, y: 480, w: 400, h: 320 }, NAME.PAGE_VIEW, ATTR.UTM_CAMPAIGN, 10),

    card({ id: "vitals", title: "Web vitals", x: 0, y: 820, w: 620, h: 220 }, "table", {
      filter: nameIs(NAME.WEB_VITAL),
      groupBy: [attr(ATTR.METRIC)],
      aggregations: [
        { fn: "percentile", field: attr(ATTR.VALUE, "number"), p: 0.75 },
        { fn: "count" },
      ],
      orderBy: [{ key: { group: 0 }, direction: "asc" }],
      limit: 10,
    }),

    ranking({ id: "files", title: "Downloads", x: 640, y: 820, w: 640, h: 220 }, NAME.FILE_DOWNLOAD, ATTR.URL_PATH, 8),
  ]);
}

function appBoard(): Board {
  return board([
    counter({ id: "installs", title: "Installs", x: 0, y: 0, w: 300, h: 160 }, NAME.APP_INSTALL, "uniques"),
    counter({ id: "launches", title: "Launches", x: 320, y: 0, w: 300, h: 160 }, NAME.APP_LAUNCH, "uniques"),
    counter({ id: "sessions", title: "Sessions", x: 640, y: 0, w: 300, h: 160 }, NAME.SESSION_START, "entries"),
    counter({ id: "identified", title: "Identified", x: 960, y: 0, w: 300, h: 160 }, NAME.IDENTIFY, "uniques"),

    ranking({ id: "versions", title: "Versions in use", x: 0, y: 180, w: 620, h: 320 }, null, ATTR.SERVICE_VERSION, 20),

    // What used to be a retention curve. Retention needs each unique's first
    // entry and then its later ones, which is a self-join this layer does not
    // do. Daily active installs answers the question the curve was watched for
    // -- is the software still being opened -- without pretending to be a
    // cohort.
    card(
      { id: "active", title: "Active installs per day", x: 660, y: 180, w: 620, h: 320 },
      "line",
      { filter: nameIs(NAME.APP_LAUNCH), aggregations: [uniquesAggregation()], bucket: daily, fill: true },
      { compare: true }
    ),

    ranking({ id: "os", title: "Operating systems", x: 0, y: 520, w: 620, h: 280 }, NAME.APP_INSTALL, ATTR.OS_TYPE, 8),

    card({ id: "faults", title: "Errors per day", x: 660, y: 520, w: 620, h: 280 }, "bar", {
      filter: { op: "gte", field: { kind: "column", column: "severity" }, value: SEVERITY.ERROR },
      aggregations: [{ fn: "count" }],
      bucket: daily,
      fill: true,
    }),
  ]);
}

const blankBoard = (): Board => board([]);

export interface DashboardTemplate {
  key: string;
  name: string;
  description: string;
  /** Which kind of source this board is worth offering for. */
  fits: Array<Surface | "any">;
  build: () => Board;
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    key: "overview",
    name: "Overview",
    description: "Every surface side by side: traffic, installs, and where people came from.",
    fits: ["any"],
    build: overviewBoard,
  },
  {
    key: "web",
    name: "Website",
    description: "Traffic, pages, referrers, campaigns and vitals.",
    fits: ["web"],
    build: webBoard,
  },
  {
    key: "app",
    name: "App health",
    description: "Installs, versions in use, how many open it each day, and what is failing.",
    fits: ["desktop", "mobile"],
    build: appBoard,
  },
  {
    key: "blank",
    name: "Blank",
    description: "An empty canvas.",
    fits: ["any"],
    build: blankBoard,
  },
];

export const templatesFor = (surface: Surface): DashboardTemplate[] =>
  DASHBOARD_TEMPLATES.filter((t) => t.fits.includes("any") || t.fits.includes(surface));

export const templateByKey = (key: string): DashboardTemplate | undefined =>
  DASHBOARD_TEMPLATES.find((t) => t.key === key);

/**
 * What a project gets before anyone has touched it.
 *
 * The overview, because a project that has just been created does not yet know
 * which of its surfaces will be the interesting one.
 */
export const defaultBoard = (): Board => overviewBoard();

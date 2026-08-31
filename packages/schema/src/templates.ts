import { ATTR, NAME } from "./conventions.js";
import { BOARD_VERSION, type Board, type BoardWidget } from "./board.js";
import { emptyFilter, type LogQuery, type Visualisation } from "./query.js";
import {
  UNIQUES,
  allOf,
  atLeast,
  attr,
  dailyIn,
  nameIn,
  nameIs,
  rankingQuery,
  seriesQuery,
  sourceIs,
  totalQuery,
  vitalsQuery,
  type Unit,
} from "./recipes.js";

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
 * package because they PRODUCE a board: a template builds the same shape
 * `parseBoard` reads, so a card a template cannot express is a card the
 * customer could not have built either.
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

const daily = dailyIn(TEMPLATE_TZ);

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
const counter = (at: Placement, name: string, of: Unit): BoardWidget =>
  card(at, "number", totalQuery(of, nameIs(name)), { compare: true, sparkline: true });

/** A ranked list of one attribute, over one name. */
const ranking = (at: Placement, name: string | null, key: string, limit: number): BoardWidget =>
  card(
    at,
    "list",
    rankingQuery({ by: attr(key), ...(name ? { filter: nameIs(name) } : {}), limit })
  );

const board = (widgets: BoardWidget[]): Board => ({
  version: BOARD_VERSION,
  range: { kind: "last", days: 30 },
  comparison: { kind: "previous" },
  filter: emptyFilter(),
  // A template is a starting point for a real board, so it starts on real data.
  testMode: false,
  widgets,
});

function overviewBoard(): Board {
  return board([
    counter({ id: "views", title: "Page views", x: 0, y: 0, w: 400, h: 180 }, NAME.PAGE_VIEW, "entries"),
    counter({ id: "visitors", title: "Visitors", x: 400, y: 0, w: 400, h: 180 }, NAME.PAGE_VIEW, "uniques"),
    counter({ id: "installs", title: "Installs", x: 800, y: 0, w: 400, h: 180 }, NAME.APP_INSTALL, "uniques"),
    counter({ id: "launches", title: "Launches", x: 1200, y: 0, w: 420, h: 180 }, NAME.APP_LAUNCH, "uniques"),

    card(
      { id: "series", title: "Visitors per day", x: 0, y: 180, w: 800, h: 300 },
      "bar",
      seriesQuery("uniques", TEMPLATE_TZ, nameIs(NAME.PAGE_VIEW)),
      { compare: true }
    ),

    // What used to be a three-step funnel. A funnel needs a self-join on one
    // person's entries in order, which this query layer does not answer, so the
    // card is the honest version of the same question: the three names side by
    // side over time, each counted on its own.
    card({ id: "journey", title: "Visits, installs and launches", x: 800, y: 180, w: 820, h: 300 }, "line", {
      filter: nameIn([NAME.PAGE_VIEW, NAME.APP_INSTALL, NAME.APP_LAUNCH]),
      groupBy: [{ kind: "column", column: "name" }],
      aggregations: [UNIQUES()],
      bucket: daily,
      limit: 200,
    }),

    ranking({ id: "pages", title: "Top pages", x: 0, y: 480, w: 800, h: 300 }, NAME.PAGE_VIEW, ATTR.URL_PATH, 10),
    ranking({ id: "refs", title: "Where people came from", x: 800, y: 480, w: 820, h: 300 }, NAME.PAGE_VIEW, ATTR.REFERRER_HOST, 10),
  ]);
}

function webBoard(): Board {
  return board([
    counter({ id: "views", title: "Page views", x: 0, y: 0, w: 400, h: 180 }, NAME.PAGE_VIEW, "entries"),
    counter({ id: "visitors", title: "Visitors", x: 400, y: 0, w: 400, h: 180 }, NAME.PAGE_VIEW, "uniques"),
    counter({ id: "sessions", title: "Sessions", x: 800, y: 0, w: 400, h: 180 }, NAME.SESSION_START, "entries"),
    counter({ id: "forms", title: "Form submits", x: 1200, y: 0, w: 420, h: 180 }, NAME.FORM_SUBMIT, "uniques"),

    card(
      { id: "series", title: "Page views per day", x: 0, y: 180, w: 1620, h: 280 },
      "area",
      seriesQuery("entries", TEMPLATE_TZ, nameIs(NAME.PAGE_VIEW)),
      { compare: true }
    ),

    ranking({ id: "pages", title: "Top pages", x: 0, y: 460, w: 540, h: 320 }, NAME.PAGE_VIEW, ATTR.URL_PATH, 10),
    ranking({ id: "refs", title: "Referrers", x: 540, y: 460, w: 540, h: 320 }, NAME.PAGE_VIEW, ATTR.REFERRER_HOST, 10),
    ranking({ id: "camps", title: "Campaigns", x: 1080, y: 460, w: 540, h: 320 }, NAME.PAGE_VIEW, ATTR.UTM_CAMPAIGN, 10),

    card(
      { id: "vitals", title: "Web vitals", x: 0, y: 780, w: 800, h: 220 },
      "table",
      vitalsQuery(NAME.WEB_VITAL)
    ),

    ranking({ id: "files", title: "Downloads", x: 800, y: 780, w: 820, h: 220 }, NAME.FILE_DOWNLOAD, ATTR.URL_PATH, 8),
  ]);
}

function appBoard(): Board {
  return board([
    counter({ id: "installs", title: "Installs", x: 0, y: 0, w: 400, h: 180 }, NAME.APP_INSTALL, "uniques"),
    counter({ id: "launches", title: "Launches", x: 400, y: 0, w: 400, h: 180 }, NAME.APP_LAUNCH, "uniques"),
    counter({ id: "sessions", title: "Sessions", x: 800, y: 0, w: 400, h: 180 }, NAME.SESSION_START, "entries"),
    counter({ id: "identified", title: "Identified", x: 1200, y: 0, w: 420, h: 180 }, NAME.IDENTIFY, "uniques"),

    ranking({ id: "versions", title: "Versions in use", x: 0, y: 180, w: 800, h: 320 }, null, ATTR.SERVICE_VERSION, 20),

    // What used to be a retention curve. Retention needs each unique's first
    // entry and then its later ones, which is a self-join this layer does not
    // do. Daily active installs answers the question the curve was watched for
    // -- is the software still being opened -- without pretending to be a
    // cohort.
    card(
      { id: "active", title: "Active installs per day", x: 800, y: 180, w: 820, h: 320 },
      "line",
      seriesQuery("uniques", TEMPLATE_TZ, nameIs(NAME.APP_LAUNCH)),
      { compare: true }
    ),

    ranking({ id: "os", title: "Operating systems", x: 0, y: 500, w: 800, h: 280 }, NAME.APP_INSTALL, ATTR.OS_TYPE, 8),

    card(
      { id: "faults", title: "Errors per day", x: 800, y: 500, w: 820, h: 280 },
      "bar",
      seriesQuery("entries", TEMPLATE_TZ, atLeast("ERROR"))
    ),
  ]);
}

const blankBoard = (): Board => board([]);

export interface DashboardTemplate {
  key: string;
  name: string;
  description: string;

  build: () => Board;
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    key: "overview",
    name: "Overview",
    description: "Every source side by side: traffic, installs, and where people came from.",
    build: overviewBoard,
  },
  {
    key: "web",
    name: "Website",
    description: "Traffic, pages, referrers, campaigns and vitals.",
    build: webBoard,
  },
  {
    key: "app",
    name: "App health",
    description: "Installs, versions in use, how many open it each day, and what is failing.",
    build: appBoard,
  },
  {
    key: "blank",
    name: "Blank",
    description: "An empty canvas.",
    build: blankBoard,
  },
];

export const templateByKey = (key: string): DashboardTemplate | undefined =>
  DASHBOARD_TEMPLATES.find((t) => t.key === key);

/**
 * The same board, narrowed to one source for good.
 *
 * A board called *Marketing site* that shows the desktop app's numbers too is a
 * board somebody has to re-filter on every visit, so the constraint belongs to
 * the BOARD rather than to the person looking at it: it is ANDed into every
 * card before the key is derived, it survives a reload and a shared link, and
 * it is a filter like any other, so whoever opens the board can see it in the
 * filter sheet and take it off.
 *
 * ANDed onto whatever the template already carried rather than replacing it.
 * Every template here starts with no constraint, and this must not be the
 * reason that stops being safe to change.
 */
export function scopedToSource(layout: Board, sourceId: string): Board {
  const existing = layout.filter;
  const parts = existing.op === "and" ? existing.filters : [existing];
  return { ...layout, filter: allOf([...parts, sourceIs(sourceId)]) };
}

/**
 * What a project gets before anyone has touched it.
 *
 * The overview, because a project that has just been created does not yet know
 * which of its sources will be the interesting one.
 */
export const defaultBoard = (): Board => overviewBoard();

import { SEVERITY, severityBand, type SeverityBand } from "@firstrun/schema";
import { ATTR, NAME } from "@firstrun/schema/conventions";

/**
 * The fake instance the sign-in page shows, as pure data.
 *
 * No Solid, no DOM, no clock and no `Date`. One seeded generator and a frame
 * counter, so `buildFrameZero()` returns the same object on the server as it
 * does in the browser and the first client render is byte-identical to the HTML
 * that arrived. Hydration safety here is a property of the module rather than
 * something the component has to remember.
 *
 * That is also why there is no `Date.now()` anywhere below and why no value
 * produced here is ever handed to `Intl`. The preview keeps a FICTIONAL wall
 * clock: a number of milliseconds into an unnamed day, formatted by hand. A
 * real instant formatted through `Intl` would render in the server's timezone
 * and then again in the reader's, which is the one hydration mismatch that
 * takes a page down silently.
 *
 * ## What it is allowed to claim
 *
 * Everything here is one row shape: a time, a severity NUMBER on the 1..24
 * ladder, a name that is any string the customer chose, and an
 * attribute map. An exception, a page view and a measurement differ in what
 * they carry and in nothing else, which is the product's first rule rendered
 * rather than asserted. Eight of the twenty-one names below are invented ones a
 * customer would have chosen, and they take exactly the same treatment as the
 * conventional ones.
 *
 * No identity is promoted and none is required. `user.id`, `device.id` and
 * `session.id` are OPTIONAL attributes and an entry may carry none of them: the
 * server lane below mostly carries none, which is the honest answer rather than
 * a gap, because a process is not a device and inventing one for it is exactly
 * what this model stopped doing. Nothing here calls a device a person, and
 * `user.id` appears only where a client would have called `user()`.
 */

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/**
 * mulberry32, carried as one uint32 on the frame.
 *
 * The state travels with the frame rather than living in a module variable,
 * because a module variable is per-process: the server would advance it once
 * per render and every reader would get a different frame zero. Carried on the
 * frame, the sequence is a pure function of the seed and the beat.
 */
export class Rng {
  constructor(public s: number) {}

  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  /** A jitter multiplier in `1 - amount .. 1 + amount`. */
  jitter(amount: number): number {
    return 1 + (this.next() * 2 - 1) * amount;
  }
}

/** Arbitrary, and fixed forever: changing it changes every number on screen. */
const SEED = 0x5f37c1a9;

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * The three constants that encode causality, and the two beat offsets derived
 * from them. They live together because tuning one without re-deriving the
 * others fires the spark while the packet is still in mid-air, and the only
 * claim this preview exists to make is that the two are the same event.
 *
 * `PACKET_MS` is how long a packet takes to cross the wire, `RISER_MS` is how
 * long a spark takes to climb from the ribbon into a meter tile, and both are
 * spent in the stylesheet. `LAND_BEATS` puts the accept just after the packet
 * arrives, and `BUMP_BEATS` puts the meter change at the moment the spark
 * lands: `BEAT_MS * (BUMP_BEATS - LAND_BEATS)` is 660ms, which is `RISER_MS`
 * plus one frame.
 */
export const BEAT_MS = 220;
export const PACKET_MS = 520;
export const RISER_MS = 620;
export const LAND_BEATS = 2;
export const BUMP_BEATS = 5;

/** 14:09:00.000, as a millisecond offset into an unnamed day. */
const EPOCH_MS = 50_940_000;

const DAY_MS = 86_400_000;

/**
 * `14:09:03.221`, composed rather than formatted.
 *
 * `padStart` on integers is timezone-free and locale-free by construction, so
 * this is the same string in Zurich, in UTC and on the server. The moment this
 * became an `Intl.DateTimeFormat` call it would be a hydration mismatch for
 * every reader outside the server's timezone.
 */
export function formatClock(msOfDay: number): string {
  const ms = ((msOfDay % DAY_MS) + DAY_MS) % DAY_MS;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const milli = Math.floor(ms) % 1000;
  return (
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:` +
    `${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`
  );
}

/**
 * The window and the baseline, as CLAUDE.md requires them to be on screen.
 *
 * Composed from integer constants into a locale-neutral string for the same
 * reason as the clock above. A delta whose baseline is unstated is a number
 * nobody can check, so both windows are printed and neither is formatted
 * through a timezone.
 */
export const PREVIEW_WINDOW = "2026-08-30 14:09 to 2026-08-31 14:09";
export const PREVIEW_BASELINE = "2026-08-29 14:09 to 2026-08-30 14:09";

// ---------------------------------------------------------------------------
// The shape of the stream
// ---------------------------------------------------------------------------

/**
 * How fast the fake instance runs, and the one number every other number is
 * derived from.
 *
 * Four entries a second is 345,600 a day, which is roughly a hundred times what
 * Themia actually sends. The truth is about one entry every twenty-five
 * seconds, which is a still image, so the stream is deliberately faster than
 * life and the board says `Sample data` in its chrome. That badge is doing real
 * work: without it somebody signing in reads six figures of page views as their
 * own.
 */
const RATE_PER_SEC = 4;

/**
 * Entries per beat: 0, 1, 2 or 3.
 *
 * Twenty-five slots holding twenty-two entries, so the mean is exactly 0.88,
 * which at a 220ms beat is `RATE_PER_SEC`. The distribution matters as much as
 * the mean: a fixed one-per-beat metronome reads as an animation, and real
 * traffic arrives in a clump and then not at all for half a second.
 */
const PER_BEAT = [
  0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2,
  3,
] as const;

/** The three sources, named exactly as `db/seed.ts` names them.
 *
 * Named, never typed. A source has no surface and no kind: the column was
 * deleted, and the key is `fr_` plus sixteen hex with nothing in the middle. A
 * lane here is a row in a diagram, not a taxonomy. */
export const PREVIEW_SOURCES = ["themia.app", "Themia for Windows", "api.themia.app"] as const;

export interface Template {
  name: string;
  severity: number;
  lane: 0 | 1 | 2;
  weight: number;
  attrKeys: readonly string[];
}

/**
 * Twenty-one entry names, thirteen conventional and eight a customer invented.
 *
 * The invented ones are the point: `render_stalled` at 13 and `export_finished`
 * at 10 are stored, indexed and queried exactly like `page_view` at 9. There is
 * no allowlist anywhere, so a name is any string, and a preview that only ever
 * showed our own vocabulary would be advertising a restriction that does not
 * exist.
 */
export const TEMPLATES: readonly Template[] = [
  // themia.app
  { name: NAME.PAGE_VIEW, severity: SEVERITY.INFO, lane: 0, weight: 30,
    attrKeys: [ATTR.URL_PATH, ATTR.REFERRER_HOST, ATTR.BROWSER_LANGUAGE, ATTR.SESSION_ID] },
  { name: NAME.PAGE_LEAVE, severity: SEVERITY.INFO, lane: 0, weight: 7,
    attrKeys: [ATTR.URL_PATH, ATTR.DURATION_MS] },
  { name: NAME.WEB_VITAL, severity: SEVERITY.DEBUG, lane: 0, weight: 6,
    attrKeys: [ATTR.METRIC, ATTR.VALUE, ATTR.UNIT] },
  { name: NAME.SESSION_START, severity: SEVERITY.INFO, lane: 0, weight: 5,
    attrKeys: [ATTR.REFERRER_HOST, ATTR.SESSION_ID, ATTR.UTM_SOURCE, ATTR.UTM_MEDIUM] },
  { name: NAME.OUTBOUND_CLICK, severity: SEVERITY.INFO, lane: 0, weight: 3,
    attrKeys: [ATTR.URL_DOMAIN, ATTR.URL_PATH] },
  { name: "download_clicked", severity: SEVERITY.INFO, lane: 0, weight: 2.5,
    attrKeys: [ATTR.URL_PATH, ATTR.UTM_SOURCE] },
  { name: NAME.FILE_DOWNLOAD, severity: SEVERITY.INFO, lane: 0, weight: 2,
    attrKeys: [ATTR.URL_PATH, ATTR.CHANNEL] },
  { name: NAME.FORM_SUBMIT, severity: SEVERITY.INFO, lane: 0, weight: 1.5,
    attrKeys: [ATTR.URL_PATH, ATTR.URL_QUERY] },

  // Themia for Windows
  { name: NAME.APP_LAUNCH, severity: SEVERITY.INFO, lane: 1, weight: 6,
    attrKeys: [ATTR.OS_TYPE, ATTR.OS_VERSION, ATTR.SERVICE_VERSION, ATTR.CHANNEL] },
  { name: "export_finished", severity: SEVERITY.INFO + 1, lane: 1, weight: 2.5,
    attrKeys: [ATTR.DURATION_MS, ATTR.SERVICE_VERSION] },
  { name: NAME.APP_INSTALL, severity: SEVERITY.INFO, lane: 1, weight: 2,
    attrKeys: [ATTR.OS_TYPE, ATTR.OS_VERSION, ATTR.SERVICE_VERSION, ATTR.HOST_ARCH] },
  { name: "render_stalled", severity: SEVERITY.WARN, lane: 1, weight: 1.5,
    attrKeys: [ATTR.DURATION_MS, ATTR.METRIC] },
  { name: "project_created", severity: SEVERITY.INFO, lane: 1, weight: 1.2,
    attrKeys: [ATTR.SERVICE_VERSION, ATTR.SESSION_ID] },
  { name: NAME.EXCEPTION, severity: SEVERITY.ERROR, lane: 1, weight: 1.2,
    attrKeys: [ATTR.EXCEPTION_TYPE, ATTR.EXCEPTION_MESSAGE, ATTR.EXCEPTION_STACKTRACE, ATTR.OS_VERSION] },
  { name: NAME.IDENTIFY, severity: SEVERITY.INFO, lane: 1, weight: 1,
    attrKeys: [ATTR.USER_ID, ATTR.SESSION_ID] },
  { name: "update_failed", severity: SEVERITY.ERROR + 1, lane: 1, weight: 0.5,
    attrKeys: [ATTR.SERVICE_VERSION, ATTR.EXCEPTION_TYPE, ATTR.EXCEPTION_ESCAPED] },
  { name: "queue_flush_failed", severity: SEVERITY.FATAL, lane: 1, weight: 0.12,
    attrKeys: [ATTR.EXCEPTION_TYPE, ATTR.DURATION_MS, ATTR.SOURCE_ID] },

  // api.themia.app
  { name: NAME.HTTP_REQUEST, severity: SEVERITY.INFO, lane: 2, weight: 18,
    attrKeys: [ATTR.HTTP_REQUEST_METHOD, ATTR.HTTP_ROUTE, ATTR.HTTP_RESPONSE_STATUS_CODE, ATTR.DURATION_MS] },
  { name: NAME.MEASUREMENT, severity: SEVERITY.DEBUG, lane: 2, weight: 5,
    attrKeys: [ATTR.METRIC, ATTR.VALUE, ATTR.UNIT] },
  { name: "slow_query", severity: SEVERITY.WARN, lane: 2, weight: 1.5,
    attrKeys: [ATTR.DURATION_MS, ATTR.HTTP_ROUTE] },
  { name: "checkout_completed", severity: SEVERITY.INFO, lane: 2, weight: 0.8,
    attrKeys: [ATTR.USER_ID, ATTR.VALUE, ATTR.UTM_CAMPAIGN] },
];

const TOTAL_WEIGHT = TEMPLATES.reduce((sum, t) => sum + t.weight, 0);

function pickTemplate(rng: Rng): Template {
  let roll = rng.next() * TOTAL_WEIGHT;
  for (const t of TEMPLATES) {
    roll -= t.weight;
    if (roll <= 0) return t;
  }
  return TEMPLATES[0]!;
}

// ---------------------------------------------------------------------------
// The value pools
// ---------------------------------------------------------------------------

export const PREVIEW_PATHS = [
  "/",
  "/pricing",
  "/download",
  "/docs/quickstart",
  "/changelog",
  "/blog/one-log-for-everything",
  "/docs/self-hosting",
  "/docs/query",
  "/docs/tauri",
] as const;

const REFERRERS = ["news.ycombinator.com", "google.com", "github.com", "reddit.com", "(direct)"];
const LANGUAGES = ["en-GB", "en-US", "de-DE", "fr-FR"];
const OS_VERSIONS = ["10.0.26100", "10.0.22631", "10.0.19045"];
const ARCHES = ["amd64", "arm64"];
/** The three tracks `db/seed.ts` ships, rather than versions invented here. */
const VERSIONS = ["1.4.2", "1.4.0", "1.3.7"];
const CHANNELS = ["stable", "beta"];
const METHODS = ["GET", "POST"];
const ROUTES = ["/v1/e", "/api/projects/{id}", "/api/boards/{slug}"];
const STATUSES = ["200", "202", "404"];
const EXCEPTION_TYPES = ["IOException", "TimeoutException", "InvalidOperationException"];
const EXCEPTION_MESSAGES = ["file is locked", "request timed out after 30s"];
const METRICS = ["LCP", "INP", "CLS", "TTFB", "queue_depth", "rss_bytes", "frame_ms"];
const UTM_SOURCES = ["hn", "newsletter", "github"];
const DOMAINS = ["github.com", "docs.rs"];
const USER_IDS = ["u_8341", "u_2207", "u_5119"];

/**
 * Forty-eight installation ids, written out rather than generated.
 *
 * One installation sends many entries, so drawing from a small fixed pool is
 * what makes the same id appear on three rows a few seconds apart, which is
 * what a real tail looks like. Rendered in full and never truncated to look
 * like a person's handle.
 */
const DEVICE_IDS = [
  "9c41ab7d2f80e6c1", "3f7e2b19c05da864", "d208f4a76b3ce915", "51ba9e03d7f28c40",
  "8e30c5f19a64b2d7", "0a6d83bf47e1c592", "b7f21c4e8d095a36", "26c9d0a5f83b174e",
  "f4581e7cb230d9a6", "7d0b62a94ecf3815", "1e93f5d8072ab6c4", "ca4703b6e91d825f",
  "58ef1a920c73d46b", "a3c86d51f4207be9", "60b4e8c3a179df25", "e91d47f0b528ac63",
  "2f76b0d94a3e158c", "d5c2098e6bf471a3", "47a1f36c8092de5b", "b0e58d247c1a9f36",
  "93f6c1a05d8e274b", "1c47e920b6df385a", "6ba3d70f2c8145e9",
  "fe20b78d5c134a69", "05a9c46e2fb87d31", "8c1e73a0d549b28f", "3d6f80b12ea4c795",
  "72b5da930e6f1c84", "af03e6c584b21d97", "419c7f2ab8d0e563", "e6820d5b47f39ca1",
  "0d94a2f7c6135e8b", "5b8e10c3d972f4a6", "c73f5b8021ae6d94", "28d6094fb5e3c71a",
  "9f1c86b3e0472da5", "b45072e9c18f6a3d", "1a8d3c50f7b269e4", "6e2b91d47a0c538f",
  "d0574fa8c31b962e", "35c8e17b09df4a26", "80f3a695d2c47e1b", "4c9016bea583fd72",
  "e58724c0b19a6f3d", "170be493a26cf85d", "ab6f2d80e547931c", "7f3c58d1046be29a",
] as const;

// ---------------------------------------------------------------------------
// The derived seeds
// ---------------------------------------------------------------------------

/**
 * Every headline number, computed from `RATE_PER_SEC` and the weights above in
 * one place, so the board cannot contradict itself.
 *
 * Three designs for this preview all shipped numbers that disagreed with each
 * other by two orders of magnitude in the same box: a shelf holding a million
 * rows a day beside a throughput readout of three a second. Deriving them once
 * is what makes the arithmetic checkable.
 */
const PER_DAY = RATE_PER_SEC * 86_400;

function shareOf(name: string): number {
  const t = TEMPLATES.find((x) => x.name === name);
  return t ? t.weight / TOTAL_WEIGHT : 0;
}

export const PAGE_VIEW_SEED = Math.round(PER_DAY * shareOf(NAME.PAGE_VIEW));
export const APP_INSTALL_SEED = Math.round(PER_DAY * shareOf(NAME.APP_INSTALL));
export const ERROR_SEED = Math.round(
  PER_DAY *
    TEMPLATES.filter((t) => t.severity >= SEVERITY.ERROR).reduce(
      (sum, t) => sum + t.weight / TOTAL_WEIGHT,
      0
    )
);
/**
 * Uniques on ONE source, and never added to another number.
 *
 * `count(distinct coalesce(user.id, device.id, session.id))`, inside one source.
 * The same human on the website and in the app is two uniques, which is the
 * correct answer rather than a bug, so this tile names its source and no tile
 * anywhere sums across them.
 */
export const UNIQUES_SEED = 21_884;

/** Three daily partitions of `log_entries`. The newest is a partial day. */
export const PREVIEW_SHELVES = [
  "log_entries_2026_08_29",
  "log_entries_2026_08_30",
  "log_entries_2026_08_31",
] as const;

const SHELF_SEEDS = [
  Math.round(PER_DAY * 0.998),
  Math.round(PER_DAY * 1.002),
  // 14:09 into the day is 0.5896 of it.
  Math.round(PER_DAY * 0.5896),
];

/**
 * A day of traffic, by hour, normalised to its own mean.
 *
 * Quiet at 04:00, a morning climb, a plateau through the working day and a
 * long evening tail. The shape is what makes the histogram read as a real day
 * rather than as noise, and it is what makes the sliding window interesting to
 * watch rather than flat.
 */
const DIURNAL = [
  0.26, 0.22, 0.2, 0.21, 0.26, 0.38, 0.55, 0.78, 1.02, 1.2, 1.28, 1.31,
  1.29, 1.24, 1.22, 1.26, 1.3, 1.28, 1.18, 1.02, 0.84, 0.66, 0.48, 0.34,
];
const DIURNAL_MEAN = DIURNAL.reduce((a, b) => a + b, 0) / DIURNAL.length;

/** The count a full hour of `page_view` holds, before jitter. */
const BUCKET_MEAN = PAGE_VIEW_SEED / 24;

function bucketFor(epochHour: number, rng: Rng): number {
  const shape = DIURNAL[((epochHour % 24) + 24) % 24]! / DIURNAL_MEAN;
  return Math.max(1, Math.round(BUCKET_MEAN * shape * rng.jitter(0.07)));
}

/**
 * How much the open bucket grows per landing `page_view`.
 *
 * The window represents twenty-four hours and slides every 48 beats, so one
 * bucket is one hour compressed into 10.56 seconds. About thirteen page views
 * land in that time, and the bucket has to reach a plausible full hour by the
 * end of it, so each landing is worth a real hour's share rather than one row.
 * The hatch on that bar is what says the hour is not finished.
 */
const SLIDE_BEATS = 48;
const OPEN_STEP = Math.max(
  1,
  Math.round(BUCKET_MEAN / (SLIDE_BEATS * 0.88 * shareOf(NAME.PAGE_VIEW)))
);

/** Nine paths seeded to sum to the page view total, the last four within 350. */
const BREAKDOWN_SEEDS = [29_120, 17_640, 13_204, 10_512, 8_216, 6_940, 6_808, 6_502, 6_466];

/** The nine keys a project has already sent by the time anybody looks. */
const SEED_KEYS = [
  ATTR.URL_PATH,
  ATTR.REFERRER_HOST,
  ATTR.SESSION_ID,
  ATTR.SERVICE_VERSION,
  ATTR.OS_TYPE,
  ATTR.HTTP_ROUTE,
  ATTR.DURATION_MS,
  ATTR.BROWSER_LANGUAGE,
  ATTR.METRIC,
];

/** How late a late entry is. Real shapes: a lunch break, a night, a long weekend. */
const LATE_BY_MS = [41 * 60_000, 127 * 60_000, 192 * 60_000, 348 * 60_000, 1162 * 60_000];

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

export interface PreviewRow {
  id: number;
  name: string;
  severity: number;
  band: SeverityBand;
  lane: number;
  /**
   * The device this entry came from, or nothing.
   *
   * Nullable, and genuinely null for the whole server lane. A client sets what
   * it can actually know, and a backend logging an exception normally knows no
   * device at all.
   */
  deviceId: string | null;
  timeMs: number;
  attrs: readonly (readonly [string, string])[];
  late: boolean;
  lateByMs: number | null;
  /**
   * Whether this row arrived rather than having always been there.
   *
   * The entrance animation is keyed off this and `buildFrameZero()` never sets
   * it, which is what stops all twenty-two seeded rows animating at once the
   * instant motion turns on. It is an invariant enforced by a field rather than
   * by remembering.
   *
   * Set once, at construction, and NEVER cleared. Clearing it a beat later
   * would mean rebuilding the object, and a rebuilt object is a new node to
   * Solid: the row would be destroyed and recreated 220ms into its own 700ms
   * settle flash. The animations are one-shot, so a class that stays on a node
   * that is never recreated runs exactly once anyway.
   */
  fresh: boolean;
}

export interface BreakdownRow {
  path: string;
  count: number;
}

/** A beat-stamped one-shot effect. The component keys a `Show` on the stamp. */
export interface Stamp {
  beat: number;
  value: number;
}

export interface PreviewFrame {
  beat: number;
  rngState: number;
  clockMs: number;
  nextId: number;

  rows: readonly PreviewRow[];
  /** 24 hourly counts, oldest first. Index 23 is the open hour. */
  buckets: readonly number[];
  bucketEpoch: number;
  meters: readonly number[];
  deltas: readonly number[];
  sparks: readonly (readonly number[])[];
  breakdown: readonly BreakdownRow[];
  /**
   * The attribute keys seen IN THE VISIBLE RANGE.
   *
   * Not a list of every key ever sent, which is the version this started as and
   * which was wrong twice over. It contradicted the product (the pickers list
   * the keys actually written in the visible range, so a key nobody has sent
   * this window is a filter that matches nothing), and it SETTLED: the
   * vocabulary is finite, so after about a minute the strip had everything and
   * never moved again.
   *
   * Scoped to the range instead, a rare key ages out when the window slides
   * past it and is rediscovered the next time an entry carries one. The strip
   * is therefore never finished, which is the honest behaviour and the lively
   * one at the same time.
   *
   * Objects rather than bare strings so each carries whether it has just been
   * discovered. A string cannot hold that, and marking freshness outside the
   * array would mean rebuilding it every beat, which recreates every chip.
   */
  keys: readonly { key: string; fresh: boolean }[];

  /**
   * When each key was last carried by an entry, by key.
   *
   * Deliberately NOT a field on the objects above. Those are rendered, and
   * touching one every time its key turns up would rebuild the object, which
   * makes Solid destroy and recreate the chip and replay its entrance
   * animation several times a second.
   */
  keySeen: Readonly<Record<string, number>>;
  throughput: readonly number[];
  openSecond: number;
  ratePerSec: number;
  shelves: readonly number[];
  p50Ms: number;
  p50Late: boolean;

  /** Packets currently crossing the wire. */
  inflight: readonly { id: number; lane: number }[];
  /** Per lane, the beat it last emitted. Drives the emitter tile flash. */
  laneFired: readonly number[];
  /** The beat the endpoint last accepted something. Drives the 202. */
  acceptBeat: number;
  /** Per shelf, the beat it was last written to, and the severity that hit it. */
  shelfHit: readonly Stamp[];
  /** Per meter, the beat its odometer last moved. */
  meterBump: readonly number[];
  /** Per riser, the beat a spark last started climbing it. */
  riserFired: readonly number[];
  /** The bucket a late entry grew, and when. `value` is the bucket index. */
  lateBucket: Stamp | null;
  /** The caption under the chart, held for eleven beats by the clock. */
  lateNote: { beat: number; delayMs: number } | null;
  /** The beat the window last slid. Drives the board sweep. */
  slideBeat: number;
  /** Which row is showing its attribute map. */
  expandedId: number | null;
  /** The row whose breakdown count just moved. */
  breakdownHit: Stamp | null;

  /**
   * Effects emitted but not yet landed. At most about thirty records.
   *
   * On the FRAME rather than in a module variable, which is what makes
   * `advance` a pure function of its argument. A module-level queue is shared
   * by every frame chain in the process: two concurrent server renders would
   * drain each other's entries, and two frames advanced from the same seed
   * would diverge within five beats. This one is never rendered, and it is
   * empty at frame zero, so it costs the server nothing.
   */
  pending: readonly Pending[];
}

export interface Pending {
  landsAt: number;
  bumpsAt: number;
  lane: number;
  name: string;
  severity: number;
  band: SeverityBand;
  meter: number | null;
  path: string | null;
  isPageView: boolean;
  late: boolean;
  lateBucket: number | null;
  lateByMs: number | null;
  attrKeys: readonly string[];
}

// ---------------------------------------------------------------------------
// Building one entry
// ---------------------------------------------------------------------------

function valueFor(key: string, rng: Rng): string {
  switch (key) {
    case ATTR.URL_PATH:
      return rng.pick(PREVIEW_PATHS);
    case ATTR.REFERRER_HOST:
      return rng.pick(REFERRERS);
    case ATTR.BROWSER_LANGUAGE:
      return rng.pick(LANGUAGES);
    case ATTR.SESSION_ID:
      return `s_${rng.int(0xffffff).toString(16).padStart(6, "0")}`;
    case ATTR.DURATION_MS:
      return String(rng.int(2400) + 12);
    case ATTR.METRIC:
      return rng.pick(METRICS);
    case ATTR.VALUE:
      return String(Math.round(rng.next() * 2400) / 100);
    case ATTR.UNIT:
      return rng.pick(["ms", "s", "byte", "1"]);
    case ATTR.UTM_SOURCE:
      return rng.pick(UTM_SOURCES);
    case ATTR.UTM_MEDIUM:
      return rng.pick(["referral", "email", "organic"]);
    case ATTR.UTM_CAMPAIGN:
      return rng.pick(["launch", "v1-4", "self-hosting"]);
    case ATTR.URL_QUERY:
      return rng.pick(["", "?plan=team", "?ref=hn"]);
    case ATTR.EXCEPTION_ESCAPED:
      return rng.pick(["true", "false"]);
    case ATTR.SOURCE_ID:
      return "fr_9f3ab21c4d5e6f70";
    case ATTR.SESSION_ID:
      return `s_${rng.int(0xffffff).toString(16).padStart(6, "0")}`;
    case ATTR.URL_DOMAIN:
      return rng.pick(DOMAINS);
    case ATTR.CHANNEL:
      return rng.pick(CHANNELS);
    case ATTR.OS_TYPE:
      return "windows";
    case ATTR.OS_VERSION:
      return rng.pick(OS_VERSIONS);
    case ATTR.SERVICE_VERSION:
      return rng.pick(VERSIONS);
    case ATTR.HOST_ARCH:
      return rng.pick(ARCHES);
    case ATTR.HTTP_REQUEST_METHOD:
      return rng.pick(METHODS);
    case ATTR.HTTP_ROUTE:
      return rng.pick(ROUTES);
    case ATTR.HTTP_RESPONSE_STATUS_CODE:
      return rng.pick(STATUSES);
    case ATTR.EXCEPTION_TYPE:
      return rng.pick(EXCEPTION_TYPES);
    case ATTR.EXCEPTION_MESSAGE:
      return rng.pick(EXCEPTION_MESSAGES);
    case ATTR.EXCEPTION_STACKTRACE:
      return "IOException: file is locked\\n    at themia::run (src/lib.rs:214)";
    case ATTR.USER_ID:
      return rng.pick(USER_IDS);
    default:
      return "1";
  }
}

function buildRow(
  rng: Rng,
  id: number,
  clockMs: number,
  late: boolean,
  fresh: boolean
): PreviewRow {
  const template = pickTemplate(rng);
  const lateByMs = late ? rng.pick(LATE_BY_MS) : null;
  const attrs = template.attrKeys.map((k) => [k, valueFor(k, rng)] as const);
  return {
    id,
    name: template.name,
    severity: template.severity,
    band: severityBand(template.severity),
    lane: template.lane,
    // A browser and an app know their device. A server process does not, and
    // says so rather than inventing one.
    deviceId: template.lane === 2 ? null : rng.pick(DEVICE_IDS),
    // A late entry's `time` is its own, which is what it was stamped with on a
    // laptop that was offline. `ingested_at` is now, and is not shown on a row.
    timeMs: late ? clockMs - (lateByMs ?? 0) : clockMs,
    attrs,
    late,
    lateByMs,
    fresh,
  };
}

/** Which meter an entry moves, or none. Most entries move none. */
function meterFor(row: PreviewRow, rng: Rng): number | null {
  if (row.severity >= SEVERITY.ERROR) return 2;
  if (row.name === NAME.PAGE_VIEW) {
    // A page view on the website is also a unique now and then: the same
    // installation sends many, so only some of them are the first this window.
    return rng.next() < 0.18 ? 3 : 0;
  }
  if (row.name === NAME.APP_INSTALL) return 1;
  return null;
}

const MAX_ROWS = 22;

/**
 * The strip stops growing because the vocabulary is finite, not because a
 * number said so.
 *
 * Counted from the templates rather than written down, so a key added above is
 * a key the strip can reach. A discovered-keys strip that grew forever would be
 * a lie about a project that has settled, and one that stopped at an arbitrary
 * cap would be a lie about a project that had not.
 */
const MAX_KEYS = new Set(TEMPLATES.flatMap((t) => t.attrKeys)).size;

/**
 * How long a key stays on the strip after the last entry that carried it.
 *
 * Two windows. Long enough that an ordinary key never flickers (anything above
 * about one percent of the stream turns up several times a window), short
 * enough that the genuinely rare ones age out and come back, which is what
 * keeps the strip working for as long as the page is open.
 */
const KEY_RETENTION_BEATS = SLIDE_BEATS * 2;
const THROUGHPUT_CELLS = 40;
const LATE_EVERY = 34;
const EXPAND_EVERY = 26;
const THROUGHPUT_EVERY = 5;

// ---------------------------------------------------------------------------
// Frame zero
// ---------------------------------------------------------------------------

/**
 * The board as it is the moment somebody opens the page.
 *
 * Full, not empty: twenty-two rows already in the tail, twenty-four filled
 * buckets, four meters at their seeds, nine keys already discovered. This is
 * also exactly what somebody who has turned the motion off sees, and what a
 * reader who asked for reduced motion sees, which is why it has to read as a
 * screenshot of a working board rather than as a loading state.
 *
 * The wire is EMPTY at frame zero. Nothing is in flight, no chip is lit and no
 * spark is climbing, so the server sends no element that is mid-animation.
 */
export function buildFrameZero(): PreviewFrame {
  const rng = new Rng(SEED);

  const rows: PreviewRow[] = [];
  for (let i = 0; i < MAX_ROWS; i++) {
    // Each row is a little older than the one above it, which is what makes the
    // times descend down the tail the way arrival order does.
    rows.push(buildRow(rng, MAX_ROWS - i, EPOCH_MS - i * 260, false, false));
  }

  const buckets: number[] = [];
  for (let i = 0; i < 24; i++) buckets.push(bucketFor(i, rng));
  // The open hour is partial by definition, so it starts low and climbs.
  buckets[23] = Math.round(buckets[23]! * 0.18);

  const sparks: number[][] = [];
  for (let m = 0; m < 4; m++) {
    const strip: number[] = [];
    for (let i = 0; i < 24; i++) strip.push(0.35 + rng.next() * 0.6);
    sparks.push(strip);
  }

  // Raw counts per closed window, not fractions. The bars are normalised at
  // render against the tallest cell, so the strip cannot quietly rescale the
  // number printed beside it.
  const throughput: number[] = [];
  for (let i = 0; i < THROUGHPUT_CELLS; i++) throughput.push(3 + rng.int(4));

  return {
    beat: 0,
    rngState: rng.s,
    clockMs: EPOCH_MS,
    nextId: MAX_ROWS + 1,
    rows,
    buckets,
    bucketEpoch: 24,
    meters: [PAGE_VIEW_SEED, APP_INSTALL_SEED, ERROR_SEED, UNIQUES_SEED],
    deltas: [0.062, 0.034, -0.118, 0.049],
    sparks,
    breakdown: PREVIEW_PATHS.map((path, i) => ({ path, count: BREAKDOWN_SEEDS[i]! })),
    keys: SEED_KEYS.map((key) => ({ key, fresh: false })),
    keySeen: Object.fromEntries(SEED_KEYS.map((key) => [key, 0])),
    throughput,
    openSecond: 0,
    ratePerSec: RATE_PER_SEC,
    shelves: SHELF_SEEDS,
    p50Ms: 42,
    p50Late: false,
    inflight: [],
    laneFired: [-99, -99, -99],
    acceptBeat: -99,
    shelfHit: [
      { beat: -99, value: 0 },
      { beat: -99, value: 0 },
      { beat: -99, value: 0 },
    ],
    meterBump: [-99, -99, -99, -99],
    riserFired: [-99, -99, -99, -99],
    lateBucket: null,
    lateNote: null,
    slideBeat: -99,
    expandedId: null,
    breakdownHit: null,
    pending: [],
  };
}

// ---------------------------------------------------------------------------
// One beat
// ---------------------------------------------------------------------------

/**
 * The next frame.
 *
 * Arrays are reused by reference wherever nothing in them changed, so a memo
 * over `buckets` re-runs on a slide beat and not on the other forty-seven. That
 * is the whole performance story: one signal write a beat, and the fine-grained
 * graph below it only recomputes what actually moved.
 */
export function advance(frame: PreviewFrame): PreviewFrame {
  const rng = new Rng(frame.rngState);
  const beat = frame.beat + 1;
  const clockMs = frame.clockMs + BEAT_MS;

  // --- emit ---------------------------------------------------------------
  const count = rng.pick(PER_BEAT);
  const isLateBeat = beat % LATE_EVERY === 0;
  let rows = frame.rows;
  let nextId = frame.nextId;
  const inflight = frame.inflight.slice(-6);
  const laneFired = frame.laneFired.slice();
  const pending = frame.pending.slice();

  if (count > 0) {
    const arriving: PreviewRow[] = [];
    for (let i = 0; i < count; i++) {
      const late = isLateBeat && i === 0;
      const row = buildRow(rng, nextId++, clockMs, late, true);
      arriving.push(row);
      laneFired[row.lane] = beat;
      inflight.push({ id: row.id, lane: row.lane });

      const meter = meterFor(row, rng);
      const path = row.attrs.find(([k]) => k === ATTR.URL_PATH)?.[1] ?? null;
      pending.push({
        landsAt: beat + LAND_BEATS,
        bumpsAt: beat + BUMP_BEATS,
        lane: row.lane,
        name: row.name,
        severity: row.severity,
        band: row.band,
        meter,
        path,
        isPageView: row.name === NAME.PAGE_VIEW,
        late: row.late,
        // Two to nineteen buckets back, never the open one: a late entry
        // belongs to the hour it happened in, not to the hour it arrived in.
        lateBucket: row.late ? 23 - (2 + rng.int(18)) : null,
        lateByMs: row.lateByMs,
        attrKeys: row.attrs.map(([k]) => k),
      });
    }
    // Newest first, and the previous frame's arrivals stop being fresh so their
    // entrance animation is not re-declared on a node that already ran it.
    // Newest first. Every surviving row keeps its object identity, which is
    // what keeps its DOM node alive and its animations uninterrupted.
    rows = [...arriving.reverse(), ...frame.rows].slice(0, MAX_ROWS);
  }

  // --- drain --------------------------------------------------------------
  let buckets = frame.buckets;
  let shelves = frame.shelves;
  let breakdown = frame.breakdown;
  let keys = frame.keys;
  let keySeen = frame.keySeen;
  let meters = frame.meters;
  let sparks = frame.sparks;
  const shelfHit = frame.shelfHit.slice();
  const meterBump = frame.meterBump.slice();
  const riserFired = frame.riserFired.slice();
  const freshKeys: string[] = [];
  const seenThisBeat: string[] = [];
  let acceptBeat = frame.acceptBeat;
  let lateBucket = frame.lateBucket;
  let lateNote = frame.lateNote;
  let breakdownHit = frame.breakdownHit;
  let openSecond = frame.openSecond;
  let p50Ms = frame.p50Ms;
  let p50Late = frame.p50Late;

  const stillPending: Pending[] = [];
  for (const p of pending) {
    // DRAIN ONE: the edge accepted it and the row exists on disk.
    if (p.landsAt === beat) {
      acceptBeat = beat;
      openSecond += 1;

      const shelf = p.late ? (p.lateByMs! > 12 * 3_600_000 ? 0 : 1) : 2;
      shelves = shelves.map((v, i) => (i === shelf ? v + 1 : v));
      shelfHit[shelf] = { beat, value: p.severity };

      if (p.isPageView) {
        if (p.late && p.lateBucket !== null) {
          const idx = p.lateBucket;
          buckets = buckets.map((v, i) => (i === idx ? v + OPEN_STEP : v));
          lateBucket = { beat, value: idx };
          lateNote = { beat, delayMs: p.lateByMs ?? 0 };
        } else {
          buckets = buckets.map((v, i) => (i === 23 ? v + OPEN_STEP : v));
        }
        if (p.path) {
          const idx = breakdown.findIndex((b) => b.path === p.path);
          if (idx >= 0) {
            breakdown = breakdown.map((b, i) =>
              i === idx ? { path: b.path, count: b.count + OPEN_STEP } : b
            );
            breakdownHit = { beat, value: idx };
          }
        }
      } else if (p.late) {
        // A late entry that is not a page view still lands on an older shelf
        // and still spikes the lateness readout. It just has no bar to grow.
        lateNote = { beat, delayMs: p.lateByMs ?? 0 };
      }

      if (p.late) {
        p50Ms = p.lateByMs ?? p50Ms;
        p50Late = true;
      }

      // Attributes are DISCOVERED. A key nobody has sent is not an error and
      // not a schema change: it is a key that starts existing the first time an
      // entry carries it, and this is the only place in the product that says
      // so out loud.
      for (const k of p.attrKeys) {
        seenThisBeat.push(k);
        const known = keys.some((e) => e.key === k) || freshKeys.includes(k);
        if (!known && keys.length + freshKeys.length < MAX_KEYS) freshKeys.push(k);
      }

      if (p.meter !== null) riserFired[p.meter] = beat;
    } else if (p.bumpsAt === beat) {
      // DRAIN TWO: the spark has arrived, so now the number moves.
      if (p.meter !== null) {
        const m = p.meter;
        meters = meters.map((v, i) => (i === m ? v + 1 : v));
        meterBump[m] = beat;
        sparks = sparks.map((strip, i) =>
          i === m ? [...strip.slice(0, 23), Math.min(1, strip[23]! + 0.02)] : strip
        );
      }
    }
    if (p.bumpsAt > beat) stillPending.push(p);
  }
  // (the surviving records are carried on the returned frame)

  if (freshKeys.length > 0) {
    keys = [...freshKeys.map((key) => ({ key, fresh: true })), ...keys];
  }
  if (seenThisBeat.length > 0) {
    keySeen = { ...keySeen };
    for (const k of seenThisBeat) (keySeen as Record<string, number>)[k] = beat;
  }

  // The lateness readout holds its spike for four beats and then settles back
  // to an ordinary transport delay. It is the ONLY place `ingested_at` appears,
  // and it never sorts, buckets or retains anything.
  if (p50Late && lateNote && beat - lateNote.beat > 4) {
    p50Late = false;
    p50Ms = 38 + rng.int(9);
  }
  if (lateNote && beat - lateNote.beat > 11) lateNote = null;

  // --- the clock's own periodic work --------------------------------------
  let throughput = frame.throughput;
  let ratePerSec = frame.ratePerSec;
  if (beat % THROUGHPUT_EVERY === 0) {
    throughput = [...frame.throughput.slice(1), openSecond];
    // Smoothed, not instantaneous. One 1.1 second window holds four or five
    // entries, so the raw quotient swings between 0.9 and 4.5 every second and
    // is unreadable. The strip beside it shows the windows themselves, so the
    // jitter is on screen either way and the number does not have to carry it.
    const instant = openSecond / ((BEAT_MS * THROUGHPUT_EVERY) / 1000);
    ratePerSec = frame.ratePerSec * 0.7 + instant * 0.3;
    openSecond = 0;
    if (!p50Late) p50Ms = 38 + rng.int(9);
  }

  let expandedId = frame.expandedId;
  if (beat % EXPAND_EVERY === 0) expandedId = rows[2]?.id ?? null;

  let bucketEpoch = frame.bucketEpoch;
  let deltas = frame.deltas;
  let slideBeat = frame.slideBeat;
  if (beat % SLIDE_BEATS === 0) {
    // The window slides by one hour. Everything that is a function of the
    // window moves on this beat and only on this beat, so eight changes read as
    // one re-run of the board's queries rather than as unrelated fidgeting.
    bucketEpoch += 1;
    const opened = Math.round(bucketFor(bucketEpoch, rng) * 0.18);
    buckets = [...buckets.slice(1), opened];
    sparks = sparks.map((strip) => [...strip.slice(1), 0.35 + rng.next() * 0.6]);
    // The baseline moved, so the deltas are recomputed. They deliberately do
    // NOT tick with every entry: a baseline that moves four times a second is
    // not a baseline, and a delta whose baseline moves is not a comparison.
    deltas = frame.deltas.map((d) => d + (rng.next() * 0.008 - 0.004));
    // The range moved, so a key nothing has carried for two windows is no
    // longer a key in the range. Filtering PRESERVES the identity of every
    // survivor, so no surviving chip is recreated and none of them re-animate.
    // Only the removals leave, and the rediscoveries arrive as new chips.
    const cutoff = beat - KEY_RETENTION_BEATS;
    const kept = keys.filter((e) => (keySeen[e.key] ?? 0) > cutoff);
    if (kept.length !== keys.length && kept.length > 0) keys = kept;
    slideBeat = beat;
  }

  return {
    beat,
    rngState: rng.s,
    clockMs,
    nextId,
    rows,
    buckets,
    bucketEpoch,
    meters,
    deltas,
    sparks,
    breakdown,
    keys,
    keySeen,
    throughput,
    openSecond,
    ratePerSec,
    shelves,
    p50Ms,
    p50Late,
    inflight,
    laneFired,
    acceptBeat,
    shelfHit,
    meterBump,
    riserFired,
    lateBucket,
    lateNote,
    slideBeat,
    expandedId,
    breakdownHit,
    pending: stillPending,
  };
}

/** The chart's own caption, as a query rather than as a sentence. */
export const PREVIEW_QUERY_LINE =
  "count(*) where name = 'page_view' group by hour(time) limit 24";

/** What the four meters are, printed on the tiles as the queries they are. */
export const METER_QUERIES = [
  "name = 'page_view'",
  "name = 'app_install'",
  "severity >= 17",
  "coalesce(user.id, device.id, session.id)",
] as const;

/** The board's permanent filters. A filter belongs to the board, not the viewer. */
export const PREVIEW_FILTERS = ["severity >= 9", "firstrun.test is not true"] as const;

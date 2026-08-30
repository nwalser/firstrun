#!/usr/bin/env bun
import { templateByKey } from "@firstrun/schema";
import { ATTR, NAME, WEB_VITALS, type WebVital } from "@firstrun/schema/conventions";
import { SEVERITY } from "@firstrun/schema/severity";
import type { Surface } from "@firstrun/schema/surface";
import { eq, sql as raw } from "drizzle-orm";
import { createStore } from "./client.js";
import { insertLogEntries, type AttributeValue, type LogEntryInput } from "./log-entries.js";
import { applyMigrations } from "./migrate.js";
import { clearProjectData } from "./repo.js";
import { dashboards, projects, sources, users, workspaceMembers, workspaces } from "./schema.js";

/**
 * A synthetic workspace shaped like the first real subject: a Windows desktop
 * app, its marketing site, and the API behind both.
 *
 * ONE TABLE, ONE ROW SHAPE, EVERY KIND OF TELEMETRY. A page view, a crash, an
 * HTTP request and a queue-depth sample are all `log_entries` rows here, and
 * nothing in this file writes them differently: they differ in the `name` they
 * carry, the severity they were stamped with and the attributes they hold. If
 * you can find a second write path in this file, it is a bug.
 *
 * THREE SURFACES, AND NOTHING JOINS THEM. The site has visitors, the app has
 * installs, the API has processes, they are three separate anonymous id spaces,
 * and no row here claims that two of them are the same person. That is not a
 * gap in the fixture: it is the product. A funnel whose steps cross two
 * surfaces reads zero at the crossing, and that is the honest answer.
 *
 * The numbers are not decoration. A screen you cannot look at is a screen you
 * cannot judge: if the drop from install to second launch is invisible on fake
 * data, it will be invisible on real data too. The same goes for the parts the
 * query layer is new for. There are entries at every band of the severity
 * ladder, entries carrying genuine JSON numbers so a percentile is arithmetic
 * rather than a cast, entries following no convention at all, and entries with
 * NO severity, because unclassified is a legal state and a filter has to behave
 * sensibly in front of one.
 *
 * Everything random is driven by one seeded RNG, so two runs on the same day
 * produce the same workspace and a diff in the numbers means a diff in the
 * code. Only the CLOCK moves it: the window is the last thirty days, so the
 * counts drift a little across midnight and the fixture keeps landing in the
 * partitions a dashboard is actually looking at.
 */

const SEED_WORKSPACE_ID = "3d8e1a47-5c62-4f19-a83b-11c4de90f277";
const SEED_PROJECT_ID = "7f9b5c2e-1d4a-4f8b-9c3e-6a2b8d5f1e40";
const SEED_WEB_SOURCE_ID = "1b6f0c58-3f2a-4a91-8f2d-9c1e77a04b11";
const SEED_DESKTOP_SOURCE_ID = "2c7a1d69-4e3b-4b02-9a3e-0d2f88b15c22";
const SEED_SERVER_SOURCE_ID = "4e8c3b7a-6d15-4c23-b1f4-8a3e99c26d33";
const SEED_WEB_KEY = "fr_web_5eed000000000001";
const SEED_DESKTOP_KEY = "fr_desktop_5eed000000000002";
const SEED_SERVER_KEY = "fr_server_5eed000000000003";
const SEED_USER_LOGIN = process.env.SEED_USER ?? "seed";
const ASSET_NAME = "Themia-Setup";
const DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const TARGET = {
  visitors: 3400,
  installs: 780,
  /** Requests the API serves in a month. Sampled, the way a real one would be. */
  requests: 11_000,
};

/** Where an install sits in the version story. */
const TRACKS = [
  { name: "current", weight: 0.62, version: "1.4.2", quiet: false },
  { name: "lagging", weight: 0.22, version: "1.4.0", quiet: false },
  // The cohort the version table exists to surface: still installed, on an old
  // build, and no longer launching.
  { name: "stale", weight: 0.16, version: "1.3.7", quiet: true },
] as const;

/** How the app was obtained. A label the app reports, not something we infer. */
const CHANNELS = [
  { name: "site", weight: 0.85 },
  { name: "winget", weight: 0.1 },
  { name: "shared-link", weight: 0.05 },
] as const;

const OSES = ["windows", "windows", "windows", "windows", "darwin"] as const;
const LOCALES = ["de-CH", "de-DE", "en-US", "en-GB", "fr-CH", "it-CH"] as const;

const UTM = [
  { source: null, medium: null, campaign: null, referrer: "https://www.google.com/" },
  { source: "google", medium: "organic", campaign: null, referrer: "https://www.google.com/" },
  { source: "reddit", medium: "social", campaign: "r-datahoarder", referrer: "https://old.reddit.com/" },
  { source: "newsletter", medium: "email", campaign: "2026-08", referrer: null },
  { source: "producthunt", medium: "referral", campaign: "launch", referrer: "https://www.producthunt.com/" },
] as const;

/** Landing pages, weighted the way a small marketing site actually reads. */
const LANDINGS = [
  { path: "/", weight: 0.58 },
  { path: "/download", weight: 0.18 },
  { path: "/pricing", weight: 0.12 },
  { path: "/docs/getting-started", weight: 0.08 },
  { path: "/changelog", weight: 0.04 },
] as const;

const NEXT_PAGES = ["/download", "/pricing", "/docs/getting-started", "/changelog", "/"] as const;

const ORIGIN = "https://themia.app";
const API_ORIGIN = "https://api.themia.app";

/** Good-ish vitals with a slow tail, so p75 is a number worth reading. */
const VITAL_RANGE: Record<WebVital, [number, number]> = {
  LCP: [900, 4200],
  INP: [40, 420],
  CLS: [0, 0.28],
  FCP: [600, 2600],
  TTFB: [90, 1400],
};

/**
 * The routes the API serves, with the shape of their latency and how often they
 * fail. `weight` is share of traffic.
 */
const ROUTES = [
  { route: "/v1/licence/{key}", method: "GET", weight: 0.34, ms: [8, 90] as const, fail: 0.004 },
  { route: "/v1/sync", method: "POST", weight: 0.28, ms: [40, 900] as const, fail: 0.011 },
  { route: "/v1/index/{id}", method: "GET", weight: 0.18, ms: [15, 260] as const, fail: 0.006 },
  { route: "/v1/export", method: "POST", weight: 0.12, ms: [220, 4200] as const, fail: 0.023 },
  { route: "/v1/webhook/stripe", method: "POST", weight: 0.08, ms: [30, 400] as const, fail: 0.002 },
] as const;

/**
 * The things that go wrong, per surface. Every one of them becomes an entry
 * named `exception` carrying the OTel `exception.*` attributes, which is the
 * whole of what "error tracking" is in this system: a log entry, at a severity
 * that says how bad, with the conventional keys filled in.
 */
const WEB_FAULTS = [
  { type: "TypeError", message: "Cannot read properties of undefined (reading 'plan')" },
  { type: "ChunkLoadError", message: "Loading chunk 42 failed" },
] as const;

const APP_FAULTS = [
  { type: "IoError", message: "The process cannot access the file because it is being used by another process" },
  { type: "SqliteError", message: "database is locked" },
  { type: "SerdeError", message: "invalid type: null, expected a string at line 1 column 18" },
] as const;

const API_FAULTS = [
  { type: "TimeoutError", message: "upstream timed out after 5000ms" },
  { type: "PoolExhausted", message: "no connection available after 10000ms" },
  { type: "ValidationError", message: "body must contain at least one document" },
] as const;

/** mulberry32. Small, fast, and the same on every machine. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20260829);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number): boolean => rand() < p;
const between = (lo: number, hi: number): number => lo + rand() * (hi - lo);

function weighted<T extends { weight: number }>(options: readonly T[]): T {
  let r = rand();
  for (const o of options) {
    if (r < o.weight) return o;
    r -= o.weight;
  }
  return options[options.length - 1]!;
}

/**
 * Arrivals per day. Weekends are quieter and there is one Product Hunt spike,
 * because a chart over flat traffic hides exactly the shape a founder opens
 * this screen to find. Normalised so the month still totals the target.
 */
function perDay(total: number): number[] {
  const weights: number[] = [];
  for (let day = 0; day < DAYS; day++) {
    const date = new Date(Date.now() - (DAYS - 1 - day) * DAY);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    const spike = day === DAYS - 12 ? 2.6 : 1;
    weights.push((weekend ? 0.55 : 1) * spike * between(0.85, 1.15));
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.round((w * total) / sum));
}

/**
 * How often an install that is still around opens the app on day N.
 *
 * The floor matters: a habitual user does not decay to zero, they settle into
 * opening it a couple of times a week forever. Churn is modelled separately, by
 * installs stopping outright, because "everyone slowly uses it less" and "most
 * stop and the rest keep going" produce very different retention curves and
 * only the second is what actually happens.
 */
const launchChance = (daysSinceInstall: number): number =>
  0.55 * Math.exp(-daysSinceInstall / 6) + 0.22;

/**
 * The day an install stops opening the app for good. Most of the loss is in the
 * first few days: someone downloads a tool, opens it once, and never thinks
 * about it again. That early cliff is the shape retention exists to show.
 */
function churnDay(quiet: boolean): number {
  if (quiet) return between(4, 11);
  if (chance(0.44)) return between(0, 3);
  if (chance(0.4)) return between(4, 12);
  return Infinity;
}

const startOfDay = (day: number): number => Date.now() - (DAYS - 1 - day) * DAY;
/** Business hours in CET, roughly, and never in the future. */
const arrival = (day: number): number =>
  Math.min(startOfDay(day) - DAY + between(7, 23) * 60 * 60 * 1000, Date.now() - 60_000);

// ---------------------------------------------------------------------------
// Building entries
// ---------------------------------------------------------------------------

type Attrs = Record<string, AttributeValue | undefined>;

/**
 * One client: a browser, an installation, a server process.
 *
 * `distinctId` belongs to this client and to NOTHING else. A web visitor id and
 * an install id are two id spaces, never compared, here or anywhere else.
 * `base` is what this client stamps on every entry it sends, which is what the
 * real clients do rather than a shortcut the fixture takes.
 */
interface Client {
  source: { id: string; surface: Surface };
  distinctId: string;
  base: Attrs;
}

const WEB_SOURCE = { id: SEED_WEB_SOURCE_ID, surface: "web" as const };
const APP_SOURCE = { id: SEED_DESKTOP_SOURCE_ID, surface: "desktop" as const };
const API_SOURCE = { id: SEED_SERVER_SOURCE_ID, surface: "server" as const };

/** Undefined means "this client did not report that", and is not stored. */
function clean(attrs: Attrs): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * One entry, exactly as an SDK would have sent it, plus the two attributes the
 * edge stamps.
 *
 * `observed_timestamp` equals `time` because nothing in a fixture arrives late.
 * Real data does, which is why they are two columns and why nothing in the
 * product ever buckets on the second one.
 *
 * `severity` is passed explicitly on every call, `null` included. There is no
 * default: an entry filed as INFO because nobody chose is a lie that a "warnings
 * and worse" filter will act on.
 */
function log(
  out: LogEntryInput[],
  c: Client,
  name: string,
  at: number,
  severity: number | null,
  attrs: Attrs = {}
): void {
  out.push({
    project_id: SEED_PROJECT_ID,
    entry_id: crypto.randomUUID(),
    time: new Date(at),
    observed_timestamp: new Date(at),
    distinct_id: c.distinctId,
    severity,
    name,
    attributes: clean({
      [ATTR.SOURCE_ID]: c.source.id,
      [ATTR.SOURCE_SURFACE]: c.source.surface,
      ...c.base,
      ...attrs,
    }),
  });
}

/**
 * A conventional exception entry: what `error()` produces in every client.
 *
 * There is no error table and no error pipeline. This is a row in the same
 * table as a page view, and the only things that make it an error are the name,
 * the severity band and the `exception.*` keys.
 */
function fault(
  out: LogEntryInput[],
  c: Client,
  at: number,
  f: { type: string; message: string },
  severity: number,
  attrs: Attrs = {}
): void {
  log(out, c, NAME.EXCEPTION, at, severity, {
    [ATTR.EXCEPTION_TYPE]: f.type,
    [ATTR.EXCEPTION_MESSAGE]: f.message,
    [ATTR.EXCEPTION_STACKTRACE]: `${f.type}: ${f.message}\n    at themia::run (src/lib.rs:214)`,
    [ATTR.EXCEPTION_ESCAPED]: severity >= SEVERITY.FATAL,
    ...attrs,
  });
}

/**
 * A numeric sample.
 *
 * `firstrun.value` is a JSON NUMBER, not a string, which is the whole point: a
 * percentile over it is arithmetic the database can do, where a bag of strings
 * would need a cast per row that one malformed client could fail.
 */
function measure(
  out: LogEntryInput[],
  c: Client,
  at: number,
  metric: string,
  value: number,
  unit: string,
  attrs: Attrs = {}
): void {
  log(out, c, NAME.MEASUREMENT, at, SEVERITY.INFO, {
    [ATTR.METRIC]: metric,
    [ATTR.VALUE]: value,
    [ATTR.UNIT]: unit,
    ...attrs,
  });
}

// ---------------------------------------------------------------------------
// The website
// ---------------------------------------------------------------------------

interface WebTotals {
  visitors: number;
  sessions: number;
  identified: number;
  downloads: number;
  faults: number;
}

function generateWeb(out: LogEntryInput[]): WebTotals {
  const counts = perDay(TARGET.visitors);
  let visitors = 0;
  let sessions = 0;
  let identified = 0;
  let downloads = 0;
  let faults = 0;

  /** One visit: a session, the pages in it, and whatever happened on them. */
  function visit(c: Client, startedAt: number, referrer: string | null): number {
    sessions++;
    let at = startedAt;

    const referrerAttrs: Attrs = {
      [ATTR.REFERRER]: referrer ?? undefined,
      [ATTR.REFERRER_HOST]: referrer ? new URL(referrer).host : undefined,
    };

    log(out, c, NAME.SESSION_START, at, SEVERITY.INFO, {
      [ATTR.URL_FULL]: ORIGIN + "/",
      [ATTR.URL_PATH]: "/",
      ...referrerAttrs,
    });

    const pages = [weighted(LANDINGS).path];
    const depth = chance(0.42) ? 1 + Math.floor(rand() * 3) : 0;
    for (let p = 0; p < depth; p++) pages.push(pick(NEXT_PAGES));

    pages.forEach((path, index) => {
      at += index === 0 ? 0 : between(15, 180) * 1000;
      const from = index === 0 ? referrer : ORIGIN + pages[index - 1]!;
      log(out, c, NAME.PAGE_VIEW, at, SEVERITY.INFO, {
        [ATTR.URL_FULL]: ORIGIN + path,
        [ATTR.URL_PATH]: path,
        [ATTR.REFERRER]: from ?? undefined,
        [ATTR.REFERRER_HOST]: from ? new URL(from).host : undefined,
      });

      // The tag reports vitals once per page view, when the page is hidden.
      // Only a quarter of visits here, to keep the fixture from being mostly
      // vitals rows.
      if (index === 0 && chance(0.25)) {
        for (const metric of WEB_VITALS) {
          const [lo, hi] = VITAL_RANGE[metric];
          const slow = chance(0.2);
          const value = between(lo, slow ? hi : lo + (hi - lo) * 0.45);
          // A vital is a MEASUREMENT with its own conventional name, so the
          // vitals card and a percentile a customer builds by hand read the
          // same two attributes off the same rows.
          log(out, c, NAME.WEB_VITAL, at + 500, SEVERITY.INFO, {
            [ATTR.METRIC]: metric,
            [ATTR.VALUE]: metric === "CLS" ? Number(value.toFixed(3)) : Math.round(value),
            [ATTR.UNIT]: metric === "CLS" ? "" : "ms",
            [ATTR.URL_PATH]: path,
          });
        }
      }

      // A script error on somebody's browser. Same table, same insert.
      if (chance(0.012)) {
        faults++;
        fault(out, c, at + between(1, 20) * 1000, pick(WEB_FAULTS), SEVERITY.ERROR, {
          [ATTR.URL_PATH]: path,
        });
      }
    });

    const last = pages[pages.length - 1]!;
    const dwell = Math.round(between(4_000, 240_000));
    log(out, c, NAME.PAGE_LEAVE, at + dwell, SEVERITY.INFO, {
      [ATTR.URL_PATH]: last,
      [ATTR.DURATION_MS]: dwell,
      // Not a conventional key, and deliberately so: a customer's own attribute
      // is stored, indexed, grouped and filtered exactly like ours.
      scroll_depth: Number(between(0.1, 1).toFixed(2)),
    });

    // The download button is an ORDINARY entry. Nothing mints a token, nothing
    // redirects, and the file comes from wherever it always came from. If
    // firstrun is down the button still works.
    if (chance(0.26)) {
      downloads++;
      log(out, c, NAME.FILE_DOWNLOAD, at + between(2, 40) * 1000, SEVERITY.INFO, {
        [ATTR.URL_PATH]: "/download",
        file: `${ASSET_NAME}.exe`,
        kind: "installer",
      });
    }

    if (chance(0.05)) {
      log(out, c, NAME.OUTBOUND_CLICK, at + between(5, 90) * 1000, SEVERITY.INFO, {
        [ATTR.URL_PATH]: last,
        href: "https://github.com/themia/themia",
      });
    }

    return at + dwell;
  }

  for (let day = 0; day < DAYS; day++) {
    for (let i = 0; i < counts[day]!; i++) {
      const n = visitors++;
      const utm = pick(UTM);

      // The visitor id the tag generated in this browser. It means nothing
      // outside this browser and is never compared with an install id.
      const distinctId = `v_${n.toString(36)}_${Math.floor(rand() * 1e6).toString(36)}`;
      const base: Attrs = {
        [ATTR.BROWSER_LANGUAGE]: pick(LOCALES),
        [ATTR.OS_TYPE]: pick(OSES),
        [ATTR.URL_DOMAIN]: "themia.app",
        [ATTR.UTM_SOURCE]: utm.source ?? undefined,
        [ATTR.UTM_MEDIUM]: utm.medium ?? undefined,
        [ATTR.UTM_CAMPAIGN]: utm.campaign ?? undefined,
      };

      let userId: string | null = null;
      const first: Client = {
        source: WEB_SOURCE,
        distinctId,
        base: { ...base, [ATTR.SESSION_ID]: `s_${n.toString(36)}_0` },
      };
      const endedAt = visit(first, arrival(day), utm.referrer);

      // Signing up is where a web visitor gets a user id. It is the customer's
      // own id, from their own form, and it stays on the web surface: no id
      // here is ever compared with an id from the app.
      if (chance(0.035)) {
        identified++;
        userId = `u_site_${n.toString(36)}`;
        log(out, first, NAME.FORM_SUBMIT, endedAt + 1000, SEVERITY.INFO, {
          [ATTR.URL_PATH]: "/pricing",
          form: "trial",
        });
        const known: Client = { ...first, base: { ...first.base, [ATTR.USER_ID]: userId } };
        log(out, known, NAME.IDENTIFY, endedAt + 1500, SEVERITY.INFO);
      }

      // Some people come back. Without them every visitor is a one-day cohort
      // and the web retention curve is a flat zero that tells you nothing.
      if (!chance(0.18)) continue;
      const returns = 1 + Math.floor(rand() * 2);
      for (let r = 1; r <= returns; r++) {
        const laterDay = day + Math.ceil(between(1, 9));
        if (laterDay >= DAYS) break;
        visit(
          {
            source: WEB_SOURCE,
            distinctId,
            base: {
              ...base,
              [ATTR.SESSION_ID]: `s_${n.toString(36)}_${r}`,
              [ATTR.USER_ID]: userId ?? undefined,
            },
          },
          arrival(laterDay),
          null
        );
      }
    }
  }

  return { visitors, sessions, identified, downloads, faults };
}

// ---------------------------------------------------------------------------
// The desktop app
// ---------------------------------------------------------------------------

interface AppTotals {
  installs: number;
  identified: number;
  launches: number;
  faults: number;
  crashes: number;
}

function generateApp(out: LogEntryInput[]): AppTotals {
  const counts = perDay(TARGET.installs);
  let installs = 0;
  let identified = 0;
  let launches = 0;
  let faults = 0;
  let crashes = 0;

  for (let day = 0; day < DAYS; day++) {
    for (let i = 0; i < counts[day]!; i++) {
      const n = installs++;
      const installedAt = arrival(day);
      const track = weighted(TRACKS);
      const channel = weighted(CHANNELS).name;
      const os = pick(OSES);

      // The install id the SDK generated on first run. It is not, and cannot
      // be, any web visitor id: separate surface, separate id space.
      const distinctId = `i_${n.toString(36)}_${Math.floor(rand() * 1e6).toString(36)}`;
      const base: Attrs = {
        [ATTR.SERVICE_NAME]: "themia",
        [ATTR.SERVICE_VERSION]: track.version,
        [ATTR.CHANNEL]: channel,
        [ATTR.OS_TYPE]: os,
        [ATTR.OS_VERSION]: os === "windows" ? "10.0.26100" : "15.3",
        [ATTR.HOST_ARCH]: os === "darwin" ? "arm64" : "amd64",
        [ATTR.BROWSER_LANGUAGE]: pick(LOCALES),
      };

      // Signing in is what gives an install a user id, and WHEN it happens
      // matters: `coalesce(attributes ->> 'user.id', distinct_id)` keys on the
      // install before the sign-in and on the account after it, so an install
      // that signs in halfway through its life is two uniques. That is a real
      // property of the counting rule rather than a fixture artefact, so most
      // of these sign in on first run (Themia asks for a licence key) and a few
      // sign in later, so the property is visible in the data and not only in a
      // comment.
      let userId: string | null = chance(0.24) ? `u_app_${n.toString(36)}` : null;
      if (userId) identified++;
      const signsInLater = !userId && chance(0.07);

      const client = (extra: Attrs = {}): Client => ({
        source: APP_SOURCE,
        distinctId,
        base: { ...base, [ATTR.USER_ID]: userId ?? undefined, ...extra },
      });

      const firstRun = client();
      log(out, firstRun, NAME.APP_INSTALL, installedAt, SEVERITY.INFO, {
        install_channel: channel,
      });
      log(out, firstRun, NAME.SESSION_START, installedAt + 2000, SEVERITY.INFO);
      if (userId) log(out, firstRun, NAME.IDENTIFY, installedAt + 2200, SEVERITY.INFO);
      log(out, firstRun, NAME.APP_LAUNCH, installedAt + 2500, SEVERITY.INFO);
      launches++;

      // Some of the healthy cohort upgrades partway through the month, which is
      // what makes "last version reported" different from "version installed".
      const upgradesAt =
        !track.quiet && chance(0.35) ? installedAt + between(3, 18) * DAY : Infinity;

      const stopsAfter = churnDay(track.quiet);
      let launchCount = 1;

      for (let d = 1; installedAt + d * DAY < Date.now(); d++) {
        if (d > stopsAfter) break;
        if (!chance(launchChance(d))) continue;

        const at = installedAt + d * DAY + between(-4, 4) * 60 * 60 * 1000;
        if (at > Date.now() - 60_000) continue;

        const version = at >= upgradesAt ? "1.4.2" : track.version;
        const c = client({
          [ATTR.SERVICE_VERSION]: version,
          [ATTR.SESSION_ID]: `as_${n.toString(36)}_${d}`,
        });

        log(out, c, NAME.SESSION_START, at, SEVERITY.INFO);
        log(out, c, NAME.APP_LAUNCH, at + 400, SEVERITY.INFO);
        launches++;
        launchCount++;

        // The app account id is NOT the web signup id: two id spaces, never
        // reconciled, here or anywhere else.
        if (signsInLater && !userId && launchCount >= 3) {
          identified++;
          userId = `u_app_${n.toString(36)}`;
          log(out, client({ [ATTR.SESSION_ID]: `as_${n.toString(36)}_${d}` }), NAME.IDENTIFY,
            at + 600, SEVERITY.INFO);
        }

        // The routine chatter a desktop app produces. DEBUG, so it is present
        // and indexed but sits below anything a board opens on, which is
        // exactly what the ladder is for.
        if (chance(0.5)) {
          log(out, c, "update.check", at + between(2, 30) * 1000, SEVERITY.DEBUG, {
            current: version,
            latest: "1.4.2",
            up_to_date: version === "1.4.2",
          });
        }

        // Resident memory, sampled once a launch. A number, so a p95 over it is
        // arithmetic.
        if (chance(0.35)) {
          measure(out, c, at + between(30, 300) * 1000, "rss_bytes",
            Math.round(between(120e6, 900e6)), "By");
        }

        // A licence server that could not be reached is a warning, not an
        // error: the app carries on with a cached licence.
        if (chance(0.03)) {
          log(out, c, "licence.refresh_failed", at + between(5, 60) * 1000, SEVERITY.WARN, {
            reason: pick(["offline", "timeout", "http_502"]),
            cached_until_days: Math.round(between(1, 14)),
          });
        }

        // Something threw and the app kept going.
        if (chance(0.02)) {
          faults++;
          fault(out, c, at + between(10, 600) * 1000, pick(APP_FAULTS), SEVERITY.ERROR);
        }

        // Something threw and the app did not. FATAL, and `exception.escaped`
        // is true, which is the difference the convention encodes.
        if (chance(0.004)) {
          crashes++;
          fault(out, c, at + between(10, 900) * 1000, pick(APP_FAULTS), SEVERITY.FATAL);
        }

        // An entry name nothing in this codebase has ever heard of, which is
        // the point: it is counted, charted and broken down exactly like the
        // ones the conventions suggest.
        if (chance(0.3)) {
          const rows = Math.round(between(20, 40_000));
          log(out, c, "export_completed", at + between(60, 900) * 1000, SEVERITY.INFO, {
            format: chance(0.6) ? "csv" : "parquet",
            rows,
            [ATTR.DURATION_MS]: Math.round(rows * between(0.4, 2.2)),
          });
        }

        // An entry with NO severity at all: a customer calling `log()` with a
        // name and some attributes and nothing else. Legal, stored, queryable,
        // and honestly unclassified rather than quietly filed as INFO.
        if (chance(0.05)) {
          log(out, c, "workspace.opened", at + between(1, 120) * 1000, null, {
            documents: Math.round(between(1, 400)),
          });
        }
      }
    }
  }

  return { installs, identified, launches, faults, crashes };
}

// ---------------------------------------------------------------------------
// The API behind both
// ---------------------------------------------------------------------------

/**
 * A backend surface, which is the one the old fixture had nothing of.
 *
 * `distinct_id` here is a PROCESS id, not a person: a server has no visitors,
 * and the id it persists is the identity of one running instance. Counting
 * uniques over this surface counts processes, which is the correct answer to a
 * question nobody should be asking of it, and is exactly why uniques are never
 * summed across surfaces.
 */
interface ApiTotals {
  requests: number;
  failures: number;
  faults: number;
}

function generateApi(out: LogEntryInput[]): ApiTotals {
  const counts = perDay(TARGET.requests);
  let requests = 0;
  let failures = 0;
  let faults = 0;

  // Four instances behind a load balancer, restarted onto a new build once
  // during the month.
  const instances = [0, 1, 2, 3].map((i) => `p_api_${i.toString(36)}`);

  for (let day = 0; day < DAYS; day++) {
    const version = day < 12 ? "2026.8.3" : "2026.8.9";

    for (let i = 0; i < counts[day]!; i++) {
      const distinctId = pick(instances);
      const c: Client = {
        source: API_SOURCE,
        distinctId,
        base: {
          [ATTR.SERVICE_NAME]: "themia-api",
          [ATTR.SERVICE_VERSION]: version,
          [ATTR.OS_TYPE]: "linux",
          [ATTR.HOST_ARCH]: "amd64",
          [ATTR.CHANNEL]: "stable",
        },
      };

      const r = weighted(ROUTES);
      const at = arrival(day);
      const failed = chance(r.fail);
      const clientError = !failed && chance(0.02);
      const status = failed ? pick([500, 502, 503]) : clientError ? pick([400, 401, 404]) : 200;
      // A failure is slow or it is instant, rarely in between.
      const ms = failed
        ? chance(0.5)
          ? Math.round(between(4800, 5200))
          : Math.round(between(2, 30))
        : Math.round(between(r.ms[0], r.ms[1]));

      // The severity is the CLIENT'S judgement about its own request, made at
      // write time. Nothing in the backend derives it from the status code, and
      // nothing branches on it after: a customer whose 404s are routine can
      // send them at INFO and get exactly this behaviour.
      const severity = status >= 500 ? SEVERITY.ERROR : status >= 400 ? SEVERITY.WARN : SEVERITY.INFO;

      requests++;
      if (status >= 500) failures++;

      log(out, c, NAME.HTTP_REQUEST, at, severity, {
        [ATTR.HTTP_REQUEST_METHOD]: r.method,
        [ATTR.HTTP_ROUTE]: r.route,
        [ATTR.HTTP_RESPONSE_STATUS_CODE]: status,
        [ATTR.DURATION_MS]: ms,
        [ATTR.URL_FULL]: API_ORIGIN + r.route,
        [ATTR.URL_PATH]: r.route,
      });

      // A 5xx carries the exception that caused it, as its own entry. Two rows,
      // correlated by nothing but their timestamps and their process: trace ids
      // are reserved in the model and no client fills them in yet.
      if (status >= 500) {
        faults++;
        fault(out, c, at + 1, pick(API_FAULTS), SEVERITY.ERROR, {
          [ATTR.HTTP_ROUTE]: r.route,
          [ATTR.HTTP_RESPONSE_STATUS_CODE]: status,
        });
      }
    }

    // Housekeeping, once an hour per instance: the queue depth and the
    // connection pool. Metric-ish entries, on the same table as everything else.
    for (const distinctId of instances) {
      const c: Client = {
        source: API_SOURCE,
        distinctId,
        base: {
          [ATTR.SERVICE_NAME]: "themia-api",
          [ATTR.SERVICE_VERSION]: version,
          [ATTR.OS_TYPE]: "linux",
        },
      };
      for (let h = 0; h < 24; h += 4) {
        const at = startOfDay(day) - DAY + h * 60 * 60 * 1000;
        if (at > Date.now() - 60_000) continue;
        measure(out, c, at, "queue_depth", Math.round(between(0, 240)), "{item}");
        measure(out, c, at + 1000, "pool_in_use", Math.round(between(1, 20)), "{connection}");
        // The chattiest band there is, present so a severity filter has
        // something below DEBUG to exclude.
        if (chance(0.25)) {
          log(out, c, "cache.evicted", at + 2000, SEVERITY.TRACE, {
            keys: Math.round(between(1, 5000)),
          });
        }
      }
    }
  }

  return { requests, failures, faults };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await applyMigrations();
  const store = createStore();
  const { db, close } = store;

  try {
    // A workspace nobody can open is not a fixture. The seed user is a real row
    // that `bun run dev:login` can mint a session for.
    const user = (
      await db
        .insert(users)
        .values({
          githubId: 1,
          login: SEED_USER_LOGIN,
          name: "Seed User",
          email: null,
          avatarUrl: null,
        })
        .onConflictDoUpdate({ target: users.githubId, set: { login: SEED_USER_LOGIN } })
        .returning()
    )[0]!;

    await db
      .insert(workspaces)
      .values({ id: SEED_WORKSPACE_ID, name: "Nathaniel", slug: "nathaniel" })
      .onConflictDoUpdate({ target: workspaces.id, set: { name: "Nathaniel" } });

    await db
      .insert(workspaceMembers)
      .values({ workspaceId: SEED_WORKSPACE_ID, userId: user.id, role: "admin" })
      .onConflictDoNothing();

    await db
      .insert(projects)
      .values({
        id: SEED_PROJECT_ID,
        workspaceId: SEED_WORKSPACE_ID,
        name: "Themia",
        slug: "themia",
      })
      .onConflictDoUpdate({ target: projects.id, set: { name: "Themia" } });

    await db
      .insert(sources)
      .values([
        {
          id: SEED_WEB_SOURCE_ID,
          projectId: SEED_PROJECT_ID,
          name: "themia.app",
          kind: "web",
          assetName: null,
          ingestKey: SEED_WEB_KEY,
        },
        {
          id: SEED_DESKTOP_SOURCE_ID,
          projectId: SEED_PROJECT_ID,
          name: "Themia for Windows",
          kind: "desktop",
          assetName: ASSET_NAME,
          ingestKey: SEED_DESKTOP_KEY,
        },
        {
          id: SEED_SERVER_SOURCE_ID,
          projectId: SEED_PROJECT_ID,
          name: "api.themia.app",
          kind: "server",
          assetName: null,
          ingestKey: SEED_SERVER_KEY,
        },
      ])
      .onConflictDoNothing();

    // Three boards, not one: a project has a tab strip, and the two
    // surface-specific templates are the ones that light up on this data.
    //
    // Rebuilt on every run rather than left alone if present. A board stored by
    // an older version of this file is a board from a different product, and a
    // seed that leaves a pre-pivot layout in place is a seed you cannot trust
    // to tell you what the current templates look like.
    await db.delete(dashboards).where(eq(dashboards.projectId, SEED_PROJECT_ID));
    const boards = [
      { key: "overview", name: "Overview", slug: "overview" },
      { key: "web", name: "Website", slug: "website" },
      { key: "app", name: "App health", slug: "app-health" },
    ];
    await db.insert(dashboards).values(
      boards.map((b, position) => ({
        projectId: SEED_PROJECT_ID,
        name: b.name,
        slug: b.slug,
        position,
        layout: templateByKey(b.key)!.build(),
      }))
    );

    console.log("clearing previous seed");
    await clearProjectData(db, SEED_PROJECT_ID);

    console.log("generating");
    const rows: LogEntryInput[] = [];
    const web = generateWeb(rows);
    const app = generateApp(rows);
    const api = generateApi(rows);

    // Ingest order is arrival order, and arrival order is not entry order.
    rows.sort((a, b) => (a.time as Date).getTime() - (b.time as Date).getTime());

    console.log(`inserting ${rows.length} entries`);
    for (let i = 0; i < rows.length; i += 2000) {
      await insertLogEntries(store, rows.slice(i, i + 2000));
    }

    // The planner has never seen this table with rows in it, and a partitioned
    // parent has to be analysed by name for its partitions to get statistics.
    // Without this the first board load picks a plan built on a guess.
    await db.execute(raw`ANALYZE log_entries`);

    const names = new Set(rows.map((r) => r.name));
    const severities = new Set(rows.map((r) => r.severity));
    const attributeKeys = new Set(rows.flatMap((r) => Object.keys(r.attributes ?? {})));

    console.log("");
    console.log(`  workspace        Nathaniel`);
    console.log(`  project          Themia`);
    console.log(`  user             ${SEED_USER_LOGIN}`);
    console.log(`  entry names      ${[...names].sort().join(", ")}`);
    console.log(`  severities       ${[...severities].sort((a, b) => Number(a) - Number(b)).join(", ")}`);
    console.log(`  attribute keys   ${attributeKeys.size}`);
    console.log("");
    console.log(`  web visitors     ${web.visitors}`);
    console.log(`  web sessions     ${web.sessions}`);
    console.log(`  web identified   ${web.identified}`);
    console.log(`  file_download    ${web.downloads}`);
    console.log(`  web exceptions   ${web.faults}`);
    console.log(`  installs         ${app.installs}`);
    console.log(`  app identified   ${app.identified}`);
    console.log(`  app launches     ${app.launches}`);
    console.log(`  app exceptions   ${app.faults} (${app.crashes} fatal)`);
    console.log(`  api requests     ${api.requests}`);
    console.log(`  api 5xx          ${api.failures}`);
    console.log(`  entries          ${rows.length}`);
    console.log("");
    console.log("  The three surfaces are NOT joined. A funnel whose steps cross");
    console.log("  from web to desktop reads zero at the crossing, by design.");
    console.log("");
    console.log(`  bun run dev:login ${SEED_USER_LOGIN}`);
    console.log(`  http://localhost:3000/w/nathaniel/themia`);
  } finally {
    await close();
  }
}

if (import.meta.main) await main();

export {
  SEED_DESKTOP_KEY,
  SEED_PROJECT_ID,
  SEED_SERVER_KEY,
  SEED_WEB_KEY,
  SEED_WORKSPACE_ID,
};

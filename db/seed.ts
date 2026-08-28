#!/usr/bin/env bun
import {
  IdentityResolver,
  MemoryIdentityStore,
  type Distinct,
  type IdentityEdge,
} from "@firstrun/identity";
import { EVENT, TOKEN_TTL_MS, mintToken } from "@firstrun/schema";
import type { EventEnvelope, StoredEvent } from "@firstrun/schema";
import { ClickHouseClient, configFromEnv, toChDateTime } from "./clickhouse/client.js";
import { insertEvents } from "./events.js";
import { applyClickHouseMigrations, applySqliteMigrations, waitForClickHouse } from "./migrate.js";
import { openSqlite, sqlitePathFromEnv } from "./sqlite/client.js";
import { repositories } from "./sqlite/repositories.js";

/**
 * A synthetic project shaped like the first real subject: a Windows desktop app
 * with a marketing site, about a thousand monthly users and a few dozen paying
 * customers.
 *
 * The numbers are not decoration. The funnel screen is the only screen, and a
 * screen you cannot look at is a screen you cannot judge -- if the drop from
 * download to first run is invisible on fake data, it will be invisible on real
 * data too.
 *
 * Everything is driven by one seeded RNG, so re-running produces the same
 * project and a diff in the numbers means a diff in the code.
 */

const SEED_PROJECT_ID = "7f9b5c2e-1d4a-4f8b-9c3e-6a2b8d5f1e40";
const SEED_API_KEY = "fr_seed_0000000000000000";
const ASSET_NAME = "Themia-Setup";
const DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const TARGET = {
  visitors: 3400,
  downloadRate: 0.262, // -> ~890
  installRate: 0.685, // -> ~610
  /** Installs whose filename made it through to first run. The rest are guesses. */
  tokenRate: 0.86,
  purchases: 19,
};

/** Where an install sits in the version story. */
const TRACKS = [
  { name: "current", weight: 0.62, versions: ["1.4.2"], quiet: false },
  { name: "lagging", weight: 0.22, versions: ["1.4.0", "1.4.1"], quiet: false },
  // The cohort the version breakdown exists to surface: still installed, on an
  // old build, and no longer launching.
  { name: "stale", weight: 0.16, versions: ["1.3.5", "1.3.7"], quiet: true },
] as const;

/**
 * Where the install came from, weighted.
 *
 * Site-heavy because that is the truth for a small desktop app with a
 * marketing site, and because it is the honest shape for the screen: most
 * joins are exact, and the estimated number is a minority that has to be
 * visible without pretending to be the main event.
 */
const CHANNELS = [
  { name: "site", weight: 0.85 },
  { name: "winget", weight: 0.1 },
  { name: "shared-link", weight: 0.05 },
] as const;
const OSES = ["windows", "windows", "windows", "windows", "macos"] as const;
const LOCALES = ["de-CH", "de-DE", "en-US", "en-GB", "fr-CH", "it-CH"] as const;
const UTM = [
  { source: null, medium: null, campaign: null },
  { source: "google", medium: "organic", campaign: null },
  { source: "reddit", medium: "social", campaign: "r-datahoarder" },
  { source: "newsletter", medium: "email", campaign: "2026-08" },
  { source: "producthunt", medium: "referral", campaign: "launch" },
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

const rand = rng(20260828);
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
 * Visitors per day.
 *
 * Weekends are quieter and there is one Product Hunt spike, because a funnel
 * over flat traffic hides exactly the shape a founder opens this screen to
 * find. Normalised afterwards so the month still totals the target rather than
 * drifting whichever way the shape happens to push it.
 */
function visitorsPerDay(total: number): number[] {
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

/** Exactly `n` of `xs`, chosen without replacement. */
function sample<T>(xs: readonly T[], n: number): T[] {
  return xs
    .map((x) => ({ x, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map((o) => o.x);
}

/**
 * How often someone who is still around opens the app on day N.
 *
 * The floor matters: a habitual user does not decay to zero, they settle into
 * opening it a couple of times a week forever. Churn is modelled separately,
 * by people leaving outright, because "everyone slowly uses it less" and "most
 * people quit and the rest keep going" produce very different retention curves
 * and only the second one is what actually happens.
 */
function launchChance(daysSinceFirstRun: number): number {
  return 0.55 * Math.exp(-daysSinceFirstRun / 6) + 0.22;
}

/**
 * The day an install stops opening the app for good.
 *
 * Most of the loss is in the first few days -- someone downloads a tool, opens
 * it once, and never thinks about it again. That early cliff is the shape the
 * funnel screen exists to make visible.
 */
function churnDay(quiet: boolean): number {
  if (quiet) return between(4, 11);
  if (chance(0.44)) return between(0, 3);
  if (chance(0.4)) return between(4, 12);
  return Infinity;
}

interface Person {
  visitorId: string;
  firstVisitAt: number;
  locale: string;
  utm: (typeof UTM)[number];
  downloadedAt?: number;
  token?: string;
  installId?: string;
  firstRunAt?: number;
  track?: (typeof TRACKS)[number];
  version?: string;
  channel?: string;
  os?: string;
  accountId?: string;
  purchasedAt?: number;
  launches: number[];
}

function generate(): { people: Person[]; edges: Array<[Distinct, Distinct, "token" | "account" | "estimate", number]> } {
  const people: Person[] = [];
  const perDay = visitorsPerDay(TARGET.visitors);

  for (let day = 0; day < DAYS; day++) {
    const dayStart = Date.now() - (DAYS - 1 - day) * DAY;
    for (let i = 0; i < perDay[day]!; i++) {
      // Business hours in CET, roughly.
      const at = dayStart - DAY + between(7, 23) * 60 * 60 * 1000;
      people.push({
        visitorId: `v_${people.length.toString(36)}_${Math.floor(rand() * 1e6).toString(36)}`,
        firstVisitAt: Math.min(at, Date.now() - 60_000),
        locale: pick(LOCALES),
        utm: pick(UTM),
        launches: [],
      });
    }
  }

  const edges: Array<[Distinct, Distinct, "token" | "account" | "estimate", number]> = [];
  const buyers: Person[] = [];

  // Exactly N downloaders and exactly N installers, chosen at random, rather
  // than a coin flip per person. A coin flip is more honest as a model and less
  // useful as a fixture: the headline numbers on the screen should be the
  // numbers this file says they are, not those numbers plus whatever the RNG
  // felt like this month.
  const downloaders = sample(people, Math.round(people.length * TARGET.downloadRate));
  const installers = new Set(sample(downloaders, Math.round(downloaders.length * TARGET.installRate)));

  for (const p of downloaders) {
    p.downloadedAt = p.firstVisitAt + between(1, 25) * 60 * 1000;
    p.token = mintToken();
    p.channel = weighted(CHANNELS).name;
    p.os = pick(OSES);

    if (!installers.has(p)) continue;
    p.installId = `i_${p.visitorId.slice(2)}`;
    // Clamped rather than dropped: someone who downloaded an hour ago and has
    // not run it yet is a real row in the funnel's biggest drop-off, and
    // silently removing them would flatter the number.
    p.firstRunAt = Math.min(
      p.downloadedAt + between(2 / 60, 62) * 60 * 60 * 1000,
      Date.now() - 60_000
    );

    const track = weighted(TRACKS);
    p.track = track;
    p.version = pick(track.versions);

    const install: Distinct = { type: "install", id: p.installId };
    const web: Distinct = { type: "web_visitor", id: p.visitorId };

    if (p.channel === "site" && chance(TARGET.tokenRate)) {
      // The filename made it through. This is the exact join.
      edges.push([install, web, "token", 1]);
    } else if (chance(0.55)) {
      // winget, a store, a pasted link. Same network, same OS, half an hour
      // apart -- a guess, and it stays a guess.
      edges.push([install, web, "estimate", chance(0.5) ? 0.8 : 0.4]);
    }

    // Launches, from first run to today, decaying until the person leaves.
    const quietAfterDays = churnDay(track.quiet);
    for (let d = 1; (p.firstRunAt + d * DAY) < Date.now(); d++) {
      if (d > quietAfterDays) break;
      if (!chance(launchChance(d))) continue;
      p.launches.push(p.firstRunAt + d * DAY + between(-4, 4) * 60 * 60 * 1000);
    }

    // Signing in is what makes an account id an exact join across surfaces.
    if (!track.quiet && p.launches.length >= 2 && chance(0.22)) {
      p.accountId = `acct_${p.visitorId.slice(2)}`;
      edges.push([install, { type: "account", id: p.accountId }, "account", 1]);
      if (chance(0.6)) edges.push([web, { type: "account", id: p.accountId }, "account", 1]);
    }

    // Nobody pays for something they opened twice and abandoned.
    if (!track.quiet && p.launches.length >= 3) buyers.push(p);
  }

  for (const p of sample(buyers, TARGET.purchases)) {
    p.purchasedAt = Math.min(p.launches.at(-1) ?? p.firstRunAt!, Date.now() - 60_000);
  }

  return { people, edges };
}

function envelope(e: Partial<EventEnvelope> & Pick<EventEnvelope, "event_name" | "event_time" | "surface">): EventEnvelope {
  return {
    project_id: SEED_PROJECT_ID,
    event_id: crypto.randomUUID(),
    ingest_time: e.event_time,
    web_visitor_id: null,
    install_id: null,
    account_id: null,
    session_id: null,
    app_version: null,
    channel: null,
    os: null,
    arch: null,
    locale: null,
    url: null,
    referrer: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    props: {},
    ...e,
  } as EventEnvelope;
}

async function main(): Promise<void> {
  const chConfig = configFromEnv();
  const ch = new ClickHouseClient(chConfig);
  await waitForClickHouse(ch);
  await applyClickHouseMigrations(ch);

  const sqlite = openSqlite(sqlitePathFromEnv());
  applySqliteMigrations(sqlite);
  const repos = repositories(sqlite);

  console.log("clearing previous seed");
  for (const table of ["events", "identity_edges", "person_overrides"]) {
    await ch.command(`DELETE FROM ${table} WHERE project_id = {project:UUID}`, {
      project: SEED_PROJECT_ID,
    });
  }
  sqlite.query(`DELETE FROM download_tokens WHERE project_id = ?`).run(SEED_PROJECT_ID);
  sqlite.query(`DELETE FROM download_hints WHERE project_id = ?`).run(SEED_PROJECT_ID);
  sqlite.query(`DELETE FROM ingested_events WHERE project_id = ?`).run(SEED_PROJECT_ID);

  repos.projects.upsert({
    id: SEED_PROJECT_ID,
    name: "Themia",
    asset_name: ASSET_NAME,
    created_at: Date.now() - DAYS * DAY,
  });
  if (!repos.apiKeys.projectFor(SEED_API_KEY)) {
    repos.apiKeys.create({
      key: SEED_API_KEY,
      project_id: SEED_PROJECT_ID,
      name: "seed",
      created_at: Date.now(),
      revoked_at: null,
    });
  }

  console.log("generating");
  const { people, edges } = generate();

  // Resolve people through the real resolver rather than a shortcut, so the
  // seed cannot disagree with production about who anybody is.
  const store = new MemoryIdentityStore();
  const resolver = new IdentityResolver(store);
  for (const [from, to, method, confidence] of edges) {
    await resolver.link(SEED_PROJECT_ID, from, to, method, confidence);
  }

  const personCache = new Map<string, string>();
  const personOf = async (d: Distinct): Promise<string> => {
    const key = d.type + " " + d.id;
    let p = personCache.get(key);
    if (!p) {
      p = await resolver.resolve(SEED_PROJECT_ID, d);
      personCache.set(key, p);
    }
    return p;
  };

  const events: StoredEvent[] = [];
  const tokenRows: Array<Parameters<typeof repos.downloadTokens.create>[0]> = [];

  for (const p of people) {
    const webPerson = await personOf({ type: "web_visitor", id: p.visitorId });
    const sessionId = `s_${p.visitorId.slice(2)}`;

    const views = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < views; i++) {
      events.push({
        ...envelope({
          event_name: EVENT.PAGE_VIEW,
          event_time: p.firstVisitAt + i * between(20, 240) * 1000,
          surface: "web",
          web_visitor_id: p.visitorId,
          session_id: sessionId,
          locale: p.locale,
          url: i === 0 ? "https://themia.app/" : "https://themia.app/download",
          referrer: i === 0 ? "https://www.google.com/" : "https://themia.app/",
          utm_source: p.utm.source,
          utm_medium: p.utm.medium,
          utm_campaign: p.utm.campaign,
        }),
        person_id: webPerson,
      });
    }

    if (p.downloadedAt === undefined || !p.token) continue;

    tokenRows.push({
      token: p.token,
      project_id: SEED_PROJECT_ID,
      web_visitor_id: p.visitorId,
      asset: ASSET_NAME,
      created_at: p.downloadedAt,
      expires_at: p.downloadedAt + TOKEN_TTL_MS,
      claimed_at: p.firstRunAt ?? null,
    });

    events.push({
      ...envelope({
        event_name: EVENT.DOWNLOAD_STARTED,
        event_time: p.downloadedAt,
        surface: "web",
        web_visitor_id: p.visitorId,
        session_id: sessionId,
        locale: p.locale,
        os: p.os,
        url: "https://themia.app/download",
        utm_source: p.utm.source,
        utm_medium: p.utm.medium,
        utm_campaign: p.utm.campaign,
        props: { asset: ASSET_NAME, channel: p.channel ?? "site" },
      }),
      person_id: webPerson,
    });

    if (!p.installId || p.firstRunAt === undefined) continue;

    const appPerson = await personOf({ type: "install", id: p.installId });
    const appCommon = {
      surface: "app" as const,
      install_id: p.installId,
      account_id: p.accountId ?? null,
      app_version: p.version ?? null,
      channel: p.channel ?? null,
      os: p.os ?? "windows",
      arch: "x86_64",
      locale: p.locale,
    };

    events.push({
      ...envelope({ ...appCommon, event_name: EVENT.APP_FIRST_RUN, event_time: p.firstRunAt }),
      person_id: appPerson,
    });

    for (const at of p.launches) {
      events.push({
        ...envelope({ ...appCommon, event_name: EVENT.APP_LAUNCH, event_time: at }),
        person_id: appPerson,
      });
    }

    if (p.purchasedAt !== undefined) {
      events.push({
        ...envelope({
          ...appCommon,
          event_name: EVENT.PURCHASE,
          event_time: p.purchasedAt,
          props: { plan: chance(0.3) ? "team" : "pro", currency: "CHF" },
        }),
        person_id: appPerson,
      });
    }
  }

  console.log(`inserting ${events.length} events`);
  for (let i = 0; i < events.length; i += 5000) {
    await insertEvents(ch, events.slice(i, i + 5000));
  }

  await ch.insert(
    "identity_edges",
    store.edges.map((e: IdentityEdge) => ({
      project_id: e.project_id,
      from_type: e.from.type,
      from_id: e.from.id,
      to_type: e.to.type,
      to_id: e.to.id,
      method: e.method,
      confidence: e.confidence,
      created_at: toChDateTime(e.created_at),
    }))
  );

  const insertToken = sqlite.transaction((rows: typeof tokenRows) => {
    for (const r of rows) repos.downloadTokens.create(r);
  });
  insertToken(tokenRows);
  sqlite.close();

  const installs = people.filter((p) => p.installId).length;
  const exact = store.edges.filter((e) => e.method === "token").length;
  const estimated = store.edges.filter((e) => e.method === "estimate").length;
  const purchases = people.filter((p) => p.purchasedAt !== undefined).length;

  console.log("");
  console.log(`  project        ${SEED_PROJECT_ID}`);
  console.log(`  visitors       ${people.length}`);
  console.log(`  downloads      ${tokenRows.length}`);
  console.log(`  installs       ${installs}`);
  console.log(`  token joins    ${exact}`);
  console.log(`  estimated      ${estimated}`);
  console.log(`  purchases      ${purchases}`);
  console.log(`  events         ${events.length}`);
  console.log("");
  console.log(`  http://localhost:3000/projects/${SEED_PROJECT_ID}/funnel`);
}

if (import.meta.main) await main();

export { SEED_PROJECT_ID, SEED_API_KEY };

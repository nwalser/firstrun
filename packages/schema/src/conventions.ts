import type { Surface } from "./surface.js";

/**
 * CONVENTIONS, NOT LAW.
 *
 * Nothing in this file is enforced. No entry is rejected for failing to use one
 * of these keys, no query is restricted to them, and a customer who writes
 * `err.msg` instead of `exception.message` gets exactly the same storage, the
 * same indexing and the same query surface. What they lose is only the
 * suggestions: the pickers offer these, and a starting-point board is built out
 * of them.
 *
 * They exist so that two projects meaning the same thing spell it the same way,
 * and so the SDK helpers have something to point at instead of us inventing a
 * private vocabulary. Where OpenTelemetry has already named a thing, its name
 * is used verbatim, including the ones whose shape we would have chosen
 * differently. Where it has not, the key is namespaced `firstrun.*` so it is
 * obvious at a glance which half of the vocabulary is ours to change.
 */

// ---------------------------------------------------------------------------
// Attribute keys
// ---------------------------------------------------------------------------

export const ATTR = {
  // --- OpenTelemetry semantic conventions, used verbatim ------------------

  /** The class or type of the thrown thing. `TypeError`, `IOError`. */
  EXCEPTION_TYPE: "exception.type",
  EXCEPTION_MESSAGE: "exception.message",
  /** The formatted stack, as one string with newlines. */
  EXCEPTION_STACKTRACE: "exception.stacktrace",
  /** Whether the exception escaped the scope it was recorded in. */
  EXCEPTION_ESCAPED: "exception.escaped",

  /** The session this entry belongs to. Whatever the client calls a session. */
  SESSION_ID: "session.id",
  /** The previous session, when a client rotates one. */
  SESSION_PREVIOUS_ID: "session.previous_id",

  /** Whatever the customer passed to `identify()`. Their id, their meaning. */
  USER_ID: "user.id",

  /** The build of the customer's own software that emitted this. */
  SERVICE_VERSION: "service.version",
  SERVICE_NAME: "service.name",

  OS_TYPE: "os.type",
  OS_NAME: "os.name",
  OS_VERSION: "os.version",
  HOST_ARCH: "host.arch",

  /** The path alone: `/pricing`. What a breakdown by page groups on. */
  URL_PATH: "url.path",
  URL_FULL: "url.full",
  URL_DOMAIN: "url.domain",
  URL_QUERY: "url.query",
  URL_FRAGMENT: "url.fragment",

  HTTP_REQUEST_METHOD: "http.request.method",
  HTTP_RESPONSE_STATUS_CODE: "http.response.status_code",
  /** The template, not the resolved path: `/users/{id}`. */
  HTTP_ROUTE: "http.route",

  /** The BCP-47 tag the client reported. */
  BROWSER_LANGUAGE: "browser.language",
  DEVICE_ID: "device.id",
  CLIENT_ADDRESS: "client.address",

  // --- Ours. Namespaced, because OTel has not named these ----------------

  /** Which ingestion site the entry arrived at. Stamped by the edge. */
  SOURCE_ID: "firstrun.source.id",
  /** The surface recorded on that source. Stamped by the edge, never claimed. */
  SOURCE_SURFACE: "firstrun.source.surface",

  REFERRER: "firstrun.referrer",
  /** The referring host alone. A full referrer groups into a thousand rows. */
  REFERRER_HOST: "firstrun.referrer.host",

  UTM_SOURCE: "firstrun.utm.source",
  UTM_MEDIUM: "firstrun.utm.medium",
  UTM_CAMPAIGN: "firstrun.utm.campaign",
  UTM_TERM: "firstrun.utm.term",
  UTM_CONTENT: "firstrun.utm.content",

  /** Release channel of the customer's build: stable, beta, nightly. */
  CHANNEL: "firstrun.channel",

  /**
   * Test data. `true` on every entry a development or CI build produced.
   *
   * A resource attribute rather than a column, like everything else that is not
   * one of the five. It is only ever written as the JSON boolean `true`, and a
   * production entry OMITS it rather than sending `false`: the absent case is
   * the overwhelming majority of rows, and `attributes @> '{"firstrun.test":
   * true}'` is one GIN lookup whose negation is still a plain boolean. A `false`
   * would cost a byte on every entry ever sent to say what silence already says.
   *
   * Nothing in the backend reads it. It is a filter the dashboard adds, which is
   * why a customer who ignores this key entirely loses nothing except the
   * toggle.
   */
  TEST: "firstrun.test",

  /** How long something took, in milliseconds. */
  DURATION_MS: "firstrun.duration_ms",
  /** A plain numeric sample, for entries that are a measurement. */
  VALUE: "firstrun.value",
  /** What that sample is called: `LCP`, `queue_depth`, `rss_bytes`. */
  METRIC: "firstrun.metric",
  /** The unit the sample is in, when it is not obvious. */
  UNIT: "firstrun.unit",
} as const;

export type ConventionalAttribute = (typeof ATTR)[keyof typeof ATTR];

/** What an attribute picker shows before a project has sent anything. */
export interface AttributeSuggestion {
  key: string;
  label: string;
  description: string;
  /** Which surface usually sends it. `any` means all of them do. */
  surface: Surface | "any";
}

export const CONVENTIONAL_ATTRIBUTES: AttributeSuggestion[] = [
  { key: ATTR.URL_PATH, label: "Page", description: "The path alone, without the query string.", surface: "web" },
  { key: ATTR.REFERRER_HOST, label: "Referrer", description: "The host that linked here.", surface: "web" },
  { key: ATTR.UTM_SOURCE, label: "Campaign source", description: "The utm_source on the landing URL.", surface: "web" },
  { key: ATTR.UTM_CAMPAIGN, label: "Campaign", description: "The utm_campaign on the landing URL.", surface: "web" },
  { key: ATTR.OS_TYPE, label: "Operating system", description: "windows, darwin, linux, ios, android.", surface: "any" },
  { key: ATTR.BROWSER_LANGUAGE, label: "Language", description: "The BCP-47 tag the client reported.", surface: "any" },
  { key: ATTR.SERVICE_VERSION, label: "App version", description: "The build of your software that sent this.", surface: "any" },
  { key: ATTR.CHANNEL, label: "Channel", description: "stable, beta, nightly.", surface: "desktop" },
  { key: ATTR.SESSION_ID, label: "Session", description: "The session this entry belongs to.", surface: "any" },
  { key: ATTR.USER_ID, label: "User", description: "Whatever you passed to identify().", surface: "any" },
  { key: ATTR.EXCEPTION_TYPE, label: "Exception type", description: "The class of the thrown thing.", surface: "any" },
  { key: ATTR.EXCEPTION_MESSAGE, label: "Exception message", description: "The message on the thrown thing.", surface: "any" },
  { key: ATTR.HTTP_ROUTE, label: "Route", description: "The route template, not the resolved path.", surface: "server" },
  { key: ATTR.HTTP_RESPONSE_STATUS_CODE, label: "Status code", description: "The HTTP status that went back.", surface: "server" },
  { key: ATTR.DURATION_MS, label: "Duration", description: "How long it took, in milliseconds.", surface: "any" },
  { key: ATTR.METRIC, label: "Measurement", description: "What a numeric sample is called.", surface: "any" },
];

// ---------------------------------------------------------------------------
// Entry names
// ---------------------------------------------------------------------------

/**
 * Conventional values for the `name` column.
 *
 * There is no allowlist. A customer may send any name that matches
 * `LOG_NAME_RE`; it is stored, counted, grouped and filtered exactly like every
 * other name. A customer who calls their install entry `installed` gets
 * identical behaviour and simply types the name themselves.
 */
export const NAME = {
  /** A page or screen was viewed. */
  PAGE_VIEW: "page_view",
  /** First entry of a visit or a run, after a gap or a new referrer. */
  SESSION_START: "session_start",
  /** This installation ran for the first time. One per install, ever. */
  APP_INSTALL: "app_install",
  /** Any launch, including the first. */
  APP_LAUNCH: "app_launch",
  /** `identify()` was called: this client now knows its user id. */
  IDENTIFY: "identify",

  /** A page was left. Carries a duration and a scroll depth. */
  PAGE_LEAVE: "page_leave",
  /** A link to another origin was followed. */
  OUTBOUND_CLICK: "outbound_click",
  /** A link to a file was followed. */
  FILE_DOWNLOAD: "file_download",
  /** A `<form>` was submitted. */
  FORM_SUBMIT: "form_submit",

  /**
   * Something threw. The severity says how bad, the `exception.*` attributes
   * say what. This is a log entry like every other one: there is no error table
   * and no error pipeline.
   */
  EXCEPTION: "exception",
  /** One Core Web Vital sample, in `firstrun.metric` and `firstrun.value`. */
  WEB_VITAL: "web_vital",
  /** One HTTP request served, with the `http.*` attributes. */
  HTTP_REQUEST: "http.request",
  /** A plain numeric sample. `firstrun.metric` names it. */
  MEASUREMENT: "measurement",
} as const;

export type ConventionalName = (typeof NAME)[keyof typeof NAME];

export interface NameSuggestion {
  name: string;
  label: string;
  description: string;
  surface: Surface | "any";
}

export const CONVENTIONAL_NAMES: NameSuggestion[] = [
  { name: NAME.PAGE_VIEW, label: "Page view", description: "A page or screen was viewed.", surface: "any" },
  { name: NAME.SESSION_START, label: "Session start", description: "The first entry of a visit or a run.", surface: "any" },
  { name: NAME.APP_INSTALL, label: "App install", description: "An installation ran for the first time.", surface: "desktop" },
  { name: NAME.APP_LAUNCH, label: "App launch", description: "Any launch of an installed app.", surface: "desktop" },
  { name: NAME.IDENTIFY, label: "Identify", description: "A client learned which user it belongs to.", surface: "any" },
  { name: NAME.PAGE_LEAVE, label: "Page leave", description: "A page was left. Carries time on page.", surface: "web" },
  { name: NAME.OUTBOUND_CLICK, label: "Outbound click", description: "A link to another origin was followed.", surface: "web" },
  { name: NAME.FILE_DOWNLOAD, label: "File download", description: "A link to a file was followed.", surface: "web" },
  { name: NAME.FORM_SUBMIT, label: "Form submit", description: "A form was submitted.", surface: "web" },
  { name: NAME.EXCEPTION, label: "Exception", description: "Something threw.", surface: "any" },
  { name: NAME.WEB_VITAL, label: "Web vital", description: "One Core Web Vital sample.", surface: "web" },
  { name: NAME.HTTP_REQUEST, label: "HTTP request", description: "One request served.", surface: "server" },
  { name: NAME.MEASUREMENT, label: "Measurement", description: "A plain numeric sample.", surface: "any" },
];

// ---------------------------------------------------------------------------
// Web vitals
// ---------------------------------------------------------------------------

/** The Core Web Vitals a browser client reports, in the order they read best. */
export const WEB_VITALS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type WebVital = (typeof WEB_VITALS)[number];

/**
 * Google's thresholds. Below `good` is good; above `poor` is poor; between is
 * "needs improvement". CLS is unitless, the rest are milliseconds.
 */
export const WEB_VITAL_THRESHOLDS: Record<WebVital, { good: number; poor: number; unit: "ms" | "" }> =
  {
    LCP: { good: 2500, poor: 4000, unit: "ms" },
    INP: { good: 200, poor: 500, unit: "ms" },
    CLS: { good: 0.1, poor: 0.25, unit: "" },
    FCP: { good: 1800, poor: 3000, unit: "ms" },
    TTFB: { good: 800, poor: 1800, unit: "ms" },
  };

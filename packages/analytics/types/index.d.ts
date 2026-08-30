/**
 * Declarations for `@firstrun/analytics`.
 *
 * Hand-written rather than emitted, because emitting them would mean checking
 * the framework wrappers against React, Vue, Svelte and Next -- four optional
 * peer dependencies that a repo building this package is not required to have
 * installed. None of the entry points needs a framework type to describe it:
 * every component here renders nothing and is typed as returning `null`.
 */

/** An attribute map. JSON values, bounded server-side, open by design. */
export type Attrs = Record<string, unknown>;

/**
 * When a send is attempted. See docs/delivery-policy.md.
 *
 * The policy's fourth mode, `startup`, is absent: it drains a queue that
 * survived the last run, and nothing survives a page. It is only coherent with
 * disk persistence, and this client has none by design.
 */
export type DeliveryMode = "immediate" | "interval" | "manual";

/** What `log` takes. Every field optional except the name. */
export interface Entry {
  name: string;
  /** 1..24 on the OpenTelemetry ladder. 9 is INFO, 17 is ERROR. */
  severity?: number;
  attributes?: Attrs;
  /** Milliseconds since epoch. Defaults to now. */
  time?: number;
}

export interface AnalyticsConfig {
  /** The source key from the workspace's Sources page, `fr_web_…`. */
  sourceKey: string;
  /** Ingest origin, e.g. `https://t.themia.app`. */
  host: string;
  /** Page views on SPA navigations. Default true. */
  autoPage?: boolean;
  /** `outbound_click` and `file_download`. Default true. */
  autoOutbound?: boolean;
  /** Core Web Vitals. Default true. */
  autoVitals?: boolean;
  /** `form_submit`, the form's id and name only. Default true. */
  autoForms?: boolean;
  /** `page_leave`, with visible time and scroll depth. Default true. */
  trackLeave?: boolean;
  /** Uncaught errors and rejections as `exception` entries. Default FALSE. */
  autoErrors?: boolean;
  /** The schedule. Default `immediate`, coalesced. */
  mode?: DeliveryMode;
  /** Send at once at or above this severity. Default 17 (ERROR). */
  flushOnSeverity?: number;
  /** Upper bound between flushes, ms, in `interval` mode only. Default 30000. */
  flushEvery?: number;
  /** Also expose the command API as a global. Off by default. */
  global?: string;
}

export declare function init(config: AnalyticsConfig): void;
export declare function stop(): void;
export declare function event(name: string, attributes?: Attrs): void;
export declare function error(err: unknown, attributes?: Attrs): void;
export declare function log(entry: Entry): void;
export declare function identify(userId?: string | null): void;
export declare function consent(granted: boolean): void;
export declare function page(): void;
export declare function navigated(): void;
export declare function flush(): void;

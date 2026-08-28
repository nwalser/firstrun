/**
 * The tag's logic, with every browser API behind `Env`.
 *
 * Split out from `tag.ts` because the consent rule is a promise made to the
 * people being measured, and a promise nothing tests is a promise nobody keeps.
 * With the browser mocked out, "before consent nothing is stored and nothing is
 * sent" is an assertion rather than a comment.
 *
 * esbuild inlines this back into one IIFE, so the split costs nothing on the wire.
 */

export type Props = Record<string, string>;

export interface WireEvent {
  i: string;
  n: string;
  t: number;
  u?: string;
  r?: string;
  l?: string;
  us?: string;
  um?: string;
  uc?: string;
  x?: Props;
}

export interface PageInfo {
  url?: string;
  referrer?: string;
  locale?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

export interface Env {
  now(): number;
  uuid(): string;
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
  send(url: string, body: string): void;
  pageInfo(): PageInfo;
  /** Called whenever the visitor id appears or disappears, to redo download links. */
  identityChanged(): void;
}

export const KEY_VID = "_frv";
export const KEY_CONSENT = "_frc";
/** Beyond this we are not collecting analytics, we are leaking memory. */
export const MAX_BUFFER = 60;
/** Flush without waiting for the page to go away, so long sessions still land. */
export const FLUSH_AT = 20;

export interface TagConfig {
  projectId: string;
  host: string;
}

export function createTag(env: Env, config: TagConfig) {
  let consented = false;
  let visitorId: string | null = null;
  let accountId: string | undefined;
  const sessionId = env.uuid();
  let buffer: WireEvent[] = [];

  // A returning visitor already answered the banner. A first-time visitor has
  // stored nothing, so there is nothing to read and nothing to send.
  if (env.get(KEY_CONSENT) === "1") {
    consented = true;
    visitorId = env.get(KEY_VID) || env.uuid();
    env.set(KEY_VID, visitorId);
  }

  function push(e: WireEvent): void {
    if (buffer.length >= MAX_BUFFER) buffer.shift();
    buffer.push(e);
  }

  function flush(): void {
    if (!consented || !visitorId || buffer.length === 0) return;
    const e = buffer;
    buffer = [];
    env.send(
      config.host + "/v1/e",
      JSON.stringify({ p: config.projectId, v: visitorId, s: sessionId, a: accountId, e })
    );
  }

  function track(name: string, props?: Props): void {
    const e: WireEvent = { i: env.uuid(), n: name, t: env.now() };
    if (props) e.x = props;
    push(e);
    if (consented && buffer.length >= FLUSH_AT) flush();
  }

  function page(): void {
    const info = env.pageInfo();
    const e: WireEvent = { i: env.uuid(), n: "page_view", t: env.now() };
    if (info.url) e.u = info.url;
    if (info.referrer) e.r = info.referrer;
    if (info.locale) e.l = info.locale;
    if (info.utm_source) e.us = info.utm_source;
    if (info.utm_medium) e.um = info.utm_medium;
    if (info.utm_campaign) e.uc = info.utm_campaign;
    push(e);
  }

  /**
   * The download URL, carrying the visitor id when we are allowed to carry one.
   * The server mints the token and redirects to a filename holding it, and that
   * filename is the only thing that survives into the installer.
   */
  function downloadUrl(asset?: string, version?: string): string {
    let u = config.host + "/v1/download?project=" + encodeURIComponent(config.projectId);
    if (asset) u += "&asset=" + encodeURIComponent(asset);
    if (version) u += "&version=" + encodeURIComponent(version);
    if (visitorId) u += "&vid=" + encodeURIComponent(visitorId);
    return u;
  }

  function setConsent(granted: boolean): void {
    if (granted) {
      consented = true;
      visitorId = env.get(KEY_VID) || env.uuid();
      env.set(KEY_VID, visitorId);
      env.set(KEY_CONSENT, "1");
      env.identityChanged();
      flush();
    } else {
      // Withdrawn consent drops the buffer as well as the id. Sending what we
      // gathered while waiting for an answer, after the answer was no, is
      // exactly the behaviour a consent banner is supposed to prevent.
      consented = false;
      visitorId = null;
      buffer = [];
      env.del(KEY_VID);
      env.del(KEY_CONSENT);
      env.identityChanged();
    }
  }

  return {
    call(cmd: string, a?: unknown, b?: unknown): unknown {
      if (cmd === "consent") return setConsent(a !== false);
      if (cmd === "event") return track(String(a), b as Props | undefined);
      if (cmd === "page") return page();
      if (cmd === "identify") {
        accountId = a ? String(a) : undefined;
        return;
      }
      if (cmd === "download") return downloadUrl(a as string | undefined, b as string | undefined);
      if (cmd === "flush") return flush();
      return undefined;
    },
    page,
    flush,
    downloadUrl,
    hasConsent: () => consented,
    visitorId: () => visitorId,
    buffered: () => buffer.length,
  };
}

export type Tag = ReturnType<typeof createTag>;

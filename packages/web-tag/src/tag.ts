import { createTag, type Env, type PageInfo, type Tag } from "./core.js";

/**
 * The browser half of the tag: DOM, storage, and the beacon.
 *
 * All logic lives in core.ts. This file only supplies the browser and wires the
 * two events that matter -- `visibilitychange` and `pagehide` -- to a flush.
 *
 * The body goes out as `text/plain` so the request stays simple. A JSON content
 * type or any custom header would add a preflight to every beacon, and a
 * preflight fired from `pagehide` does not complete.
 */

function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  let s = "";
  for (let i = 0; i < 16; i++) {
    s += b[i]!.toString(16).padStart(2, "0");
    if (i === 3 || i === 5 || i === 7 || i === 9) s += "-";
  }
  return s;
}

// Every storage access is wrapped: Safari in private mode throws on write, and
// a throwing analytics tag takes the page's other scripts down with it.
function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode, quota, blocked. Not ours to solve. */
  }
}

function del(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* as above */
  }
}

function send(url: string, body: string): void {
  const nav = navigator;
  if (nav && typeof nav.sendBeacon === "function") {
    if (nav.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
  }
  // Only reached when sendBeacon is absent or refused the payload. Never from
  // an unload handler on a browser that has it.
  try {
    fetch(url, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => {});
  } catch {
    /* nothing left to try */
  }
}

function pageInfo(): PageInfo {
  let q: URLSearchParams | null = null;
  try {
    q = new URLSearchParams(location.search);
  } catch {
    /* exotic embedding */
  }
  return {
    url: location.href,
    referrer: document.referrer || undefined,
    locale: navigator.language,
    utm_source: q?.get("utm_source") || undefined,
    utm_medium: q?.get("utm_medium") || undefined,
    utm_campaign: q?.get("utm_campaign") || undefined,
  };
}

let tag: Tag;

/** Rewrites `<a data-fr-download>` so the customer writes markup, not URLs. */
function decorate(): void {
  const links = document.querySelectorAll("a[data-fr-download]");
  for (let i = 0; i < links.length; i++) {
    const a = links[i] as HTMLAnchorElement;
    a.href = tag.downloadUrl(
      a.getAttribute("data-fr-asset") || undefined,
      a.getAttribute("data-fr-version") || undefined
    );
  }
}

interface Queued {
  q?: IArguments[];
}

function boot(): void {
  const script = document.currentScript as HTMLScriptElement | null;
  const globalName = script?.getAttribute("data-global") || "fr";
  const projectId = script?.getAttribute("data-project") || "";
  // Defaults to wherever this file was served from, which is the point of
  // serving it from a path a customer can put behind their own CNAME.
  const host = (script?.getAttribute("data-host") || script?.src.replace(/\/[^/]*$/, "") || "").replace(
    /\/$/,
    ""
  );

  const env: Env = {
    now: Date.now,
    uuid,
    get,
    set,
    del,
    send,
    pageInfo,
    identityChanged: () => decorate(),
  };

  tag = createTag(env, { projectId, host });

  const globals = globalThis as Record<string, unknown>;
  const existing = globals[globalName] as (Queued & Function) | undefined;
  const api = (cmd: string, a?: unknown, b?: unknown) => tag.call(cmd, a, b);
  globals[globalName] = api;

  tag.page();
  decorate();

  // Commands the page queued before this file arrived.
  const queue = existing?.q;
  if (queue) for (let i = 0; i < queue.length; i++) api.apply(null, queue[i] as never);

  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") tag.flush();
  });
  addEventListener("pagehide", () => tag.flush());

  tag.flush();
}

boot();

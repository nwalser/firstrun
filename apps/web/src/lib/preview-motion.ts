/**
 * Whether the sign-in page's preview is allowed to move, remembered in the browser.
 *
 * The preview beside the sign-in form runs: entries arrive, counters climb, the
 * histogram's window slides. That is the point of it, and it is also the one
 * thing on the page somebody might not want, so it is a real control rather
 * than something to endure. Nobody is signed in here, so there is no account to
 * hang the choice on. It belongs to the browser.
 *
 * `localStorage` rather than a cookie, which is what the sidebar and the locale
 * use. Those two need the SERVER to know, because getting them wrong for one
 * frame moves the page. This one cannot move anything: the markup is identical
 * either way and only the motion differs, so there is nothing to send.
 *
 * Shaped exactly like `selected-source.ts`, and for the reason that file
 * already writes down: reading `localStorage` throws outright in Safari's
 * private mode and wherever site data is blocked, and a throw here would happen
 * during render, which takes the whole sign-in page down over a preference.
 */

/** One key, namespaced, so nothing else in localStorage can collide with it. */
const STORAGE_KEY = "firstrun.login.preview-motion";

/**
 * The stored choice, or `null` when nothing is recorded. `null` resolves to ON.
 *
 * The stored values are the strings `on` and `off` rather than JSON or a
 * stringified boolean, so a value that outlives this version is readable by a
 * human in the storage pane without being decoded first.
 */
export function readPreviewMotion(): "on" | "off" | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "on" || value === "off" ? value : null;
  } catch {
    return null;
  }
}

export function writePreviewMotion(value: "on" | "off"): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Nothing to do: the page renders the same, it just forgets.
  }
}

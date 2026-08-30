import { createEffect, createMemo, createSignal, onMount, type Accessor } from "solid-js";
import type { WikiSource } from "./api.js";

/**
 * Which source the wiki is currently written for, remembered across navigation.
 *
 * The whole point of the wiki is that a snippet arrives with the reader's own
 * ingest key already in it, so the choice has to outlive a page change -- and a
 * choice that resets on every navigation is worse than no choice at all,
 * because the reader has to notice it reset before they paste.
 *
 * Only the source **id** is stored. Storing the source itself would go stale
 * the moment somebody renames it or rotates its key, and a wiki that shows a
 * key from three months ago is exactly the silent failure this feature exists
 * to prevent.
 */

/** One key, namespaced, so nothing else in localStorage can collide with it. */
const STORAGE_KEY = "firstrun.wiki.source-id";

/**
 * `localStorage` is not a safe property to touch.
 *
 * Reading it throws outright in Safari's private mode and wherever site data is
 * blocked -- and a throw here happens during render, which takes the entire
 * wiki down over a preference. Every access is wrapped, and failure means "no
 * choice remembered", which is a page that still works.
 */
export function readStoredSourceId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredSourceId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the page renders the same, it just forgets.
  }
}

export interface SelectedSource {
  /** The chosen source, already validated against what the reader can see. */
  source: Accessor<WikiSource | null>;
  /** The stored id, whether or not it still resolves. Mostly for debugging. */
  sourceId: Accessor<string | null>;
  setSource: (source: WikiSource | null) => void;
  clear: () => void;
}

/**
 * The selection, as a reactive value.
 *
 * `sources` is an accessor rather than an array so this tracks the loader data
 * it is validated against: sign out in another tab, come back, and the stored
 * id stops resolving without anybody re-mounting anything.
 *
 * **Hydration.** The signal starts `null` on the server *and* on the client's
 * first render, and the stored id is read in `onMount`, which never runs during
 * SSR and runs only after hydration on the client. So the HTML the server sent
 * and the first client render are identical by construction -- the selection
 * appears one tick later, which is invisible, whereas a mismatch here would
 * leave the page half-hydrated and silently uninteractive.
 */
export function createSelectedSource(sources: () => WikiSource[]): SelectedSource {
  const [sourceId, setSourceId] = createSignal<string | null>(null);

  onMount(() => {
    const stored = readStoredSourceId();
    if (stored) setSourceId(stored);
  });

  const source = createMemo(() => {
    const id = sourceId();
    if (!id) return null;
    return sources().find((s) => s.id === id) ?? null;
  });

  // An id that no longer resolves is dropped rather than displayed. A source
  // can be deleted, or the reader can sign into an account that never had it,
  // and either way the honest answer is "nothing picked" -- never a stale name
  // beside a key that no longer exists.
  //
  // Safe to run eagerly because the route awaits its loader before this
  // component exists: `sources()` is the real list from the first render, not a
  // pending empty one, so an empty list means the reader genuinely has none.
  createEffect(() => {
    if (sourceId() && !source()) {
      setSourceId(null);
      writeStoredSourceId(null);
    }
  });

  const setSource = (next: WikiSource | null) => {
    setSourceId(next?.id ?? null);
    writeStoredSourceId(next?.id ?? null);
  };

  return {
    source,
    sourceId,
    setSource,
    clear: () => setSource(null),
  };
}

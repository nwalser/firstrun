import { createSignal, onCleanup, onMount } from "solid-js";

/** shadcn's mobile breakpoint. */
export const MOBILE_BREAKPOINT = 768;

/**
 * Whether the viewport is phone-sized.
 *
 * Starts false and only becomes true after mount: the server has no viewport,
 * and guessing on the way out means the markup it renders disagrees with what
 * the client decides a moment later. Fifteen lines here rather than a
 * dependency for the same.
 */
export function createIsMobile() {
  const [isMobile, setIsMobile] = createSignal(false);

  onMount(() => {
    const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    onCleanup(() => query.removeEventListener("change", update));
  });

  return isMobile;
}

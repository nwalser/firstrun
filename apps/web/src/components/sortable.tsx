import { createSignal, onCleanup } from "solid-js";

/**
 * Sort-on-hover reordering for a grid, on Pointer Events.
 *
 * Not a library. The obvious choice for Solid, `@thisbeyond/solid-dnd`, has not
 * been published since 2023, and what it buys -- sensors, collision strategies,
 * multi-container transfers -- is not what a six-card grid needs. Pointer
 * Events cover mouse, pen and touch in one API, which is more than HTML5 drag
 * and drop manages (it does not fire on touch at all).
 *
 * The interaction is "sort on hover": the list reorders live as you drag past
 * other cards, so what you see during the drag is what you get when you let go.
 * There is no separate drop indicator to keep in sync with reality.
 *
 * Positions are read from the DOM on every move rather than cached, because the
 * cards are moving underneath the pointer as the list reorders.
 */

export interface SortableOptions {
  /** Reordering is only possible while editing. */
  enabled: () => boolean;
  /** Called as the drag crosses another card. Reorder immediately. */
  onMove: (from: number, to: number) => void;
  /** Called once when the drag ends, if anything actually moved. */
  onCommit?: () => void;
}

/** Below this, a press is a click. Above it, a drag. */
const DRAG_THRESHOLD_PX = 4;

export function createSortable(options: SortableOptions) {
  const [dragIndex, setDragIndex] = createSignal<number | null>(null);
  let container: HTMLElement | undefined;
  let moved = false;

  const setContainer = (el: HTMLElement) => {
    container = el;
  };

  function itemElements(): HTMLElement[] {
    if (!container) return [];
    return [...container.querySelectorAll<HTMLElement>("[data-sortable-item]")];
  }

  /** The card under the pointer, or the nearest one by centre distance. */
  function indexAt(x: number, y: number): number | null {
    const els = itemElements();
    if (els.length === 0) return null;

    for (let i = 0; i < els.length; i++) {
      const r = els[i]!.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
    }

    // Outside every card -- dragging through a gap, or past the last row.
    // Falling back to the nearest centre keeps the drag from stalling.
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < els.length; i++) {
      const r = els[i]!.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height / 2);
      const d = dx * dx + dy * dy;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best;
  }

  function start(index: number, event: PointerEvent) {
    if (!options.enabled()) return;
    // Left button or touch only; a right-click should open a context menu.
    if (event.button !== 0) return;

    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    moved = false;

    const handle = event.currentTarget as HTMLElement;
    // Capture keeps the move and up events coming to this element even when the
    // pointer leaves it, which it immediately does. It throws if the pointer id
    // is not active -- synthetic events, a pointer already released -- and that
    // is not a reason to abandon the drag.
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* proceed without capture */
    }

    const onMove = (e: PointerEvent) => {
      if (!active) {
        // Wait for real movement, so a click on the drag handle is still a click.
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
        active = true;
        setDragIndex(index);
      }

      const from = dragIndex();
      if (from === null) return;
      const to = indexAt(e.clientX, e.clientY);
      if (to !== null && to !== from) {
        options.onMove(from, to);
        setDragIndex(to);
        moved = true;
      }
    };

    const finish = () => {
      try {
        handle.releasePointerCapture?.(event.pointerId);
      } catch {
        /* never captured */
      }
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      setDragIndex(null);
      if (moved) options.onCommit?.();
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    onCleanup(finish);
  }

  return {
    setContainer,
    dragIndex,
    /** Spread onto whatever should be grabbable. */
    handleProps: (index: number) => ({
      onPointerDown: (e: PointerEvent) => start(index, e),
      // Without this the browser scrolls the page instead of dragging on touch.
      style: { "touch-action": "none" },
    }),
  };
}

/** Six dots. The universally understood "you can drag this". */
export function GripIcon(props: { class?: string }) {
  return (
    <svg
      class={props.class}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

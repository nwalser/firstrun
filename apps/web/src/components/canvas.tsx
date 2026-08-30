import {
  CANVAS_MIN_HEIGHT,
  CANVAS_WIDTH,
  GRID,
  MIN_WIDGET_H,
  MIN_WIDGET_W,
  normaliseRect,
  type Rect,
} from "@firstrun/schema";
import {
  For,
  Show,
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
  useContext,
  type Accessor,
  type ComponentProps,
  type JSX,
} from "solid-js";
import { cn } from "../lib/cn.js";

/**
 * Free placement on a fixed-width canvas, on Pointer Events.
 *
 * Cards are placed, not flowed. A column grid would reflow a careful
 * arrangement the moment something above it changed height, and the entire
 * point of putting a card somewhere yourself is that it stays there -- gaps
 * included. So: absolute pixels, snapped to the grid, clamped to the canvas.
 *
 * A STORED RECT IS A CELL, NOT THE CARD YOU SEE. Cells are meant to touch: two
 * cards side by side are `x2 = x1 + w1`, exactly. The card is drawn inset
 * inside its cell by `GUTTER` on every side, so the borders have air between
 * them without anybody having to leave that air in the coordinates. Placement
 * is all cell arithmetic -- drag, resize, snapping, guides, the grid overlay --
 * and `CanvasItem` is the single place that converts to the other side.
 *
 * Not a library. `@thisbeyond/solid-dnd` has not been published since 2023, and
 * sensors and collision strategies are not what a board of a dozen cards needs.
 * Pointer Events cover mouse, pen and touch in one API, which HTML5 drag and
 * drop does not (it never fires on touch at all).
 *
 * Snapping happens during the gesture as well as on release, so the position
 * you are looking at while you drag is the position you get when you let go.
 * Overlap is allowed: a person dragging a card can see what they are doing, and
 * a board that shoves its neighbours aside is a board you cannot arrange.
 *
 * The geometry is plain functions over rectangles, deliberately free of DOM and
 * of Solid, because that is the part worth reading twice.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_EDGES: ResizeEdge[] = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];

export interface PlacedRect extends Rect {
  id: string;
}

/** A line drawn while dragging, because two cards agree about an edge or a centre. */
export interface Guide {
  axis: "x" | "y";
  /** Canvas coordinate of the line. */
  at: number;
  /** The span the line is drawn over, so it points at the two cards it relates. */
  from: number;
  to: number;
}

/**
 * The air between a cell's edge and the card drawn inside it.
 *
 * Ten pixels a side, which puts twenty between two neighbouring borders: one
 * grid cell, so the space you are looking at is a space you could have measured
 * off the overlay. Two gutters is also one grid step, which is what keeps every
 * size stated on a card (the tier thresholds, the minimums) on the grid when it
 * is restated on a cell.
 *
 * The rejected alternative is leaving the gap in the coordinates. Then two
 * cards that look evenly spaced are at arbitrary non-adjacent numbers, nobody
 * can land on "touching", and the same board arranged twice never agrees with
 * itself.
 */
export const GUTTER = 10;

/**
 * The card inside a cell. The one crossing between the two coordinate spaces.
 *
 * Symmetric on purpose: a cell's centre is its card's centre, so a centre
 * alignment guide points at exactly what it appears to point at, and a resize
 * that pins one edge pins the card's edge with it.
 */
export const cardRect = (cell: Rect): Rect => ({
  x: cell.x + GUTTER,
  y: cell.y + GUTTER,
  w: Math.max(0, cell.w - GUTTER * 2),
  h: Math.max(0, cell.h - GUTTER * 2),
});

/** Empty space kept below the lowest cell, so there is somewhere to drop things. */
const CANVAS_PADDING = 80;

/**
 * Below this, a press is a click. Above it, a drag.
 *
 * The whole card is the drag surface now, so this threshold is what keeps the
 * things inside a card usable: under it the press never becomes a gesture, no
 * default is prevented, and the click lands on whatever was actually under the
 * pointer. Four pixels is far enough to survive a shaky click and short enough
 * that a deliberate drag feels immediate.
 */
const DRAG_THRESHOLD_PX = 4;

/**
 * Things a press must never turn into a drag.
 *
 * A card is not inert -- it has a settings strip, links, and tables you can
 * scroll. Dragging from anywhere is only tolerable if "anywhere" excludes the
 * parts that already do something when you press them. `[data-no-drag]` is the
 * escape hatch for anything a widget adds later that this list cannot know
 * about.
 */
const NO_DRAG_SELECTOR =
  'button, a, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [role="switch"], [contenteditable], [data-no-drag]';

const startsGesture = (target: EventTarget | null): boolean =>
  !(target instanceof Element) || !target.closest(NO_DRAG_SELECTOR);

/**
 * How close two edges must be to count as aligned.
 *
 * Everything is already on the grid, so in practice this only ever matches an
 * exact agreement. It is a tolerance rather than an equality test because a
 * card whose width is odd puts its centre on a half pixel.
 */
const GUIDE_TOLERANCE_PX = 1.5;

/**
 * An SVG rule drawn at one DEVICE pixel, not one CSS pixel.
 *
 * The same rule the shell's chrome hairlines follow: every border in the
 * reference computes to 0.667px at a 1.5x display, so a baseline or a guide
 * drawn a full CSS pixel thick reads heavier than the chrome around it at 150%
 * and 200% scaling. Exported because the charts have the same problem and the
 * two have to agree.
 *
 * Arbitrary properties rather than a utility because Tailwind's stroke-width
 * scale is whole numbers only, and there is no fractional step on it.
 */
export const hairlineStroke = [
  "[stroke-width:1px]",
  "[@media(min-resolution:1.5dppx)]:[stroke-width:0.667px]",
  "[@media(min-resolution:2dppx)]:[stroke-width:0.5px]",
].join(" ");

export const canvasHeight = (items: Rect[]): number =>
  Math.max(
    CANVAS_MIN_HEIGHT,
    items.reduce((lowest, r) => Math.max(lowest, r.y + r.h), 0) + CANVAS_PADDING
  );

export const moveBy = (r: Rect, dx: number, dy: number): Rect => ({
  ...r,
  x: r.x + dx,
  y: r.y + dy,
});

/**
 * A rect dragged by one of its edges or corners.
 *
 * The opposite edge is the anchor: dragging the west edge moves `x` and grows
 * `w` by the same amount, so the right hand side of the card does not creep.
 * Both minimum size and the canvas bounds are enforced here rather than left to
 * `normaliseRect`, because clamping a width after the fact would let a card
 * slide sideways once it hit its minimum.
 *
 * Cells, like everything else on this side of the file. `MIN_WIDGET_W` and
 * `MIN_WIDGET_H` are the smallest CELL, so the smallest card is two gutters
 * short of them: the 160x120 minimum cell draws a 140x100 card, which still
 * holds a headline number under a truncated title, and that is all tier 1 ever
 * draws.
 */
export function resizeBy(r: Rect, edge: ResizeEdge, dx: number, dy: number): Rect {
  let { x, y, w, h } = r;

  if (edge.includes("e")) w = Math.min(r.w + dx, CANVAS_WIDTH - r.x);
  if (edge.includes("s")) h = r.h + dy;

  if (edge.includes("w")) {
    const right = r.x + r.w;
    x = Math.min(Math.max(0, r.x + dx), right - MIN_WIDGET_W);
    w = right - x;
  }
  if (edge.includes("n")) {
    const bottom = r.y + r.h;
    y = Math.min(Math.max(0, r.y + dy), bottom - MIN_WIDGET_H);
    h = bottom - y;
  }

  return { x, y, w, h };
}

/** The edges and centres of a rect, in the order they are compared. */
const xLines = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
const yLines = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];

/**
 * Where the dragged cell lines up with something already on the board.
 *
 * Cells, not cards, because cells are the things that touch: two neighbours
 * agree about one boundary and the line is drawn down the middle of the gutter
 * they share. Lining up the cards instead would report agreement between two
 * edges twenty pixels apart and stay silent about the one edge they actually
 * have in common.
 *
 * Only reported, never snapped to. Magnetic alignment fights the grid -- two
 * rules about where a card may land, disagreeing by a pixel or two, is how a
 * card ends up somewhere neither of them chose.
 */
export function alignmentGuides(rect: Rect, others: Rect[]): Guide[] {
  const found = new Map<string, Guide>();

  const consider = (axis: "x" | "y", at: number, a: Rect, b: Rect) => {
    const from = axis === "x" ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    const to = axis === "x" ? Math.max(a.y + a.h, b.y + b.h) : Math.max(a.x + a.w, b.x + b.w);
    const key = `${axis}:${Math.round(at)}`;
    const existing = found.get(key);
    if (existing) {
      existing.from = Math.min(existing.from, from);
      existing.to = Math.max(existing.to, to);
    } else {
      found.set(key, { axis, at, from, to });
    }
  };

  for (const other of others) {
    for (const a of xLines(rect)) {
      for (const b of xLines(other)) {
        if (Math.abs(a - b) <= GUIDE_TOLERANCE_PX) consider("x", b, rect, other);
      }
    }
    for (const a of yLines(rect)) {
      for (const b of yLines(other)) {
        if (Math.abs(a - b) <= GUIDE_TOLERANCE_PX) consider("y", b, rect, other);
      }
    }
  }

  return [...found.values()];
}

// ---------------------------------------------------------------------------
// How much a card can say
// ---------------------------------------------------------------------------

/**
 * THE TIER CONTRACT. Widgets render against this.
 *
 * A card shows more as it grows and less as it shrinks, and the size that
 * decides is the CARD's, never the viewport's -- four cards of four different
 * sizes sit side by side on the same screen.
 *
 * There are two channels, and they answer two different questions.
 *
 * 1. TIER -- "how much information". A number from 1 to 4, derived from width
 *    AND height together, because a 600x120 card has no room for a chart no
 *    matter how wide it is and Tailwind has no height container variant to say
 *    so. Read it with `useCardTier()` inside any widget; every `CanvasItem`
 *    provides it. Outside a card it answers 4, so a widget rendered anywhere
 *    else shows everything.
 *
 *      tier 1  tiny     the headline number, and nothing else
 *      tier 2  compact  + its label and the delta
 *      tier 3  full     + the sparkline or the chart
 *      tier 4  rich     + secondary detail, legend, footnote, extra columns
 *
 *    Thresholds are on the VISIBLE card, in canvas pixels, and a card must
 *    clear BOTH to reach a tier:
 *
 *      tier 2  w >= 200   h >= 140
 *      tier 3  w >= 240   h >= 160
 *      tier 4  w >= 440   h >= 260
 *
 *    The card, never the cell: what a card can say is a question about the box
 *    the words go in, and the gutter is not part of it. In cell terms every
 *    number above is two gutters larger (220/260/460 and 160/180/280), and
 *    since a gutter is half a grid cell those stay multiples of the grid too --
 *    so a card can still be dragged exactly onto a tier rather than landing a
 *    few pixels short of one.
 *
 * 2. CONTAINER QUERIES -- "how to lay that out at this width". Each
 *    `CanvasItem` is a container named `card` (`CARD_CONTAINER`), so a widget
 *    reaches the card's own width with Tailwind's built-in container variants
 *    written against that name: the `card`-suffixed forms of the extra-small
 *    through extra-large container sizes. Use the built-in sizes, not arbitrary
 *    thresholds -- an arbitrary variant in this codebase once emitted no rule
 *    at all. Column counts, hiding a table column, wrapping a row: those are
 *    container-query questions. What to show at all is a tier question.
 *
 * Both channels measure the same box, and it is the card: the `CanvasItem`
 * element is drawn at the inset rect, so a container query is asked of the
 * width a widget actually gets. Sizing the element to the cell and insetting
 * the contents would mis-tier every widget on the board by two gutters.
 *
 * The container type is `size` rather than `inline-size`. The item is
 * absolutely positioned with both dimensions written in pixels by the drag, so
 * its size never depends on its contents and size containment costs nothing --
 * and it buys container-relative units on both axes for charts and type.
 *
 * Type scales with the card through `--card-hero`, a pixel value set on every
 * item: the size the headline number should be here. It is computed from the
 * card rect rather than from container units so that the number a widget draws
 * and the tier it draws it at come from the same arithmetic.
 */
export type CardTier = 1 | 2 | 3 | 4;

/** The `container-name` on every card. Query it with the `card`-suffixed variants. */
export const CARD_CONTAINER = "card";

/** Takes the CARD's size. Pass a cell through `cardRect` first. */
export function cardTier(rect: { w: number; h: number }): CardTier {
  const byWidth = rect.w >= 440 ? 4 : rect.w >= 240 ? 3 : rect.w >= 200 ? 2 : 1;
  const byHeight = rect.h >= 260 ? 4 : rect.h >= 160 ? 3 : rect.h >= 140 ? 2 : 1;
  return Math.min(byWidth, byHeight) as CardTier;
}

/**
 * The headline number's size on this card, in pixels.
 *
 * Bounded by both axes -- a wide, squat card cannot spend its width on a number
 * that will not fit under the title -- then clamped, because past a point a
 * bigger number stops reading as a number and starts reading as a poster.
 */
export function heroFontSize(rect: { w: number; h: number }): number {
  const fits = Math.min(rect.w * 0.11, rect.h * 0.22);
  return Math.round(Math.min(56, Math.max(20, fits)));
}

const CardTierContext = createContext<Accessor<CardTier>>();

/** The tier of the card this widget is inside. 4 when it is not inside one. */
export const useCardTier = (): Accessor<CardTier> => useContext(CardTierContext) ?? (() => 4);

// ---------------------------------------------------------------------------
// The gesture
// ---------------------------------------------------------------------------

export type GestureMode = "move" | "resize";

export interface GestureProps {
  onPointerDown: (event: PointerEvent) => void;
  style: JSX.CSSProperties;
}

export interface FocusProps {
  tabindex: number;
  onKeyDown: (event: KeyboardEvent) => void;
}

export interface CanvasOptions {
  /** Every card on the board, in render order. */
  items: () => PlacedRect[];
  /** No handles, no drag surface, no listeners when this is false. */
  enabled: () => boolean;
  /** Called on every pointer move. Local state only -- do not save from here. */
  onPreview: (id: string, rect: Rect) => void;
  /** Called once, on release. This is the one worth persisting. */
  onCommit: (id: string, rect: Rect) => void;
}

export interface CanvasController {
  /** The card being dragged or resized, or null. Drives the grid overlay. */
  active: () => { id: string; mode: GestureMode } | null;
  guides: () => Guide[];
  /** Spread onto the card itself. The whole card is the drag surface. */
  moveProps: (id: string) => GestureProps;
  /** Spread onto one resize handle. */
  resizeProps: (id: string, edge: ResizeEdge) => GestureProps;
  /** Spread onto the card itself, so it can be reached and moved from a keyboard. */
  focusProps: (id: string) => FocusProps;
}

const CURSORS: Record<ResizeEdge, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

const NO_GESTURE: GestureProps = { onPointerDown: () => {}, style: {} };

/**
 * A drag that crossed the threshold ends with a click nobody asked for.
 *
 * The pointer went down on the card and came up somewhere else entirely, and
 * the browser still dispatches a click at the release point. Swallowed in the
 * capture phase so it never reaches whatever happens to be under the cursor.
 */
function swallowNextClick() {
  if (typeof window === "undefined") return;
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("click", swallow, true);
  setTimeout(() => window.removeEventListener("click", swallow, true), 0);
}

export function createCanvas(options: CanvasOptions): CanvasController {
  const [active, setActive] = createSignal<{ id: string; mode: GestureMode } | null>(null);
  const [guides, setGuides] = createSignal<Guide[]>([]);

  // A gesture outlives the handler that started it, so the way to abort one is
  // a reference to its own teardown. Registered here, in component scope, where
  // `onCleanup` actually has an owner to attach to.
  let abort: (() => void) | null = null;
  onCleanup(() => abort?.());

  function begin(id: string, mode: GestureMode, edge: ResizeEdge | null, event: PointerEvent) {
    if (!options.enabled()) return;
    // Left button or touch only. Right-click belongs to the context menu and
    // middle-click to the browser; neither is ever a drag.
    if (event.button !== 0) return;
    // A second finger arriving mid-gesture is not a second gesture.
    if (abort) return;
    // The whole card drags, so everything on it that already does something
    // when pressed has to be left alone.
    if (mode === "move" && !startsGesture(event.target)) return;

    const start = options.items().find((r) => r.id === id);
    if (!start) return;

    const surface = event.currentTarget as HTMLElement;

    if (mode === "move") {
      // Deliberately NOT prevented here. Until the threshold is crossed this is
      // still a click, and preventing the default would take focus, selection
      // and every inner control with it. Focus is moved explicitly instead, so
      // the arrow keys reach the card you just pressed.
      surface.focus?.({ preventScroll: true });
    } else {
      event.preventDefault();
      event.stopPropagation();
    }

    const from: Rect = { x: start.x, y: start.y, w: start.w, h: start.h };
    const others = options.items().filter((r) => r.id !== id);
    const originX = event.clientX;
    const originY = event.clientY;

    let latest = from;
    let live = false;

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      const dx = e.clientX - originX;
      const dy = e.clientY - originY;

      if (!live) {
        // Wait for real movement, so a press stays a click and the grid does
        // not flash every time somebody touches a card.
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        live = true;
        setActive({ id, mode });
        // Capture keeps the gesture coming even when the pointer leaves the
        // window. It throws on a pointer id that is not active -- a synthetic
        // event, a pointer already released -- and that is not a reason to
        // abandon the drag. Taken here rather than on pointerdown: a captured
        // pointer retargets the trailing click, which would break every button
        // inside a card.
        try {
          surface.setPointerCapture(event.pointerId);
        } catch {
          /* proceed without capture */
        }
        // A press that became a drag may have started a text selection first.
        document.getSelection()?.removeAllRanges();
      }

      e.preventDefault();

      const next = normaliseRect(
        mode === "move" ? moveBy(from, dx, dy) : resizeBy(from, edge!, dx, dy)
      );
      latest = next;
      setGuides(alignmentGuides(next, others));
      options.onPreview(id, next);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      finish(false);
    };

    function finish(commit: boolean) {
      abort = null;
      try {
        surface.releasePointerCapture?.(event.pointerId);
      } catch {
        /* never captured */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      setActive(null);
      setGuides([]);

      if (!live) return;
      swallowNextClick();
      // Escape puts the card back where it was. Anything else keeps it.
      if (commit) options.onCommit(id, latest);
      else options.onPreview(id, from);
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      finish(true);
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      finish(false);
    };

    // On the window rather than on the card: without pointer capture at
    // pointerdown -- which is what keeps inner buttons clickable -- the element
    // stops hearing about a pointer the moment it leaves, which is immediately.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    abort = () => finish(false);
  }

  /**
   * One grid step from the keyboard, five with shift, resizing with alt.
   *
   * A canvas that only answers to a mouse is a canvas some people cannot use,
   * and it is also the only way to place a card at an exact coordinate.
   */
  function nudge(id: string, dx: number, dy: number, resize: boolean) {
    const r = options.items().find((x) => x.id === id);
    if (!r) return;
    const next = normaliseRect(
      resize
        ? { x: r.x, y: r.y, w: r.w + dx, h: r.h + dy }
        : { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }
    );
    options.onPreview(id, next);
    options.onCommit(id, next);
  }

  return {
    active,
    guides,

    moveProps: (id) =>
      !options.enabled()
        ? NO_GESTURE
        : {
            onPointerDown: (e) => begin(id, "move", null, e),
            style: {
              // Without this the browser scrolls the page instead of dragging.
              // Only ever set while arranging, so a table inside a card still
              // scrolls under a finger the rest of the time.
              "touch-action": "none",
              cursor: active()?.id === id ? "grabbing" : "grab",
            },
          },

    resizeProps: (id, edge) =>
      !options.enabled()
        ? NO_GESTURE
        : {
            onPointerDown: (e) => begin(id, "resize", edge, e),
            style: { "touch-action": "none", cursor: CURSORS[edge] },
          },

    focusProps: (id) => ({
      tabindex: options.enabled() ? 0 : -1,
      onKeyDown: (e) => {
        if (!options.enabled()) return;
        // Only when the card itself has focus. A scrollable table inside one
        // uses the arrow keys too, and stealing them would move the card while
        // somebody was reading it.
        if (e.target !== e.currentTarget) return;
        const step = e.shiftKey ? GRID * 5 : GRID;
        const delta =
          e.key === "ArrowLeft"
            ? [-step, 0]
            : e.key === "ArrowRight"
              ? [step, 0]
              : e.key === "ArrowUp"
                ? [0, -step]
                : e.key === "ArrowDown"
                  ? [0, step]
                  : null;
        if (!delta) return;
        e.preventDefault();
        nudge(id, delta[0]!, delta[1]!, e.altKey);
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * The grid, drawn only while a gesture is running.
 *
 * It marks CELL corners, which is what a drag lands on, so a card that has
 * snapped sits one gutter inside the dots rather than on them. That reads
 * correctly: the dots are where the boxes go, and the boxes are what touch.
 *
 * At 20px a dot on every intersection is graph paper, and graph paper is the
 * thing you end up looking at instead of the board. So the fine dots are barely
 * there and a second, firmer dot lands every fifth cell -- a hundred pixels,
 * which is the distance anybody is actually judging by eye. The fine layer
 * gives the drag its felt resolution; the coarse layer gives it a ruler.
 */
function GridOverlay() {
  return (
    <>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 rounded-md opacity-30"
        style={{
          "background-image":
            "radial-gradient(circle at 0.5px 0.5px, var(--color-border) 1px, transparent 0)",
          "background-size": `${GRID}px ${GRID}px`,
        }}
      />
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 rounded-md opacity-70"
        style={{
          "background-image":
            "radial-gradient(circle at 0.5px 0.5px, var(--color-ring) 1.5px, transparent 0)",
          "background-size": `${GRID * 5}px ${GRID * 5}px`,
        }}
      />
    </>
  );
}

export function Canvas(props: {
  /** Usually `canvasHeight(items)`. */
  height: number;
  /** Only while something is being dragged. A permanent grid is a wireframe. */
  showGrid?: boolean;
  guides?: Guide[];
  class?: string;
  children: JSX.Element;
}) {
  return (
    // The canvas keeps its logical width on every screen and scrolls when the
    // viewport is narrower. A board arranged at one width that rearranges
    // itself at another is a board somebody has to arrange twice.
    //
    // Pulled out by one gutter on every side. The gutter is space BETWEEN two
    // cards, and the outermost cells have nothing on the far side to be between
    // -- left uncompensated, a card flush against the canvas would draw ten
    // pixels in from the page's own padding and read as an accident. So the
    // surface bleeds by exactly that much and a flush cell lands flush.
    //
    // This also replaces the padding that used to be here for the resize
    // handles: they reach four pixels out of a card, which is now four pixels
    // into its own gutter rather than over the canvas edge or a neighbour.
    <div
      class={cn(
        "overflow-x-auto overflow-y-hidden",
        props.showGrid && "select-none",
        props.class
      )}
      style={{ margin: `-${GUTTER}px` }}
    >
      <div class="relative" style={{ width: `${CANVAS_WIDTH}px`, height: `${props.height}px` }}>
        <Show when={props.showGrid}>
          <GridOverlay />
        </Show>

        {props.children}

        <Show when={props.guides?.length}>
          <svg
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 z-50 h-full w-full overflow-visible"
          >
            <For each={props.guides}>
              {(g) => (
                <line
                  class={hairlineStroke}
                  x1={g.axis === "x" ? g.at : g.from}
                  x2={g.axis === "x" ? g.at : g.to}
                  y1={g.axis === "x" ? g.from : g.at}
                  y2={g.axis === "x" ? g.to : g.at}
                  stroke="var(--color-ring)"
                  stroke-dasharray="3 3"
                  shape-rendering="crispEdges"
                />
              )}
            </For>
          </svg>
        </Show>
      </div>
    </div>
  );
}

/**
 * One absolutely placed card. Everything about where it is lives here.
 *
 * `rect` is the CELL. This is the only place that crosses over: the element is
 * drawn at the inset rect, and the gutter around it holds nothing at all. That
 * is also the hit-testing rule, and it costs no code -- a press in the gutter
 * lands on the canvas, which listens for nothing, so it drags neither of the
 * cards whose cells meet there. The dead space is dead in both directions:
 * there is no half-gutter of a neighbour's card to grab by mistake.
 *
 * The card is also the size container every widget inside it queries, and the
 * source of the tier those widgets render against -- see the tier contract
 * above. Both come from the same rect the drag is writing, so a card resized by
 * its edge re-tiers as the pointer moves rather than one frame later.
 */
export function CanvasItem(
  props: ComponentProps<"div"> & { rect: Rect; z?: number; active?: boolean }
) {
  const [local, rest] = splitProps(props, ["rect", "z", "active", "class", "style"]);
  const card = createMemo(() => cardRect(local.rect));
  const tier = createMemo(() => cardTier(card()));

  return (
    <CardTierContext.Provider value={tier}>
      <div
        class={cn(
          "absolute",
          // One hairline, not three. The large shadow this used to carry
          // already contains a ring, the card inside carries its own, and the
          // explicit half-alpha ring on top of both is exactly the thing the
          // design system warns reads as grey rather than as blue.
          local.active && "dragging",
          // The two-stop blue: 2px of the page colour, then 2px of the ring.
          "focus-ring",
          local.class
        )}
        data-tier={tier()}
        style={{
          left: `${card().x}px`,
          top: `${card().y}px`,
          width: `${card().w}px`,
          height: `${card().h}px`,
          "z-index": local.active ? 40 : (local.z ?? 0),
          "container-type": "size",
          "container-name": CARD_CONTAINER,
          "--card-w": `${card().w}px`,
          "--card-h": `${card().h}px`,
          "--card-hero": `${heroFontSize(card())}px`,
          ...(typeof local.style === "object" ? local.style : {}),
        }}
        {...rest}
      />
    </CardTierContext.Provider>
  );
}

/**
 * Eight grab zones: four corners and four edges.
 *
 * Width and height are both changeable, so both need a handle. The edges are
 * invisible strips that only announce themselves through the cursor; the
 * corners get a visible dot, because a corner is where people look first.
 *
 * Each one straddles its edge and so reaches four pixels into the card's own
 * gutter. That is the one part of the gutter that is not dead, and it can never
 * reach the neighbour: half a gutter is ten pixels and a handle spends four.
 *
 * These are the one part of a card that is not a drag surface, which is why
 * every one of them is marked as such: the card behind them would otherwise
 * start a move under the same press.
 */
export function ResizeHandles(props: { edgeProps: (edge: ResizeEdge) => GestureProps }) {
  const CORNERS: Array<{ edge: ResizeEdge; class: string }> = [
    { edge: "nw", class: "-left-1 -top-1" },
    { edge: "ne", class: "-right-1 -top-1" },
    { edge: "se", class: "-right-1 -bottom-1" },
    { edge: "sw", class: "-left-1 -bottom-1" },
  ];
  const SIDES: Array<{ edge: ResizeEdge; class: string }> = [
    { edge: "n", class: "inset-x-3 -top-1 h-2" },
    { edge: "s", class: "inset-x-3 -bottom-1 h-2" },
    { edge: "w", class: "inset-y-3 -left-1 w-2" },
    { edge: "e", class: "inset-y-3 -right-1 w-2" },
  ];

  return (
    <>
      <For each={SIDES}>
        {(side) => (
          <span
            aria-hidden="true"
            data-no-drag
            class={cn("absolute z-20", side.class)}
            {...props.edgeProps(side.edge)}
          />
        )}
      </For>
      <For each={CORNERS}>
        {(corner) => (
          <span
            aria-hidden="true"
            data-no-drag
            class={cn(
              "absolute z-20 size-3 rounded-full border border-ring bg-background opacity-0 transition-opacity",
              "group-hover/card:opacity-100 group-focus-within/card:opacity-100",
              corner.class
            )}
            {...props.edgeProps(corner.edge)}
          />
        )}
      </For>
    </>
  );
}

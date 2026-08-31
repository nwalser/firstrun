import {
  CANVAS_MIN_HEIGHT,
  CANVAS_WIDTH,
  GRID,
  MAX_WIDGETS,
  MAX_WIDGET_H,
  MAX_WIDGET_Y,
  MIN_WIDGET_H,
  MIN_WIDGET_W,
  normaliseRect,
  snapToGrid,
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
 * cards side by side are `x2 = x1 + w1`, exactly. The cell is the OUTER WALL:
 * the element is drawn at the whole of it and PADS the card in by `GUTTER` on
 * every side, so the air between two borders is padding rather than a hole left
 * in the coordinates. Placement is all cell arithmetic -- drag, resize,
 * snapping, guides, the grid overlay, the handles -- and the padding is the
 * single place the two sides differ.
 *
 * That is why a card's BORDER is not where its handles are. The handles, the
 * alignment guides, the grid dots and the focus ring all live on the wall,
 * because the wall is what a drag actually moves; the border is the card drawn
 * inside it. Sizing the element to the visible border instead would put the
 * handles a gutter away from every line that explains them.
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
 * The padding between a cell's wall and the card drawn inside it.
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
 * The card inside a cell: what the padding leaves.
 *
 * The element is laid out at the cell, so the browser already computes this as
 * the content box. It is restated here because the two things that must agree
 * with what a widget can say -- the tier and the hero type size -- are
 * arithmetic rather than layout, and they have to be known before the box is
 * measured.
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
 * Extra ruled ground under the board, while it is being arranged.
 *
 * `CANVAS_PADDING` is the room a board keeps for a drop at all times, and it is
 * deliberately small: a board of three cards should not sit above a screen of
 * emptiness while somebody is reading it. Arranging asks the opposite question.
 * Ten cells is half a card's height of visible, ruled, obviously-droppable
 * space past the last card, which is what makes "somewhere further down" look
 * like a place rather than the end of the page.
 */
const ARRANGE_ROOM = GRID * 10;

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
 *
 * THE MOVING EDGE IS SNAPPED HERE, AND THE SIZE IS DERIVED FROM THE ANCHOR.
 * That ordering is the whole correctness of the west and north handles.
 * `normaliseRect` snaps `x` and `w` independently, and a start rect is always
 * grid-aligned, so `x + w` is a multiple of the grid: the moment the pointer
 * put the west edge on a half-cell it put the WIDTH on one too, and rounding
 * both away from zero pushed the anchored right edge out by a whole cell. The
 * card either grew on the side nobody was touching or slid sideways without
 * changing size at all. Snapping the origin first and taking `w = right - x`
 * makes the pair grid-aligned by construction, so the later `normaliseRect` is
 * an identity on it rather than a second, disagreeing opinion.
 *
 * The west and north edges clamp to BOTH limits HERE, because those are the two
 * that move the origin: a size clamped after the fact would let a card slide
 * once it hit a limit, since the origin would keep following the pointer while
 * the size stopped growing. That is true at the maximum exactly as it is at the
 * minimum -- a card already at the tallest the schema allows would have
 * translated upward one-for-one under a north drag rather than stopping. East
 * and south leave the origin alone, so the later clamp reaches the same answer
 * and every direction stops dead instead of jumping.
 *
 * Cells, like everything else on this side of the file. `MIN_WIDGET_W` and
 * `MIN_WIDGET_H` are the smallest CELL, so the smallest card is two gutters
 * short of them: the 160x120 minimum cell draws a 140x100 card, which still
 * holds a headline number under a truncated title, and that is all tier 1 ever
 * draws.
 */
export function resizeBy(r: Rect, edge: ResizeEdge, dx: number, dy: number): Rect {
  let { x, y, w, h } = r;
  const right = r.x + r.w;
  const bottom = r.y + r.h;

  if (edge.includes("e")) w = Math.min(snapToGrid(r.w + dx), CANVAS_WIDTH - r.x);
  if (edge.includes("s")) h = snapToGrid(r.h + dy);

  if (edge.includes("w")) {
    // The widest a card may be is the canvas itself, and the anchor is already
    // on it, so the lower bound here can never bite. Stated anyway, in the same
    // shape as the north edge, so the two cannot drift apart.
    const widest = Math.max(0, right - CANVAS_WIDTH);
    x = Math.min(Math.max(widest, snapToGrid(r.x + dx)), right - MIN_WIDGET_W);
    w = right - x;
  }
  if (edge.includes("n")) {
    // Both ends: the tallest the card may be going up, and the lowest a top
    // edge may sit going down. Either bound reached with only the size clamped
    // afterwards would have left the origin still following the pointer.
    const tallest = Math.max(0, bottom - MAX_WIDGET_H);
    const lowest = Math.min(bottom - MIN_WIDGET_H, MAX_WIDGET_Y);
    y = Math.min(Math.max(tallest, snapToGrid(r.y + dy)), lowest);
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
 * Both channels measure the same box, and it is the card. The `CanvasItem`
 * element is laid out at the CELL, but it pads by one gutter and a size
 * container queries its CONTENT box, so a container query is asked of the width
 * a widget actually gets rather than of the wall two gutters outside it.
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

/*
  There is deliberately no card-box context beside the tier one.

  A tier says HOW MUCH a card may show; what SHAPE it is is a different
  question, and 620x160 and 300x320 are the same tier while wanting opposite
  layouts. But a widget is also rendered off the board -- the explore preview,
  the project overview -- where there is no card to ask, and a context default
  would be one guess standing in for every one of those boxes. A widget that
  needs its own proportions measures them (`Measured` in `widgets.tsx`), which
  is the same answer in all three places.
*/

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
 * A lifted card sits above every resting one, and below the chrome.
 *
 * A resting card's stacking order IS its render order, so the top card on a
 * full board is at `MAX_WIDGETS - 1`. A fixed lift below that number puts the
 * card you are dragging underneath the last few cards on a busy board, which
 * reads as the drag having been dropped. The chrome layer starts at 50, so this
 * has to stay under it: a card dragged past the top of the viewport must go
 * behind the topbar rather than over it.
 *
 * The `dragging` utility names a stacking step of its own, and this beats it:
 * a resting card writes its order as an inline style, so the lift has to be
 * written the same way or it would lose to the very cards it is meant to clear.
 */
const LIFTED_Z = MAX_WIDGETS;

/**
 * The cursor for a running gesture, stated on the document as well as the card.
 *
 * The same rule the sidebar's resize handle follows, and for the same reason:
 * the pointer leaves the thing it is dragging the moment that thing stops
 * following it -- a card clamped against the canvas edge, an edge held past its
 * minimum -- and the cursor flicking back to an arrow reads as the gesture
 * having ended. `cursor` inherits, so one declaration on the root reaches the
 * empty canvas, the page around it and every card that has not stated its own.
 *
 * The cards state theirs from the same value (see the `GestureProps` below),
 * because a declared cursor beats an inherited one however important the
 * inherited one is -- and while a card is being RESIZED the lift utility is
 * declaring the grab cursor on it, which is the wrong one.
 */
function setDocumentCursor(value: string | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (value) root.style.setProperty("cursor", value, "important");
  else root.style.removeProperty("cursor");
}

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
  /** The one cursor everything shows while a gesture runs. Null between them. */
  const [cursor, setCursor] = createSignal<string | null>(null);

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
        const held = mode === "move" ? "grabbing" : CURSORS[edge!]!;
        setCursor(held);
        setDocumentCursor(held);
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
      setCursor(null);
      setDocumentCursor(null);

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
              // The gesture's cursor while one runs, on EVERY card and not just
              // the one being dragged: a card that says `grab` while another is
              // passing over it is the flicker this exists to stop.
              cursor: cursor() ?? "grab",
            },
          },

    resizeProps: (id, edge) =>
      !options.enabled()
        ? NO_GESTURE
        : {
            onPointerDown: (e) => begin(id, "resize", edge, e),
            style: { "touch-action": "none", cursor: cursor() ?? CURSORS[edge] },
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
 * The grid, drawn for as long as the board is being arranged.
 *
 * RULED, at exactly the pitch a drag snaps to. It used to be dots on cell
 * corners at two densities, which is a different claim: a dot marks where a
 * corner may land and says nothing about the edges between them, so a card
 * being lined up against one two columns away had nothing to follow. A line at
 * every snap position is the same information drawn as the thing a person
 * actually sights along, and one pitch rather than two means what you see is
 * what the drag does.
 *
 * It is on the whole time you are arranging rather than only while the pointer
 * is down: the question a grid answers is "where can this go", and that is
 * asked before the drag starts. It stays off while you are only reading the
 * board, because a permanent grid is a wireframe.
 *
 * The rules are the chrome's own hairline colour and they firm up while a
 * gesture runs, so the ruler is loudest exactly while somebody is measuring
 * against it. One device pixel, like every other rule in the app: at 20px a
 * full CSS pixel in both directions reads as a solid wash rather than a grid.
 */
function GridOverlay(props: { active?: boolean }) {
  const rule = "var(--color-border)";
  return (
    <div
      aria-hidden="true"
      class={cn(
        "pointer-events-none absolute inset-0 transition-opacity duration-200",
        // `--border` is an ALPHA in both themes (14% white in dark), so this is
        // already a faint line before any opacity is put on it. A grid you
        // cannot see while arranging is the one state this must not have.
        props.active ? "opacity-100" : "opacity-70"
      )}
      style={{
        "background-image": `linear-gradient(to right, ${rule} 1px, transparent 1px), linear-gradient(to bottom, ${rule} 1px, transparent 1px)`,
        "background-size": `${GRID}px ${GRID}px`,
        // The lines sit ON the snap positions rather than one pixel after them,
        // so a card's wall lands on the rule it was dragged to and not beside it.
        "background-position": "-0.5px -0.5px",
      }}
    />
  );
}

export function Canvas(props: {
  /** Usually `canvasHeight(items)`. */
  height: number;
  /** Whenever the board is being arranged. A grid while reading is a wireframe. */
  showGrid?: boolean;
  /** A gesture is actually running: the grid firms up and text stops selecting. */
  gesturing?: boolean;
  guides?: Guide[];
  class?: string;
  children: JSX.Element;
}) {
  return (
    // The canvas keeps its logical width on every screen and scrolls when the
    // viewport is narrower. A board arranged at one width that rearranges
    // itself at another is a board somebody has to arrange twice.
    //
    // The net effect is a bleed of one gutter on every side. The gutter is space
    // BETWEEN two cards, and the outermost cells have nothing on the far side to
    // be between -- left uncompensated, a card flush against the canvas would
    // draw ten pixels in from the page's own padding and read as an accident.
    //
    // It is spelled as two gutters of negative margin and one of padding rather
    // than as one negative margin, because a scroller CLIPS at its padding box
    // and the cell wall now carries ink that is painted outside the border box:
    // the dashed arrange frame, and the two-stop focus ring at four pixels of
    // spread. With no padding, a card at x=0 or y=0 lost the top and left of
    // both -- and leftward overflow is not even scrollable, so there was no way
    // to see it. One gutter of room inside the clip is more than either needs.
    <div
      class={cn(
        "overflow-x-auto overflow-y-hidden",
        props.gesturing && "select-none",
        props.class
      )}
      style={{ margin: `-${GUTTER * 2}px`, padding: `${GUTTER}px` }}
    >
      {/*
        The placeable area, and while arranging that is the whole of it.

        The height normally follows the cards, which is right for reading: a
        board of three cards should not leave a screen of emptiness under them.
        It is the wrong answer while arranging, where the question is where a
        card COULD go, and a grid that stops just below the lowest card answers
        it with "nowhere else". So the box grows to fill what is left of the
        viewport, and the grid fills the box.

        The width does not grow with it. `CANVAS_WIDTH` is the placeable area,
        not a rendering convenience, and ruling ground a card can never be
        dropped on would be the same lie in the other direction.
      */}
      <div
        class="relative"
        style={{
          width: `${CANVAS_WIDTH}px`,
          height: `${props.height + (props.showGrid ? ARRANGE_ROOM : 0)}px`,
          ...(props.showGrid ? { "min-height": "calc(100vh - 13rem)" } : {}),
        }}
      >
        <Show when={props.showGrid}>
          <GridOverlay active={props.gesturing} />
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
 * `rect` is the CELL, and the element IS the cell: it is laid out at the whole
 * of it and pads its contents in by one gutter, so the air around a card is
 * this element's padding rather than a hole in the coordinates. Two cells that
 * touch draw two cards twenty pixels apart, and everything a person aims at
 * while arranging -- the handles, the dashed wall, the focus ring -- is on the
 * cell, because the cell is what a drag moves.
 *
 * The gutter is still dead in both directions for a MOVE: a press there is a
 * press on this element, which drags this card and never the neighbour whose
 * wall it shares. What changed is that a RESIZE now has the whole gutter to be
 * grabbed by instead of four pixels either side of the border.
 *
 * The card is the size container every widget inside it queries, and the source
 * of the tier those widgets render against -- see the tier contract above. A
 * size container queries its CONTENT box, so the padding takes itself out of
 * both answers, and both still come from the rect the drag is writing: a card
 * resized by its edge re-tiers as the pointer moves rather than one frame later.
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
          // The two-stop blue, on the wall rather than on the border: the ring
          // and the handles answer the same question and have to agree about
          // where the card's edge is. Four pixels of it fall outside the cell,
          // which is inside the neighbour's own gutter and so over nothing.
          "focus-ring",
          local.class
        )}
        data-tier={tier()}
        style={{
          left: `${local.rect.x}px`,
          top: `${local.rect.y}px`,
          width: `${local.rect.w}px`,
          height: `${local.rect.h}px`,
          padding: `${GUTTER}px`,
          "z-index": local.active ? LIFTED_Z : (local.z ?? 0),
          "container-type": "size",
          "container-name": CARD_CONTAINER,
          // Only the hero size. `--card-w` and `--card-h` used to be published
          // beside it and nothing ever read them: an element inside a size
          // container already reaches both axes through the container-relative
          // units, so they were a second, staler answer to a question CSS
          // answers itself.
          "--card-hero": `${heroFontSize(card())}px`,
          ...(typeof local.style === "object" ? local.style : {}),
        }}
        {...rest}
      />
    </CardTierContext.Provider>
  );
}

/**
 * Eight grab zones: four corners and four edges, all on the cell's wall.
 *
 * Width and height are both changeable, so both need a handle. The edges are
 * invisible strips that only announce themselves through the cursor; the
 * corners get a visible dot, because a corner is where people look first.
 *
 * They are positioned against the padding box, which is the cell, so each one
 * sits in the card's own gutter and NONE of them crosses into the neighbour's.
 * Two cards placed touching therefore have two handles ten pixels apart rather
 * than two in the same place arguing about which one the pointer meant.
 *
 * These are the one part of a card that is not a drag surface, which is why
 * every one of them is marked as such: the card behind them would otherwise
 * start a move under the same press.
 */
export function ResizeHandles(props: { edgeProps: (edge: ResizeEdge) => GestureProps }) {
  const CORNERS: Array<{ edge: ResizeEdge; class: string }> = [
    { edge: "nw", class: "left-0 top-0" },
    { edge: "ne", class: "right-0 top-0" },
    { edge: "se", class: "right-0 bottom-0" },
    { edge: "sw", class: "left-0 bottom-0" },
  ];
  // The strips stop one corner short at each end, so a corner dot is never
  // sitting on top of the edge handle it shares a pixel with.
  const SIDES: Array<{ edge: ResizeEdge; class: string }> = [
    { edge: "n", class: "inset-x-4 top-0 h-2.5" },
    { edge: "s", class: "inset-x-4 bottom-0 h-2.5" },
    { edge: "w", class: "inset-y-4 left-0 w-2.5" },
    { edge: "e", class: "inset-y-4 right-0 w-2.5" },
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
              "absolute z-20 size-2.5 rounded-full border border-ring bg-background opacity-0 transition-opacity",
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

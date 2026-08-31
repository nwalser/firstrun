/**
 * The canvas a board is arranged on.
 *
 * Geometry only. Nothing here knows what a card is or what it asks: a widget is
 * a saved query plus a visualisation (`board.ts`), and where it sits is these
 * four numbers. Keeping the two apart is what lets the card vocabulary change
 * without anybody's arrangement moving.
 */

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

/**
 * Cards are placed, not flowed.
 *
 * Coordinates are plain pixels on a canvas of fixed logical width, snapped to a
 * 20px grid. Not a 12-column grid: the point of placing a card yourself is that
 * you can leave a gap, and a column system is a flow with extra steps -- it
 * will always reflow a careful arrangement the moment something above it
 * changes height.
 *
 * The grid is coarse on purpose. At 5px a drag landed wherever the pointer
 * happened to stop and two cards meant to line up were three pixels apart; at
 * 20px they either line up or visibly do not. Everything that can be on the
 * grid is: the minimum sizes, the canvas, every gap in every template.
 *
 * The canvas keeps its logical width on every screen and scrolls when the
 * viewport is narrower. A layout arranged at 1440px that silently rearranges
 * itself at 1280px is a layout somebody has to arrange twice.
 */
export const GRID = 20;
export const CANVAS_WIDTH = 1280;
export const CANVAS_MIN_HEIGHT = 600;
export const MIN_WIDGET_W = 160;
export const MIN_WIDGET_H = 120;

/**
 * The largest a card may be, and the lowest it may sit.
 *
 * These are the numbers the stored contract already enforces (`board.ts`), said
 * here as well because this is where a rect is made legal. `normaliseRect` used
 * to clamp height and y downward only, so an arrow key held on the south edge
 * walked a card straight past the schema's ceiling: the board then failed to
 * SAVE, silently, every time, on a card the canvas had happily drawn.
 */
export const MAX_WIDGET_H = 3000;
export const MAX_WIDGET_Y = 40_000;

export const snapToGrid = (n: number): number => Math.round(n / GRID) * GRID;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Keeps a rect on the canvas, on the grid, and within the size the schema allows. */
export function normaliseRect(r: Rect): Rect {
  const w = clamp(snapToGrid(r.w), MIN_WIDGET_W, CANVAS_WIDTH);
  const h = clamp(snapToGrid(r.h), MIN_WIDGET_H, MAX_WIDGET_H);
  return {
    w,
    h,
    x: clamp(snapToGrid(r.x), 0, CANVAS_WIDTH - w),
    y: clamp(snapToGrid(r.y), 0, MAX_WIDGET_Y),
  };
}

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Somewhere a new card fits without landing on top of an existing one.
 *
 * Scans left to right, top to bottom, and gives up onto the bottom of the
 * canvas rather than searching forever. Overlap is allowed once a human is
 * dragging -- they can see what they are doing -- but a card that appears
 * underneath another one looks like the button did nothing.
 *
 * The scan steps one grid cell at a time. It used to step four (20px on the old
 * 5px grid); four cells of a 20px grid is an 80px stride, which steps straight
 * over gaps a card would have fitted in and drops it at the bottom of the board
 * instead. One cell keeps the scan at the 20px resolution it always had, and
 * the grid is now coarse enough that a cell is not a wasted probe.
 */
export function findFreeSlot(
  taken: Rect[],
  size: { w: number; h: number }
): { x: number; y: number } {
  const step = GRID;
  const maxY = taken.reduce((m, r) => Math.max(m, r.y + r.h), 0) + size.h + step;
  for (let y = 0; y <= maxY; y += step) {
    for (let x = 0; x + size.w <= CANVAS_WIDTH; x += step) {
      const probe = { x, y, w: size.w, h: size.h };
      if (!taken.some((r) => rectsOverlap(probe, r))) return { x, y };
    }
  }
  return { x: 0, y: snapToGrid(maxY) };
}


/** How many cards one board may hold. */
export const MAX_WIDGETS = 48;

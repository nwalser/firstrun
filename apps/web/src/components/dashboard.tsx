import type { BoardFrame, Comparison, DateRange, Rect, Surface } from "@firstrun/schema";
import { effectiveQuery, findFreeSlot } from "@firstrun/schema";
import { useRouter } from "@tanstack/solid-router";
import BringToFront from "lucide-solid/icons/bring-to-front";
import Copy from "lucide-solid/icons/copy";
import Eye from "lucide-solid/icons/eye";
import FlaskConical from "lucide-solid/icons/flask-conical";
import Funnel from "lucide-solid/icons/funnel";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import Move from "lucide-solid/icons/move";
import Plus from "lucide-solid/icons/plus";
import SlidersHorizontal from "lucide-solid/icons/sliders-horizontal";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { saveDashboard } from "../lib/api.js";
import { cn } from "../lib/cn.js";
import {
  Canvas,
  CanvasItem,
  ResizeHandles,
  canvasHeight,
  cardRect,
  cardTier,
  createCanvas,
  type CanvasController,
} from "./canvas.js";
import { FilterEditor } from "./explore/builder.js";
import { ExplorePanel } from "./explore/panel.js";
import {
  PRESETS,
  presetHint,
  presetLabel,
  presetsFor,
  type Preset,
} from "./explore/presets.js";
import type { Board, BoardWidget, QueryWidget } from "@firstrun/schema/board";
import {
  emptyDiscovery,
  emptyFilter,
  type BoardSnapshot,
  type Discovery,
  type Filter,
  type LogQuery,
  type Visualisation,
} from "@firstrun/schema/query";
import { useI18n } from "../lib/i18n/index.js";
import { queryLabels } from "./query-labels.js";
import { TimeRangePicker } from "./time-range.js";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
  Input,
  Label,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
} from "./ui/index.js";
import { WidgetBody, defaultTitle } from "./widgets.js";

/**
 * The board, and the editor for it.
 *
 * A card is a saved query and a way of drawing its answer, so this file has no
 * catalogue of card kinds in it: the palette offers STARTING POINTS, every one
 * of them a query somebody could have built, and the settings drawer opens the
 * builder on whichever card is selected. There is nothing a preset can reach
 * that the drawer cannot, which is the whole point: a question the product can
 * answer and the customer cannot ask is the failure mode now.
 *
 * Editing is in place and the board is a canvas, not a flow. Cards are dragged
 * from anywhere on them, resized in both directions, snapped to the grid, and
 * they keep rendering real numbers the whole time, so the thing being arranged
 * is the thing you will be looking at. Nothing turns into a grey placeholder
 * and no configuration appears inline: a card that grows a form has stopped
 * showing you what it will look like.
 *
 * What a widget stores and what a drag snaps is its CELL. Cells are meant to
 * touch, and the card is drawn one gutter inside its own, so a board arranged
 * edge to edge has even air between every border. Geometry belongs to
 * `canvas.tsx` and nothing here computes a pixel of it.
 */

type SaveState = "idle" | "saving" | "saved" | "error";

/** Long enough to swallow a drag, short enough that nobody navigates away first. */
const DRAG_SAVE_DEBOUNCE_MS = 250;
const TYPING_DEBOUNCE_MS = 500;

/**
 * How wide the content pane must be before the palette can sit BESIDE the board.
 *
 * The board's own layout answers the pane through container queries, which is
 * the reference's mechanism and the reason opening a panel reflows the content
 * as if the window had shrunk. Which surface the palette IS cannot be answered
 * that way: below this the palette becomes a sheet, a sheet is portalled out of
 * the pane, and no container query can reach it there. So the same step is
 * stated twice, once as a container variant on the body row and once here, and
 * the two are meant to agree.
 */
const PALETTE_PANE_PX = 1024;

export interface DashboardProps {
  workspaceSlug: string;
  projectSlug: string;
  dashboardId: string;
  layout: Board;
  snapshot: BoardSnapshot;
  sources: Array<{ id: string; name: string; kind: Surface }>;
  /** What this project has actually written, so every picker offers real keys. */
  discovery: Discovery;
  canEdit: boolean;
}

interface PersistOptions {
  /** True only when the change alters what the numbers MEAN. */
  refetch?: boolean;
  debounceMs?: number;
}

export function Dashboard(props: DashboardProps) {
  const router = useRouter();
  const i18n = useI18n();
  const labels = queryLabels(i18n);

  /**
   * What the palette is, and how to arrange what lands on the board.
   *
   * The arrange-mode keys are said here rather than above the toolbar because
   * this is the one place they are relevant: a hint about dragging cards,
   * printed above a board nobody is dragging, is a permanent line of chrome
   * answering a question nobody asked.
   */
  const paletteHint = () => i18n.t("dashboard.palette_hint");

  const [board, setBoard] = createSignal<Board>(props.layout);
  const [editing, setEditing] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [filtering, setFiltering] = createSignal(false);
  const [configuring, setConfiguring] = createSignal<string | null>(null);
  const [state, setState] = createSignal<SaveState>("idle");
  const [error, setError] = createSignal<string | null>(null);

  // The loader is the source of truth. When it refetches -- after a range
  // change, or another tab saving -- take its answer over the local copy.
  createEffect(() => setBoard(props.layout));

  let debounce: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(debounce));

  /**
   * Every edit persists immediately.
   *
   * With drag-to-arrange there is no natural moment to press Save, and a board
   * that looks right but was never written is worse than a brief "Saving…".
   * Continuous gestures debounce; `refetch` is only for changes that alter what
   * the numbers mean, because moving a card does not need new SQL.
   */
  async function persist(next: Board, opts: PersistOptions = {}) {
    setBoard(next);
    clearTimeout(debounce);

    const run = async () => {
      setState("saving");
      setError(null);
      const result = await saveDashboard({
        data: {
          workspace: props.workspaceSlug,
          project: props.projectSlug,
          dashboardId: props.dashboardId,
          layout: next,
        },
      });
      if (!result.ok) {
        setState("error");
        setError(result.error);
        return;
      }
      if (opts.refetch) await router.invalidate();
      setState("saved");
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1600);
    };

    if (opts.debounceMs) debounce = setTimeout(() => void run(), opts.debounceMs);
    else await run();
  }

  const widgets = () => board().widgets;
  /** Stable across a drag, unlike the widget objects themselves. See the `<For>`. */
  const ids = createMemo(() => widgets().map((w) => w.id));
  const canArrange = () => props.canEdit && editing();

  const setWidgets = (next: BoardWidget[], opts?: PersistOptions) =>
    persist({ ...board(), widgets: next }, opts);

  const withRect = (id: string, rect: Rect): BoardWidget[] =>
    widgets().map((w) => (w.id === id ? { ...w, ...rect } : w));

  const canvas = createCanvas({
    items: () => widgets().map((w) => ({ id: w.id, x: w.x, y: w.y, w: w.w, h: w.h })),
    enabled: canArrange,
    // Local only while the pointer is down: this fires on every move.
    onPreview: (id, rect) => setBoard({ ...board(), widgets: withRect(id, rect) }),
    onCommit: (id, rect) =>
      void setWidgets(withRect(id, rect), { debounceMs: DRAG_SAVE_DEBOUNCE_MS }),
  });

  const patch = (id: string, changes: Partial<BoardWidget>, opts?: PersistOptions) =>
    setWidgets(
      widgets().map((w) => (w.id === id ? ({ ...w, ...changes } as BoardWidget) : w)),
      opts
    );

  const remove = (id: string) => {
    if (configuring() === id) setConfiguring(null);
    return setWidgets(widgets().filter((w) => w.id !== id));
  };

  const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * Every rect on this board, as cells.
   *
   * Which is what `findFreeSlot`, `canvasHeight` and the canvas gestures all
   * want: a free slot found against cells puts the new card touching its
   * neighbours, and touching looks like twenty pixels of air rather than two
   * borders meeting.
   */
  const occupied = (): Rect[] => widgets().map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h }));

  /**
   * A preset lands on the board and opens its own builder.
   *
   * The rail stays open behind it: boards are built a handful of cards at a
   * time, and a palette that closes itself after each one is a palette you
   * reopen. The drawer opens because a preset is a starting point, and the next
   * thing anybody does with one is change what it counts.
   */
  function add(preset: Preset) {
    const at = findFreeSlot(occupied(), preset.size);
    const widget = {
      ...preset.build(),
      id: newId(preset.key),
      ...at,
      ...preset.size,
    } as BoardWidget;
    void setWidgets([...widgets(), widget], { refetch: true });
    // On a narrow pane the palette is a sheet OVER the board rather than a rail
    // beside it, and the settings drawer is about to open on top of it.
    if (!paletteIsRail()) setPaletteOpen(false);
    setConfiguring(widget.id);
  }

  function duplicate(widget: BoardWidget) {
    const at = findFreeSlot(occupied(), { w: widget.w, h: widget.h });
    // The same query, so it keys identically and the snapshot already has its
    // answer. A copy costs a render, not a round trip.
    void setWidgets([...widgets(), { ...widget, id: newId(widget.kind), ...at }]);
  }

  /** Render order is stacking order, so "bring to front" is a move to the end. */
  const bringToFront = (id: string) =>
    setWidgets([...widgets().filter((w) => w.id !== id), ...widgets().filter((w) => w.id === id)]);

  const current = () => widgets().find((w) => w.id === configuring()) ?? null;

  const surfaces = (): Surface[] => props.sources.map((s) => s.kind);
  const palette = () => (props.sources.length === 0 ? PRESETS : presetsFor(surfaces()));

  const filterCount = () => countConditions(board().filter);

  /**
   * How much room the pane is actually giving the board.
   *
   * Measured off the body row, which spans the pane's content track, so this is
   * the pane's width and not the window's: a collapsed sidebar or a panel opening
   * beside the content moves this number, which is the whole point.
   */
  const [paneWidth, setPaneWidth] = createSignal(0);
  let bodyRow: HTMLDivElement | undefined;

  onMount(() => {
    if (!bodyRow || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setPaneWidth(Math.round(rect.width));
    });
    observer.observe(bodyRow);
    onCleanup(() => observer.disconnect());
  });

  const paletteIsRail = () => paneWidth() >= PALETTE_PANE_PX;

  return (
    <>
      {/*
        The dashboard page variant: a 24px-gap column of a 36px toolbar row and
        then the body, and no h1. The page already says which board this is, in
        the sidebar and in the topbar's breadcrumb, and a third statement of it
        here would push the numbers a heading's worth further down every board.
      */}
      <div class="flex flex-col gap-6">
        {/*
          One row, one height, and it does not wrap. Everything in it is on the
          36px control step at radius 6, which is what the reference states for
          a toolbar: a standalone button rounds less, a button in this row does
          not.
        */}
        <div class="flex h-control-md items-center gap-2">
          <TimeRangePicker
            range={board().range}
            comparison={board().comparison}
            onChange={(next: { range: DateRange; comparison: Comparison }) =>
              persist({ ...board(), ...next }, { refetch: true })
            }
          />
          {/*
            The board's permanent filter, not the viewer's. It survives a
            reload, a shared link and the next person to open it, which is the
            difference between a board called "Marketing site" and one you have
            to re-filter every visit.
          */}
          <Button
            variant={filterCount() > 0 ? "secondary" : "outline"}
            size="toolbar"
            onClick={() => setFiltering(true)}
          >
            <Funnel size={14} />
            {filterCount() === 0
              ? i18n.t("dashboard.filter_none")
              : i18n.t("dashboard.filters", { count: filterCount() })}
          </Button>

          {/*
            Which of the two worlds the board is reading. It sits beside the
            filter rather than inside it because it is not a condition somebody
            built: it is the frame, like the range.

            `refetch` is not optional here. Every key on the board is derived
            from a query that now carries a different frame filter, so the
            answers already in the snapshot belong to the other world and there
            is nothing cached to fall back on.
          */}
          <Button
            variant={board().testMode ? "secondary" : "outline"}
            size="toolbar"
            aria-pressed={board().testMode}
            title={i18n.t(board().testMode ? "dashboard.test_mode_on" : "dashboard.test_mode_off")}
            onClick={() =>
              persist({ ...board(), testMode: !board().testMode }, { refetch: true })
            }
          >
            <FlaskConical size={14} />
            {i18n.t("dashboard.test_mode")}
          </Button>

          {/*
            Both resolved windows, in the cell the reference's search input
            occupies. A delta against an unnamed baseline is a number nobody can
            check, so this has to be on screen -- and it is a caption on the
            toolbar rather than a block of its own, which is what it had become.
          */}
          {/* One key with both windows in it rather than a sentence built from
              two: the separator and the word between them are part of the
              sentence, and German does not put them where English does. */}
          <p class="min-w-0 flex-1 truncate text-copy-13 text-muted-foreground">
            <Show
              when={props.snapshot.compare}
              fallback={i18n.dateRange(props.snapshot.from, props.snapshot.to)}
            >
              {(compare) =>
                i18n.t("dashboard.window_and_baseline", {
                  range: i18n.dateRange(props.snapshot.from, props.snapshot.to),
                  baseline: i18n.dateRange(compare().from, compare().to),
                })
              }
            </Show>
          </p>

          <Show when={state() !== "idle"}>
            <span
              class={cn(
                "shrink-0 text-label-13",
                state() === "error" ? "text-negative" : "text-muted-foreground"
              )}
            >
              {state() === "saving"
                ? i18n.t("common.saving")
                : state() === "saved"
                  ? i18n.t("dashboard.saved")
                  : error()}
            </span>
          </Show>

          <Show when={props.canEdit}>
            <ModeToggle
              arranging={editing()}
              onChange={(arranging) => {
                setEditing(arranging);
                if (!arranging) setPaletteOpen(false);
              }}
            />
            {/* Only while arranging: adding a card to a board you are only
                looking at is the one action that implies the other mode. */}
            <Show when={editing()}>
              <Button
                variant={paletteOpen() ? "secondary" : "outline"}
                size="toolbar"
                aria-expanded={paletteOpen()}
                onClick={() => setPaletteOpen((open) => !open)}
              >
                <Plus size={14} />
                {i18n.t("dashboard.add_card")}
              </Button>
            </Show>
          </Show>
        </div>

        {/*
          The board, and the palette beside it rather than over it. The canvas
          keeps its own logical width and scrolls; opening the rail slides it
          over instead of hiding it, so you can see where the card you are about
          to add will have to fit.

          A column that becomes a row once the PANE can afford both, which is
          the reference's rule: the layout answers the pane, so collapsing the
          sidebar reflows this exactly as making the window wider would.
        */}
        <div
          ref={bodyRow}
          class={cn(
            "flex w-full flex-col gap-4",
            // A row only once the pane can hold both. `items-start` belongs to
            // the row: as a column it would take the canvas off full width and
            // size it to the 1280px board it is meant to be scrolling.
            "@lg-page/page:flex-row @lg-page/page:items-start @lg-page/page:gap-6"
          )}
        >
          <Canvas
            class="min-w-0 flex-1"
            height={canvasHeight(occupied())}
            showGrid={canvas.active() !== null}
            guides={canvas.guides()}
          >
            {/*
              Keyed by id, not by the widget object.
              `<For>` disposes and recreates a row whenever its item's identity
              changes, and every pointer move during a drag produces a new widget
              object. That would tear down the element the gesture is running on,
              mid-gesture, and the drag would die on the first pixel.
            */}
            <For each={ids()}>
              {(id, index) => {
                const widget = () => widgets().find((w) => w.id === id);
                return (
                  <Show when={widget()}>
                    {(card) => (
                      <BoardCard
                        board={board()}
                        widget={card()}
                        z={index()}
                        snapshot={props.snapshot}
                        canvas={canvas}
                        arranging={canArrange()}
                        onConfigure={() => setConfiguring(id)}
                        onDuplicate={() => duplicate(card())}
                        onBringToFront={() => void bringToFront(id)}
                        onRemove={() => void remove(id)}
                      />
                    )}
                  </Show>
                );
              }}
            </For>

            {/* The page empty state, at the canvas's own width: a shrink-to-fit
                box floating in the middle of a 1280px board reads as a card
                somebody dropped there rather than as the state of the board. */}
            <Show when={widgets().length === 0}>
              <div class="absolute inset-x-0 top-24">
                <Empty>
                  <EmptyMedia>
                    <LayoutGrid />
                  </EmptyMedia>
                  <EmptyTitle>{i18n.t("dashboard.empty_title")}</EmptyTitle>
                  <EmptyDescription>{i18n.t("dashboard.empty_body")}</EmptyDescription>
                  <Show when={props.canEdit}>
                    <EmptyContent>
                      <Button
                        onClick={() => {
                          setEditing(true);
                          setPaletteOpen(true);
                        }}
                      >
                        {i18n.t("dashboard.palette_title")}
                      </Button>
                    </EmptyContent>
                  </Show>
                </Empty>
              </div>
            </Show>
          </Canvas>

          {/*
            The palette as a rail, whenever the pane is wide enough to hold one.

            It stays open while three cards go on in a row, and it does not cover
            the thing they are going onto. Sticky, because the canvas is taller
            than the viewport and the list should still be there once you have
            scrolled down to the gap you are filling.
          */}
          <Show when={paletteOpen() && canArrange() && paletteIsRail()}>
            <aside
              class={cn(
                "sticky top-2 flex max-h-[calc(100vh-8rem)] w-80 shrink-0 flex-col",
                // The raised surface: the ring and its 1px lift, no border.
                "rounded-md bg-card shadow-sm",
                "@xl-page/page:w-[404px]"
              )}
            >
              <div class="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
                <div class="min-w-0">
                  <h2 class="text-body font-semibold">{i18n.t("dashboard.palette_title")}</h2>
                  <p class="mt-0.5 text-copy-13 text-muted-foreground">{paletteHint()}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={i18n.t("dashboard.palette_close")}
                  onClick={() => setPaletteOpen(false)}
                >
                  <X size={14} />
                </Button>
              </div>
              <div class="min-h-0 flex-1 overflow-y-auto p-1">
                <PresetList presets={palette()} onPick={add} />
              </div>
            </aside>
          </Show>
        </div>
      </div>

      {/*
        The same palette, on a pane too narrow to put it beside the board.

        A rail that squeezes the canvas below the width of one card is worse
        than a drawer: the board is what you are aiming at, and you cannot aim
        at forty pixels of it.
      */}
      <Sheet
        open={paletteOpen() && canArrange() && !paletteIsRail()}
        onOpenChange={setPaletteOpen}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{i18n.t("dashboard.palette_title")}</SheetTitle>
            <SheetDescription>{paletteHint()}</SheetDescription>
          </SheetHeader>
          <SheetBody class="px-2">
            <PresetList presets={palette()} onPick={add} />
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/* The board's own filter. Applied to every card before any key is derived. */}
      <Sheet open={filtering()} onOpenChange={setFiltering}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{i18n.t("dashboard.board_filter_title")}</SheetTitle>
            <SheetDescription>{i18n.t("dashboard.board_filter_body")}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <FilterEditor
              filter={board().filter}
              discovery={props.discovery}
              disabled={!props.canEdit}
              onChange={(filter) => void persist({ ...board(), filter }, { refetch: true })}
            />
          </SheetBody>
          <SheetFooter>
            <Show when={filterCount() > 0}>
              <Button
                variant="outline"
                class="mr-auto"
                onClick={() =>
                  void persist({ ...board(), filter: emptyFilter() }, { refetch: true })
                }
              >
                {i18n.t("dashboard.clear")}
              </Button>
            </Show>
            <Button onClick={() => setFiltering(false)}>{i18n.t("common.done")}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Per-card settings: the query builder itself. Never inline. */}
      <Sheet open={configuring() !== null} onOpenChange={(open) => !open && setConfiguring(null)}>
        <SheetContent class="sm:max-w-2xl">
          <Show when={current()}>
            {(widget) => (
              <>
                <SheetHeader>
                  <SheetTitle>{widget().title ?? defaultTitle(i18n, widget())}</SheetTitle>
                  <SheetDescription>
                    <Badge variant="outline">
                      {widget().kind === "note"
                        ? i18n.t("dashboard.note_badge")
                        : labels.visualisation((widget() as QueryWidget).viz)}
                    </Badge>
                  </SheetDescription>
                </SheetHeader>

                <SheetBody>
                  {/*
                    The two card actions that do not fit on a small card. They
                    are buttons on the card itself once it is big enough to
                    carry them; here so that a card at the minimum size is not
                    the one card you cannot duplicate.
                  */}
                  <div class="mb-5 flex gap-2 border-b pb-5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setConfiguring(null);
                        duplicate(widget());
                      }}
                    >
                      <Copy size={14} />
                      {i18n.t("dashboard.duplicate")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void bringToFront(widget().id)}
                    >
                      <BringToFront size={14} />
                      {i18n.t("dashboard.bring_to_front")}
                    </Button>
                  </div>

                  <CardSettings
                    workspaceSlug={props.workspaceSlug}
                    projectSlug={props.projectSlug}
                    range={board().range}
                    discovery={props.discovery}
                    sourceId={props.sources[0]?.id ?? null}
                    frame={board()}
                    widget={widget()}
                    canEdit={props.canEdit}
                    onPatch={(changes, opts) => patch(widget().id, changes, opts)}
                  />
                </SheetBody>

                <SheetFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const id = widget().id;
                      setConfiguring(null);
                      void remove(id);
                    }}
                    class="mr-auto hover:text-negative"
                  >
                    {i18n.t("common.remove")}
                  </Button>
                  <Button onClick={() => setConfiguring(null)}>{i18n.t("common.done")}</Button>
                </SheetFooter>
              </>
            )}
          </Show>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** How many leaf conditions a filter tree holds, for the toolbar's count. */
function countConditions(filter: Filter | undefined): number {
  if (!filter) return 0;
  if (filter.op === "and" || filter.op === "or") {
    return filter.filters.reduce((n, child) => n + countConditions(child), 0);
  }
  if (filter.op === "not") return countConditions(filter.filter);
  return 1;
}

/**
 * Looking, or arranging. One control, always in the same place.
 *
 * This used to be a pair of buttons that swapped: "Arrange" became "Add card"
 * and "Done", so the toolbar changed width and the thing under your cursor
 * changed meaning in the same click. The reference's equivalent is a 72x36
 * segmented control with a ring and two icon cells, and the cell that is filled
 * IS the answer to which mode you are in -- no label to read, nothing to move.
 */
function ModeToggle(props: { arranging: boolean; onChange: (arranging: boolean) => void }) {
  const i18n = useI18n();
  const cell = (active: boolean) =>
    cn(
      "focus-ring flex h-full flex-1 cursor-pointer items-center justify-center rounded-sm",
      "outline-none transition-colors",
      active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
    );

  return (
    <div
      role="group"
      aria-label={i18n.t("dashboard.mode_group")}
      // The ring alone: this is a boundary around two cells, not a surface.
      class="flex h-control-md w-18 shrink-0 items-center gap-0.5 rounded-md p-1 shadow-2xs"
    >
      <button
        type="button"
        title={i18n.t("dashboard.mode_look")}
        aria-label={i18n.t("dashboard.mode_look")}
        aria-pressed={!props.arranging}
        class={cell(!props.arranging)}
        onClick={() => props.onChange(false)}
      >
        <Eye size={14} />
      </button>
      <button
        type="button"
        title={i18n.t("dashboard.mode_arrange")}
        aria-label={i18n.t("dashboard.mode_arrange")}
        aria-pressed={props.arranging}
        class={cell(props.arranging)}
        onClick={() => props.onChange(true)}
      >
        <Move size={14} />
      </button>
    </div>
  );
}

/**
 * The starting points, as popover rows.
 *
 * One list, two containers: a rail on a wide pane and a sheet on a narrow one.
 * The row is the measured popover row -- 36px, radius 6, 8px of horizontal
 * padding -- which has no second line to spend on a description, so the
 * description stays on the row as its title rather than being dropped. Nothing
 * here is a capability: every preset is a query somebody could have built in
 * the drawer it opens.
 */
function PresetList(props: { presets: Preset[]; onPick: (preset: Preset) => void }) {
  const i18n = useI18n();
  return (
    <div class="flex flex-col">
      <For each={props.presets}>
        {(preset) => (
          <button
            type="button"
            title={presetHint(i18n, preset)}
            onClick={() => props.onPick(preset)}
            class={cn(
              "focus-ring flex h-popover-row w-full cursor-pointer items-center gap-3",
              "rounded-md px-2 text-left text-body text-foreground",
              "outline-none transition-colors hover:bg-accent"
            )}
          >
            <span class="min-w-0 flex-1 truncate">{presetLabel(i18n, preset)}</span>
          </button>
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One card
// ---------------------------------------------------------------------------

/** One card control. Never a drag surface, which is what the marker is for. */
function CardAction(props: {
  label: string;
  destructive?: boolean;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={props.label}
      aria-label={props.label}
      data-no-drag
      // No size override: the glyph is 24px of icon inside the 28px hit target
      // `icon-sm` already draws, and a control shrunk to the size of its own
      // glyph is a control you have to aim at.
      class={cn(props.destructive && "hover:bg-destructive/10 hover:text-negative")}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

/**
 * A card on the board: its frame, its controls, and its live answer.
 *
 * The whole card is the drag surface while the board is being arranged, so
 * there is no grip to look at and nothing to aim for: press anywhere and move.
 * The controls are revealed on hover and on focus, floating over the top-right
 * corner rather than sitting in the header, because a card narrow enough to be
 * a single number has no header room to give them.
 *
 * Which controls appear is itself a size question. Below tier 3 only settings
 * and remove fit; duplicate and bring-to-front live in the drawer, where they
 * are always reachable. Padding scales too: four pixels of chrome on a 140px
 * card is a quarter of the space the number needs.
 *
 * Sizes here are the CARD's, never the cell's: `CanvasItem` is given the cell
 * and draws this inset inside it by one gutter on every side.
 */
function BoardCard(props: {
  board: Board;
  widget: BoardWidget;
  z: number;
  snapshot: BoardSnapshot;
  canvas: CanvasController;
  arranging: boolean;
  onConfigure: () => void;
  onDuplicate: () => void;
  onBringToFront: () => void;
  onRemove: () => void;
}) {
  const i18n = useI18n();
  const id = () => props.widget.id;
  const title = () => props.widget.title ?? defaultTitle(i18n, props.widget);
  // The widget's rect is its cell. Padding and the control strip are questions
  // about the card drawn inside it, which is two gutters smaller, and this has
  // to agree with the tier `CanvasItem` hands to the widget body.
  const tier = () => cardTier(cardRect(props.widget));
  /** A note with no title is a note; give it a header only while it is editable. */
  const showHeader = () =>
    props.arranging || props.widget.kind !== "note" || Boolean(props.widget.title);

  // Three steps, every one of them on the 4px rhythm. The half steps this used
  // to walk (14px of inline padding, 10px above, 6px below) are the one thing
  // on a card that no other measurement in the system agrees with.
  const headerPad = () =>
    tier() === 1 ? "px-2 pt-2 pb-1" : tier() === 2 ? "px-3 pt-3 pb-2" : "px-4 pt-4 pb-3";
  const contentPad = () =>
    tier() === 1 ? "px-2 pb-2" : tier() === 2 ? "px-3 pb-3" : "px-4 pb-4";

  return (
    <CanvasItem
      rect={props.widget}
      z={props.z}
      active={props.canvas.active()?.id === id()}
      // The same radius as the card inside it, so the focus ring and the
      // arrange-mode outline trace the card rather than missing it by 6px.
      class="group/card rounded-md"
      aria-label={title()}
      {...props.canvas.focusProps(id())}
      {...props.canvas.moveProps(id())}
    >
      <Card
        class={cn(
          "h-full overflow-hidden",
          // An outline, not a border: the card's hairline is a box-shadow ring
          // and the card has no border to style, so a dashed border here would
          // set a style on a zero-width edge and draw nothing. An outline is
          // also outside the box, so arrange mode does not move anything.
          props.arranging &&
            "outline-1 outline-dashed outline-offset-0 outline-border hover:outline-ring"
        )}
      >
        <Show when={showHeader()}>
          <CardHeader class={cn("shrink-0", headerPad())}>
            {/* One size at every card width. The measured card title is the
                14/600 application heading step, and the container query that
                used to sit here shrank it to 12 on exactly the cards with the
                most room to spend. */}
            <CardTitle class="min-w-0 truncate">{title()}</CardTitle>
          </CardHeader>
        </Show>

        <CardContent class={cn("min-h-0 flex-1", contentPad())}>
          <WidgetBody board={props.board} widget={props.widget} snapshot={props.snapshot} />
        </CardContent>
      </Card>

      <Show when={props.arranging}>
        <div
          data-no-drag
          class={cn(
            // Inset far enough to clear the north and east resize handles,
            // which reach eight pixels in from the edge they belong to.
            "absolute right-2.5 top-2.5 z-30 flex items-center gap-0.5 rounded-md",
            // The small shadow IS the hairline plus its lift, so no border here.
            "bg-card/95 p-0.5 shadow-sm backdrop-blur-[1px]",
            "opacity-0 transition-opacity",
            "group-hover/card:opacity-100 group-focus-within/card:opacity-100"
          )}
        >
          <Show when={tier() >= 3}>
            <CardAction
              label={i18n.t("dashboard.bring_to_front")}
              onClick={props.onBringToFront}
            >
              <BringToFront size={13} />
            </CardAction>
            <CardAction label={i18n.t("dashboard.duplicate")} onClick={props.onDuplicate}>
              <Copy size={13} />
            </CardAction>
          </Show>
          <CardAction label={i18n.t("dashboard.card_settings")} onClick={props.onConfigure}>
            <SlidersHorizontal size={13} />
          </CardAction>
          <CardAction label={i18n.t("common.remove")} destructive onClick={props.onRemove}>
            <Trash2 size={13} />
          </CardAction>
        </div>

        <ResizeHandles edgeProps={(edge) => props.canvas.resizeProps(id(), edge)} />
      </Show>
    </CanvasItem>
  );
}

// ---------------------------------------------------------------------------
// Settings: the builder, on one card
// ---------------------------------------------------------------------------

type Patch = (changes: Partial<BoardWidget>, opts?: PersistOptions) => void;

/** A labelled row. The drawer has room to explain itself; a card header does not. */
function Setting(props: { label: string; hint?: string; for?: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-2">
      <Label for={props.for}>{props.label}</Label>
      {props.children}
      <Show when={props.hint}>
        <p class="text-xs text-muted-foreground">{props.hint}</p>
      </Show>
    </div>
  );
}

/**
 * Everything one card can be changed into.
 *
 * The query and the visualisation are the card, so the builder IS the settings
 * drawer rather than a second surface beside it. Changing what a card asks
 * reloads the board's snapshot, because the answer it needs is one nobody has
 * fetched; changing its title or its chart type does not.
 */
function CardSettings(props: {
  workspaceSlug: string;
  projectSlug: string;
  range: DateRange;
  discovery: Discovery;
  sourceId: string | null;
  /**
   * The board's frame and permanent filter, so the preview runs the query the
   * CARD will run rather than the one the builder is editing. Without it a
   * drawer over a production board previews test entries too.
   */
  frame: BoardFrame;
  widget: BoardWidget;
  canEdit: boolean;
  onPatch: Patch;
}) {
  const i18n = useI18n();
  const asQuery = (): QueryWidget | null =>
    props.widget.kind === "query" ? props.widget : null;

  return (
    <div class="flex flex-col gap-5">
      <Setting
        label={i18n.t("dashboard.setting_title")}
        for="card-title"
        hint={i18n.t("dashboard.setting_title_hint")}
      >
        <Input
          id="card-title"
          value={props.widget.title ?? ""}
          placeholder={defaultTitle(i18n, props.widget)}
          disabled={!props.canEdit}
          onInput={(e) =>
            props.onPatch(
              { title: e.currentTarget.value || undefined },
              { debounceMs: TYPING_DEBOUNCE_MS }
            )
          }
        />
      </Setting>

      <Show
        when={asQuery()}
        fallback={
          <Setting
            label={i18n.t("dashboard.setting_text")}
            hint={i18n.t("dashboard.setting_text_hint")}
          >
            <Textarea
              autoResize
              maxRows={12}
              value={props.widget.kind === "note" ? props.widget.body : ""}
              disabled={!props.canEdit}
              onInput={(e) =>
                props.onPatch({ body: e.currentTarget.value } as Partial<BoardWidget>, {
                  debounceMs: TYPING_DEBOUNCE_MS,
                })
              }
            />
          </Setting>
        }
      >
        {(widget) => (
          <>
            <Show when={widget().viz === "number"}>
              <div class="flex flex-col gap-3 rounded-lg border p-3">
                <Switch
                  checked={widget().compare}
                  label={i18n.t("dashboard.show_change")}
                  description={i18n.t("dashboard.show_change_hint")}
                  onChange={(compare) =>
                    props.onPatch({ compare } as Partial<BoardWidget>, { refetch: true })
                  }
                />
                <Switch
                  checked={widget().sparkline}
                  label={i18n.t("dashboard.show_shape")}
                  description={i18n.t("dashboard.show_shape_hint")}
                  onChange={(sparkline) =>
                    props.onPatch({ sparkline } as Partial<BoardWidget>, { refetch: true })
                  }
                />
              </div>
            </Show>

            <ExplorePanel
              workspace={props.workspaceSlug}
              project={props.projectSlug}
              range={props.range}
              discovery={props.discovery}
              sourceId={props.sourceId}
              query={widget().query}
              previewQuery={effectiveQuery(props.frame, widget())}
              viz={widget().viz}
              disabled={!props.canEdit}
              onChange={(next: { query: LogQuery; viz: Visualisation }) =>
                props.onPatch(next as Partial<BoardWidget>, { refetch: true })
              }
            />
          </>
        )}
      </Show>
    </div>
  );
}

/** An empty discovery, for a board rendered before one has been fetched. */
export const noDiscovery = emptyDiscovery;

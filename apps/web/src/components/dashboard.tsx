import { useRouter } from "@tanstack/solid-router";
import {
  METRIC_KEYS,
  METRIC_LABELS,
  TIMESERIES_METRICS,
  WIDGET_CATALOGUE,
  type DashboardLayout,
  type Widget,
} from "@firstrun/schema";
import type { Snapshot } from "@firstrun/db";
import { For, Show, batch, createEffect, createSignal, onCleanup } from "solid-js";
import { saveDashboard } from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { GripIcon, createSortable } from "./sortable.js";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  SegmentedControl,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
} from "./ui/index.js";
import { WidgetBody, defaultTitle } from "./widgets.js";

/**
 * The dashboard, and the editor for it.
 *
 * Editing is in place: the cards keep rendering real data while you drag them,
 * so the thing you are arranging is the thing you will be looking at. Nothing
 * turns into a grey placeholder and no configuration appears inline -- a card
 * that grows a form is no longer showing you what it will look like.
 *
 * Per-widget settings live in a drawer instead, which also gives them room to
 * be explained rather than crammed into a row.
 *
 * "Configurable" means arrangeable: which of a fixed set of cards appear, in
 * what order, at what width, over what window. It does not mean you can define
 * a new question -- every card comes from `WIDGET_CATALOGUE`. A generic explore
 * view is the failure mode for this product, and that catalogue is the line.
 */

const RANGES = [
  { value: 7, label: "7d" },
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
];

type SaveState = "idle" | "saving" | "saved" | "error";

export interface DashboardProps {
  workspaceSlug: string;
  projectSlug: string;
  layout: DashboardLayout;
  snapshot: Snapshot;
  sources: Array<{ id: string; name: string; kind: string }>;
  canEdit: boolean;
}

export function Dashboard(props: DashboardProps) {
  const router = useRouter();

  const [layout, setLayout] = createSignal<DashboardLayout>(props.layout);
  const [editing, setEditing] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [configuring, setConfiguring] = createSignal<string | null>(null);
  const [state, setState] = createSignal<SaveState>("idle");
  const [error, setError] = createSignal<string | null>(null);

  // The loader is the source of truth. When it refetches -- after a range
  // change, or another tab saving -- take its answer over the local copy.
  createEffect(() => setLayout(props.layout));

  let debounce: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(debounce));

  /**
   * Every edit persists immediately.
   *
   * With drag-to-reorder there is no natural moment to press Save, and a layout
   * that looks right but was never written is worse than a brief "Saving…".
   * `refetch` is only true when the change alters what the numbers mean.
   */
  async function persist(next: DashboardLayout, opts: { refetch?: boolean; debounceMs?: number } = {}) {
    setLayout(next);
    clearTimeout(debounce);

    const run = async () => {
      setState("saving");
      setError(null);
      const result = await saveDashboard({
        data: { workspace: props.workspaceSlug, project: props.projectSlug, layout: next },
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

    if (opts.debounceMs) debounce = setTimeout(run, opts.debounceMs);
    else await run();
  }

  const widgets = () => layout().widgets;

  const setWidgets = (next: Widget[], opts?: { debounceMs?: number }) =>
    persist({ ...layout(), widgets: next }, opts);

  const sortable = createSortable({
    enabled: editing,
    onMove: (from, to) => {
      const next = [...widgets()];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      // Local only while the pointer is down; committed on release.
      setLayout({ ...layout(), widgets: next });
    },
    onCommit: () => void setWidgets(widgets()),
  });

  const patch = (id: string, changes: Partial<Widget>, debounceMs?: number) =>
    setWidgets(
      widgets().map((w) => (w.id === id ? ({ ...w, ...changes } as Widget) : w)),
      debounceMs ? { debounceMs } : undefined
    );

  const remove = (id: string) => {
    if (configuring() === id) setConfiguring(null);
    return setWidgets(widgets().filter((w) => w.id !== id));
  };

  const resize = (id: string) =>
    setWidgets(
      widgets().map((w) =>
        w.id === id ? ({ ...w, width: w.width === 3 ? 1 : ((w.width + 1) as 1 | 2 | 3) } as Widget) : w
      )
    );

  function add(entry: (typeof WIDGET_CATALOGUE)[number]) {
    const id = `${entry.type}-${Math.random().toString(36).slice(2, 8)}`;
    batch(() => {
      void setWidgets([...widgets(), entry.create(id)]);
      setPaletteOpen(false);
    });
  }

  const current = () => widgets().find((w) => w.id === configuring()) ?? null;

  return (
    <>
      <div class="flex flex-wrap items-center justify-between gap-3 pb-5">
        <div class="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={layout().rangeDays}
            options={RANGES}
            onChange={(days) => persist({ ...layout(), rangeDays: days }, { refetch: true })}
          />

          <Show when={props.sources.length > 1}>
            <Select
              class="h-8 w-44 text-xs"
              aria-label="Filter by source"
              value={layout().sourceId ?? "all"}
              onChange={(value) =>
                persist({ ...layout(), sourceId: value === "all" ? null : value }, { refetch: true })
              }
              options={[
                { value: "all", label: "All sources" },
                ...props.sources.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </Show>
        </div>

        <div class="flex items-center gap-2">
          <Show when={state() !== "idle"}>
            <span
              class={cn(
                "text-xs",
                state() === "error" ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {state() === "saving" ? "Saving…" : state() === "saved" ? "Saved" : error()}
            </span>
          </Show>

          <Show when={props.canEdit}>
            <Show
              when={editing()}
              fallback={
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Edit layout
                </Button>
              }
            >
              <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)}>
                Add widget
              </Button>
              <Button size="sm" onClick={() => setEditing(false)}>
                Done
              </Button>
            </Show>
          </Show>
        </div>
      </div>

      <Show when={editing()}>
        <p class="pb-3 text-xs text-muted-foreground">
          Drag a card by its handle to reorder. Changes save as you make them.
        </p>
      </Show>

      <div ref={sortable.setContainer} class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <For each={widgets()}>
          {(widget, index) => (
            <Card
              data-sortable-item
              class={cn(
                widget.width === 3
                  ? "md:col-span-3"
                  : widget.width === 2
                    ? "md:col-span-2"
                    : "md:col-span-1",
                editing() && "border-dashed",
                sortable.dragIndex() === index() && "dragging"
              )}
            >
              <CardHeader>
                <div class="flex min-w-0 items-center gap-2">
                  <Show when={editing()}>
                    <span
                      class="-ml-1 cursor-grab rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
                      title="Drag to reorder"
                      {...sortable.handleProps(index())}
                    >
                      <GripIcon />
                    </span>
                  </Show>
                  <CardTitle class="truncate">{widget.title ?? defaultTitle(widget)}</CardTitle>
                </div>

                <Show when={editing()}>
                  <div class="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Change width"
                      onClick={() => resize(widget.id)}
                    >
                      <span class="text-[10px] font-semibold">{widget.width}∕3</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Settings"
                      onClick={() => setConfiguring(widget.id)}
                    >
                      <GearIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Remove"
                      class="hover:text-destructive"
                      onClick={() => remove(widget.id)}
                    >
                      <CrossIcon />
                    </Button>
                  </div>
                </Show>
              </CardHeader>

              <CardContent>
                <WidgetBody widget={widget} snapshot={props.snapshot} />
              </CardContent>
            </Card>
          )}
        </For>

        <Show when={widgets().length === 0}>
          <div class="col-span-full rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
            Nothing on this dashboard yet.
            <Show when={props.canEdit}>
              <div class="mt-3">
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(true);
                    setPaletteOpen(true);
                  }}
                >
                  Add a widget
                </Button>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* The catalogue. */}
      <Sheet open={paletteOpen()} onOpenChange={setPaletteOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add a widget</SheetTitle>
            <SheetDescription>
              A fixed catalogue, not a query builder. Each one answers a question this product
              exists to answer.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div class="flex flex-col gap-2">
              <For each={WIDGET_CATALOGUE}>
                {(entry) => (
                  <button
                    type="button"
                    onClick={() => add(entry)}
                    class="cursor-pointer rounded-lg border bg-card p-3 text-left transition-colors hover:border-ring hover:bg-accent/40"
                  >
                    <div class="text-sm font-medium">{entry.label}</div>
                    <div class="mt-0.5 text-xs text-muted-foreground">{entry.description}</div>
                  </button>
                )}
              </For>
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/* Per-widget settings. */}
      <Sheet open={configuring() !== null} onOpenChange={(open) => !open && setConfiguring(null)}>
        <SheetContent>
          <Show when={current()}>
            {(widget) => (
              <>
                <SheetHeader>
                  <SheetTitle>{widget().title ?? defaultTitle(widget())}</SheetTitle>
                  <SheetDescription>
                    <Badge variant="outline">{widget().type.replace("_", " ")}</Badge>
                  </SheetDescription>
                </SheetHeader>

                <SheetBody>
                  <WidgetSettings
                    widget={widget()}
                    onPatch={(changes, debounceMs) => patch(widget().id, changes, debounceMs)}
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
                    class="mr-auto hover:text-destructive"
                  >
                    Remove
                  </Button>
                  <Button onClick={() => setConfiguring(null)}>Done</Button>
                </SheetFooter>
              </>
            )}
          </Show>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The knobs for one widget. Lives in the drawer, never inline. */
function WidgetSettings(props: {
  widget: Widget;
  onPatch: (changes: Partial<Widget>, debounceMs?: number) => void;
}) {
  return (
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <Label for="widget-title">Title</Label>
        <Input
          id="widget-title"
          placeholder={defaultTitle(props.widget)}
          value={props.widget.title ?? ""}
          onInput={(e) =>
            props.onPatch({ title: e.currentTarget.value || undefined } as never, 500)
          }
        />
        <p class="text-xs text-muted-foreground">Leave empty to use the default.</p>
      </div>

      <div class="flex flex-col gap-2">
        <Label>Width</Label>
        <SegmentedControl
          value={props.widget.width}
          options={[
            { value: 1, label: "1∕3" },
            { value: 2, label: "2∕3" },
            { value: 3, label: "Full" },
          ]}
          onChange={(width) => props.onPatch({ width } as never)}
        />
      </div>

      <Show when={props.widget.type === "metric"}>
        <div class="flex flex-col gap-2">
          <Label>Metric</Label>
          <Select
            value={(props.widget as never as { metric: string }).metric}
            onChange={(metric) => props.onPatch({ metric } as never)}
            options={METRIC_KEYS.map((m) => ({ value: m, label: METRIC_LABELS[m] }))}
          />
        </div>
        <Switch
          checked={(props.widget as never as { compare: boolean }).compare}
          onChange={(compare) => props.onPatch({ compare } as never)}
          label="Compare to previous period"
          description="Shows the change against the window before this one."
        />
      </Show>

      <Show when={props.widget.type === "timeseries"}>
        <div class="flex flex-col gap-2">
          <Label>Metric</Label>
          <Select
            value={(props.widget as never as { metric: string }).metric}
            onChange={(metric) => props.onPatch({ metric } as never)}
            options={TIMESERIES_METRICS.map((m) => ({ value: m, label: METRIC_LABELS[m] }))}
          />
          <p class="text-xs text-muted-foreground">
            Only metrics that are a countable event on a given day. Day 7 and install counts are
            whole-window figures — there is no honest way to put them on a daily axis.
          </p>
        </div>
      </Show>

      <Show when={props.widget.type === "versions"}>
        <div class="flex flex-col gap-2">
          <Label for="quiet-days">Quiet after</Label>
          <div class="flex items-center gap-2">
            <Input
              id="quiet-days"
              class="w-20"
              value={String((props.widget as never as { quietDays: number }).quietDays)}
              onInput={(e) => {
                const n = parseInt(e.currentTarget.value, 10);
                if (Number.isFinite(n) && n >= 1 && n <= 90) {
                  props.onPatch({ quietDays: n } as never, 500);
                }
              }}
            />
            <span class="text-sm text-muted-foreground">days of silence</span>
          </div>
        </div>
      </Show>

      <Show when={props.widget.type === "retention"}>
        <div class="flex flex-col gap-2">
          <Label for="retention-days">Show up to day</Label>
          <Input
            id="retention-days"
            class="w-20"
            value={String((props.widget as never as { days: number }).days)}
            onInput={(e) => {
              const n = parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(n) && n >= 7 && n <= 60) props.onPatch({ days: n } as never, 500);
            }}
          />
        </div>
      </Show>

      <Show when={props.widget.type === "funnel" || props.widget.type === "join_health"}>
        <p class="text-xs text-muted-foreground">
          Nothing to configure. This card always shows exact and estimated as two separate numbers.
        </p>
      </Show>
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

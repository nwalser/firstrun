import { useRouter } from "@tanstack/solid-router";
import {
  METRIC_KEYS,
  METRIC_LABELS,
  TIMESERIES_METRICS,
  WIDGET_CATALOGUE,
  type DashboardLayout,
  type Widget,
} from "@firstrun/schema";
import { For, Show, createSignal } from "solid-js";
import type { Snapshot } from "@firstrun/db";
import { saveDashboard } from "../lib/api.js";
import { WidgetBody, defaultTitle } from "./widgets.js";

/**
 * The dashboard, and the editor for it.
 *
 * "Configurable" here means arrangeable: which of a fixed set of cards appear,
 * in what order, at what width, over what window. It does not mean you can
 * define a new question -- every card comes from `WIDGET_CATALOGUE`, and adding
 * to that catalogue means writing SQL for a question worth answering.
 *
 * The distinction is the whole design constraint. A generic explore view is the
 * failure mode for this product: anything obtainable by pointing Grafana at the
 * same Postgres does not belong here.
 *
 * Range and source save immediately, because they change what the numbers mean
 * and showing stale figures under a new window would be a lie. Widget
 * arrangement is local until Save, because half-dragged layouts should not
 * persist.
 */

const RANGES = [7, 14, 30, 90] as const;

export interface DashboardProps {
  slug: string;
  layout: DashboardLayout;
  snapshot: Snapshot;
  sources: Array<{ id: string; name: string; kind: string }>;
  canEdit: boolean;
}

export function Dashboard(props: DashboardProps) {
  const router = useRouter();

  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal<Widget[] | null>(null);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const widgets = () => draft() ?? props.layout.widgets;

  async function persist(layout: DashboardLayout) {
    setBusy(true);
    try {
      await saveDashboard({ data: { slug: props.slug, layout } });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  const setRange = (days: number) => persist({ ...props.layout, rangeDays: days });
  const setSource = (id: string | null) => persist({ ...props.layout, sourceId: id });

  function edit(fn: (list: Widget[]) => Widget[]) {
    setDraft(fn([...widgets()]));
  }

  const move = (index: number, by: number) =>
    edit((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length) return list;
      const [item] = list.splice(index, 1);
      list.splice(to, 0, item!);
      return list;
    });

  const resize = (index: number) =>
    edit((list) => {
      const w = list[index]!;
      const next = w.width === 3 ? 1 : ((w.width + 1) as 1 | 2 | 3);
      list[index] = { ...w, width: next } as Widget;
      return list;
    });

  const remove = (index: number) =>
    edit((list) => {
      list.splice(index, 1);
      return list;
    });

  const patch = (index: number, changes: Partial<Widget>) =>
    edit((list) => {
      list[index] = { ...list[index]!, ...changes } as Widget;
      return list;
    });

  function add(entry: (typeof WIDGET_CATALOGUE)[number]) {
    const id = `${entry.type}-${Math.random().toString(36).slice(2, 8)}`;
    edit((list) => [...list, entry.create(id)]);
    setPaletteOpen(false);
  }

  async function save() {
    const next = draft();
    if (next) await persist({ ...props.layout, widgets: next });
    setDraft(null);
    setEditing(false);
  }

  function cancel() {
    setDraft(null);
    setEditing(false);
  }

  return (
    <>
      <div class="page-head">
        <div class="toolbar">
          <For each={RANGES}>
            {(days) => (
              <button
                class="btn sm"
                data-variant={props.layout.rangeDays === days ? undefined : "ghost"}
                disabled={busy()}
                onClick={() => setRange(days)}
              >
                {days}d
              </button>
            )}
          </For>

          <Show when={props.sources.length > 1}>
            <select
              value={props.layout.sourceId ?? ""}
              disabled={busy()}
              onChange={(e) => setSource(e.currentTarget.value || null)}
            >
              <option value="">All sources</option>
              <For each={props.sources}>
                {(s) => <option value={s.id}>{s.name}</option>}
              </For>
            </select>
          </Show>
        </div>

        <Show when={props.canEdit}>
          <div class="toolbar">
            <Show
              when={editing()}
              fallback={
                <button class="btn" onClick={() => setEditing(true)}>
                  Edit layout
                </button>
              }
            >
              <button class="btn" onClick={() => setPaletteOpen(true)}>
                Add widget
              </button>
              <button class="btn" data-variant="ghost" onClick={cancel}>
                Cancel
              </button>
              <button class="btn" data-variant="primary" disabled={busy()} onClick={save}>
                {busy() ? "Saving…" : "Save"}
              </button>
            </Show>
          </div>
        </Show>
      </div>

      <div class="grid" classList={{ editing: editing() }}>
        <For each={widgets()}>
          {(widget, index) => (
            <section class="card" data-w={widget.width}>
              <div class="card-head">
                <div class="card-title">{widget.title ?? defaultTitle(widget)}</div>
                <Show when={editing()}>
                  <div class="card-tools">
                    <button class="btn sm" title="Move left" onClick={() => move(index(), -1)}>
                      ←
                    </button>
                    <button class="btn sm" title="Move right" onClick={() => move(index(), 1)}>
                      →
                    </button>
                    <button class="btn sm" title="Change width" onClick={() => resize(index())}>
                      {widget.width}/3
                    </button>
                    <button
                      class="btn sm"
                      data-variant="danger"
                      title="Remove"
                      onClick={() => remove(index())}
                    >
                      ✕
                    </button>
                  </div>
                </Show>
              </div>

              <Show when={editing()}>
                <WidgetConfig widget={widget} onPatch={(c) => patch(index(), c)} />
              </Show>

              <WidgetBody widget={widget} snapshot={props.snapshot} />
            </section>
          )}
        </For>

        <Show when={widgets().length === 0}>
          <div class="card" data-w="3">
            <div class="empty">
              Nothing on this dashboard yet.
              <Show when={props.canEdit}>
                {" "}
                <button class="btn sm" onClick={() => { setEditing(true); setPaletteOpen(true); }}>
                  Add a widget
                </button>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      <Show when={paletteOpen()}>
        <div class="palette" onClick={() => setPaletteOpen(false)}>
          <div class="palette-inner" onClick={(e) => e.stopPropagation()}>
            <h2>Add a widget</h2>
            <p class="meta" style={{ margin: "6px 0 0" }}>
              A fixed catalogue, not a query builder. Each one answers a question this product
              exists to answer.
            </p>
            <div class="palette-list">
              <For each={WIDGET_CATALOGUE}>
                {(entry) => (
                  <button class="palette-item" onClick={() => add(entry)}>
                    <strong>{entry.label}</strong>
                    <span>{entry.description}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}

/** The per-widget knobs, shown only while editing. */
function WidgetConfig(props: { widget: Widget; onPatch: (changes: Partial<Widget>) => void }) {
  return (
    <div class="row" style={{ margin: "0 0 12px" }}>
      <Show when={props.widget.type === "metric"}>
        <select
          value={(props.widget as never as { metric: string }).metric}
          onChange={(e) => props.onPatch({ metric: e.currentTarget.value } as never)}
        >
          <For each={METRIC_KEYS}>{(m) => <option value={m}>{METRIC_LABELS[m]}</option>}</For>
        </select>
        <label class="meta" style={{ display: "flex", gap: "6px", "align-items": "center" }}>
          <input
            type="checkbox"
            checked={(props.widget as never as { compare: boolean }).compare}
            onChange={(e) => props.onPatch({ compare: e.currentTarget.checked } as never)}
          />
          compare
        </label>
      </Show>

      <Show when={props.widget.type === "timeseries"}>
        <select
          value={(props.widget as never as { metric: string }).metric}
          onChange={(e) => props.onPatch({ metric: e.currentTarget.value } as never)}
        >
          <For each={TIMESERIES_METRICS}>{(m) => <option value={m}>{METRIC_LABELS[m]}</option>}</For>
        </select>
      </Show>

      <Show when={props.widget.type === "versions"}>
        <label class="meta">
          quiet after{" "}
          <input
            type="text"
            style={{ width: "56px" }}
            value={String((props.widget as never as { quietDays: number }).quietDays)}
            onChange={(e) => {
              const n = parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(n) && n >= 1 && n <= 90) props.onPatch({ quietDays: n } as never);
            }}
          />{" "}
          days
        </label>
      </Show>

      <Show when={props.widget.type === "retention"}>
        <label class="meta">
          up to day{" "}
          <input
            type="text"
            style={{ width: "56px" }}
            value={String((props.widget as never as { days: number }).days)}
            onChange={(e) => {
              const n = parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(n) && n >= 7 && n <= 60) props.onPatch({ days: n } as never);
            }}
          />
        </label>
      </Show>

      <input
        type="text"
        placeholder={defaultTitle(props.widget)}
        value={props.widget.title ?? ""}
        onChange={(e) => props.onPatch({ title: e.currentTarget.value || undefined } as never)}
      />
    </div>
  );
}

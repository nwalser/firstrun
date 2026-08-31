import { severityText, type SeverityBand } from "@firstrun/schema";
import Pause from "lucide-solid/icons/pause";
import Play from "lucide-solid/icons/play";
import {
  For,
  Index,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { cn } from "../lib/cn.js";
import { useI18n } from "../lib/i18n/index.js";
import { readPreviewMotion, writePreviewMotion } from "../lib/preview-motion.js";
import { BAND_TONE } from "./entry-row.js";
import { Odometer } from "./login-odometer.js";
import {
  BEAT_MS,
  METER_QUERIES,
  PREVIEW_BASELINE,
  PREVIEW_FILTERS,
  PREVIEW_QUERY_LINE,
  PREVIEW_SHELVES,
  PREVIEW_SOURCES,
  PREVIEW_WINDOW,
  advance,
  buildFrameZero,
  formatClock,
  type PreviewFrame,
  type PreviewRow,
} from "./login-preview.data.js";
import { Badge, Card } from "./ui/index.js";

/**
 * The product, running, beside the sign-in form.
 *
 * Somebody signing in is about to look at a board, so the page shows them one
 * working rather than a still life of one. Entries land in the tail four a
 * second, the edge accepts them, a partition takes the row, a spark climbs into
 * whichever meter changed, and its odometer rolls. Every 48 beats the window
 * slides and the whole board re-reads itself at once. Every 34 beats one entry
 * turns up late and grows an OLDER bucket, which is the single most
 * characteristic thing this product does.
 *
 * ## Why it is safe to hydrate
 *
 * Nothing here reads a clock, a storage key or a media query during render. The
 * frame is `buildFrameZero()`, which is a pure function of a constant seed, and
 * `motion` starts `false` on the server AND on the client's first render. Every
 * animation in `styles.css` is scoped under `data-fr-motion="on"`, so the HTML
 * the server sends and the first client render are byte-identical and still.
 * The board comes alive one frame after hydration, which is invisible, and
 * somebody who stored "off" never sees a frame of it.
 *
 * ## What it is not allowed to say
 *
 * It is decorative and `aria-hidden`, but it is on screen, so it has to be
 * true. Nothing here is labelled estimated. `device.id` is an installation
 * and is never called a person. Uniques are scoped to one source and are never
 * summed across them. `ingested_at` appears in exactly one readout, as the
 * debugging stamp it is, and nothing sorts, buckets or retains on it.
 */

/** How often the board re-reads itself, in beats. 48 beats is 10.56 seconds. */
const SLIDE_BEATS = 48;

/**
 * The edge bar's fill, per severity band, written out.
 *
 * The tones themselves come from `BAND_TONE`, which is what the real log page
 * tints its severity column with, so the two cannot drift. The FILL cannot be
 * derived from it at runtime, though: Tailwind generates a rule only for a
 * class name it can find as text in the source, and a name assembled by string
 * surgery is one it never saw. Every one of these is spelled out for that
 * reason, and the pairing with `BAND_TONE` is checked by the type.
 */
const BAND_FILL: Record<SeverityBand, string> = {
  TRACE: "bg-muted-foreground",
  DEBUG: "bg-muted-foreground",
  INFO: "bg-foreground",
  WARN: "bg-warning",
  ERROR: "bg-negative",
  FATAL: "bg-negative",
};

/** The last beat whose one-shot effects are still worth drawing. */
function isRecent(beat: number, stamp: number, within = 3): boolean {
  return stamp > 0 && beat - stamp < within;
}

/**
 * The restart trick for an element that SURVIVES its own animation.
 *
 * A same-name animation re-added to a node inside its own duration does not
 * restart, and at four entries a second two hits land inside 600ms routinely.
 * Alternating between two class names on the parity of the firing beat gives
 * each fire a name that is free to run. Everything that can simply be destroyed
 * and recreated uses a keyed `Show` instead, which is simpler and is what the
 * flashes, the sparks and the sweep do.
 */
function firedClass(beat: number, stamp: number): string | undefined {
  if (!isRecent(beat, stamp)) return undefined;
  return stamp % 2 === 0 ? "fr-fired-a" : "fr-fired-b";
}

export function LoginPreview() {
  const i18n = useI18n();

  const [frame, setFrame] = createSignal<PreviewFrame>(buildFrameZero());
  const [motion, setMotion] = createSignal(false);
  const [reduced, setReduced] = createSignal(false);
  const [hidden, setHidden] = createSignal(false);

  /**
   * Three states, from two booleans and a tab.
   *
   * `off` means still, and reduced motion reaches it through the same path as a
   * stored choice rather than through a gentler third mode. `paused` freezes
   * the compositor for a tab nobody is looking at, rather than trusting the
   * browser to throttle a timer it may well keep running.
   */
  const motionState = () => {
    if (reduced() || !motion()) return "off";
    return hidden() ? "paused" : "on";
  };

  const running = () => motion() && !reduced() && !hidden();

  onMount(() => {
    const query =
      typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (query) {
      setReduced(query.matches);
      const onChange = () => setReduced(query.matches);
      query.addEventListener("change", onChange);
      onCleanup(() => query.removeEventListener("change", onChange));
    }

    // Nothing stored means on. The default is stated exactly once, here.
    setMotion(readPreviewMotion() !== "off");

    const onVisibility = () => setHidden(document.hidden);
    setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));
  });

  /**
   * One interval for the whole page, created and cleared by whether it should
   * be running. Toggling off genuinely stops the clock rather than hiding the
   * movement, and a tab restored after an hour resumes from the beat it stopped
   * at with no catch-up burst, so the fictional wall clock stays plausible.
   */
  createEffect(() => {
    if (!running()) return;
    const id = setInterval(() => {
      // One beat is one render pass, so eight changes that belong to the same
      // moment reach the DOM together instead of as eight separate updates.
      batch(() => setFrame((f) => advance(f)));
    }, BEAT_MS);
    onCleanup(() => clearInterval(id));
  });

  const toggle = () => {
    const next = !motion();
    setMotion(next);
    writePreviewMotion(next ? "on" : "off");
  };

  // --- derived, so only what moved re-renders ------------------------------
  const beat = () => frame().beat;
  const rows = createMemo(() => frame().rows);
  const buckets = createMemo(() => frame().buckets);
  const bucketMax = createMemo(() => Math.max(...buckets()));
  const meters = createMemo(() => frame().meters);
  const keys = createMemo(() => frame().keys);
  const throughput = createMemo(() => frame().throughput);
  const throughputMax = createMemo(() => Math.max(1, ...throughput()));

  /**
   * The six paths on screen, the slot each occupies, and which of them has just
   * arrived in the top six.
   *
   * `entering` is compared against the PREVIOUS value of this memo rather than
   * assumed, because the alternative is putting the entrance class on every
   * visible row: six rows would then slide in together the instant motion turns
   * on, which is the first-paint storm the stylesheet exists to prevent. The
   * first run has no previous value and therefore nothing entering.
   */
  const breakdown = createMemo<
    { path: string; count: number; slot: number; share: number; entering: boolean }[]
  >((previous) => {
    const ordered = [...frame().breakdown].sort((a, b) => b.count - a.count);
    const top = ordered.slice(0, 6);
    const total = Math.max(1, top[0]?.count ?? 1);
    const before = new Map((previous ?? []).map((r) => [r.path, r.slot]));
    return frame().breakdown.map((row) => {
      const slot = top.findIndex((t) => t.path === row.path);
      const was = before.get(row.path);
      return {
        ...row,
        slot,
        share: row.count / total,
        entering: was !== undefined && was < 0 && slot >= 0,
      };
    });
  });

  return (
    <>
      <div
        aria-hidden="true"
        data-slot="login-preview"
        data-fr-motion={motionState()}
        class={cn(
          "pointer-events-none absolute inset-0 flex select-none flex-col overflow-hidden",
          "px-8 pt-6 font-sans"
        )}
      >
        {/* A. The chrome. What board this is, what it is filtered to, and the
            two windows every delta on it is measured between. */}
        <div class="flex h-9 shrink-0 items-center justify-between gap-4">
          <div class="flex min-w-0 items-center gap-2">
            <span class="text-body text-muted-foreground">Themia</span>
            <span class="text-muted-foreground opacity-50">/</span>
            <span class="text-body font-medium text-foreground">Overview</span>
            <Index each={PREVIEW_FILTERS}>
              {(filter) => (
                <span class="ring-hairline rounded-xs px-1.5 py-0.5 font-mono text-mono text-muted-foreground">
                  {filter()}
                </span>
              )}
            </Index>
            {/*
              Load-bearing, and the first thing an editor will want to cut.

              This stream runs about a hundred times faster than Themia really
              sends, because the truth is one entry every twenty-five seconds
              and that is a still image. Without this badge somebody signing in
              reads six figures of page views as their own.
            */}
            <Badge variant="secondary">{i18n.t("auth.preview_sample")}</Badge>
          </div>

          <div class="flex shrink-0 items-center gap-3">
            <span class="flex items-center gap-1.5 text-label-13 text-muted-foreground">
              <span class="relative flex size-1.5 shrink-0">
                {/* The halo pulses, never the dot, so the word beside it does
                    not move. A stopped board shows no halo at all: a live dot
                    over something that has stopped listening is the one thing
                    this must never say. */}
                <Show when={running()}>
                  <span class="absolute inline-flex h-full w-full rounded-full bg-positive opacity-75 motion-safe:animate-ping" />
                </Show>
                <span
                  class={cn(
                    "relative inline-flex size-1.5 rounded-full",
                    running() ? "bg-positive" : "bg-muted-foreground"
                  )}
                />
              </span>
              {i18n.t("auth.preview_live")}
            </span>
            <span class="ring-hairline rounded-xs px-1.5 py-0.5 text-caption text-muted-foreground">
              {i18n.t("auth.preview_range")}
            </span>
            <span class="font-mono text-mono text-muted-foreground">
              {i18n.t("auth.preview_windows", {
                window: PREVIEW_WINDOW,
                baseline: PREVIEW_BASELINE,
              })}
            </span>
          </div>
        </div>

        {/* B. The two cards a board is mostly made of: a series and a group by. */}
        <div class="mt-3 grid h-[196px] shrink-0 grid-cols-3 gap-3">
          <Card class="col-span-2 p-3">
            <div class="flex h-5 items-center justify-between">
              <span class="text-small font-semibold uppercase tracking-wider text-muted-foreground">
                {i18n.t("auth.preview_chart_title", { name: "page_view" })}
              </span>
              <span class="text-small uppercase tracking-wider text-muted-foreground">
                {i18n.t("auth.preview_agg_count")}
              </span>
            </div>
            {/* The saved query itself, because a widget IS a saved query plus a
                way of drawing its answer. Not translated: it is code. */}
            <div class="h-4 truncate font-mono text-mono text-muted-foreground opacity-70">
              {PREVIEW_QUERY_LINE}
            </div>

            <div class="mt-2 flex h-[104px] items-end gap-[3px]">
              <Index each={buckets()}>
                {(value, i) => (
                  <div class="relative h-full flex-1">
                    <i
                      class={cn(
                        "fr-bar absolute inset-x-0 bottom-0 h-full rounded-[1px] bg-chart-1",
                        i === 23 && "fr-bar-open",
                        frame().lateBucket?.value === i &&
                          isRecent(beat(), frame().lateBucket?.beat ?? 0, 5) &&
                          "fr-bucket-late"
                      )}
                      style={{
                        "--fr-v": String(value() / Math.max(1, bucketMax())),
                        "--fr-i": String(i),
                      }}
                    />
                    {/* A late entry does not touch the open bucket. It grows the
                        hour it actually happened in, and says so. */}
                    <Show
                      when={
                        frame().lateBucket?.value === i ? frame().lateBucket?.beat : undefined
                      }
                      keyed
                    >
                      <i class="fr-late-plus absolute -top-3 left-1/2 -translate-x-1/2 font-mono text-[9px] text-warning not-italic">
                        +1
                      </i>
                    </Show>
                  </div>
                )}
              </Index>
            </div>

            {/* Relative on purpose. The window advances every 10.56 seconds, so
                an absolute hour of the day would contradict the tail's own
                clock inside a minute. A relative label contradicts nothing. */}
            <div class="mt-1 flex h-4 justify-between font-mono text-mono text-muted-foreground opacity-70">
              <span>-24h</span>
              <span>-16h</span>
              <span>-8h</span>
              <span>{i18n.t("auth.preview_open_bucket")}</span>
            </div>

            <div class="h-4">
              <Show when={frame().lateNote} keyed>
                {(note) => (
                  <span class="fr-note block truncate font-mono text-mono text-warning">
                    {i18n.t("auth.preview_late_note", { delay: i18n.duration(note.delayMs) })}
                  </span>
                )}
              </Show>
            </div>
          </Card>

          <Card class="relative p-3">
            <div class="flex h-5 items-center justify-between">
              <span class="text-small font-semibold uppercase tracking-wider text-muted-foreground">
                {i18n.t("auth.preview_breakdown_title")}
              </span>
              <span class="font-mono text-mono text-muted-foreground">
                {i18n.t("auth.preview_breakdown_by", { key: "url.path" })}
              </span>
            </div>
            {/* Absolutely positioned on a slot index, so two rows trading places
                slide PAST each other instead of jumping. */}
            <div class="relative mt-2 h-[132px]">
              <For each={breakdown()}>
                {(row) => (
                  <Show when={row.slot >= 0}>
                    <div
                      class={cn(
                        "fr-breakdown-row absolute inset-x-0 top-0 flex h-[22px] items-center gap-2 px-1",
                        row.entering && "fr-breakdown-row-in"
                      )}
                      style={{ "--fr-row": String(row.slot) }}
                    >
                      <i
                        class="fr-share absolute inset-y-0 left-0 rounded-xs bg-chart-1/15"
                        style={{ "--fr-share": String(row.share), width: "100%" }}
                      />
                      <span class="relative truncate font-mono text-mono text-foreground">
                        {row.path}
                      </span>
                      <span class="relative ml-auto font-mono text-mono text-muted-foreground">
                        {i18n.num(row.count)}
                      </span>
                    </div>
                  </Show>
                )}
              </For>
            </div>
          </Card>
        </div>

        {/* C. Four meters. Each names the query it is, not a word for it. */}
        <div class="mt-3 grid h-[104px] shrink-0 grid-cols-4 gap-px overflow-hidden rounded-md bg-border shadow-sm">
          <Index each={meters()}>
            {(value, i) => (
              <div class="relative overflow-hidden bg-card p-3">
                <div class="h-5 truncate font-mono text-mono text-muted-foreground">
                  {METER_QUERIES[i]}
                </div>
                <Odometer
                  value={value()}
                  format={(n) => i18n.num(n)}
                  class="h-8 text-h2 text-foreground"
                />
                <div class="mt-0.5 flex h-4 items-center gap-1.5">
                  <span
                    class={cn(
                      "font-mono text-mono",
                      // Only on the beat the window slid. Unconditional, this
                      // crossfaded all four chips on hydration for no reason:
                      // a delta that has not been recomputed has not changed.
                      isRecent(beat(), frame().slideBeat, 3) && "fr-delta-chip",
                      (frame().deltas[i] ?? 0) >= 0 ? "text-positive" : "text-negative"
                    )}
                  >
                    {i18n.percent(frame().deltas[i] ?? 0)}
                  </span>
                  <span class="truncate text-small text-muted-foreground">
                    {i === 2
                      ? i18n.t("auth.preview_agg_errors")
                      : i === 3
                        ? i18n.t("auth.preview_agg_uniques", { source: PREVIEW_SOURCES[0] })
                        : i18n.t("auth.preview_agg_count")}
                  </span>
                </div>
                <div class="mt-1.5 flex h-3 items-end gap-[2px]">
                  <Index each={frame().sparks[i] ?? []}>
                    {(cell) => (
                      <i
                        class="fr-cell h-full w-[3px] rounded-[1px] bg-chart-1/40"
                        style={{ "--fr-v": String(cell()) }}
                      />
                    )}
                  </Index>
                </div>
                {/* Keyed, so Solid destroys and recreates the node: a fresh node
                    runs its animation from frame zero with no class juggling. */}
                <Show when={isRecent(beat(), frame().meterBump[i] ?? 0, 3)}>
                  <Show when={frame().meterBump[i]} keyed>
                    <i class="fr-flash pointer-events-none absolute inset-0 bg-chart-1/25" />
                  </Show>
                </Show>
              </div>
            )}
          </Index>
        </div>

        {/* D. The gutter the sparks climb: ingested, THEN the board moved. */}
        <div class="relative h-[30px] shrink-0">
          <Index each={[0, 1, 2, 3]}>
            {(_, i) => (
              <div class="fr-riser">
                <Show when={isRecent(beat(), frame().riserFired[i] ?? 0, 4)}>
                  <Show when={frame().riserFired[i]} keyed>
                    <i class="fr-riser-spark absolute inset-x-0 bottom-0 block h-1.5 bg-chart-1" />
                  </Show>
                </Show>
              </div>
            )}
          </Index>
        </div>

        {/* E. The plumbing: three sources, one endpoint, three partitions. */}
        <div class="ring-hairline shrink-0 overflow-hidden rounded-md bg-card">
          <div class="fr-ribbon-grid p-3">
            <div class="flex flex-col gap-1">
              <span class="text-small uppercase tracking-wider text-muted-foreground">
                {i18n.t("auth.preview_sources")}
              </span>
              <Index each={PREVIEW_SOURCES}>
                {(source, i) => (
                  <div class="flex h-[18px] items-center gap-1.5">
                    <i
                      class={cn(
                        "fr-emitter ring-hairline block size-2 shrink-0 rounded-[2px] bg-chart-1/30",
                        firedClass(beat(), frame().laneFired[i] ?? 0)
                      )}
                    />
                    <span class="truncate font-mono text-mono text-muted-foreground">
                      {source()}
                    </span>
                  </div>
                )}
              </Index>
            </div>

            <div class="flex flex-col gap-1">
              <span class="text-small uppercase tracking-wider text-muted-foreground">
                {i18n.t("auth.preview_wire")}
              </span>
              <Index each={[0, 1, 2]}>
                {(_, lane) => (
                  <div class="relative flex h-[18px] items-center">
                    <i class={cn("fr-wire block h-px w-full", `fr-wire-${lane}`)} />
                    {/* One mark per entry, crossing in 520ms: travel outlasts a
                        beat, so the wire is always carrying something. */}
                    <For each={frame().inflight.filter((p) => p.lane === lane)}>
                      {(packet) => (
                        <i
                          class="fr-packet absolute left-0 block h-[2px] w-2 rounded-full bg-chart-1"
                          style={{ "--fr-travel": "calc(100% * 12)" }}
                          data-id={packet.id}
                        />
                      )}
                    </For>
                  </div>
                )}
              </Index>
            </div>

            <div class="flex flex-col gap-1">
              <span class="font-mono text-mono text-foreground">POST /v1/e</span>
              {/* Identical for a FATAL at 21 and a page view at 9. The edge
                  validates shape and writes: it never branches on a name or a
                  severity, and this is that said out loud. */}
              <Index each={["resolved", "validated", "stamped"] as const}>
                {(step, i) => (
                  <div
                    class={cn(
                      "fr-edge-line flex h-[14px] items-center gap-1.5 opacity-50",
                      `fr-edge-line-${i}`
                    )}
                  >
                    <i class="block size-1 rounded-full bg-positive" />
                    <span class="truncate font-mono text-[10px] leading-none text-muted-foreground">
                      {i18n.t(`auth.preview_${step()}` as "auth.preview_resolved")}
                    </span>
                  </div>
                )}
              </Index>
              {/*
                The chip is always here and only the FLASH is conditional.

                Gating the element itself on the accept beat looked right and
                was not: the beat starts negative, which is truthy, so the chip
                rendered at frame zero and flashed the moment motion turned on.
                A still board should show a dim 202, because the endpoint is
                still there when nothing is arriving.
              */}
              <span
                class={cn(
                  "relative mt-0.5 block overflow-hidden rounded-xs px-1 font-mono text-mono",
                  isRecent(beat(), frame().acceptBeat, 3)
                    ? "fr-accept text-positive"
                    : "text-positive/50"
                )}
              >
                202 {i18n.t("auth.preview_accepted")}
                <Show when={isRecent(beat(), frame().acceptBeat, 3)}>
                  <Show when={frame().acceptBeat} keyed>
                    <i class="fr-accept-sweep absolute inset-y-0 left-0 block w-4 bg-positive/25" />
                  </Show>
                </Show>
              </span>
            </div>

            <div class="flex flex-col gap-1">
              <span class="font-mono text-mono text-muted-foreground">log_entries</span>
              {/*
                The only place in the product where a partition is visible.

                The newest shelf ticks four times a second. The older two tick
                ONLY when something arrives late, which is the whole argument
                for partitioning by the client's own `time` in one object.
              */}
              <Index each={PREVIEW_SHELVES}>
                {(shelf, i) => (
                  <div
                    class={cn(
                      "fr-shelf ring-hairline flex h-[18px] items-center justify-between gap-2 rounded-xs px-1.5",
                      firedClass(beat(), frame().shelfHit[i]?.beat ?? 0)
                    )}
                    style={{ "--fr-hit": "var(--chart-1)" }}
                  >
                    <span class="truncate font-mono text-[10px] leading-none text-muted-foreground">
                      {shelf()}
                    </span>
                    <span
                      class={cn(
                        "fr-count shrink-0 font-mono text-[10px] leading-none text-muted-foreground",
                        firedClass(beat(), frame().shelfHit[i]?.beat ?? 0)
                      )}
                    >
                      {i18n.num(frame().shelves[i] ?? 0)}
                    </span>
                  </div>
                )}
              </Index>
            </div>
          </div>

          <div class="flex items-center justify-between gap-4 border-t px-3 py-2">
            <span class="font-mono text-mono text-muted-foreground">
              {i18n.t("auth.preview_throughput", { rate: frame().ratePerSec.toFixed(1) })}
            </span>
            <div class="flex h-4 flex-1 items-end justify-end gap-[2px]">
              <Index each={throughput()}>
                {(cell) => (
                  <i
                    class="fr-cell h-full w-[3px] rounded-[1px] bg-chart-1/40"
                    style={{ "--fr-v": String(cell() / throughputMax()) }}
                  />
                )}
              </Index>
            </div>
            {/*
              The two stamps, and the difference between them, as a number that
              reacts. This is the ONLY place `ingested_at` appears anywhere in
              the preview, and nothing sorts, buckets or retains on it.
            */}
            <span class="shrink-0 font-mono text-mono text-muted-foreground">
              {i18n.t("auth.preview_lateness")}{" "}
              <span
                class={cn("fr-p50", frame().p50Late ? "text-warning" : "text-foreground")}
                data-late={frame().p50Late ? "true" : "false"}
              >
                {frame().p50Late ? i18n.duration(frame().p50Ms) : `${frame().p50Ms}ms`}
              </span>
            </span>
          </div>
        </div>

        {/*
          F. Attributes are DISCOVERED, not declared.

          A chip appears the first time an entry carries a key nobody has sent.
          There is no registration step and no schema to declare, and this is
          the only animation in the product that says so.
        */}
        <div class="fr-keys mt-3 flex h-6 shrink-0 items-center gap-1.5 overflow-hidden">
          <span class="shrink-0 text-small uppercase tracking-wider text-muted-foreground">
            {i18n.t("auth.preview_keys", { count: keys().length })}
          </span>
          <For each={keys()}>
            {(entry) => (
              <span
                class={cn(
                  "ring-hairline shrink-0 rounded-xs px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground",
                  entry.fresh && "fr-key-fresh"
                )}
              >
                {entry.key}
              </span>
            )}
          </For>
        </div>

        {/* G. The tail. Four of the five promoted columns and the map. */}
        <div class="mt-2 flex min-h-0 flex-1 flex-col">
          <div class="fr-row shrink-0 pb-1 font-mono text-mono uppercase tracking-wider text-muted-foreground opacity-60">
            <span>time</span>
            <span>severity</span>
            <span>name</span>
            <span class="fr-cell-did">device.id</span>
            <span>attributes</span>
          </div>
          <div class="fr-tail relative min-h-0 flex-1 overflow-hidden">
            <i class="fr-caret absolute left-2 top-0 block h-3 w-px bg-foreground" />
            <ul class="mt-3">
              <For each={rows()}>
                {(row) => <TailRow row={row} expanded={frame().expandedId === row.id} />}
              </For>
            </ul>
          </div>
        </div>

        {/*
          The band that crosses the board when the window slides.

          Eight things change on that beat: the histogram, the four sparklines,
          the deltas and the baseline. One band crossing them all is what makes
          that read as one re-run of the board's queries rather than as
          unrelated fidgeting.
        */}
        <Show when={isRecent(beat(), frame().slideBeat, SLIDE_BEATS)}>
          <Show when={frame().slideBeat} keyed>
            <i class="fr-sweep pointer-events-none absolute inset-y-0 left-0 block w-1/4 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
          </Show>
        </Show>
      </div>

      {/*
        The one real control on this side of the page.

        A sibling of the board rather than a child, so it is outside the
        `aria-hidden` subtree and outside `pointer-events-none`: the decoration
        is hidden from a reader and inert to a pointer, and this is neither. It
        is always visible rather than revealed on hover, because a control that
        appears only under a pointer is not one a keyboard can find.

        Not rendered at all when the machine asks for reduced motion: there is
        nothing to disable, and a button that does nothing is worse than none.
      */}
      <Show when={!reduced()}>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={!motion()}
          aria-label={i18n.t("auth.preview_motion_label")}
          title={i18n.t("auth.preview_motion_label")}
          class={cn(
            "focus-ring ring-hairline absolute bottom-4 right-4 z-10 inline-flex items-center gap-1.5",
            "h-control-sm rounded-sm bg-card/80 px-2.5 backdrop-blur-sm",
            "text-caption text-muted-foreground opacity-70 transition-opacity duration-150",
            "hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
          )}
        >
          <Show when={motion()} fallback={<Play aria-hidden="true" class="size-3.5" />}>
            <Pause aria-hidden="true" class="size-3.5" />
          </Show>
          {motion() ? i18n.t("auth.preview_motion_pause") : i18n.t("auth.preview_motion_play")}
        </button>
      </Show>
    </>
  );
}

/**
 * One entry, in the shape the real log page draws it in.
 *
 * The severity is the NUMBER, printed in the spec's own short form and tinted
 * through the same map the log page uses, so the two cannot drift. Nobody reads
 * the word INFO at four rows a second, which is what the coloured edge bar is
 * for: it is the ladder made legible at the speed the tail moves.
 */
function TailRow(props: { row: PreviewRow; expanded: boolean }) {
  const i18n = useI18n();
  const row = () => props.row;

  return (
    <li>
      <div
        class={cn("fr-row", row().fresh && "fr-row-fresh")}
        data-late={row().late ? "true" : "false"}
      >
        <i
          class={cn(
            "fr-edge absolute inset-y-0 left-0 block w-[2px] not-italic",
            row().late ? "bg-warning" : BAND_FILL[row().band]
          )}
        />
        <span
          class={cn(
            "truncate font-mono text-mono",
            row().late ? "text-warning" : "text-foreground"
          )}
        >
          {formatClock(row().timeMs)}
        </span>
        <span class={cn("font-mono text-mono", BAND_TONE[row().band])}>
          {severityText(row().severity)}
        </span>
        <span class="truncate text-body text-foreground">{row().name}</span>
        <span class="fr-cell-did truncate font-mono text-mono text-muted-foreground">
          {row().deviceId}
        </span>
        <span class="truncate font-mono text-mono text-muted-foreground">
          <Show
            when={row().late}
            fallback={
              <span class="opacity-70">
                {row().attrs.length} {row().attrs.length === 1 ? "key" : "keys"}
              </span>
            }
          >
            {/*
              Its own fact about the row, arriving after it has settled.

              A laptop was offline, the queue replayed on the next launch, and
              the entry carries the time it HAPPENED. It sorts and buckets by
              that, which is why it is at the top of an arrival-ordered tail
              while showing an older clock.
            */}
            <span class="fr-late-chip text-warning">
              {i18n.t("auth.preview_late_by", { delay: i18n.duration(row().lateByMs ?? 0) })}
            </span>
          </Show>
        </span>
      </div>

      {/* The whole entry, opened in place. No height is ever measured. */}
      <div class="fr-expand" data-open={props.expanded ? "true" : "false"}>
        <div>
          <div class="flex flex-col gap-0.5 py-1 pl-[110px] font-mono text-mono">
            <For each={row().attrs}>
              {([key, value]) => (
                <div class="flex gap-2">
                  <span class="w-[190px] shrink-0 truncate text-code-name">{key}</span>
                  <span class="truncate text-code-string">{value}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </li>
  );
}

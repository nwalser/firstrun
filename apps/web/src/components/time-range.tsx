import {
  RANGE_PRESETS,
  resolveComparison,
  resolveRange,
  toCalendarDate,
  type Comparison,
  type DateRange,
} from "@firstrun/schema";
import CalendarIcon from "lucide-solid/icons/calendar";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import { cn } from "../lib/cn.js";
import { useI18n, type I18n, type SimpleKey } from "../lib/i18n/index.js";
import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RangeCalendar,
  Separator,
} from "./ui/index.js";

/**
 * The window the board looks at, and what it compares against.
 *
 * The two are picked in one place because they are read as one sentence -- "the
 * last 30 days, against the 30 before" -- but they stay separate values, for
 * the reason `packages/schema/src/range.ts` gives: a delta whose baseline moved
 * when the range did, silently, is a number nobody can check. Which is also why
 * both resolved windows are spelled out in full at the bottom of the popover
 * rather than left implied by two words in a dropdown.
 *
 * Changes apply as they are made. There is no Save button in this product and
 * this is not the screen to introduce one. The single exception is a custom
 * range mid-pick: one click is not a range, so `RangeCalendar` holds it back
 * until the second one lands.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * The kinds of comparison, as keys rather than words.
 *
 * A translated label at module scope is frozen in whichever language was active
 * when this file was first imported, and a language switch would not re-render
 * it. The keys are language-free; `t` runs inside the component.
 */
const COMPARISONS: Array<{ kind: Comparison["kind"]; key: SimpleKey }> = [
  { kind: "none", key: "dashboard.compare_none" },
  { kind: "previous", key: "dashboard.compare_previous" },
  { kind: "year", key: "dashboard.compare_year" },
  { kind: "absolute", key: "dashboard.compare_custom" },
];

/** The inclusive last day, which is what a calendar shows and `to` is not. */
const lastDay = (to: Date) => toCalendarDate(new Date(to.getTime() - DAY));

/**
 * A `yyyy-mm-dd` or a resolved boundary, written out.
 *
 * Pinned to UTC, because every date in a range is a calendar date rather than
 * an instant: `resolveRange` builds its boundaries at midnight UTC and
 * `CalendarDate` parses the same way. Formatted in the viewer's own zone,
 * anybody west of Greenwich would be shown the previous day.
 */
const calendarDate = (i18n: I18n, value: Date | string) =>
  i18n.date(value, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * How a range reads, in the reader's language.
 *
 * `describeRange` and the labels on `RANGE_PRESETS` answer this already, and
 * both answer it in English: `packages/schema` is the contract and carries no
 * locale. So the label is derived from the range's own shape here instead, and
 * the preset's `label` field is ignored in favour of its `days`.
 */
function rangeLabel(i18n: I18n, range: DateRange): string {
  if (range.kind === "last") {
    if (range.days === 1) return i18n.t("dashboard.range_last_24h");
    if (range.days === 365) return i18n.t("dashboard.range_last_12m");
    return i18n.t("dashboard.range_last_days", { count: range.days });
  }
  const from = calendarDate(i18n, range.from);
  return range.from === range.to
    ? from
    : i18n.t("dashboard.window_span", { from, to: calendarDate(i18n, range.to) });
}

/**
 * The lower-case half of "vs previous period", for the trailing pill.
 *
 * A separate key rather than `toLowerCase()` on the picker's own label: German
 * capitalises a noun wherever it stands, so lower-casing "Vorjahreszeitraum"
 * spells it wrong.
 */
function baselineLabel(i18n: I18n, comparison: Comparison): string {
  switch (comparison.kind) {
    case "none":
      return "";
    case "previous":
      return i18n.t("dashboard.baseline_previous");
    case "year":
      return i18n.t("dashboard.baseline_year");
    case "absolute":
      return i18n.t("dashboard.window_span", {
        from: calendarDate(i18n, comparison.from),
        to: calendarDate(i18n, comparison.to),
      });
  }
}

export function TimeRangePicker(props: {
  range: DateRange;
  comparison: Comparison;
  onChange: (next: { range: DateRange; comparison: Comparison }) => void;
  disabled?: boolean;
}): JSX.Element {
  const i18n = useI18n();

  /**
   * Both resolved windows, spelled out with the year on them.
   *
   * `i18n.dateRange` collapses the shared parts and drops the year, which is
   * wrong for exactly the comparison this control exists to make checkable: a
   * baseline of "previous year" and the current window would print identically.
   */
  const describeWindow = (w: { from: Date; to: Date }) =>
    i18n.t("dashboard.window_span", {
      from: calendarDate(i18n, w.from),
      to: calendarDate(i18n, new Date(w.to.getTime() - DAY)),
    });

  /**
   * "Custom" is a mode, not yet a value: it has to be selectable before there
   * are two dates to put in it, and picking it must not emit a comparison the
   * board cannot resolve.
   */
  const [customCompare, setCustomCompare] = createSignal(false);

  const compareKind = () =>
    props.comparison.kind === "absolute" || customCompare() ? "absolute" : props.comparison.kind;

  const current = createMemo(() => resolveRange(props.range));
  const baseline = createMemo(() => resolveComparison(props.range, props.comparison));

  const rangeFrom = () => toCalendarDate(current().from);
  const rangeTo = () => lastDay(current().to);

  const setRange = (range: DateRange) => props.onChange({ range, comparison: props.comparison });
  const setComparison = (comparison: Comparison) =>
    props.onChange({ range: props.range, comparison });

  const pickCompareKind = (kind: Comparison["kind"]) => {
    if (kind === "absolute") {
      // Wait for the calendar; emitting half a window here would blank the delta.
      setCustomCompare(true);
      return;
    }
    setCustomCompare(false);
    setComparison({ kind } as Comparison);
  };

  return (
    <Popover placement="bottom-start" gutter={6}>
      {/* A control in a toolbar row: 36px at radius 6, which is one step more
          than a standalone button rounds. */}
      <PopoverTrigger
        as={Button}
        variant="outline"
        size="toolbar"
        disabled={props.disabled}
        // `min-w-0` and the two truncations are the German fix: the button is
        // `shrink-0` by variant, and "ggü. vorherigem Zeitraum" is half again
        // as wide as "vs previous period". Without them a long baseline pushes
        // the rest of the toolbar off the row instead of clipping itself.
        class="min-w-0 gap-2"
      >
        <CalendarIcon class="size-4 opacity-60" />
        <span class="truncate">{rangeLabel(i18n, props.range)}</span>
        <Show when={props.comparison.kind !== "none"}>
          {/* The measured trailing pill: 11px at weight 500, 2px above and
              below, 8px each side, fully rounded. The one place in the system
              that is deliberately below the caption step. */}
          <Badge variant="outline" class="max-w-48 truncate rounded-full px-2 text-[11px]">
            {i18n.t("dashboard.baseline", { range: baselineLabel(i18n, props.comparison) })}
          </Badge>
        </Show>
        <ChevronDown class="size-3.5 opacity-50" />
      </PopoverTrigger>

      <PopoverContent class="w-auto max-w-[calc(100vw-2rem)] overflow-auto p-0">
        <div class="flex">
          <div class="flex w-44 shrink-0 flex-col gap-0.5 border-r p-2">
            <div class="text-muted-foreground px-2 pb-1 text-xs font-medium">
              {i18n.t("dashboard.range")}
            </div>
            <For each={RANGE_PRESETS}>
              {(preset) => {
                const active = () =>
                  props.range.kind === "last" &&
                  preset.range.kind === "last" &&
                  props.range.days === preset.range.days;
                return (
                  <button
                    type="button"
                    aria-pressed={active()}
                    onClick={() => setRange(preset.range)}
                    // The measured popover row: 36px, radius 6, 8px each side.
                    // The height is the token rather than padding, so a row
                    // here keeps the same pitch as one in the scope switcher.
                    class={cn(
                      "flex h-popover-row cursor-pointer items-center justify-between",
                      "rounded-md px-2 text-body transition-colors",
                      "focus-ring outline-none",
                      active()
                        ? "bg-accent font-medium text-accent-foreground"
                        : "hover:bg-accent/60"
                    )}
                  >
                    {rangeLabel(i18n, preset.range)}
                    <Show when={active()}>
                      <Check class="size-3.5" />
                    </Show>
                  </button>
                );
              }}
            </For>
            <div class="text-muted-foreground mt-1 px-2 text-copy-13">
              {i18n.t("dashboard.range_hint")}
            </div>
          </div>

          <div class="p-3">
            <RangeCalendar
              from={rangeFrom()}
              to={rangeTo()}
              onChange={(r) => setRange({ kind: "absolute", from: r.from, to: r.to })}
            />
          </div>
        </div>

        <Separator />

        <div class="p-3">
          <div class="text-muted-foreground pb-2 text-xs font-medium">
            {i18n.t("dashboard.compared_with")}
          </div>
          <div class="flex flex-wrap gap-2">
            <For each={COMPARISONS}>
              {(option) => (
                <button
                  type="button"
                  aria-pressed={compareKind() === option.kind}
                  onClick={() => pickCompareKind(option.kind)}
                  // The measured facet chip: 32px, radius 6. A chip is a
                  // control, so it sits on the same height rhythm as one.
                  class={cn(
                    "flex h-control-sm cursor-pointer items-center rounded-md border px-2.5",
                    "text-body transition-colors focus-ring outline-none",
                    compareKind() === option.kind
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {i18n.t(option.key)}
                </button>
              )}
            </For>
          </div>

          <Show when={compareKind() === "absolute"}>
            <div class="pt-3">
              <RangeCalendar
                from={props.comparison.kind === "absolute" ? props.comparison.from : null}
                to={props.comparison.kind === "absolute" ? props.comparison.to : null}
                onChange={(r) => {
                  setCustomCompare(false);
                  setComparison({ kind: "absolute", from: r.from, to: r.to });
                }}
              />
            </div>
          </Show>
        </div>

        <Separator />

        {/* Both windows, in full. The whole point of a comparison is that you
            can check it, and "vs previous period" is not something you can. */}
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2.5 text-xs">
          <dt class="text-muted-foreground">{i18n.t("dashboard.showing")}</dt>
          <dd class="tabular-nums">{describeWindow(current())}</dd>
          <dt class="text-muted-foreground">{i18n.t("dashboard.compared_with")}</dt>
          <dd class="tabular-nums">
            <Show
              when={baseline()}
              fallback={
                <span class="text-muted-foreground">{i18n.t("dashboard.baseline_nothing")}</span>
              }
            >
              {(window) => describeWindow(window())}
            </Show>
          </dd>
        </dl>
      </PopoverContent>
    </Popover>
  );
}

import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";
import { useI18n } from "../../lib/i18n/index.js";

/**
 * A month grid, hand-rolled.
 *
 * Kobalte has no calendar primitive, and the alternative -- a date library --
 * would be the single largest dependency in the app in exchange for arithmetic
 * that fits on one screen. So: `Date` and `Intl`, nothing else.
 *
 * Everything here is UTC, and every value crossing the boundary is a plain
 * `yyyy-mm-dd` string. That is not fussiness. A range picked as "the 3rd to the
 * 9th" has to stay the 3rd to the 9th for whoever opens the board next, and the
 * moment a local-timezone `Date` gets involved the 3rd becomes the 2nd at 23:00
 * for half the people looking at it. `packages/schema/src/range.ts` reasons the
 * same way and this is the other end of that contract.
 */

const DAY = 24 * 60 * 60 * 1000;

const dayToMs = (day: string) => Date.parse(day + "T00:00:00.000Z");
const msToDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => msToDay(dayToMs(day) + n * DAY);
const monthOf = (day: string) => day.slice(0, 7);
const todayUtc = () => msToDay(Date.now());

/** `yyyy-mm` plus n months. */
function addMonths(month: string, n: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** A day plus n months, clamped: the 31st a month before the 30th is the 30th. */
function addMonthsToDay(day: string, n: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1;
  const date = Number(day.slice(8, 10));
  const lastOfTarget = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  return msToDay(Date.UTC(y, m + n, Math.min(date, lastOfTarget)));
}

/**
 * Six weeks of days, Monday first, including the neighbouring months' tail and
 * head. Always six so the grid does not change height as you page through it --
 * a picker that grows a row in February moves the button you were about to
 * click.
 */
function monthGridDays(month: string): string[] {
  const first = dayToMs(month + "-01");
  // getUTCDay puts Sunday at 0; a Monday-first week wants Sunday in column 7.
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const start = first - lead * DAY;
  return Array.from({ length: 42 }, (_, i) => msToDay(start + i * DAY));
}

/** 2024-01-01 was a Monday, which is where the week starts here. */
const WEEK_ANCHORS = Array.from({ length: 7 }, (_, i) => Date.UTC(2024, 0, 1 + i));

// ---------------------------------------------------------------------------
// One month
// ---------------------------------------------------------------------------

type Edge = "start" | "end" | "both" | null;

interface MonthGridProps {
  month: string;
  /** The day the arrow keys are sitting on. Roving tabindex, one stop per grid. */
  focused: string;
  /**
   * Bumped whenever focus should follow `focused` into the DOM. A plain effect
   * on `focused` would steal focus on mount and again on every re-render; a
   * counter only moves it when a key was actually pressed.
   */
  focusToken: number;
  min?: string;
  max: string;
  selected: (day: string) => boolean;
  inRange?: (day: string) => boolean;
  edge?: (day: string) => Edge;
  onPick: (day: string) => void;
  onHover?: (day: string | null) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onPrev?: () => void;
  onNext?: () => void;
}

function MonthGrid(props: MonthGridProps): JSX.Element {
  /*
   * Every month name, weekday and spelled-out date on this grid comes from
   * here, and all three are read INSIDE the component rather than built once at
   * module scope. A module constant is evaluated the first time the module is
   * loaded, which freezes the calendar in whichever language happened to be
   * active then: switching language re-renders the grid and the month heading
   * stays in the old one.
   *
   * The three helpers are pinned to UTC, which is what the rest of this file
   * is. Server and browser agree because the locale is decided once, by the
   * root loader, and handed to the provider -- so the month name the server
   * wrote is the month name hydration expects.
   */
  const i18n = useI18n();
  const refs = new Map<string, HTMLButtonElement>();
  const today = todayUtc();

  const monthTitle = () => i18n.monthYear(dayToMs(props.month + "-01"));
  const weekdays = createMemo(() => WEEK_ANCHORS.map((ms) => i18n.weekdayShort(ms)));

  const weeks = createMemo(() => {
    const days = monthGridDays(props.month);
    return Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));
  });

  const isDisabled = (day: string) =>
    day > props.max || (props.min !== undefined && day < props.min);

  createEffect(() => {
    if (props.focusToken === 0) return;
    refs.get(props.focused)?.focus();
  });

  return (
    <div class="w-[15.5rem] shrink-0" onPointerLeave={() => props.onHover?.(null)}>
      <div class="flex h-8 items-center justify-between">
        <NavButton label={i18n.t("ui.previous_month")} onClick={props.onPrev}>
          <ChevronLeft class="size-4" />
        </NavButton>
        <div aria-hidden="true" class="text-body font-medium">
          {monthTitle()}
        </div>
        <NavButton label={i18n.t("ui.next_month")} onClick={props.onNext}>
          <ChevronRight class="size-4" />
        </NavButton>
      </div>

      <div role="grid" aria-label={monthTitle()} onKeyDown={props.onKeyDown}>
        <div role="row" class="grid grid-cols-7">
          <For each={weekdays()}>
            {(name) => (
              <div
                role="columnheader"
                aria-label={name}
                class="text-muted-foreground text-caption py-1 text-center font-normal"
              >
                {name.slice(0, 2)}
              </div>
            )}
          </For>
        </div>

        <For each={weeks()}>
          {(week) => (
            <div role="row" class="grid grid-cols-7">
              <For each={week}>
                {(day) => {
                  const outside = () => monthOf(day) !== props.month;
                  const disabled = () => isDisabled(day);
                  const selected = () => props.selected(day);
                  const edge = () => props.edge?.(day) ?? null;
                  const between = () => (props.inRange?.(day) ?? false) && edge() === null;
                  return (
                    <div
                      role="gridcell"
                      aria-selected={selected()}
                      class={cn(
                        "flex justify-center py-0.5",
                        // The band lives on the cell, not the button, so it
                        // reaches the gaps and reads as one continuous range.
                        (between() || edge() !== null) && !disabled() && "bg-accent",
                        (edge() === "start" || edge() === "both") && "rounded-l-sm",
                        (edge() === "end" || edge() === "both") && "rounded-r-sm"
                      )}
                    >
                      <button
                        ref={(el) => {
                          refs.set(day, el);
                          onCleanup(() => refs.delete(day));
                        }}
                        type="button"
                        tabindex={day === props.focused ? 0 : -1}
                        disabled={disabled()}
                        aria-label={i18n.fullDate(dayToMs(day))}
                        aria-current={day === today ? "date" : undefined}
                        onClick={() => props.onPick(day)}
                        onPointerEnter={() => !disabled() && props.onHover?.(day)}
                        class={cn(
                          // A small control: 4px, like a button, inside the
                          // 6px surfaces around it.
                          "flex size-8 items-center justify-center rounded-sm",
                          // Mono at the control size, because these are numbers
                          // in a grid: the figures are one width, so a 1 and a 0
                          // occupy the same cell and the columns line up down
                          // the month.
                          "font-mono text-code",
                          "cursor-pointer transition-[color,background-color,box-shadow] outline-none",
                          "focus-visible:shadow-focus",
                          "disabled:pointer-events-none disabled:opacity-40",
                          outside() && "text-muted-foreground/60",
                          selected()
                            ? "bg-primary text-primary-foreground hover:bg-primary/90"
                            : "text-foreground hover:bg-accent hover:text-accent-foreground",
                          // Today is an outline, not a fill: the fill means
                          // selected, and a day can be both. It is drawn inset
                          // so it stays inside the cell and cannot collide with
                          // the day either side of it, and it is a step up from
                          // the hairline because at hairline alpha a mark this
                          // small is not a mark.
                          day === today &&
                            !selected() &&
                            "ring-muted-foreground/40 ring-1 ring-inset"
                        )}
                      >
                        {Number(day.slice(8, 10))}
                      </button>
                    </div>
                  );
                }}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/** Rendered even without a handler, so the two month headers stay aligned. */
function NavButton(props: { label: string; onClick?: () => void; children: JSX.Element }) {
  return (
    <Show when={props.onClick} fallback={<span class="size-control-xs" />}>
      <button
        type="button"
        aria-label={props.label}
        onClick={() => props.onClick?.()}
        class={cn(
          "size-control-xs flex cursor-pointer items-center justify-center rounded-sm",
          // These two sit alone above a grid with nothing else on that row to
          // give them an edge, so they get the hairline -- as a ring, not a
          // border, so they do not gain a pixel on the header row.
          "text-muted-foreground shadow-xs transition-[color,background-color,box-shadow]",
          "hover:bg-accent hover:text-accent-foreground",
          "outline-none focus-visible:shadow-focus"
        )}
      >
        {props.children}
      </button>
    </Show>
  );
}

/**
 * Arrow keys move a day, PageUp/PageDown a month, shift+Page a year.
 *
 * Enter and Space are deliberately absent: the cells are real buttons, so the
 * browser already turns both into a click. Handling them here as well picks the
 * day twice, which in a range picker sets and immediately clears the anchor.
 */
function dayForKey(event: KeyboardEvent, from: string): string | null {
  switch (event.key) {
    case "ArrowLeft":
      return addDays(from, -1);
    case "ArrowRight":
      return addDays(from, 1);
    case "ArrowUp":
      return addDays(from, -7);
    case "ArrowDown":
      return addDays(from, 7);
    case "Home":
      return addDays(from, -((new Date(dayToMs(from)).getUTCDay() + 6) % 7));
    case "End":
      return addDays(from, 6 - ((new Date(dayToMs(from)).getUTCDay() + 6) % 7));
    case "PageUp":
      return addMonthsToDay(from, event.shiftKey ? -12 : -1);
    case "PageDown":
      return addMonthsToDay(from, event.shiftKey ? 12 : 1);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Single day
// ---------------------------------------------------------------------------

export function Calendar(props: {
  value?: string;
  onSelect: (day: string) => void;
  /** `yyyy-mm`. Uncontrolled when absent. */
  month?: string;
  onMonthChange?: (m: string) => void;
  min?: string;
  /** Defaults to today: there is no data from the future, and offering it reads as a bug. */
  max?: string;
  class?: string;
}): JSX.Element {
  const max = () => props.max ?? todayUtc();
  const [ownMonth, setOwnMonth] = createSignal(monthOf(props.value ?? todayUtc()));
  const month = () => props.month ?? ownMonth();
  const [focused, setFocused] = createSignal(props.value ?? todayUtc());
  const [focusToken, setFocusToken] = createSignal(0);

  const setMonth = (m: string) => {
    setOwnMonth(m);
    props.onMonthChange?.(m);
  };

  const goMonth = (n: number) => {
    const next = addMonths(month(), n);
    setMonth(next);
    // Keep the keyboard stop on screen, or tabbing back in lands nowhere.
    if (monthOf(focused()) !== next) setFocused(addMonthsToDay(focused(), n));
  };

  const moveFocus = (next: string) => {
    if (next > max() || (props.min !== undefined && next < props.min)) return;
    setFocused(next);
    if (monthOf(next) !== month()) setMonth(monthOf(next));
    setFocusToken((t) => t + 1);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const next = dayForKey(event, focused());
    if (next === null) return;
    event.preventDefault();
    moveFocus(next);
  };

  return (
    <div class={cn("inline-block", props.class)}>
      <MonthGrid
        month={month()}
        focused={focused()}
        focusToken={focusToken()}
        min={props.min}
        max={max()}
        selected={(day) => day === props.value}
        onPick={(day) => {
          setFocused(day);
          props.onSelect(day);
        }}
        onKeyDown={onKeyDown}
        onPrev={() => goMonth(-1)}
        onNext={() => goMonth(1)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// A span of days
// ---------------------------------------------------------------------------

export function RangeCalendar(props: {
  from: string | null;
  to: string | null;
  /** Fires once, when both ends are known. Never mid-pick. */
  onChange: (r: { from: string; to: string }) => void;
  max?: string;
  months?: 1 | 2;
  class?: string;
}): JSX.Element {
  const max = () => props.max ?? todayUtc();
  const count = () => props.months ?? 2;

  /**
   * The first click of a pick in progress. While it is set the calendar shows
   * the range it would produce rather than the one that is saved -- and nothing
   * is reported to the caller until the second click lands.
   */
  const [anchor, setAnchor] = createSignal<string | null>(null);
  const [hovered, setHovered] = createSignal<string | null>(null);

  const initialBase = () => {
    const end = props.to ?? props.from ?? max();
    return addMonths(monthOf(end), -(count() - 1));
  };
  const [base, setBase] = createSignal(initialBase());
  const [focused, setFocused] = createSignal(props.to ?? props.from ?? max());
  const [focusToken, setFocusToken] = createSignal(0);

  const visible = createMemo(() => Array.from({ length: count() }, (_, i) => addMonths(base(), i)));

  // Follow the value when it is changed from outside -- a preset button, a
  // board that loaded -- but only when the new window is nowhere on screen, so
  // paging around by hand is not undone underneath the person doing it.
  createEffect(() => {
    const end = props.to;
    if (end === null || anchor() !== null) return;
    if (visible().includes(monthOf(end))) return;
    setBase(addMonths(monthOf(end), -(count() - 1)));
  });

  /** The two ends currently on show: the pick in progress, else the value. */
  const ends = createMemo(() => {
    const a = anchor();
    if (a !== null) {
      const b = hovered() ?? a;
      return a <= b ? { from: a, to: b } : { from: b, to: a };
    }
    if (props.from === null || props.to === null) return null;
    return props.from <= props.to
      ? { from: props.from, to: props.to }
      : { from: props.to, to: props.from };
  });

  const edge = (day: string): Edge => {
    const e = ends();
    if (e === null) return null;
    if (e.from === e.to) return day === e.from ? "both" : null;
    if (day === e.from) return "start";
    if (day === e.to) return "end";
    return null;
  };

  const inRange = (day: string) => {
    const e = ends();
    return e !== null && day >= e.from && day <= e.to;
  };

  /** Either order: whichever two days get clicked, the earlier one is `from`. */
  const pick = (day: string) => {
    setFocused(day);
    const a = anchor();
    if (a === null) {
      setAnchor(day);
      setHovered(null);
      return;
    }
    setAnchor(null);
    setHovered(null);
    props.onChange(a <= day ? { from: a, to: day } : { from: day, to: a });
  };

  const goMonth = (n: number) => setBase(addMonths(base(), n));

  const moveFocus = (next: string) => {
    if (next > max()) return;
    setFocused(next);
    const m = monthOf(next);
    const months = visible();
    if (!months.includes(m)) setBase(m < months[0]! ? m : addMonths(m, -(count() - 1)));
    setFocusToken((t) => t + 1);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const next = dayForKey(event, focused());
    if (next === null) {
      // Abandoning a half-finished range is worth a key of its own; without it
      // the only way out is to pick a second day you did not want.
      if (event.key === "Escape" && anchor() !== null) {
        event.stopPropagation();
        setAnchor(null);
        setHovered(null);
      }
      return;
    }
    event.preventDefault();
    moveFocus(next);
  };

  return (
    <div class={cn("flex gap-4", props.class)}>
      <For each={visible()}>
        {(month, i) => (
          <MonthGrid
            month={month}
            focused={focused()}
            focusToken={focusToken()}
            max={max()}
            selected={(day) => edge(day) !== null}
            inRange={inRange}
            edge={edge}
            onPick={pick}
            onHover={(day) => anchor() !== null && setHovered(day)}
            onKeyDown={onKeyDown}
            onPrev={i() === 0 ? () => goMonth(-1) : undefined}
            onNext={i() === count() - 1 ? () => goMonth(1) : undefined}
          />
        )}
      </For>
    </div>
  );
}

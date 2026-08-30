import { RadioGroup as KRadioGroup } from "@kobalte/core/radio-group";
import { Show, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * A radio group, on Kobalte's primitive.
 *
 * The group is one tab stop and the arrow keys move between the options -- that
 * is what a radio group is, and Kobalte already does it. Nothing here adds a
 * key handler; a custom one is how a group ends up with one tab stop per option
 * and no arrow keys at all.
 *
 * `ItemInput` sits before `ItemControl` rather than inside it, which is where
 * Kobalte puts it, and it is marked as the peer so the two-stop focus ring can
 * be read across the sibling. That is more dependable here than reaching down
 * into the control with a `:has()` selector written as an arbitrary variant:
 * arbitrary variants have silently emitted nothing in this repo before, and
 * whether a control shows focus should not rest on that.
 */

export interface RadioGroupProps<T extends string = string> {
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  /** Vertical by default. Cards usually want the caller's grid instead. */
  orientation?: "horizontal" | "vertical";
  name?: string;
  disabled?: boolean;
  required?: boolean;
  readOnly?: boolean;
  class?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  children?: JSX.Element;
}

export function RadioGroup<T extends string = string>(props: RadioGroupProps<T>): JSX.Element {
  return (
    <KRadioGroup
      value={props.value}
      defaultValue={props.defaultValue}
      onChange={(value) => props.onChange?.(value as T)}
      orientation={props.orientation ?? "vertical"}
      name={props.name}
      disabled={props.disabled}
      required={props.required}
      readOnly={props.readOnly}
      aria-label={props["aria-label"]}
      aria-labelledby={props["aria-labelledby"]}
      class={cn(
        "flex gap-3",
        props.orientation === "horizontal" ? "flex-row flex-wrap items-start" : "flex-col",
        props.class
      )}
    >
      {props.children}
    </KRadioGroup>
  );
}

/** The conventional one: a dot, a label, and a line of explanation under it. */
export function RadioGroupItem<T extends string = string>(props: {
  value: T;
  label: JSX.Element;
  description?: JSX.Element;
  disabled?: boolean;
  class?: string;
}): JSX.Element {
  return (
    <KRadioGroup.Item
      value={props.value}
      disabled={props.disabled}
      class={cn("flex items-start gap-2.5", props.class)}
    >
      <KRadioGroup.ItemInput class="peer sr-only" />
      <KRadioGroup.ItemControl
        class={cn(
          "mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full",
          // The hairline is a box-shadow and follows the radius, so a circular
          // control gets a circular edge without a border on it.
          "bg-card shadow-xs transition-[background-color,box-shadow]",
          "data-[checked]:bg-primary",
          "peer-focus-visible:shadow-focus",
          "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40"
        )}
      >
        <KRadioGroup.ItemIndicator class="size-1.5 rounded-full bg-primary-foreground" />
      </KRadioGroup.ItemControl>
      <div class="flex flex-col gap-0.5">
        <KRadioGroup.ItemLabel class="text-body cursor-pointer leading-none font-medium select-none">
          {props.label}
        </KRadioGroup.ItemLabel>
        <Show when={props.description}>
          <KRadioGroup.ItemDescription class="text-caption text-muted-foreground">
            {props.description}
          </KRadioGroup.ItemDescription>
        </Show>
      </div>
    </KRadioGroup.Item>
  );
}

/**
 * The same choice as a card.
 *
 * Used where the explanation is the decision -- website versus desktop app,
 * one dashboard template versus another. Nobody picks those by reading two
 * words next to a dot, so the card is the control and the dot is gone.
 *
 * It takes a `class` and imposes no layout of its own: the grid belongs to the
 * caller, who is the only one who knows how many cards there are.
 */
export function RadioCard<T extends string>(props: {
  value: T;
  label: string;
  description?: string;
  icon?: JSX.Element;
  badge?: JSX.Element;
  disabled?: boolean;
  class?: string;
}): JSX.Element {
  return (
    <KRadioGroup.Item value={props.value} disabled={props.disabled} class={cn("h-full", props.class)}>
      <KRadioGroup.ItemInput class="peer sr-only" />
      <KRadioGroup.ItemControl
        class={cn(
          "flex h-full cursor-pointer flex-col gap-3 rounded-md bg-card p-4 shadow-xs",
          "text-left transition-[color,background-color,box-shadow]",
          "hover:bg-accent",
          "peer-focus-visible:shadow-focus",
          // Selected is the card's own edge going to the text extreme, not a
          // coloured wash across the whole face: the words on it are the reason
          // the card exists and a fill would fight them. The ring composes in
          // front of the hairline, so the card keeps its edge either way.
          "data-[checked]:ring-1 data-[checked]:ring-primary",
          "data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
        )}
      >
        {/*
          The row is decided on the KEYS, not on the two markup props.

          `when={props.icon}` would read the prop to test it, and reading a
          markup prop BUILDS its nodes -- here, before the span meant to hold
          them exists. During hydration that claims the server's nodes out of
          order, Solid throws a hydration mismatch, and its own error path
          cannot print itself: the console says `template2 is not a function`
          and the page renders a second time beside the first. Reading it again
          to render it builds a second copy on top of that. `in` asks whether
          the caller passed the prop without invoking the getter, so each one is
          read exactly once and only where it belongs.
        */}
        <Show when={"icon" in props || "badge" in props}>
          <div class="flex items-start justify-between gap-3">
            <Show when={"icon" in props}>
              <span class="text-muted-foreground [&_svg]:size-5" aria-hidden="true">
                {props.icon}
              </span>
            </Show>
            <Show when={"badge" in props}>
              <span class="ml-auto">{props.badge}</span>
            </Show>
          </div>
        </Show>
        <div class="flex flex-col gap-1">
          <KRadioGroup.ItemLabel class="text-body cursor-pointer leading-none font-medium select-none">
            {props.label}
          </KRadioGroup.ItemLabel>
          <Show when={props.description}>
            <KRadioGroup.ItemDescription class="text-small text-muted-foreground">
              {props.description}
            </KRadioGroup.ItemDescription>
          </Show>
        </div>
      </KRadioGroup.ItemControl>
    </KRadioGroup.Item>
  );
}

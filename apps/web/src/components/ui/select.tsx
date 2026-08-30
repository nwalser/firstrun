import { Select as KSelect } from "@kobalte/core/select";
import { For, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";
import { useI18n } from "../../lib/i18n/index.js";

/**
 * A styled select, on Kobalte's listbox primitive.
 *
 * A native `<select>` cannot be styled to match the rest of this, and a
 * hand-rolled dropdown gets keyboard navigation, typeahead and focus return
 * wrong in ways nobody notices until someone uses a keyboard.
 *
 * The trigger is deliberately an input: same 36px height, same 14px/20px text,
 * same raised fill, same 1px ring, same two-stop blue focus. A select that is a
 * slightly different shape from the field above it is the fastest way to make a
 * form look assembled from parts.
 *
 * The menu is a popover row list: 36px rows at 6px radius, on the popover
 * surface, lifted by the menu shadow. That shadow already contains its own
 * hairline, so the content has no border.
 */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export function Select<T extends string>(props: {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  class?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const i18n = useI18n();
  const selected = () => props.options.find((o) => o.value === props.value) ?? null;

  return (
    <KSelect<SelectOption<T>>
      value={selected()}
      onChange={(option) => option && props.onChange(option.value)}
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      disabled={props.disabled}
      placeholder={props.placeholder ?? i18n.t("ui.select_placeholder")}
      itemComponent={(itemProps) => (
        <KSelect.Item
          item={itemProps.item}
          class={cn(
            "relative flex h-popover-row w-full cursor-pointer items-center gap-2 rounded-md",
            "pr-8 pl-2 text-control-md text-popover-foreground outline-none select-none",
            "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
            "data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
          )}
        >
          <KSelect.ItemLabel class="truncate">{itemProps.item.rawValue.label}</KSelect.ItemLabel>
          <KSelect.ItemIndicator class="absolute right-2 flex size-3.5 items-center justify-center">
            <CheckIcon />
          </KSelect.ItemIndicator>
        </KSelect.Item>
      )}
    >
      <KSelect.Trigger
        aria-label={props["aria-label"]}
        class={cn(
          "flex h-control-md w-full cursor-pointer items-center justify-between gap-2 rounded-md",
          "bg-card px-3 shadow-xs text-control-md text-foreground",
          "transition-[color,background-color,box-shadow] outline-none",
          "focus-visible:shadow-focus",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
          props.class
        )}
      >
        <KSelect.Value<SelectOption<T>> class="truncate">
          {(state) => state.selectedOption()?.label}
        </KSelect.Value>
        {/* The chevron is a control affordance, not body text: strong enough to
            find, quiet enough not to compete with the value beside it. */}
        <KSelect.Icon class="text-muted-foreground shrink-0">
          <ChevronIcon />
        </KSelect.Icon>
      </KSelect.Trigger>

      <KSelect.Portal>
        <KSelect.Content
          class={cn(
            "bg-popover text-popover-foreground z-50 min-w-[8rem] overflow-hidden rounded-md",
            // The menu shadow carries its own hairline, so no border here.
            "shadow-xl",
            "data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95",
            "data-[closed]:animate-out data-[closed]:fade-out-0"
          )}
        >
          <KSelect.Listbox class="max-h-64 overflow-y-auto p-1" />
        </KSelect.Content>
      </KSelect.Portal>
    </KSelect>
  );
}

/**
 * A small segmented control, for choices short enough to show all at once.
 *
 * The selected face is the raised surface lifted out of a muted trough, which
 * is the one place in this system where a fill rather than an edge marks state:
 * a ring on the selected segment would collide with the trough's own ring a
 * couple of pixels away. The segments are small controls, so 4px radius inside
 * the trough's 6.
 */
export function SegmentedControl<T extends string | number>(props: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  class?: string;
}): JSX.Element {
  return (
    <div class={cn("bg-muted inline-flex items-center gap-0.5 rounded-md p-0.5 shadow-xs", props.class)}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => props.onChange(option.value)}
            aria-pressed={props.value === option.value}
            class={cn(
              "h-control-xs cursor-pointer rounded-sm px-2.5 text-control-sm",
              "transition-[color,background-color,box-shadow] outline-none",
              "focus-visible:shadow-focus",
              "disabled:pointer-events-none disabled:opacity-40",
              props.value === option.value
                ? "bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
